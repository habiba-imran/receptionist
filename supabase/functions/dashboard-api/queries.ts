// Read endpoints: ?resource=appointments | stats | appointment.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type {
  AppointmentDetailDto,
  CallsResponse,
  CallRowDto,
  CallTranscriptTurnDto,
  DbAppointmentDetailRow,
  DbAppointmentRow,
  DbCallBookingRow,
  DbEscalationRow,
  EscalationListResponse,
  EscalationRowDto,
  EscalationStatsDto,
  EscalationStatus,
  EscalationTrigger,
  Identity,
  ListParams,
  ListResponse,
  Result,
  StatsDto,
} from "./types.ts";
import {
  ESCALATION_STATUSES,
  ESCALATION_TRIGGERS,
  fail,
  ok,
} from "./types.ts";
import { parseListParams } from "./params.ts";
import { mapRow, mapVobDetail, mapEscalationRow } from "./mapping.ts";
import {
  buildPatientSearchOr,
  DEFAULT_TZ,
  isUuid,
  maskPhone,
  parseYmd,
  safeTimezone,
  tzTodayRange,
  ymdRangeUtc,
} from "./util.ts";

const APPOINTMENT_COLUMNS =
  "id,location_id,patient_id,booking_id,call_id,vob_id,status,source,service_interest," +
  "language,triage,insurance_captured,booked_by_agent,booked_at,after_hours,starts_at," +
  "appointment_text_raw,time_parse_status,time_parse_confidence,needs_review,review_reasons," +
  "is_seeded,created_at,updated_at";

const EMBEDS_COMMON =
  "patient:patients!inner(first_name,last_name,full_legal_name,phone_e164)," +
  "location:locations(name)," +
  "confirmation_attempts(id,at,outcome,channel)," +
  "timeline:appointment_events(id,at,label,actor)," +
  "staff_notes(id,at,author,body)," +
  "booking:bookings(id,call_id)";

const VOB_DETAIL_EMBED =
  "vob:vob_queue(status,payer_name,copay," +
  "individual_deductible_total,individual_deductible_met,individual_deductible_remaining," +
  "individual_oop_total,individual_oop_met,individual_oop_remaining," +
  "prior_auth_required,updated_at)";

// Minimal structural view of the PostgREST builder so filter logic is shared
// across differently-typed query chains without `any`.
interface FilterableQuery {
  eq(column: string, value: string | boolean): this;
  is(column: string, value: null): this;
  gte(column: string, value: string): this;
  lt(column: string, value: string): this;
  or(filters: string, options?: { referencedTable?: string }): this;
}

// Awaitable structural views of the PostgREST builder. Queries are cast to these at the
// .select() boundary: the dynamic select strings blow up supabase-js's type-level query
// parser (TS2589), and these carry exactly the shape each call site consumes at runtime.
type CountQuery = FilterableQuery & PromiseLike<{
  count: number | null;
  error: { message: string } | null;
}>;

interface ListQuery extends FilterableQuery {
  order(
    column: string,
    options?: { ascending?: boolean; nullsFirst?: boolean; referencedTable?: string },
  ): this;
  limit(count: number): this;
  then<TResult>(
    onfulfilled: (value: {
      data: unknown[] | null;
      error: { message: string } | null;
      count: number | null;
    }) => TResult,
  ): PromiseLike<TResult>;
}

// ---------- shared helpers ----------

async function resolveTimezone(db: SupabaseClient, locationId: string | null): Promise<string> {
  const base = db.from("locations").select("timezone");
  const query = locationId !== null
    ? base.eq("id", locationId).limit(1)
    : base.order("created_at", { ascending: true }).limit(1);
  const { data, error } = await query.maybeSingle();
  if (error !== null || data === null) {
    if (error !== null) console.error("dashboard-api: timezone lookup failed", error);
    return DEFAULT_TZ;
  }
  const row = data as { timezone: string | null };
  return safeTimezone(row.timezone ?? DEFAULT_TZ);
}

function applyFilters<T extends FilterableQuery>(
  query: T,
  p: ListParams,
  searchOr: string | null,
  fromIso: string | null,
  toIso: string | null,
): T {
  let q = query;
  if (!p.includeSeeded) q = q.eq("is_seeded", false);
  if (p.status !== null) q = q.eq("status", p.status);
  if (p.source !== null) q = q.eq("source", p.source);
  if (p.triage !== null) q = q.eq("triage", p.triage);
  if (p.language !== null) q = q.eq("language", p.language);
  if (p.locationId !== null) q = q.eq("location_id", p.locationId);
  if (p.vob === "none") q = q.is("vob_id", null);
  else if (p.vob !== null) q = q.eq("vob.status", p.vob);
  if (fromIso !== null) q = q.gte("starts_at", fromIso);
  if (toIso !== null) q = q.lt("starts_at", toIso);
  if (searchOr !== null) q = q.or(searchOr, { referencedTable: "patient" });
  return q;
}

/** Which of these booking ids have a non-null transcript (chunked to keep URLs short). */
async function bookingsWithTranscript(db: SupabaseClient, ids: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const { data, error } = await db
      .from("bookings")
      .select("id")
      .in("id", chunk)
      .not("transcript", "is", null);
    if (error !== null) throw new Error(`bookings transcript lookup failed: ${error.message}`);
    for (const row of (data ?? []) as { id: string }[]) found.add(row.id);
  }
  return found;
}

// ---------- GET ?resource=appointments ----------

export async function listAppointments(
  db: SupabaseClient,
  identity: Identity,
  url: URL,
): Promise<Result<ListResponse>> {
  const parsed = parseListParams(url);
  if (!parsed.ok) return parsed;
  const p = parsed.data;

  let searchOr: string | null = null;
  if (p.search !== null) {
    searchOr = buildPatientSearchOr(p.search);
    if (searchOr === null) {
      // Unusable search input matches nothing, never everything.
      return ok(
        identity.mode === "PHI_BAA"
          ? { rows: [], total: 0 }
          : { kind: "aggregate", total: 0 },
      );
    }
  }

  let fromIso: string | null = null;
  let toIso: string | null = null;
  if (p.dateFrom !== null || p.dateTo !== null) {
    const tz = await resolveTimezone(db, p.locationId);
    const range = ymdRangeUtc(
      tz,
      p.dateFrom !== null ? parseYmd(p.dateFrom) : null,
      p.dateTo !== null ? parseYmd(p.dateTo) : null,
    );
    fromIso = range.fromIso;
    toIso = range.toIso;
  }

  const vobInner = p.vob !== null && p.vob !== "none";

  if (identity.mode !== "PHI_BAA") {
    // Aggregate only: count via HEAD request, return no rows.
    const parts = ["id"];
    if (searchOr !== null) parts.push("patient:patients!inner(id)");
    if (vobInner) parts.push("vob:vob_queue!inner(status)");
    const countQuery = applyFilters(
      db.from("appointments")
        .select(parts.join(","), { count: "exact", head: true }) as unknown as CountQuery,
      p,
      searchOr,
      fromIso,
      toIso,
    );
    const { count, error } = await countQuery;
    if (error !== null) {
      console.error("dashboard-api: appointments count failed", error);
      return fail(500, "internal_error", "Could not load appointments");
    }
    return ok({ kind: "aggregate", total: count ?? 0 });
  }

  const select = [
    APPOINTMENT_COLUMNS,
    vobInner ? "vob:vob_queue!inner(status)" : "vob:vob_queue(status)",
    EMBEDS_COMMON,
  ].join(",");

  const listQuery = applyFilters(
    db.from("appointments").select(select, { count: "exact" }) as unknown as ListQuery,
    p,
    searchOr,
    fromIso,
    toIso,
  );
  const { data, error, count } = await listQuery
    .order("is_seeded", { ascending: true })
    .order("created_at", { ascending: false })
    .order("starts_at", { ascending: true, nullsFirst: false })
    .order("at", { referencedTable: "confirmation_attempts", ascending: true })
    .order("at", { referencedTable: "timeline", ascending: true })
    .order("at", { referencedTable: "staff_notes", ascending: true })
    .limit(p.limit);
  if (error !== null) {
    console.error("dashboard-api: appointments list failed", error);
    return fail(500, "internal_error", "Could not load appointments");
  }

  const rows = (data ?? []) as unknown as DbAppointmentRow[];
  let transcriptIds: Set<string>;
  try {
    transcriptIds = await bookingsWithTranscript(
      db,
      rows.map((r) => (r.booking !== null ? r.booking.id : null)).filter((v): v is string => v !== null),
    );
  } catch (e) {
    console.error("dashboard-api: transcript lookup failed", e);
    return fail(500, "internal_error", "Could not load appointments");
  }

  return ok({ rows: rows.map((r) => mapRow(r, transcriptIds)), total: count ?? rows.length });
}

// ---------- GET ?resource=appointment&id=... ----------

export async function getAppointmentDetail(
  db: SupabaseClient,
  identity: Identity,
  id: string,
): Promise<Result<AppointmentDetailDto>> {
  if (identity.mode !== "PHI_BAA") {
    return fail(403, "forbidden", "Appointment detail requires PHI_BAA mode");
  }
  if (!isUuid(id)) {
    return fail(400, "bad_request", "id must be a UUID");
  }

  const select = [APPOINTMENT_COLUMNS, VOB_DETAIL_EMBED, EMBEDS_COMMON].join(",");
  const { data, error } = await db
    .from("appointments")
    .select(select)
    .eq("id", id)
    .order("at", { referencedTable: "confirmation_attempts", ascending: true })
    .order("at", { referencedTable: "timeline", ascending: true })
    .order("at", { referencedTable: "staff_notes", ascending: true })
    .maybeSingle();
  if (error !== null) {
    console.error("dashboard-api: appointment detail failed", error);
    return fail(500, "internal_error", "Could not load appointment");
  }
  if (data === null) {
    return fail(404, "not_found", "Appointment not found");
  }

  const row = data as unknown as DbAppointmentDetailRow;
  let transcriptIds = new Set<string>();
  try {
    if (row.booking !== null) {
      transcriptIds = await bookingsWithTranscript(db, [row.booking.id]);
    }
  } catch (e) {
    console.error("dashboard-api: transcript lookup failed", e);
    return fail(500, "internal_error", "Could not load appointment");
  }

  return ok({ ...mapRow(row, transcriptIds), vob: mapVobDetail(row) });
}

// ---------- GET ?resource=calls ----------

export async function listCalls(
  db: SupabaseClient,
  identity: Identity,
  url: URL,
): Promise<Result<CallsResponse>> {
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 80) || 80, 1), 200);
  const locationId = url.searchParams.get("location_id");
  if (locationId !== null && !isUuid(locationId)) {
    return fail(400, "bad_request", "location_id must be a UUID");
  }

  const countQuery = db
    .from("bookings")
    .select("id", { count: "exact", head: true }) as unknown as CountQuery;
  const { count, error: countError } = await countQuery;
  if (countError !== null) {
    console.error("dashboard-api: calls count failed", countError);
    return fail(500, "internal_error", "Could not load calls");
  }

  if (identity.mode !== "PHI_BAA") {
    return ok({ kind: "aggregate", total: count ?? 0 });
  }

  const { data, error } = await db
    .from("bookings")
    .select(
      "id,call_id,created_at,updated_at,call_started_at,representative,practice,language," +
        "contact_number,first_name,full_legal_name,reason,appointment_text,patient_status," +
        "insurance_status,triage_flag,transfer_initiated,transcript,call_summary,recording_url,raw_payload",
      { count: "exact" },
    )
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error !== null) {
    console.error("dashboard-api: calls list failed", error);
    return fail(500, "internal_error", "Could not load calls");
  }

  const defaultLocation = await resolveDefaultLocation(db);
  const rows = ((data ?? []) as DbCallBookingRow[])
    .map((row) => mapCallBooking(row, identity, defaultLocation))
    .filter((row) => locationId === null || row.locationId === locationId);

  return ok({
    rows,
    total: count ?? data?.length ?? 0,
  });
}

function mapCallBooking(
  row: DbCallBookingRow,
  identity: Identity,
  defaultLocation: { id: string | null; name: string | null },
): CallRowDto {
  const raw = row.raw_payload ?? {};
  const call = objectValue(raw.call) ?? objectValue(objectValue(raw.data)?.call) ?? {};
  const transcriptCrm = objectValue(raw.transcript_crm) ?? {};
  const finalized = transcriptCrm.finalized === true || stringValue(transcriptCrm.last_event) === "call_ended";
  const status = stringValue(call.call_status ?? raw.call_status);
  const fromNumber = stringValue(call.from_number ?? raw.from_number);
  const toNumber = stringValue(call.to_number ?? raw.to_number);
  const start = timestampValue(call.start_timestamp) ?? row.call_started_at ?? row.created_at;
  const active = !finalized && isActiveCallStatus(status) && isFreshActiveCall(row.updated_at);
  const end = timestampValue(call.end_timestamp) ?? (active ? null : row.updated_at);
  const durationSeconds = end ? Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 1000)) : 0;
  const triage = normalizeTriage(row.triage_flag);
  const full = (row.full_legal_name ?? row.first_name ?? "").trim();
  const nameParts = full.split(/\s+/).filter(Boolean);
  const firstName = row.first_name ?? nameParts[0] ?? null;
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : null;

  return {
    id: row.call_id,
    callId: row.call_id,
    at: start,
    updatedAt: row.updated_at,
    direction: toNumber ? "inbound" : fromNumber ? "outbound" : "inbound",
    agent: isVobAgent(row.representative, raw) ? "vob" : "receptionist",
    patient: {
      firstName,
      lastName,
      fullName: full || firstName,
      phoneMasked: maskPhone(row.contact_number),
      phoneE164: null,
    },
    durationSeconds,
    disposition: active
      ? "in_progress"
      : row.transfer_initiated || triage === "high" || triage === "urgent"
      ? "escalated"
      : row.appointment_text
      ? "booked"
      : "info_only",
    triage,
    locationId: defaultLocation.id,
    locationName: row.practice ?? defaultLocation.name ?? "Awaaz Labs Cardiology",
    recordingUrl: canAccessCallMedia(identity)
      ? stringValue(row.recording_url ?? call.recording_url ?? raw.recording_url)
      : null,
    transcript: canAccessCallMedia(identity) ? parseTranscript(row.transcript, start) : null,
    summary: row.call_summary,
  };
}

async function resolveDefaultLocation(db: SupabaseClient): Promise<{ id: string | null; name: string | null }> {
  const { data, error } = await db
    .from("locations")
    .select("id,name")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error !== null) {
    console.error("dashboard-api: default location lookup failed", error);
    return { id: null, name: null };
  }
  return {
    id: typeof data?.id === "string" ? data.id : null,
    name: typeof data?.name === "string" ? data.name : null,
  };
}

function canAccessCallMedia(identity: Identity): boolean {
  return identity.mode === "PHI_BAA" && identity.role !== "VIEWER";
}

function parseTranscript(transcript: string | null, fallbackAt: string): CallTranscriptTurnDto[] {
  if (!transcript) return [];
  return transcript
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(agent|assistant|ai|user|patient|caller|customer)\s*:\s*(.+)$/i);
      const role = (match?.[1] ?? "").toLowerCase();
      return {
        speaker: role === "agent" || role === "assistant" || role === "ai" ? "agent" : "patient",
        at: fallbackAt,
        text: match?.[2]?.trim() || line,
      };
    });
}

function normalizeTriage(value: string | null): "none" | "low" | "high" | "urgent" {
  const v = (value ?? "").toLowerCase();
  if (v.includes("urgent") || v.includes("emergency")) return "urgent";
  if (v.includes("high")) return "high";
  if (v.includes("low") || v.includes("chest_pain")) return "low";
  return "none";
}

function isActiveCallStatus(status: string | null): boolean {
  if (!status) return false;
  return ["registered", "ongoing", "in_progress", "active"].includes(status.toLowerCase());
}

function isFreshActiveCall(updatedAt: string): boolean {
  const updatedMs = Date.parse(updatedAt);
  if (!Number.isFinite(updatedMs)) return false;
  return Date.now() - updatedMs < 15 * 60 * 1000;
}

function isVobAgent(representative: string | null, raw: Record<string, unknown>): boolean {
  const hay = [representative, stringValue(objectValue(raw.call)?.agent_name), stringValue(objectValue(raw.call)?.agent_id)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes("vera") || hay.includes("vob") || hay.includes("agent_c8ad10f68136aafcbc25821e51");
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function timestampValue(value: unknown): string | null {
  if (typeof value !== "number") return null;
  const ms = value > 10_000_000_000 ? value : value * 1000;
  return new Date(ms).toISOString();
}

// ---------- GET ?resource=stats ----------

export async function getStats(db: SupabaseClient): Promise<Result<StatsDto>> {
  try {
    const tz = await resolveTimezone(db, null);
    const now = new Date();
    const today = tzTodayRange(tz, now);
    const nowIso = now.toISOString();
    const in7Iso = new Date(now.getTime() + 7 * 86_400_000).toISOString();
    const ago30Iso = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    const head = { count: "exact" as const, head: true };

    const [bookedToday, upcomingNext7Days, attempted, attemptedConfirmed, noShow30, completed30] =
      await Promise.all([
        countOf(
          db.from("appointments").select("id", head)
            .eq("is_seeded", false)
            .gte("booked_at", today.startIso).lt("booked_at", today.endIso),
          "bookedToday",
        ),
        countOf(
          db.from("appointments").select("id", head)
            .eq("is_seeded", false)
            .gte("starts_at", nowIso).lt("starts_at", in7Iso)
            .not("status", "in", "(cancelled,no_show)"),
          "upcomingNext7Days",
        ),
        countOf(
          db.from("appointments").select("id,confirmation_attempts!inner(id)", head)
            .eq("is_seeded", false),
          "attempted",
        ),
        countOf(
          db.from("appointments").select("id,confirmation_attempts!inner(id)", head)
            .eq("is_seeded", false)
            .in("status", ["confirmed", "completed", "rescheduled"]),
          "attemptedConfirmed",
        ),
        countOf(
          db.from("appointments").select("id", head)
            .eq("is_seeded", false)
            .eq("status", "no_show").gte("starts_at", ago30Iso).lte("starts_at", nowIso),
          "noShow30",
        ),
        countOf(
          db.from("appointments").select("id", head)
            .eq("is_seeded", false)
            .eq("status", "completed").gte("starts_at", ago30Iso).lte("starts_at", nowIso),
          "completed30",
        ),
      ]);

    const confirmationRate = attempted === 0 ? null : attemptedConfirmed / attempted;
    const denom30 = noShow30 + completed30;
    const noShowRate30d = denom30 === 0 ? null : noShow30 / denom30;

    return ok({ bookedToday, upcomingNext7Days, confirmationRate, noShowRate30d });
  } catch (e) {
    console.error("dashboard-api: stats failed", e);
    return fail(500, "internal_error", "Could not compute stats");
  }
}

async function countOf(
  query: PromiseLike<{ count: number | null; error: { message: string } | null }>,
  label: string,
): Promise<number> {
  const { count, error } = await query;
  if (error !== null) throw new Error(`${label} count failed: ${error.message}`);
  return count ?? 0;
}

// ---------- escalations ----------

const ESCALATION_COLUMNS =
  "id,location_id,booking_id,call_id,patient_id,trigger,routed_to,status," +
  "acknowledged_at,acknowledged_by,resolution_note,created_at,updated_at";

const ESCALATION_EMBEDS =
  "patient:patients(first_name,last_name)," +
  "location:locations(name)";

function parseEscalationListParams(url: URL): Result<{ status: EscalationStatus | null; trigger: EscalationTrigger | null; locationId: string | null; limit: number }> {
  const sp = url.searchParams;
  const pick = (name: string): string | null => {
    const value = sp.get(name);
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  };

  const status = pick("status");
  if (status !== null && !(ESCALATION_STATUSES as readonly string[]).includes(status)) {
    return fail(400, "bad_request", `status must be one of: ${ESCALATION_STATUSES.join(", ")}`);
  }
  const trigger = pick("trigger");
  if (trigger !== null && !(ESCALATION_TRIGGERS as readonly string[]).includes(trigger)) {
    return fail(400, "bad_request", `trigger must be one of: ${ESCALATION_TRIGGERS.join(", ")}`);
  }
  const locationId = pick("location_id");
  if (locationId !== null && !isUuid(locationId)) {
    return fail(400, "bad_request", "location_id must be a UUID");
  }
  const limitRaw = pick("limit");
  let limit = 500;
  if (limitRaw !== null) {
    limit = Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      return fail(400, "bad_request", "limit must be an integer between 1 and 1000");
    }
  }

  return ok({ status: status as EscalationStatus | null, trigger: trigger as EscalationTrigger | null, locationId, limit });
}

function applyEscalationFilters<T extends FilterableQuery>(
  query: T,
  status: string | null,
  trigger: string | null,
  locationId: string | null,
): T {
  let q = query;
  if (status !== null) q = q.eq("status", status);
  if (trigger !== null) q = q.eq("trigger", trigger);
  if (locationId !== null) q = q.eq("location_id", locationId);
  return q;
}

export async function listEscalations(
  db: SupabaseClient,
  identity: Identity,
  url: URL,
): Promise<Result<EscalationListResponse>> {
  const parsed = parseEscalationListParams(url);
  if (!parsed.ok) return parsed;
  const p = parsed.data;

  if (identity.mode !== "PHI_BAA") {
    const countQuery = applyEscalationFilters(
      db.from("escalations").select("id", { count: "exact", head: true }) as unknown as CountQuery,
      p.status,
      p.trigger,
      p.locationId,
    );
    const { count, error } = await countQuery;
    if (error !== null) {
      console.error("dashboard-api: escalations count failed", error);
      return fail(500, "internal_error", "Could not load escalations");
    }
    return ok({ kind: "aggregate", total: count ?? 0 });
  }

  const select = `${ESCALATION_COLUMNS},${ESCALATION_EMBEDS}`;
  const listQuery = applyEscalationFilters(
    db.from("escalations").select(select, { count: "exact" }) as unknown as ListQuery,
    p.status,
    p.trigger,
    p.locationId,
  );
  const { data, error, count } = await listQuery
    .order("created_at", { ascending: false })
    .limit(p.limit);
  if (error !== null) {
    console.error("dashboard-api: escalations list failed", error);
    return fail(500, "internal_error", "Could not load escalations");
  }

  const rows = (data ?? []) as unknown as DbEscalationRow[];
  return ok({ rows: rows.map((r) => mapEscalationRow(r)), total: count ?? rows.length });
}

export async function getEscalationDetail(
  db: SupabaseClient,
  identity: Identity,
  id: string,
): Promise<Result<EscalationRowDto>> {
  if (identity.mode !== "PHI_BAA") {
    return fail(403, "forbidden", "Escalation detail requires PHI_BAA mode");
  }
  if (!isUuid(id)) {
    return fail(400, "bad_request", "id must be a UUID");
  }

  const select = `${ESCALATION_COLUMNS},${ESCALATION_EMBEDS}`;
  const { data, error } = await db
    .from("escalations")
    .select(select)
    .eq("id", id)
    .maybeSingle();
  if (error !== null) {
    console.error("dashboard-api: escalation detail failed", error);
    return fail(500, "internal_error", "Could not load escalation");
  }
  if (data === null) {
    return fail(404, "not_found", "Escalation not found");
  }

  const row = data as unknown as DbEscalationRow;
  return ok(mapEscalationRow(row));
}

export async function getEscalationStats(db: SupabaseClient): Promise<Result<EscalationStatsDto>> {
  try {
    const tz = await resolveTimezone(db, null);
    const now = new Date();
    const weekStartIso = new Date(now.getTime() - 7 * 86_400_000).toISOString();

    // Fetch all escalations with minimal fields for aggregate computation.
    // No PHI crosses this boundary - only trigger/status/timestamps.
    const { data, error } = await db
      .from("escalations")
      .select("trigger,status,acknowledged_at,created_at")
      .order("created_at", { ascending: false })
      .limit(10000);
    if (error !== null) {
      console.error("dashboard-api: escalation stats failed", error);
      return fail(500, "internal_error", "Could not compute escalation stats");
    }

    const rows = (data ?? []) as Array<{ trigger: string; status: string; acknowledged_at: string | null; created_at: string }>;
    const total = rows.length;
    const thisWeek = rows.filter((r) => r.created_at >= weekStartIso).length;
    const acknowledged = rows.filter((r) => r.acknowledged_at !== null);
    const ackRate = total > 0 ? acknowledged.length / total : null;

    // Median time to acknowledge (in seconds)
    const ackDeltas = acknowledged
      .map((r) => (new Date(r.acknowledged_at as string).getTime() - new Date(r.created_at).getTime()) / 1000)
      .sort((a, b) => a - b);
    const medianTimeToAckSeconds = ackDeltas.length > 0
      ? ackDeltas.length % 2 === 1
        ? ackDeltas[Math.floor(ackDeltas.length / 2)]
        : (ackDeltas[ackDeltas.length / 2 - 1] + ackDeltas[ackDeltas.length / 2]) / 2
      : null;

    // Trigger counts - initialize all triggers to 0
    const triggerCounts: Record<string, number> = {};
    for (const t of ESCALATION_TRIGGERS) triggerCounts[t] = 0;
    for (const r of rows) {
      if (triggerCounts[r.trigger] !== undefined) triggerCounts[r.trigger]++;
    }

    return ok({ total, thisWeek, ackRate, medianTimeToAckSeconds, triggerCounts });
  } catch (e) {
    console.error("dashboard-api: escalation stats failed", e);
    return fail(500, "internal_error", "Could not compute escalation stats");
  }
}






