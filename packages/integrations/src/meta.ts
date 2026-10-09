import type { ChannelAdapter, FetchLike } from "./channel";
import { classifyFetch } from "./channel";
import { assertAllowedUrl } from "./hosts";

const IG_SCOPES = ["instagram_business_basic", "instagram_business_manage_comments", "instagram_business_manage_messages"];
const FB_SCOPES = ["pages_show_list", "pages_read_engagement", "pages_read_user_content", "pages_manage_metadata", "pages_messaging"];

export function instagramAdapter(options: {
  baseUrl: string;
  version: string;
  fetchImpl?: FetchLike;
}): ChannelAdapter {
  const base = assertAllowedUrl(options.baseUrl, "meta");
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    channel: "INSTAGRAM",
    mode: "INTEGRATION",
    async sendPrivateReply(input) {
      return classifyFetch(() =>
        fetchImpl(`${base.origin}/${options.version}/${input.accountId}/messages`, {
          method: "POST",
          headers: { Authorization: `Bearer ${input.token}`, "content-type": "application/json" },
          body: JSON.stringify({ recipient: { comment_id: input.commentId }, message: { text: input.text } }),
          signal: AbortSignal.timeout(15_000),
        }),
      );
    },
    async sendText(input) {
      return classifyFetch(() =>
        fetchImpl(`${base.origin}/${options.version}/${input.accountId}/messages`, {
          method: "POST",
          headers: { Authorization: `Bearer ${input.token}`, "content-type": "application/json" },
          // No reply_to: Instagram and Messenger reject it ("Invalid keys reply_to"), which loses the whole reply.
          body: JSON.stringify({
            recipient: { id: input.recipientId },
            message: { text: input.text },
          }),
          signal: AbortSignal.timeout(15_000),
        }),
      );
    },
    async showTyping(input) {
      return classifyFetch(() =>
        fetchImpl(`${base.origin}/${options.version}/${input.accountId}/messages`, {
          method: "POST",
          headers: { Authorization: `Bearer ${input.token}`, "content-type": "application/json" },
          body: JSON.stringify({ recipient: { id: input.recipientId }, sender_action: "typing_on" }),
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
            recipient: { id: input.recipientId },
            message: {
              attachment: { type: "audio", payload: { url: input.audioUrl } },
            },
          }),
          signal: AbortSignal.timeout(30_000),
        }),
      );
    },
    async diagnose(input) {
      const missing = IG_SCOPES.filter((scope) => !input.scopes.includes(scope));
      return [
        { name: "Credential", ok: Boolean(input.token), checkedAt: input.token ? new Date().toISOString() : null, detail: input.token ? "Token is stored." : "No token stored." },
        { name: "Scopes", ok: missing.length === 0, checkedAt: new Date().toISOString(), detail: missing.length ? `Missing ${missing.join(", ")}` : "Required Instagram scopes are recorded." },
        { name: "Subscribed", ok: input.subscribed, checkedAt: input.subscribed ? new Date().toISOString() : null, detail: input.subscribed ? "Account subscription recorded." : "Account subscription not recorded." },
      ];
    },
  };
}

export function facebookAdapter(options: {
  baseUrl: string;
  version: string;
  fetchImpl?: FetchLike;
}): ChannelAdapter {
  const base = assertAllowedUrl(options.baseUrl, "meta");
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    channel: "FACEBOOK",
    mode: "INTEGRATION",
    async sendPrivateReply(input) {
      return classifyFetch(() =>
        fetchImpl(`${base.origin}/${options.version}/${input.accountId}/messages`, {
          method: "POST",
          headers: { Authorization: `Bearer ${input.token}`, "content-type": "application/json" },
          body: JSON.stringify({
            recipient: { comment_id: input.commentId },
            message: { text: input.text },
            messaging_type: "RESPONSE",
          }),
          signal: AbortSignal.timeout(15_000),
        }),
      );
    },
    async sendText(input) {
      return classifyFetch(() =>
        fetchImpl(`${base.origin}/${options.version}/${input.accountId}/messages`, {
          method: "POST",
          headers: { Authorization: `Bearer ${input.token}`, "content-type": "application/json" },
          body: JSON.stringify({
            recipient: { id: input.recipientId },
            message: { text: input.text },
            messaging_type: "RESPONSE",
          }),
          signal: AbortSignal.timeout(15_000),
        }),
      );
    },
    async showTyping(input) {
      return classifyFetch(() =>
        fetchImpl(`${base.origin}/${options.version}/${input.accountId}/messages`, {
          method: "POST",
          headers: { Authorization: `Bearer ${input.token}`, "content-type": "application/json" },
          body: JSON.stringify({ recipient: { id: input.recipientId }, sender_action: "typing_on" }),
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
            recipient: { id: input.recipientId },
            message: {
              attachment: { type: "audio", payload: { url: input.audioUrl, is_reusable: false } },
            },
            messaging_type: "RESPONSE",
          }),
          signal: AbortSignal.timeout(30_000),
        }),
      );
    },
    async diagnose(input) {
      const missing = FB_SCOPES.filter((scope) => !input.scopes.includes(scope));
      return [
        { name: "Credential", ok: Boolean(input.token), checkedAt: input.token ? new Date().toISOString() : null, detail: input.token ? "Page token is stored." : "No Page token stored." },
        { name: "Scopes", ok: missing.length === 0, checkedAt: new Date().toISOString(), detail: missing.length ? `Missing ${missing.join(", ")}` : "Planning Page scopes are recorded." },
        { name: "Subscribed", ok: input.subscribed, checkedAt: input.subscribed ? new Date().toISOString() : null, detail: input.subscribed ? "Page subscription recorded." : "Page subscription not recorded." },
      ];
    },
  };
}

export function simulationAdapter(channel: "INSTAGRAM" | "FACEBOOK" | "WHATSAPP"): ChannelAdapter {
  return {
    channel,
    mode: "SIMULATION",
    async sendPrivateReply(input) {
      return {
        status: "ACCEPTED",
        providerMessageId: `sim_${channel.toLowerCase()}_${input.commentId}`,
        providerRecipientId: null,
        simulated: true,
      };
    },
    async sendText(input) {
      return {
        status: "ACCEPTED",
        providerMessageId: `sim_${channel.toLowerCase()}_dm_${input.recipientId}_${crypto.randomUUID()}`,
        providerRecipientId: input.recipientId,
        simulated: true,
      };
    },
    async showTyping() {
      return { status: "ACCEPTED", providerMessageId: null, providerRecipientId: null, simulated: true };
    },
    async sendAudio(input) {
      return {
        status: "ACCEPTED",
        providerMessageId: `sim_${channel.toLowerCase()}_voice_${input.recipientId}_${crypto.randomUUID()}`,
        providerRecipientId: input.recipientId,
        simulated: true,
      };
    },
    async diagnose() {
      return [
        { name: "Credential", ok: null, checkedAt: null, detail: "Simulation does not use a live credential." },
        { name: "Scopes", ok: null, checkedAt: null, detail: "Simulation does not prove Meta permissions." },
        { name: "Subscribed", ok: null, checkedAt: null, detail: "Simulation does not subscribe a real account." },
      ];
    },
  };
}
