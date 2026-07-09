// Query-string parsing and validation for GET ?resource=appointments.

import type {
  AppointmentSource,
  AppointmentStatus,
  Language,
  ListParams,
  Result,
  TriageLevel,
  VobStatus,
} from "./types.ts";
import {
  APPOINTMENT_SOURCES,
  APPOINTMENT_STATUSES,
  fail,
  LANGUAGES,
  ok,
  TRIAGE_LEVELS,
  VOB_STATUSES,
} from "./types.ts";
import { isUuid, parseYmd } from "./util.ts";

export function parseListParams(url: URL): Result<ListParams> {
  const sp = url.searchParams;
  const pick = (name: string): string | null => {
    const value = sp.get(name);
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  };
  const invalid = (name: string, allowed: readonly string[]): Result<ListParams> =>
    fail(400, "bad_request", `${name} must be one of: ${allowed.join(", ")}`);

  const status = pick("status");
  if (status !== null && !(APPOINTMENT_STATUSES as readonly string[]).includes(status)) {
    return invalid("status", APPOINTMENT_STATUSES);
  }
  const source = pick("source");
  if (source !== null && !(APPOINTMENT_SOURCES as readonly string[]).includes(source)) {
    return invalid("source", APPOINTMENT_SOURCES);
  }
  const triage = pick("triage");
  if (triage !== null && !(TRIAGE_LEVELS as readonly string[]).includes(triage)) {
    return invalid("triage", TRIAGE_LEVELS);
  }
  const language = pick("language");
  if (language !== null && !(LANGUAGES as readonly string[]).includes(language)) {
    return invalid("language", LANGUAGES);
  }
  const vob = pick("vob");
  if (vob !== null && vob !== "none" && !(VOB_STATUSES as readonly string[]).includes(vob)) {
    return invalid("vob", ["none", ...VOB_STATUSES]);
  }
  const search = pick("search");
  if (search !== null && search.length > 200) {
    return fail(400, "bad_request", "search must be at most 200 characters");
  }
  const dateFrom = pick("date_from");
  if (dateFrom !== null && parseYmd(dateFrom) === null) {
    return fail(400, "bad_request", "date_from must be a valid yyyy-mm-dd date");
  }
  const dateTo = pick("date_to");
  if (dateTo !== null && parseYmd(dateTo) === null) {
    return fail(400, "bad_request", "date_to must be a valid yyyy-mm-dd date");
  }
  if (dateFrom !== null && dateTo !== null && dateFrom > dateTo) {
    return fail(400, "bad_request", "date_from must not be after date_to");
  }
  const locationId = pick("location_id");
  if (locationId !== null && !isUuid(locationId)) {
    return fail(400, "bad_request", "location_id must be a UUID");
  }
  const includeSeeded = pick("include_seeded") === "true";
  const limitRaw = pick("limit");
  let limit = 500;
  if (limitRaw !== null) {
    limit = Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      return fail(400, "bad_request", "limit must be an integer between 1 and 1000");
    }
  }

  return ok({
    status: status as AppointmentStatus | null,
    source: source as AppointmentSource | null,
    triage: triage as TriageLevel | null,
    language: language as Language | null,
    vob: vob as VobStatus | "none" | null,
    search,
    dateFrom,
    dateTo,
    locationId,
    includeSeeded,
    limit,
  });
}


