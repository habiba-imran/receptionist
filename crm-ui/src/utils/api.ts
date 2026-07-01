import { CRMResponse, CRMActionResponse } from "../types/crm";

/**
 * Fetches all bookings and message logs from the local Next.js proxy route.
 */
export async function fetchCRMData(): Promise<CRMResponse> {
  const res = await fetch("/api/crm", {
    method: "GET",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch CRM data: ${res.statusText}`);
  }

  return res.json();
}

/**
 * Dispatches an action (like resend_confirmation or resend_form) to the local proxy route.
 */
export async function dispatchCRMAction(
  action: "resend_confirmation" | "resend_form",
  call_id: string
): Promise<CRMActionResponse> {
  const res = await fetch("/api/crm", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, call_id }),
  });

  if (!res.ok) {
    let errorMsg = "Action failed";
    try {
      const errBody = await res.json();
      if (errBody.error) errorMsg = errBody.error;
    } catch {
      // ignore parsing error
    }
    throw new Error(errorMsg);
  }

  const data: CRMActionResponse = await res.json();

  if (data.ok === false) {
    const actionError =
      data.result?.error ||
      data.error ||
      "Action completed without sending successfully.";
    throw new Error(actionError);
  }

  return data;
}
