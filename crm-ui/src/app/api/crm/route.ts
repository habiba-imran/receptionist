import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return proxyCRMRequest("GET");
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON" }, { status: 400 });
  }

  return proxyCRMRequest("POST", body);
}

async function proxyCRMRequest(method: "GET" | "POST", body?: unknown) {
  const crmApiUrl = process.env.CRM_API_URL?.trim();
  const crmSecret = process.env.CRM_SECRET?.trim();

  if (!crmApiUrl) {
    return NextResponse.json(
      { error: "Server misconfiguration: CRM_API_URL is missing" },
      { status: 500 }
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };

    if (crmSecret) {
      headers["x-crm-secret"] = crmSecret;
    }

    const response = await fetch(crmApiUrl, {
      method,
      headers,
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      cache: "no-store",
      signal: controller.signal,
    });

    const text = await response.text();
    const data = safeJsonParse(text);

    if (data !== null) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(
      { error: "Upstream returned a non-JSON response", raw: text.slice(0, 500) },
      { status: response.status }
    );
  } catch (error: unknown) {
    console.error(`${method} /api/crm error:`, error);

    if (isAbortError(error)) {
      return NextResponse.json({ error: "Upstream timeout" }, { status: 504 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  } finally {
    clearTimeout(timeoutId);
  }
}

function safeJsonParse(text: string) {
  if (!text.trim()) return {};

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}
