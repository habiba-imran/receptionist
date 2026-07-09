import type { Identity } from "../dashboard-api/types.ts";

const CACHE_VERSION = "v1";
const CACHE_PREFIX = `dashboard:${CACHE_VERSION}`;
const DEFAULT_TTL_SECONDS = 5;

type CacheableResource = "appointments" | "stats" | "calls" | "escalations" | "escalation_stats";

const RESOURCE_TTLS: Record<CacheableResource, number> = {
  calls: 2,
  appointments: 5,
  stats: 8,
  escalations: 5,
  escalation_stats: 8,
};

export function isDashboardCacheEnabled(): boolean {
  if ((Deno.env.get("DASHBOARD_CACHE_ENABLED") ?? "").toLowerCase() !== "true") return false;
  return getRedisConfig() !== null;
}

export function cacheableResource(value: string): CacheableResource | null {
  if (value === "appointments") return value;
  if (value === "stats") return value;
  if (value === "calls") return value;
  if (value === "escalations") return value;
  if (value === "escalation_stats") return value;
  return null;
}

export function dashboardCacheKey(resource: CacheableResource, url: URL, identity: Identity): string {
  const params = new URLSearchParams(url.searchParams);
  const sorted = [...params.entries()].sort(([aKey, aVal], [bKey, bVal]) =>
    aKey === bKey ? aVal.localeCompare(bVal) : aKey.localeCompare(bKey)
  );
  const query = sorted.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
  return [
    CACHE_PREFIX,
    resource,
    `mode=${identity.mode}`,
    `role=${identity.role}`,
    query || "no-query",
  ].join(":");
}

export async function getDashboardCache<T>(key: string): Promise<T | null> {
  const result = await redisCommand(["GET", key]);
  if (typeof result !== "string" || result.length === 0) return null;
  try {
    return JSON.parse(result) as T;
  } catch {
    return null;
  }
}

export async function setDashboardCache(key: string, value: unknown, resource: CacheableResource): Promise<void> {
  const ttl = RESOURCE_TTLS[resource] ?? DEFAULT_TTL_SECONDS;
  await redisCommand(["SET", key, JSON.stringify(value), "EX", ttl]);
}

export async function invalidateDashboardCache(resources?: readonly CacheableResource[]): Promise<void> {
  const targets = resources && resources.length > 0
    ? Array.from(new Set(resources))
    : ["appointments", "stats", "calls", "escalations", "escalation_stats"] as const;

  await Promise.all(targets.map((resource) => deleteByPattern(`${CACHE_PREFIX}:${resource}:*`)));
}

async function deleteByPattern(pattern: string): Promise<void> {
  let cursor = "0";
  do {
    const scanned = await redisCommand(["SCAN", cursor, "MATCH", pattern, "COUNT", "100"]);
    if (!Array.isArray(scanned) || scanned.length < 2) return;
    cursor = String(scanned[0] ?? "0");
    const keys = Array.isArray(scanned[1]) ? scanned[1].map(String).filter(Boolean) : [];
    if (keys.length > 0) await redisCommand(["DEL", ...keys]);
  } while (cursor !== "0");
}

async function redisCommand(command: unknown[]): Promise<unknown> {
  const config = getRedisConfig();
  if (config === null) return null;

  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
    });
    if (!response.ok) {
      console.warn("dashboard-cache: redis command failed", response.status, await response.text().catch(() => ""));
      return null;
    }
    const payload = await response.json().catch(() => null);
    return payload && typeof payload === "object" && "result" in payload
      ? (payload as { result: unknown }).result
      : null;
  } catch (error) {
    console.warn("dashboard-cache: redis unavailable", error instanceof Error ? error.message : String(error));
    return null;
  }
}

function getRedisConfig(): { url: string; token: string } | null {
  const url = (Deno.env.get("UPSTASH_REDIS_REST_URL") ?? "").trim().replace(/\/+$/, "");
  const token = (Deno.env.get("UPSTASH_REDIS_REST_TOKEN") ?? "").trim();
  if (!url || !token) return null;
  return { url, token };
}
