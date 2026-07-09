// POST actions: reveal_phone, status_change, add_note, record_search.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { background } from "../_shared/supa.ts";
import { invalidateDashboardCache } from "../_shared/dashboard-cache.ts";
import { syncBookingToDomain } from "../_shared/sync-domain.ts";
import type { AppointmentStatus, Identity, Result, StaffNoteDto } from "./types.ts";
import { APPOINTMENT_STATUSES, fail, ok } from "./types.ts";
import { roleAtLeast } from "./auth.ts";
import { isUuid } from "./util.ts";

export async function handleAction(
  db: SupabaseClient,
  identity: Identity,
  body: unknown,
): Promise<Result<unknown>> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail(400, "bad_request", "Request body must be a JSON object");
  }
  const record = body as Record<string, unknown>;
  const action = typeof record.action === "string" ? record.action : "";

  const result = await (async (): Promise<Result<unknown>> => {
    switch (action) {
    case "reveal_phone":
      return await revealPhone(db, identity, record);
    case "status_change":
      return await statusChange(db, identity, record);
    case "add_note":
      return await addNote(db, identity, record);
    case "record_search":
      return await recordSearch(db, identity, record);
    case "acknowledge_escalation":
      return await acknowledgeEscalation(db, identity, record);
    case "escalation_note":
      return await escalationNote(db, identity, record);
    case "resolve_escalation":
      return await resolveEscalation(db, identity, record);
    case "sync_recent_bookings":
      return await syncRecentBookings(db, identity, record);
    default:
      return fail(400, "unknown_action", "action must be one of: reveal_phone, status_change, add_note, record_search, acknowledge_escalation, escalation_note, resolve_escalation, sync_recent_bookings");
    }
  })();

  if (result.ok && invalidatesDashboardCache(action)) {
    background(invalidateDashboardCache());
  }

  return result;
}

function invalidatesDashboardCache(action: string): boolean {
  return !["reveal_phone", "record_search"].includes(action);
}

// ---------- reveal_phone ----------

async function revealPhone(
  db: SupabaseClient,
  identity: Identity,
  record: Record<string, unknown>,
): Promise<Result<{ appointmentId: string; phoneE164: string | null }>> {
  if (identity.mode !== "PHI_BAA" || !roleAtLeast(identity.role, "STAFF")) {
    return fail(403, "forbidden", "Phone reveal requires PHI_BAA mode and STAFF role or above");
  }
  const appointmentId = uuidField(record, "appointmentId");
  if (appointmentId === null) return fail(400, "bad_request", "appointmentId must be a UUID");

  const { data, error } = await db
    .from("appointments")
    .select("id,patient_id,patient:patients!inner(id,phone_e164)")
    .eq("id", appointmentId)
    .maybeSingle();
  if (error !== null) {
    console.error("dashboard-api: reveal_phone lookup failed", error);
    return fail(500, "internal_error", "Could not reveal phone");
  }
  if (data === null) return fail(404, "not_found", "Appointment not found");

  const row = data as unknown as { id: string; patient_id: string; patient: { id: string; phone_e164: string | null } };

  // Audit BEFORE returning the number; if the audit write fails, fail closed.
  const audited = await writeAudit(db, {
    actor: identity.actor,
    action: "phone_reveal",
    entity: "appointment",
    entityId: appointmentId,
    metadata: { patient_id: row.patient_id },
  });
  if (!audited) return fail(500, "internal_error", "Could not reveal phone");

  return ok({ appointmentId, phoneE164: row.patient.phone_e164 });
}

// ---------- status_change ----------

async function statusChange(
  db: SupabaseClient,
  identity: Identity,
  record: Record<string, unknown>,
): Promise<Result<{ id: string; status: AppointmentStatus }>> {
  if (!roleAtLeast(identity.role, "STAFF")) {
    return fail(403, "forbidden", "Status change requires STAFF role or above");
  }
  const appointmentId = uuidField(record, "appointmentId");
  if (appointmentId === null) return fail(400, "bad_request", "appointmentId must be a UUID");
  const status = typeof record.status === "string" ? record.status : "";
  if (!(APPOINTMENT_STATUSES as readonly string[]).includes(status)) {
    return fail(400, "bad_request", `status must be one of: ${APPOINTMENT_STATUSES.join(", ")}`);
  }

  const { data, error } = await db
    .from("appointments")
    .update({ status })
    .eq("id", appointmentId)
    .select("id,status")
    .maybeSingle();
  if (error !== null) {
    // The DB trigger enforce_appointment_transition raises P0001 with a clear
    // message ("... is completed (terminal); cannot change to ..." or
    // "illegal appointment transition x -> y"); surface it as a conflict.
    if (error.code === "P0001" || /terminal|illegal appointment transition/i.test(error.message)) {
      return fail(409, "illegal_transition", error.message);
    }
    console.error("dashboard-api: status_change update failed", error);
    return fail(500, "internal_error", "Could not update appointment status");
  }
  if (data === null) return fail(404, "not_found", "Appointment not found");

  const row = data as unknown as { id: string; status: AppointmentStatus };

  const eventInsert = await db.from("appointment_events").insert({
    appointment_id: appointmentId,
    label: `Status changed to ${status}`,
    actor: identity.actor,
  });
  const audited = eventInsert.error === null && await writeAudit(db, {
    actor: identity.actor,
    action: "status_change",
    entity: "appointment",
    entityId: appointmentId,
    metadata: { status },
  });
  if (eventInsert.error !== null || !audited) {
    if (eventInsert.error !== null) {
      console.error("dashboard-api: status_change event insert failed", eventInsert.error);
    }
    return fail(
      500,
      "logging_failed",
      "The status was updated but activity logging failed; refresh to see current state",
    );
  }

  return ok({ id: row.id, status: row.status });
}

// ---------- add_note ----------

async function addNote(
  db: SupabaseClient,
  identity: Identity,
  record: Record<string, unknown>,
): Promise<Result<{ note: StaffNoteDto }>> {
  if (!roleAtLeast(identity.role, "STAFF")) {
    return fail(403, "forbidden", "Adding notes requires STAFF role or above");
  }
  const appointmentId = uuidField(record, "appointmentId");
  if (appointmentId === null) return fail(400, "bad_request", "appointmentId must be a UUID");
  const body = typeof record.body === "string" ? record.body.trim() : "";
  if (body.length < 1 || body.length > 4000) {
    return fail(400, "bad_request", "body must be a string of 1 to 4000 characters");
  }

  const appt = await db.from("appointments").select("id").eq("id", appointmentId).maybeSingle();
  if (appt.error !== null) {
    console.error("dashboard-api: add_note lookup failed", appt.error);
    return fail(500, "internal_error", "Could not add note");
  }
  if (appt.data === null) return fail(404, "not_found", "Appointment not found");

  const { data, error } = await db
    .from("staff_notes")
    .insert({ appointment_id: appointmentId, author: identity.actor, body })
    .select("id,at,author,body")
    .single();
  if (error !== null || data === null) {
    console.error("dashboard-api: add_note insert failed", error);
    return fail(500, "internal_error", "Could not add note");
  }
  const note = data as unknown as StaffNoteDto;

  const eventInsert = await db.from("appointment_events").insert({
    appointment_id: appointmentId,
    label: "Note added",
    actor: identity.actor,
  });
  const audited = eventInsert.error === null && await writeAudit(db, {
    actor: identity.actor,
    action: "note_add",
    entity: "appointment",
    entityId: appointmentId,
    metadata: { note_id: note.id },
  });
  if (eventInsert.error !== null || !audited) {
    if (eventInsert.error !== null) {
      console.error("dashboard-api: add_note event insert failed", eventInsert.error);
    }
    return fail(
      500,
      "logging_failed",
      "The note was saved but activity logging failed; refresh to see current state",
    );
  }

  return ok({ note });
}

// ---------- record_search ----------

async function recordSearch(
  db: SupabaseClient,
  identity: Identity,
  record: Record<string, unknown>,
): Promise<Result<{ recorded: true }>> {
  const query = typeof record.query === "string" ? record.query.trim() : "";
  if (query.length < 1 || query.length > 200) {
    return fail(400, "bad_request", "query must be a string of 1 to 200 characters");
  }
  const audited = await writeAudit(db, {
    actor: identity.actor,
    action: "patient_search",
    entity: "patient",
    entityId: null,
    metadata: { query },
  });
  if (!audited) return fail(500, "internal_error", "Could not record search");
  return ok({ recorded: true });
}


// ---------- sync_recent_bookings ----------

async function syncRecentBookings(
  db: SupabaseClient,
  identity: Identity,
  record: Record<string, unknown>,
): Promise<Result<{ scanned: number; attempted: number; syncedAppointments: number; skippedWithoutCallId: number }>> {
  if (!roleAtLeast(identity.role, "OWNER")) {
    return fail(403, "forbidden", "Booking sync requires OWNER role");
  }

  const rawLimit = typeof record.limit === "number" ? record.limit : 200;
  const limit = Math.max(1, Math.min(Math.floor(rawLimit), 500));

  const { data, error } = await db
    .from("bookings")
    .select("id,call_id")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error !== null) {
    console.error("dashboard-api: sync_recent_bookings lookup failed", error);
    return fail(500, "internal_error", "Could not load bookings to sync");
  }

  const rows = (data ?? []) as Array<{ id: string; call_id: string | null }>;
  let attempted = 0;
  let skippedWithoutCallId = 0;
  for (const row of rows) {
    if (!row.call_id) {
      skippedWithoutCallId += 1;
      continue;
    }
    attempted += 1;
    await syncBookingToDomain(db, row.call_id);
  }

  const bookingIds = rows.map((row) => row.id);
  let syncedAppointments = 0;
  if (bookingIds.length > 0) {
    const { count, error: countError } = await db
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .in("booking_id", bookingIds);
    if (countError !== null) {
      console.error("dashboard-api: sync_recent_bookings count failed", countError);
      return fail(500, "internal_error", "Bookings synced but appointment count failed");
    }
    syncedAppointments = count ?? 0;
  }

  await writeAudit(db, {
    actor: identity.actor,
    action: "sync_recent_bookings",
    entity: "booking",
    entityId: null,
    metadata: { scanned: rows.length, attempted, synced_appointments: syncedAppointments },
  });

  return ok({ scanned: rows.length, attempted, syncedAppointments, skippedWithoutCallId });
}

// ---------- helpers ----------

function uuidField(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  return typeof value === "string" && isUuid(value) ? value : null;
}

interface AuditEvent {
  actor: string;
  action: string;
  entity: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
}

async function writeAudit(db: SupabaseClient, event: AuditEvent): Promise<boolean> {
  const { error } = await db.from("audit_events").insert({
    actor: event.actor,
    action: event.action,
    entity: event.entity,
    entity_id: event.entityId,
    metadata: event.metadata,
  });
  if (error !== null) {
    console.error("dashboard-api: audit_events insert failed", error);
    return false;
  }
  return true;
}

// ---------- escalation actions ----------

async function acknowledgeEscalation(
  db: SupabaseClient,
  identity: Identity,
  record: Record<string, unknown>,
): Promise<Result<{ id: string; status: string; acknowledgedAt: string | null; acknowledgedBy: string | null }>> {
  if (!roleAtLeast(identity.role, "STAFF")) {
    return fail(403, "forbidden", "Acknowledging escalations requires STAFF role or above");
  }
  const escalationId = uuidField(record, "escalationId");
  if (escalationId === null) return fail(400, "bad_request", "escalationId must be a UUID");

  // Check current state - don't overwrite an existing acknowledgement
  const { data: existing, error: fetchError } = await db
    .from("escalations")
    .select("id,status,acknowledged_at,acknowledged_by")
    .eq("id", escalationId)
    .maybeSingle();
  if (fetchError !== null) {
    console.error("dashboard-api: acknowledge fetch failed", fetchError);
    return fail(500, "internal_error", "Could not acknowledge escalation");
  }
  if (existing === null) return fail(404, "not_found", "Escalation not found");

  const row = existing as { id: string; status: string; acknowledged_at: string | null; acknowledged_by: string | null };

  // Only update if currently open
  if (row.status === "open") {
    const now = new Date().toISOString();
    const { error: updateError } = await db
      .from("escalations")
      .update({ status: "acknowledged", acknowledged_at: now, acknowledged_by: identity.actor })
      .eq("id", escalationId);
    if (updateError !== null) {
      console.error("dashboard-api: acknowledge update failed", updateError);
      return fail(500, "internal_error", "Could not acknowledge escalation");
    }
    await writeAudit(db, {
      actor: identity.actor,
      action: "escalation_acknowledge",
      entity: "escalation",
      entityId: escalationId,
      metadata: null,
    });
    return ok({ id: escalationId, status: "acknowledged", acknowledgedAt: now, acknowledgedBy: identity.actor });
  }

  // Already acknowledged or resolved - no-op success
  return ok({ id: escalationId, status: row.status, acknowledgedAt: row.acknowledged_at, acknowledgedBy: row.acknowledged_by });
}

async function escalationNote(
  db: SupabaseClient,
  identity: Identity,
  record: Record<string, unknown>,
): Promise<Result<{ id: string; resolutionNote: string; status: string; acknowledgedAt: string | null }>> {
  if (!roleAtLeast(identity.role, "STAFF")) {
    return fail(403, "forbidden", "Adding escalation notes requires STAFF role or above");
  }
  const escalationId = uuidField(record, "escalationId");
  if (escalationId === null) return fail(400, "bad_request", "escalationId must be a UUID");
  const body = typeof record.body === "string" ? record.body.trim() : "";
  if (body.length < 1 || body.length > 4000) {
    return fail(400, "bad_request", "body must be a string of 1 to 4000 characters");
  }

  const { data: existing, error: fetchError } = await db
    .from("escalations")
    .select("id,status,acknowledged_at")
    .eq("id", escalationId)
    .maybeSingle();
  if (fetchError !== null) {
    console.error("dashboard-api: escalation_note fetch failed", fetchError);
    return fail(500, "internal_error", "Could not save note");
  }
  if (existing === null) return fail(404, "not_found", "Escalation not found");

  const row = existing as { id: string; status: string; acknowledged_at: string | null };

  // Set resolution note; if still open, also acknowledge
  const patch: Record<string, unknown> = { resolution_note: body };
  let acknowledgedAt = row.acknowledged_at;
  if (row.status === "open") {
    acknowledgedAt = new Date().toISOString();
    patch.status = "acknowledged";
    patch.acknowledged_at = acknowledgedAt;
    patch.acknowledged_by = identity.actor;
  }

  const { error: updateError } = await db.from("escalations").update(patch).eq("id", escalationId);
  if (updateError !== null) {
    console.error("dashboard-api: escalation_note update failed", updateError);
    return fail(500, "internal_error", "Could not save note");
  }

  await writeAudit(db, {
    actor: identity.actor,
    action: "escalation_note",
    entity: "escalation",
    entityId: escalationId,
    metadata: { body_length: body.length },
  });

  return ok({ id: escalationId, resolutionNote: body, status: patch.status as string ?? row.status, acknowledgedAt });
}

async function resolveEscalation(
  db: SupabaseClient,
  identity: Identity,
  record: Record<string, unknown>,
): Promise<Result<{ id: string; status: string }>> {
  if (!roleAtLeast(identity.role, "STAFF")) {
    return fail(403, "forbidden", "Resolving escalations requires STAFF role or above");
  }
  const escalationId = uuidField(record, "escalationId");
  if (escalationId === null) return fail(400, "bad_request", "escalationId must be a UUID");

  const { data: existing, error: fetchError } = await db
    .from("escalations")
    .select("id,status,acknowledged_at")
    .eq("id", escalationId)
    .maybeSingle();
  if (fetchError !== null) {
    console.error("dashboard-api: resolve fetch failed", fetchError);
    return fail(500, "internal_error", "Could not resolve escalation");
  }
  if (existing === null) return fail(404, "not_found", "Escalation not found");

  const row = existing as { id: string; status: string; acknowledged_at: string | null };

  // If still open, acknowledge first (can't resolve without acknowledging)
  const patch: Record<string, unknown> = { status: "resolved" };
  if (row.status === "open") {
    patch.acknowledged_at = new Date().toISOString();
    patch.acknowledged_by = identity.actor;
  }

  const { error: updateError } = await db.from("escalations").update(patch).eq("id", escalationId);
  if (updateError !== null) {
    console.error("dashboard-api: resolve update failed", updateError);
    return fail(500, "internal_error", "Could not resolve escalation");
  }

  await writeAudit(db, {
    actor: identity.actor,
    action: "escalation_resolve",
    entity: "escalation",
    entityId: escalationId,
    metadata: null,
  });

  return ok({ id: escalationId, status: "resolved" });
}


