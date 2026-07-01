export function formatDateTime(isoString?: string | null): string {
  if (!isoString) return "--";

  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "--";

  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDateOnly(value?: string | null): string {
  if (!value) return "--";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function fallback(value: string | null | undefined, fallbackText = "--"): string {
  if (!value || value.trim() === "") return fallbackText;
  return value;
}

export function formatBoolean(
  value: boolean | null | undefined,
  trueText = "Yes",
  falseText = "No",
  fallbackText = "--"
): string {
  if (value === true) return trueText;
  if (value === false) return falseText;
  return fallbackText;
}

export function humanizeToken(value: string | null | undefined, fallbackText = "--"): string {
  if (!value) return fallbackText;

  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getStatusDetails(triageFlag: string | null, needsReview: boolean) {
  const normalized = (triageFlag ?? "").toLowerCase();

  if (normalized === "urgent_emergency" || normalized === "chest_pain_high") {
    return { class: "status-urgent", text: "Urgent Review", badgeText: "URGENT" };
  }

  if (needsReview || normalized === "chest_pain_low") {
    return { class: "status-pending", text: "Needs Review", badgeText: "REVIEW" };
  }

  return { class: "status-normal", text: "Ready", badgeText: "READY" };
}

export function isUrgentTriage(triageFlag: string | null | undefined): boolean {
  const normalized = (triageFlag ?? "").toLowerCase();
  return normalized === "urgent_emergency" || normalized === "chest_pain_high";
}

export function getStatusTone(
  kind: "triage" | "insurance" | "intake" | "confirmation" | "form",
  value: string | null | undefined
): "danger" | "warning" | "success" | "info" | "neutral" {
  const normalized = (value ?? "").toLowerCase();

  if (!normalized) return "neutral";

  if (kind === "triage") {
    if (normalized === "urgent_emergency" || normalized === "chest_pain_high") return "danger";
    if (normalized === "chest_pain_low") return "warning";
    if (normalized === "none") return "success";
    return "neutral";
  }

  if (kind === "insurance") {
    if (normalized === "covered") return "success";
    if (normalized === "partial" || normalized === "pending" || normalized === "pending_form") return "warning";
    if (normalized === "self_pay") return "danger";
    return "neutral";
  }

  if (kind === "intake") {
    if (normalized === "voice") return "info";
    if (normalized === "form") return "neutral";
    return "neutral";
  }

  if (kind === "confirmation") {
    if (normalized === "sent") return "success";
    if (normalized === "pending") return "warning";
    if (normalized === "failed") return "danger";
    return "neutral";
  }

  if (kind === "form") {
    if (normalized === "submitted" || normalized === "sent") return "success";
    if (normalized === "not_sent") return "warning";
    if (normalized === "failed") return "danger";
    return "neutral";
  }

  return "neutral";
}
