import type { ExtractionSnapshot } from "./types.ts";

export async function writeDebugSnapshot(snapshot: ExtractionSnapshot): Promise<string | null> {
  if ((Deno.env.get("TRANSCRIPT_CRM_POC_WRITE_DEBUG_FILE") ?? "").toLowerCase() !== "true") {
    return null;
  }

  const outputDir = Deno.env.get("TRANSCRIPT_CRM_POC_DEBUG_DIR") ?? "./debug-output";
  const safeCallId = snapshot.call_id.replace(/[^a-zA-Z0-9_-]/g, "_") || "unknown_call";
  const fileName = `${safeCallId}-${snapshot.event}.json`;
  const filePath = `${outputDir}/${fileName}`;

  await Deno.mkdir(outputDir, { recursive: true });
  await Deno.writeTextFile(filePath, JSON.stringify(snapshot, null, 2));
  return filePath;
}
