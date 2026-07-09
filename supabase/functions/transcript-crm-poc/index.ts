import { extractPatientData, extractPatientDataIncremental } from "./extraction.ts";
import { writeDebugSnapshot } from "./debug-file.ts";
import { getTranscriptCrmState, upsertTranscriptCrm } from "./upsert.ts";
import { validatePatientExtraction } from "./validation.ts";
import { background } from "../_shared/supa.ts";
import { sendAlert } from "../_shared/alert.ts";
import type { ExtractionMode, ExtractionSnapshot, RetellWebhookPayload } from "./types.ts";

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
  console.log("transcript-crm-poc received", JSON.stringify({
    event,
    call_id: getCallId(payload),
    top_level_keys: Object.keys(payload),
    call_keys: payload.call && typeof payload.call === "object" ? Object.keys(payload.call) : [],
    data_keys: payload.data && typeof payload.data === "object" ? Object.keys(payload.data) : [],
  }));

  if (event !== "transcript_updated" && event !== "call_ended") {
    return json({ received: true, ignored: true, event }, 200);
  }

  const callId = getCallId(payload);
  if (!callId) return json({ error: "missing_call_id" }, 400);

  const transcript = extractTranscript(payload);
  if (!transcript) {
    console.log("transcript-crm-poc missing transcript", JSON.stringify({
      call_id: callId,
      event,
      top_level_keys: Object.keys(payload),
      call_keys: payload.call && typeof payload.call === "object" ? Object.keys(payload.call) : [],
      data_keys: payload.data && typeof payload.data === "object" ? Object.keys(payload.data) : [],
    }));
    return json({ error: "missing_transcript", call_id: callId, event }, 400);
  }

  const mode: ExtractionMode = event === "call_ended" ? "final" : "realtime";

  try {
    const crmState = mode === "realtime"
      ? await getTranscriptCrmState(callId)
      : { extraction: {}, pendingExtraction: {}, transcriptLength: 0 };
    const newTranscript = mode === "realtime" ? latestTranscriptSegment(transcript, crmState.transcriptLength) : transcript;
    if (mode === "realtime" && Object.keys(crmState.extraction).length > 0 && !newTranscript) {
      return json({
        received: true,
        call_id: callId,
        event,
        mode,
        skipped: "no_new_transcript",
      }, 200);
    }
    const extraction = mode === "realtime" && Object.keys(crmState.extraction).length > 0
      ? await extractPatientDataIncremental(newTranscript, crmState.extraction, crmState.pendingExtraction)
      : await extractPatientData(transcript, mode);
    applyCallContextFallbacks(extraction, payload, transcript);
    const validation_errors = validatePatientExtraction(extraction);
    if (validation_errors.length > 0) {
      background(sendTranscriptValidationAlert(callId, event, extraction.triage_flag, validation_errors));
    } else if (isUrgentTriage(extraction.triage_flag)) {
      background(sendAlert("Urgent CRM triage detected", {
        call_id: callId,
        event,
        triage_flag: extraction.triage_flag,
        contact_number: extraction.contact_number ?? "",
        reason: extraction.reason ?? "",
      }));
    }
    const snapshot: ExtractionSnapshot = {
      call_id: callId,
      event,
      mode,
      extracted_at: new Date().toISOString(),
      transcript_length: transcript.length,
      extraction,
    };

    const debug_file = await writeDebugSnapshot(snapshot);
    const upsert_result = await upsertTranscriptCrm({
      callId,
      event,
      mode,
      transcript,
      transcriptLength: transcript.length,
      extractedAt: snapshot.extracted_at,
      extraction,
      callContext: getCallContext(payload),
      validationErrors: validation_errors,
    });

    console.log("transcript-crm-poc extraction", JSON.stringify({
      ...snapshot,
      debug_file,
      incremental: mode === "realtime" && Object.keys(crmState.extraction).length > 0,
      new_transcript_length: newTranscript.length,
    }));

    return json({
      received: true,
      call_id: callId,
      event,
      mode,
      debug_file,
      upsert_result,
      validation_errors,
      extraction,
    }, 200);
  } catch (error) {
    console.error("transcript-crm-poc error", error);
    return json({
      error: "extraction_failed",
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

function getCallContext(payload: RetellWebhookPayload): Record<string, unknown> {
  const call = payload.call ?? payload.data?.call ?? {};
  return {
    call_id: getCallId(payload),
    call_status: call.call_status,
    agent_id: call.agent_id,
    agent_name: call.agent_name,
    from_number: call.from_number,
    to_number: call.to_number,
    start_timestamp: call.start_timestamp,
    end_timestamp: call.end_timestamp,
    recording_url: call.recording_url,
  };
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

function latestTranscriptSegment(transcript: string, previousLength: number): string {
  if (!previousLength || previousLength < 0) return transcript;
  if (previousLength >= transcript.length) return "";
  return transcript.slice(previousLength).trim();
}

function applyCallContextFallbacks(
  extraction: { contact_number: string | null; callback_number: string | null; field_confidence: Record<string, "low" | "medium" | "high"> },
  payload: RetellWebhookPayload,
  transcript: string,
) {
  const fromNumber = stringValue(payload.call?.from_number ?? payload.data?.call?.from_number);
  if (!fromNumber) return;
  const callerText = callerOnlyText(transcript);
  if (!callerAcceptedCurrentNumber(callerText)) return;
  if (callerProvidedAlternateNumber(callerText)) return;
  if (hasFullPhoneNumber(extraction.contact_number) || hasFullPhoneNumber(extraction.callback_number)) return;

  extraction.contact_number = fromNumber;
  extraction.field_confidence.contact_number = "high";
}

function hasFullPhoneNumber(value: string | null): boolean {
  if (!value) return false;
  const digits = value.replace(/[^\d]/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

function callerAcceptedCurrentNumber(transcript: string): boolean {
  const text = transcript.toLowerCase();
  return [
    /\b(same|current|this|that)\s+(number|phone)\b/,
    /\b(number|phone)\s+(i am|i'm|im)\s+calling\s+from\b/,
    /\b(calling|called)\s+from\s+(this|that|same)\s+(number|phone)\b/,
    /\buse\s+(this|that|same|current)\s+(number|phone)\b/,
    /\bthe\s+one\s+(i am|i'm|im)\s+calling\s+from\b/,
  ].some((pattern) => pattern.test(text));
}

function callerProvidedAlternateNumber(transcript: string): boolean {
  const text = transcript.toLowerCase();
  return [
    /\b(different|another|alternate|new|other)\s+(number|phone|callback)\b/,
    /\b(number|phone|callback)\s+(is|should be)\s+(different|another|new|other)\b/,
    /\bnot\s+(the\s+)?(same|current|this|that)\s+(number|phone)\b/,
    /\b(use|call|text|reach)\s+(me\s+)?(on|at)?\s*(a\s+)?(different|another|new|other)\s+(number|phone)\b/,
    /\bmy\s+(callback|contact)\s+number\s+is\b/,
  ].some((pattern) => pattern.test(text));
}

function callerOnlyText(transcript: string): string {
  const lines = transcript.split(/\r?\n/);
  const callerLines = lines
    .map((line) => line.trim())
    .filter((line) => /^(user|caller|patient|customer)\s*:/i.test(line))
    .map((line) => line.replace(/^(user|caller|patient|customer)\s*:\s*/i, ""));

  return callerLines.length > 0 ? callerLines.join("\n") : transcript;
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

async function sendTranscriptValidationAlert(
  callId: string,
  event: string,
  triageFlag: string | null | undefined,
  validationErrors: Array<{ field: string; reason: string; value: unknown }>,
) {
  const criticalFields = new Set([
    "full_legal_name",
    "contact_number",
    "callback_number",
    "dob",
    "appointment_text",
    "triage_flag",
    "payer_name",
    "member_id",
    "group_number",
    "insurance_status",
  ]);
  const criticalIssues = validationErrors.filter((issue) => criticalFields.has(issue.field));
  if (criticalIssues.length === 0 && !isUrgentTriage(triageFlag)) return;

  await sendAlert("CRM extraction validation issue", {
    call_id: callId,
    event,
    triage_flag: triageFlag ?? "",
    issues: criticalIssues.map((issue) => `${issue.field}:${issue.reason}`).join(", "),
  });
}

function isUrgentTriage(value: string | null | undefined): boolean {
  const normalized = (value ?? "").toLowerCase();
  return normalized === "urgent_emergency" || normalized === "chest_pain_high";
}
