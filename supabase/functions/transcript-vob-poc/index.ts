import { extractVobData } from "./extraction.ts";
import { upsertVobQueue } from "./upsert.ts";
import { validateVobExtraction } from "./validation.ts";
import { background } from "../_shared/supa.ts";
import { sendAlert } from "../_shared/alert.ts";
import type { ExtractionMode, RetellWebhookPayload, VobExtractionSnapshot } from "./types.ts";

Deno.serve(async (req) => {
  if (!checkSecret(req)) return json({ error: "unauthorized" }, 401);
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let payload: RetellWebhookPayload = {};
  try {
    payload = await req.json();
  } catch (_) {
    return json({ error: "bad_json" }, 400);
  }

  const event = payload.event ?? "";
  console.log("transcript-vob-poc received", JSON.stringify({
    event,
    call_id: getCallId(payload),
    agent_id: getAgentId(payload),
    agent_name: getAgentName(payload),
    top_level_keys: Object.keys(payload),
  }));

  if (event !== "transcript_updated" && event !== "call_ended") {
    return json({ received: true, ignored: true, event }, 200);
  }

  const callId = getCallId(payload);
  if (!callId) return json({ error: "missing_call_id" }, 400);

  const transcript = extractTranscript(payload);
  if (!transcript) {
    return json({ error: "missing_transcript", call_id: callId, event }, 400);
  }

  const mode: ExtractionMode = event === "call_ended" ? "final" : "realtime";

  try {
    const extraction = await extractVobData(transcript, mode, getCallContext(payload));
    const validation_errors = validateVobExtraction(extraction);
    if (validation_errors.length > 0) {
      background(sendAlert("VOB extraction validation issue", {
        call_id: callId,
        event,
        status: extraction.status ?? "",
        issues: validation_errors.map((issue) => `${issue.field}:${issue.reason}`).join(", "),
      }));
    }
    const snapshot: VobExtractionSnapshot = {
      call_id: callId,
      event,
      mode,
      extracted_at: new Date().toISOString(),
      transcript_length: transcript.length,
      extraction,
    };

    const upsert_result = await upsertVobQueue({
      callId,
      event,
      mode,
      transcript,
      transcriptLength: transcript.length,
      extractedAt: snapshot.extracted_at,
      extraction,
      validationErrors: validation_errors,
    });

    console.log("transcript-vob-poc extraction", JSON.stringify(snapshot));

    return json({
      received: true,
      call_id: callId,
      event,
      mode,
      upsert_result,
      validation_errors,
      extraction,
    }, 200);
  } catch (error) {
    console.error("transcript-vob-poc error", error);
    background(sendAlert("VOB extraction failed", {
      call_id: callId,
      event,
      error: error instanceof Error ? error.message : String(error),
    }));
    return json({
      error: "vob_extraction_failed",
      message: error instanceof Error ? error.message : String(error),
      call_id: callId,
      event,
    }, 500);
  }
});

function getCallId(payload: RetellWebhookPayload): string {
  return payload.call?.call_id ??
    payload.data?.call?.call_id ??
    payload.data?.call_id ??
    payload.call_id ??
    "";
}

function getAgentId(payload: RetellWebhookPayload): string {
  return stringValue(payload.call?.agent_id ?? payload.data?.call?.agent_id);
}

function getAgentName(payload: RetellWebhookPayload): string {
  return stringValue(payload.call?.agent_name ?? payload.data?.call?.agent_name);
}

function getCallContext(payload: RetellWebhookPayload): Record<string, unknown> {
  const call = payload.call ?? payload.data?.call ?? {};
  const data = payload.data && typeof payload.data === "object" ? payload.data as Record<string, unknown> : {};
  const callRecord = call as Record<string, unknown>;
  const contextSources = [
    callRecord,
    objectValue(callRecord.metadata),
    objectValue(callRecord.retell_llm_dynamic_variables),
    objectValue(callRecord.dynamic_variables),
    data,
    objectValue(data.metadata),
    objectValue(data.retell_llm_dynamic_variables),
    objectValue(data.dynamic_variables),
  ];
  const allowedKeys = [
    "agent_id",
    "agent_name",
    "verification_id",
    "practice_name",
    "patient_full_name",
    "patient_dob",
    "member_id",
    "payer_name",
    "provider_name",
    "provider_npi",
    "tax_id",
    "cpt_codes",
    "service_type",
    "date_of_service",
  ];

  const context: Record<string, unknown> = {};
  for (const key of allowedKeys) {
    const value = firstContextValue(contextSources, key);
    if (value !== undefined && value !== null && value !== "") context[key] = value;
  }
  return context;
}

function firstContextValue(sources: Array<Record<string, unknown>>, key: string): unknown {
  for (const source of sources) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function extractTranscript(payload: RetellWebhookPayload): string {
  const candidates = [
    payload.call?.transcript,
    payload.call?.transcript_with_tool_calls,
    payload.transcript,
    payload.transcript_with_tool_calls,
    payload.call?.transcript_object,
    payload.transcript_object,
    payload.data?.call?.transcript,
    payload.data?.call?.transcript_with_tool_calls,
    payload.data?.call?.transcript_object,
    payload.data?.transcript,
    payload.data?.transcript_with_tool_calls,
    payload.data?.transcript_object,
  ];

  for (const candidate of candidates) {
    const transcript = stringifyTranscript(candidate);
    if (transcript) return transcript;
  }

  return "";
}

function stringifyTranscript(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((turn) => stringifyTranscriptTurn(turn))
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value).trim();
}

function stringifyTranscriptTurn(turn: unknown): string {
  if (!turn || typeof turn !== "object") return stringifyTranscript(turn);
  const record = turn as Record<string, unknown>;
  const role = stringValue(record.role ?? record.speaker ?? record.user ?? record.source);
  const content = stringValue(record.content ?? record.text ?? record.words ?? record.transcript);
  if (!content) return "";
  return role ? `${role}: ${content}` : content;
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(stringValue).filter(Boolean).join(" ").trim();
  return String(value).trim();
}

function checkSecret(req: Request): boolean {
  const want = Deno.env.get("RETELL_SHARED_SECRET") ?? "";
  if (!want) return false;
  const url = new URL(req.url);
  return url.searchParams.get("s") === want;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
