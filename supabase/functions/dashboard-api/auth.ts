// Authentication and identity resolution for dashboard-api.
//
// The Next.js server proxy authenticates the browser user via Clerk, then
// calls this function with a shared secret plus trusted identity headers.
// Everything here fails closed: no secret configured -> 500, wrong secret ->
// 401, unrecognized role -> VIEWER, unrecognized mode -> NON_PHI.

import type { Identity, Mode, Result, Role } from "./types.ts";
import { fail, ok } from "./types.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-dashboard-secret, x-actor, x-role, x-mode",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const ROLES: readonly Role[] = ["OWNER", "ADMIN", "STAFF", "VIEWER"];

const ROLE_RANK: Record<Role, number> = {
  VIEWER: 0,
  STAFF: 1,
  ADMIN: 2,
  OWNER: 3,
};

export function roleAtLeast(role: Role, minimum: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export function authenticate(req: Request): Result<Identity> {
  const want = Deno.env.get("DASHBOARD_API_SECRET") ?? "";
  if (!want) {
    // Unlike checkSecret() in _shared/supa.ts this does NOT fail open:
    // a missing secret means the deployment is misconfigured, so reject.
    console.error("dashboard-api: DASHBOARD_API_SECRET is not set; rejecting request");
    return fail(500, "server_misconfigured", "Server is not configured");
  }
  const got = req.headers.get("x-dashboard-secret") ?? "";
  if (!timingSafeEqual(got, want)) {
    return fail(401, "unauthorized", "Missing or invalid x-dashboard-secret");
  }

  const actorRaw = (req.headers.get("x-actor") ?? "").trim();
  const actor = actorRaw.length > 0 ? actorRaw.slice(0, 200) : "unknown";

  const roleRaw = (req.headers.get("x-role") ?? "").trim().toUpperCase();
  const role: Role = (ROLES as readonly string[]).includes(roleRaw) ? (roleRaw as Role) : "VIEWER";

  const mode: Mode = (req.headers.get("x-mode") ?? "").trim() === "PHI_BAA" ? "PHI_BAA" : "NON_PHI";

  return ok({ actor, role, mode });
}

function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}
