const ALERT_WEBHOOK_URL = Deno.env.get("ALERT_WEBHOOK_URL") ?? Deno.env.get("SLACK_WEBHOOK_URL") ?? "";

export async function sendAlert(title: string, details: Record<string, unknown> = {}): Promise<void> {
  if (!ALERT_WEBHOOK_URL) return;

  try {
    const text = buildAlertText(title, details);
    const response = await fetch(ALERT_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error("alert webhook failed", response.status, body.slice(0, 500));
    }
  } catch (error) {
    console.error("alert send failed", error);
  }
}

function buildAlertText(title: string, details: Record<string, unknown>): string {
  const lines = [title];
  for (const [key, value] of Object.entries(details)) {
    if (value === null || value === undefined || value === "") continue;
    lines.push(`${key}: ${formatValue(value)}`);
  }
  return lines.join("\n");
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}