import { decryptSecret, facebookAdapter, instagramAdapter, whatsappAdapter, type FetchLike, type SendResult } from "@snapsocial/integrations";
import { simulatedSend, type SendInput } from "./engine";

/**
 * Routes each send by the connection's own mode: simulation connections use
 * the labelled mock, integration connections call Meta with their stored token.
 * Shared by the worker and the web app so neither can send a real account's
 * reply through the mock.
 */
export function connectionSender(options: {
  keys: Record<string, Buffer>;
  instagramGraphBaseUrl: string;
  facebookGraphBaseUrl: string;
  version: string;
  fetchImpl?: FetchLike;
}): (input: SendInput) => Promise<SendResult> {
  const instagram = instagramAdapter({ baseUrl: options.instagramGraphBaseUrl, version: options.version, fetchImpl: options.fetchImpl });
  const facebook = facebookAdapter({ baseUrl: options.facebookGraphBaseUrl, version: options.version, fetchImpl: options.fetchImpl });
  const whatsapp = whatsappAdapter({ baseUrl: options.facebookGraphBaseUrl, version: options.version, fetchImpl: options.fetchImpl });
  return async (input) => {
    const { connection } = input;
    if (connection.mode === "SIMULATION") return simulatedSend(input);
    if (!connection.credentialCiphertext) {
      return { status: "PERMANENT_FAILURE", error: "No stored credential for this connection. Reconnect it.", simulated: false };
    }
    let token: string;
    try {
      token = decryptSecret(connection.credentialCiphertext, options.keys);
    } catch {
      return { status: "PERMANENT_FAILURE", error: "Stored credential could not be decrypted. Reconnect it.", simulated: false };
    }
    const adapter = connection.channel === "INSTAGRAM" ? instagram : connection.channel === "WHATSAPP" ? whatsapp : facebook;
    if (input.purpose === "opening") {
      if (!input.commentId) return { status: "PERMANENT_FAILURE", error: "Opening has no comment id.", simulated: false };
      return adapter.sendPrivateReply({ accountId: connection.externalAccountId, commentId: input.commentId, text: input.text, token });
    }
    if (!input.recipientId) {
      return { status: "PERMANENT_FAILURE", error: "No messaging participant id recorded yet.", simulated: false };
    }
    if (input.purpose === "typing") {
      return adapter.showTyping({
        accountId: connection.externalAccountId,
        recipientId: input.recipientId,
        messageId: input.inboundMessageId ?? null,
        token,
      });
    }
    if (input.audioUrl) {
      return adapter.sendAudio({
        accountId: connection.externalAccountId,
        recipientId: input.recipientId,
        audioUrl: input.audioUrl,
        token,
        replyToMessageId: input.inboundMessageId ?? null,
      });
    }
    return adapter.sendText({
      accountId: connection.externalAccountId,
      recipientId: input.recipientId,
      text: input.text,
      token,
      replyToMessageId: input.inboundMessageId ?? null,
    });
  };
}
