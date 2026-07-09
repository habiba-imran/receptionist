// Validation, phone masking, and timezone helpers for dashboard-api.

import type { DbPatientEmbed } from "./types.ts";

export const DEFAULT_TZ = "America/Chicago";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export interface Ymd {
  y: number;
  m: number;
  d: number;
}

/** Parses "yyyy-mm-dd" and verifies it is a real calendar date. */
export function parseYmd(value: string): Ymd | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return null;
  }
  return { y, m, d };
}

/** "(***) ***-1234" from the last 4 digits, or null when no phone on file. */
export function maskPhone(phoneE164: string | null): string | null {
  if (!phoneE164) return null;
  const digits = phoneE164.replace(/\D/g, "");
  if (digits.length < 4) return null;
  return `(***) ***-${digits.slice(-4)}`;
}

/** first/last name, falling back to splitting full_legal_name on whitespace. */
export function patientName(p: DbPatientEmbed): { firstName: string | null; lastName: string | null; fullName: string | null } {
  const fullName = p.full_legal_name?.trim() || null;
  const parts = (fullName ?? "").split(/\s+/).filter(Boolean);
  const firstName = p.first_name || parts[0] || null;
  const lastName = p.last_name || (parts.length > 1 ? parts.slice(1).join(" ") : null);
  return { firstName, lastName, fullName };
}

/**
 * Builds the PostgREST `or=` expression applied to the embedded `patient`
 * resource for free-text search. Returns null when the input yields no
 * searchable terms (caller should then return an empty result set — a
 * garbage search must not match everything).
 */
export function buildPatientSearchOr(search: string): string | null {
  const digits = search.replace(/\D/g, "");
  // strip characters that would break PostgREST's or() grammar or act as wildcards
  const nameTerm = search.replace(/[,()"'\\%*]/g, " ").replace(/\s+/g, " ").trim();
  const clauses: string[] = [];
  if (nameTerm.length >= 2) {
    clauses.push(`full_legal_name.ilike.*${nameTerm}*`);
    clauses.push(`first_name.ilike.*${nameTerm}*`);
    clauses.push(`last_name.ilike.*${nameTerm}*`);
  }
  if (digits.length >= 3) {
    clauses.push(`phone_e164.like.*${digits}*`);
  }
  return clauses.length > 0 ? clauses.join(",") : null;
}

// ---------- timezone math (no external deps; Intl only) ----------

/** Returns tz if the runtime recognizes it, otherwise DEFAULT_TZ. */
export function safeTimezone(tz: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch (_) {
    return DEFAULT_TZ;
  }
}

/** Offset (ms) of tz from UTC at the given instant. */
function tzOffsetMs(at: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const part of fmt.formatToParts(at)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - at.getTime();
}

/** Calendar date of the given instant, as seen in tz. */
function ymdInTz(at: Date, tz: string): Ymd {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [y, m, d] = fmt.format(at).split("-").map(Number);
  return { y, m, d };
}

/** UTC instant of local midnight (00:00) of the given calendar date in tz. */
export function tzMidnightUtc(tz: string, ymd: Ymd): Date {
  let ts = Date.UTC(ymd.y, ymd.m - 1, ymd.d);
  // two passes converge across DST transitions
  for (let i = 0; i < 2; i++) {
    ts = Date.UTC(ymd.y, ymd.m - 1, ymd.d) - tzOffsetMs(new Date(ts), tz);
  }
  return new Date(ts);
}

function nextDay(ymd: Ymd): Ymd {
  const t = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d + 1));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** [start, end) UTC instants of "today" in tz. */
export function tzTodayRange(tz: string, now: Date): { startIso: string; endIso: string } {
  const today = ymdInTz(now, tz);
  return {
    startIso: tzMidnightUtc(tz, today).toISOString(),
    endIso: tzMidnightUtc(tz, nextDay(today)).toISOString(),
  };
}

/**
 * Converts inclusive yyyy-mm-dd bounds (interpreted in tz) into UTC ISO
 * bounds: fromIso is inclusive (>=), toIso is exclusive (<).
 */
export function ymdRangeUtc(
  tz: string,
  from: Ymd | null,
  to: Ymd | null,
): { fromIso: string | null; toIso: string | null } {
  return {
    fromIso: from ? tzMidnightUtc(tz, from).toISOString() : null,
    toIso: to ? tzMidnightUtc(tz, nextDay(to)).toISOString() : null,
  };
}
