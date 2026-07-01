export function toDigits(input?: string | null): string {
  return (input ?? "").replace(/[^\d]/g, "");
}

export function toE164(input?: string | null, defaultCc = "92"): string {
  let d = toDigits(input);
  if (!d) return "";
  if (d.length === 10) d = defaultCc + d;
  return "+" + d;
}

export function parseDateOnly(input?: string | null): string | null {
  if (!input) return null;
  const s = input.trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return isRealDate(+iso[1], +iso[2], +iso[3]) ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
  const slash = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (slash) {
    let [_, a, b, y] = slash;
    let yr = +y; if (yr < 100) yr += yr < 30 ? 2000 : 1900;
    const mo = +a, da = +b;
    return isRealDate(yr, mo, da) ? fmt(yr, mo, da) : null;
  }
  const months = ["january","february","march","april","may","june","july","august","september","october","november","december"];
  const m = s.toLowerCase().match(/([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/) ||
            s.toLowerCase().match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+),?\s+(\d{4})/);
  if (m) {
    let mo: number, da: number, yr: number;
    if (isNaN(+m[1])) { mo = months.indexOf(m[1]) + 1; da = +m[2]; yr = +m[3]; }
    else { da = +m[1]; mo = months.indexOf(m[2]) + 1; yr = +m[3]; }
    if (mo > 0) return isRealDate(yr, mo, da) ? fmt(yr, mo, da) : null;
  }
  return null;
}

function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function fmt(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function validateDob(input?: string | null): { value: string | null; ok: boolean } {
  const v = parseDateOnly(input);
  if (!v) return { value: null, ok: input ? false : true };
  const ok = new Date(v + "T00:00:00Z").getTime() < Date.now();
  return { value: ok ? v : null, ok };
}

export function cleanMemberId(input?: string | null): string | null {
  if (!input) return null;
  const v = input.replace(/\s+/g, "").toUpperCase();
  return v.length ? v : null;
}

export function toBool(v: unknown): boolean | null {
  if (v === true || v === false) return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["yes", "true", "y", "1"].includes(s)) return true;
    if (["no", "false", "n", "0"].includes(s)) return false;
  }
  return null;
}

const NULL_STRINGS = new Set([
  "null", "undefined", "none", "n/a", "na",
  "not provided", "not listed", "unknown", ""
]);

export function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s.length || NULL_STRINGS.has(s.toLowerCase())) return null;
  return s;
}
