import type { ChannelAdapter, FetchLike } from "./channel";
import { classifyFetch } from "./channel";
import { assertAllowedUrl } from "./hosts";
import { MetaOAuthError } from "./meta-oauth";

export const WHATSAPP_SUBSCRIBED_FIELDS = ["messages"] as const;

type Json = Record<string, unknown>;

async function readJson(step: string, response: Response): Promise<Json> {
  const text = await response.text();
  let body: Json = {};
  try {
    body = JSON.parse(text) as Json;
  } catch {
    body = {};
  }
  const error = body.error as Json | undefined;
  if (!response.ok || error) {
    throw new MetaOAuthError(step, String(error?.message ?? `HTTP ${response.status}`).slice(0, 300));
  }
  return body;
}

export function whatsappAdapter(options: { baseUrl: string; version: string; fetchImpl?: FetchLike }): ChannelAdapter {
  const base = assertAllowedUrl(options.baseUrl, "meta");
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    channel: "WHATSAPP",
    mode: "INTEGRATION",
    async sendPrivateReply() {
      return { status: "PERMANENT_FAILURE", error: "WhatsApp has no comments to reply to.", simulated: false };
    },
    async sendText(input) {
      return classifyFetch(() =>
        fetchImpl(`${base.origin}/${options.version}/${input.accountId}/messages`, {
          method: "POST",
          headers: { Authorization: `Bearer ${input.token}`, "content-type": "application/json" },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: input.recipientId,
            ...(input.replyToMessageId ? { context: { message_id: input.replyToMessageId } } : {}),
            type: "text",
            text: { body: input.text, preview_url: false },
          }),
          signal: AbortSignal.timeout(15_000),
        }),
      );
    },
    async showTyping(input) {
      if (!input.messageId) return { status: "ACCEPTED", providerMessageId: null, providerRecipientId: null, simulated: false };
      return classifyFetch(() =>
        fetchImpl(`${base.origin}/${options.version}/${input.accountId}/messages`, {
          method: "POST",
          headers: { Authorization: `Bearer ${input.token}`, "content-type": "application/json" },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            status: "read",
            message_id: input.messageId,
            typing_indicator: { type: "text" },
          }),
          signal: AbortSignal.timeout(8_000),
        }),
      );
    },
    async sendAudio(input) {
      return classifyFetch(() =>
        fetchImpl(`${base.origin}/${options.version}/${input.accountId}/messages`, {
          method: "POST",
          headers: { Authorization: `Bearer ${input.token}`, "content-type": "application/json" },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: input.recipientId,
            ...(input.replyToMessageId ? { context: { message_id: input.replyToMessageId } } : {}),
            type: "audio",
            audio: { link: input.audioUrl },
          }),
          signal: AbortSignal.timeout(30_000),
        }),
      );
    },
    async diagnose(input) {
      return [
        { name: "Credential", ok: Boolean(input.token), checkedAt: input.token ? new Date().toISOString() : null, detail: input.token ? "Access token is stored." : "No access token stored." },
        { name: "Subscribed", ok: input.subscribed, checkedAt: input.subscribed ? new Date().toISOString() : null, detail: input.subscribed ? "WhatsApp Business Account subscription recorded." : "Subscription not recorded." },
      ];
    },
  };
}

export async function checkWhatsAppNumber(options: {
  phoneNumberId: string;
  token: string;
  graphBaseUrl: string;
  version: string;
  fetchImpl?: FetchLike;
}): Promise<{ displayPhoneNumber: string; verifiedName: string | null }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const graph = assertAllowedUrl(options.graphBaseUrl, "meta");
  const url = new URL(`/${options.version}/${encodeURIComponent(options.phoneNumberId)}`, graph);
  url.searchParams.set("fields", "display_phone_number,verified_name");
  const body = await readJson("WhatsApp number check", await fetchImpl(String(url), {
    headers: { Authorization: `Bearer ${options.token}` },
    signal: AbortSignal.timeout(15_000),
  }));
  const displayPhoneNumber = String(body.display_phone_number ?? "");
  if (!displayPhoneNumber) throw new MetaOAuthError("WhatsApp number check", "Meta did not return a phone number for that id.");
  return { displayPhoneNumber, verifiedName: typeof body.verified_name === "string" ? body.verified_name : null };
}

export async function subscribeWhatsAppAccount(options: {
  businessAccountId: string;
  token: string;
  graphBaseUrl: string;
  version: string;
  fetchImpl?: FetchLike;
}): Promise<string[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const graph = assertAllowedUrl(options.graphBaseUrl, "meta");
  const url = new URL(`/${options.version}/${encodeURIComponent(options.businessAccountId)}/subscribed_apps`, graph);
  const body = await readJson("WhatsApp subscription", await fetchImpl(String(url), {
    method: "POST",
    headers: { Authorization: `Bearer ${options.token}` },
    signal: AbortSignal.timeout(15_000),
  }));
  if (body.success !== true) throw new MetaOAuthError("WhatsApp subscription", "Meta did not confirm the subscription.");
  return [...WHATSAPP_SUBSCRIBED_FIELDS];
}

/** Media URLs from WhatsApp need the same bearer token to download. */
export async function whatsappMediaUrl(options: {
  mediaId: string;
  token: string;
  graphBaseUrl: string;
  version: string;
  fetchImpl?: FetchLike;
}): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const graph = assertAllowedUrl(options.graphBaseUrl, "meta");
  const url = new URL(`/${options.version}/${encodeURIComponent(options.mediaId)}`, graph);
  const body = await readJson("WhatsApp media", await fetchImpl(String(url), {
    headers: { Authorization: `Bearer ${options.token}` },
    signal: AbortSignal.timeout(15_000),
  }));
  const mediaUrl = String(body.url ?? "");
  if (!mediaUrl) throw new MetaOAuthError("WhatsApp media", "Meta did not return a media URL.");
  return mediaUrl;
}
