import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

export function background(p: Promise<unknown>) {
  try {
    // @ts-ignore EdgeRuntime is provided by Supabase Edge runtime
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(p);
      return;
    }
  } catch (_) { /* fall through */ }
  p.catch((e) => console.error("background error", e));
}

export function checkSecret(req: Request): boolean {
  const want = Deno.env.get("RETELL_SHARED_SECRET") ?? "";
  if (!want) return true;
  const url = new URL(req.url);
  return url.searchParams.get("s") === want;
}
