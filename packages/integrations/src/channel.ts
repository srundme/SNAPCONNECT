export type SendResult =
  | { status: "ACCEPTED"; providerMessageId: string | null; providerRecipientId: string | null; simulated: boolean }
  | { status: "RETRYABLE_FAILURE"; error: string; simulated: boolean }
  | { status: "PERMANENT_FAILURE"; error: string; simulated: boolean }
  | { status: "UNKNOWN"; error: string; simulated: boolean };

export type DiagnosticCheck = {
  name: string;
  ok: boolean | null;
  checkedAt: string | null;
  detail: string;
};

export type ChannelAdapter = {
  channel: "INSTAGRAM" | "FACEBOOK" | "WHATSAPP";
  mode: "SIMULATION" | "INTEGRATION";
  sendPrivateReply(input: { commentId: string; text: string; token: string; accountId: string }): Promise<SendResult>;
  sendText(input: { recipientId: string; text: string; token: string; accountId: string }): Promise<SendResult>;
  diagnose(input: { token: string | null; scopes: string[]; subscribed: boolean }): Promise<DiagnosticCheck[]>;
};

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export async function classifyFetch(work: () => Promise<Response>, simulated = false): Promise<SendResult> {
  try {
    const response = await work();
    const text = await response.text();
    if (response.status === 429 || response.status >= 500) {
      return { status: "RETRYABLE_FAILURE", error: `HTTP ${response.status}`, simulated };
    }
    if (!response.ok) return { status: "PERMANENT_FAILURE", error: `HTTP ${response.status}`, simulated };
    let body: {
      message_id?: string;
      recipient_id?: string;
      messages?: Array<{ id?: string }>;
      contacts?: Array<{ wa_id?: string }>;
      error?: unknown;
    } = {};
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      body = {};
    }
    if (body.error) return { status: "PERMANENT_FAILURE", error: "Provider returned an error payload.", simulated };
    return {
      status: "ACCEPTED",
      providerMessageId: body.message_id ?? body.messages?.[0]?.id ?? null,
      providerRecipientId: body.recipient_id ?? body.contacts?.[0]?.wa_id ?? null,
      simulated,
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return { status: "UNKNOWN", error: "The provider did not answer before the timeout.", simulated };
    }
    return { status: "RETRYABLE_FAILURE", error: "The provider could not be reached.", simulated };
  }
}
