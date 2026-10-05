import type { Channel } from "./types";

export type NormalizedComment = {
  kind: "comment";
  action: "add" | "edit" | "remove";
  externalAccountId: string;
  commentId: string;
  text: string;
  authorId: string;
  authorUsername: string | null;
  authorName: string | null;
  mediaId: string | null;
  contentType: "POST" | "REEL" | "UNKNOWN";
  commentedAt: string;
  isAd: boolean;
  isLive: boolean;
  isGroup: boolean;
};

export type NormalizedMessage = {
  kind: "message";
  externalAccountId: string;
  messageId: string;
  senderId: string;
  text: string;
  sentAt: string;
  isEcho: boolean;
  referralCommentId: string | null;
  referralPostId: string | null;
  audioUrl: string | null;
  senderName?: string | null;
  audioMediaId?: string | null;
  /** What kind of attachment came without being text or a voice note: image, video, sticker, document, share... */
  mediaKind?: string | null;
  imageUrl?: string | null;
  imageMediaId?: string | null;
};

export type NormalizedMessageEdit = {
  kind: "message_edit";
  externalAccountId: string;
  messageId: string;
  senderId: string;
  text: string;
  editCount: number;
  editedAt: string;
};

export type NormalizedIgnore = {
  kind: "ignore";
  externalAccountId: string;
  reason: string;
  nativeId: string | null;
};

export type NormalizedEvent = NormalizedComment | NormalizedMessage | NormalizedMessageEdit | NormalizedIgnore;

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function dedupKey(channel: Channel, event: NormalizedEvent): string {
  const account = event.externalAccountId;
  if (event.kind === "comment") return `${channel}:${account}:comment:${event.action}:${event.commentId}`;
  if (event.kind === "message") return `${channel}:${account}:message:${event.messageId}`;
  if (event.kind === "message_edit") return `${channel}:${account}:message_edit:${event.messageId}:${event.editCount}`;
  return `${channel}:${account}:ignore:${event.reason}:${event.nativeId ?? "none"}`;
}

export function normalizeMetaPayload(channel: Channel, body: unknown, receivedAt: Date): NormalizedEvent[] {
  const root = asObject(body);
  if (!root) return [];
  const object = asString(root.object);
  if (channel === "INSTAGRAM" && object !== "instagram") {
    return [{ kind: "ignore", externalAccountId: "unknown", reason: "Unexpected webhook object for Instagram.", nativeId: object }];
  }
  if (channel === "FACEBOOK" && object !== "page") {
    return [{ kind: "ignore", externalAccountId: "unknown", reason: "Unexpected webhook object for Facebook.", nativeId: object }];
  }
  if (channel === "WHATSAPP" && object !== "whatsapp_business_account") {
    return [{ kind: "ignore", externalAccountId: "unknown", reason: "Unexpected webhook object for WhatsApp.", nativeId: object }];
  }
  const events: NormalizedEvent[] = [];
  for (const entry of asArray(root.entry)) {
    const item = asObject(entry);
    if (!item) continue;
    const accountId = asString(item.id) ?? "unknown";
    if (channel === "INSTAGRAM") events.push(...instagramEntry(accountId, item, receivedAt));
    else if (channel === "WHATSAPP") events.push(...whatsappEntry(item, receivedAt));
    else events.push(...facebookEntry(accountId, item, receivedAt));
  }
  return events;
}

const WHATSAPP_PLACEHOLDER: Record<string, string> = {
  image: "(Sent a photo.)",
  video: "(Sent a video.)",
  document: "(Sent a document.)",
  sticker: "(Sent a sticker.)",
  location: "(Shared a location.)",
  contacts: "(Shared a contact.)",
};

const MEDIA_NOTES: Record<string, string> = {
  ...WHATSAPP_PLACEHOLDER,
  file: "(Sent a document.)",
  animated_image: "(Sent a GIF.)",
  share: "(Shared a post.)",
  ig_reel: "(Shared a reel.)",
  reel: "(Shared a reel.)",
  story_mention: "(Mentioned you in their story.)",
  like_heart: "(Sent a heart.)",
};

/** The note saved in the chat for an attachment; a photo carries what the vision model saw in it. */
export function mediaNote(kind: string, seen?: string | null): string {
  if (kind === "image" && seen?.trim()) return `(Sent a photo. It shows: ${seen.trim().replace(/\)+$/, "")})`;
  return MEDIA_NOTES[kind] ?? "(Sent an attachment.)";
}

function whatsappEntry(entry: Json, receivedAt: Date): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];
  for (const change of asArray(entry.changes)) {
    const node = asObject(change);
    const value = node ? asObject(node.value) : null;
    if (!value || asString(node?.field) !== "messages") continue;
    const phoneNumberId = asString(asObject(value.metadata)?.phone_number_id) ?? "unknown";
    const names = new Map<string, string>();
    for (const contact of asArray(value.contacts)) {
      const item = asObject(contact);
      const waId = asString(item?.wa_id);
      const name = asString(asObject(item?.profile)?.name);
      if (waId && name) names.set(waId, name);
    }
    for (const raw of asArray(value.messages)) {
      const message = asObject(raw);
      const messageId = asString(message?.id);
      const from = asString(message?.from);
      const type = asString(message?.type) ?? "";
      if (!message || !messageId || !from) {
        events.push({ kind: "ignore", externalAccountId: phoneNumberId, reason: "WhatsApp message has no sender.", nativeId: messageId });
        continue;
      }
      const interactive = asObject(message.interactive);
      const media = asObject(message[type]);
      const text = type === "text" ? asString(asObject(message.text)?.body)
        : type === "button" ? asString(asObject(message.button)?.text)
        : type === "interactive" ? asString(asObject(interactive?.button_reply)?.title) ?? asString(asObject(interactive?.list_reply)?.title)
        : asString(media?.caption) ?? null;
      const audioMediaId = type === "audio" ? asString(asObject(message.audio)?.id) : null;
      const mediaKind = WHATSAPP_PLACEHOLDER[type] ? type : null;
      if (!text && !audioMediaId && !mediaKind) {
        events.push({ kind: "ignore", externalAccountId: phoneNumberId, reason: `Unsupported WhatsApp message type ${type || "unknown"}.`, nativeId: messageId });
        continue;
      }
      const referral = asObject(message.referral);
      events.push({
        kind: "message",
        externalAccountId: phoneNumberId,
        messageId,
        senderId: from,
        text: text ?? "",
        sentAt: numberDate(Number(message.timestamp)) ?? receivedAt.toISOString(),
        isEcho: false,
        referralCommentId: null,
        referralPostId: asString(referral?.source_id),
        audioUrl: null,
        senderName: names.get(from) ?? null,
        audioMediaId,
        mediaKind,
        imageMediaId: type === "image" ? asString(media?.id) : null,
      });
    }
  }
  return events;
}

function instagramEntry(accountId: string, entry: Json, receivedAt: Date): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];
  for (const change of asArray(entry.changes)) {
    const node = asObject(change);
    const field = node ? asString(node.field) : null;
    const value = node ? asObject(node.value) : null;
    if (!value || field !== "comments") {
      events.push({
        kind: "ignore",
        externalAccountId: accountId,
        reason: field === "live_comments" ? "Instagram live comments are unsupported." : "Unsupported Instagram change.",
        nativeId: field,
      });
      continue;
    }
    const commentId = asString(value.id);
    const author = asObject(value.from);
    const media = asObject(value.media);
    if (!commentId || !author) {
      events.push({ kind: "ignore", externalAccountId: accountId, reason: "Instagram comment is missing identifiers.", nativeId: null });
      continue;
    }
    const product = asString(media?.media_product_type);
    events.push({
      kind: "comment",
      action: "add",
      externalAccountId: accountId,
      commentId,
      text: asString(value.text) ?? "",
      authorId: asString(author.id) ?? "",
      authorUsername: asString(author.username),
      authorName: asString(author.name),
      mediaId: asString(media?.id),
      contentType: product === "REELS" ? "REEL" : product ? "POST" : "UNKNOWN",
      commentedAt: receivedAt.toISOString(),
      isAd: false,
      isLive: false,
      isGroup: false,
    });
  }
  for (const message of asArray(entry.messaging)) {
    events.push(readMessaging(accountId, message, receivedAt));
  }
  return events;
}

function facebookEntry(accountId: string, entry: Json, receivedAt: Date): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];
  for (const change of asArray(entry.changes)) {
    const node = asObject(change);
    const field = node ? asString(node.field) : null;
    const value = node ? asObject(node.value) : null;
    if (!value || field !== "feed") {
      events.push({ kind: "ignore", externalAccountId: accountId, reason: "Unsupported Facebook change.", nativeId: field });
      continue;
    }
    const item = asString(value.item);
    const verb = asString(value.verb);
    if (item !== "comment") {
      events.push({
        kind: "ignore",
        externalAccountId: accountId,
        reason: "Facebook feed item is not a new comment.",
        nativeId: item,
      });
      continue;
    }
    const action = verb === "add" ? "add" : verb === "remove" ? "remove" : "edit";
    const commentId = asString(value.comment_id) ?? asString(value.commentId);
    if (!commentId) {
      events.push({ kind: "ignore", externalAccountId: accountId, reason: "Facebook comment is missing an id.", nativeId: null });
      continue;
    }
    const from = asObject(value.from);
    const post = asObject(value.post);
    const status = asString(post?.status_type) ?? "";
    const contentType = /reel/i.test(status) || asString(value.post_type) === "reel" ? "REEL" : "POST";
    events.push({
      kind: "comment",
      action,
      externalAccountId: accountId,
      commentId,
      text: asString(value.message) ?? "",
      authorId: asString(value.sender_id) ?? asString(from?.id) ?? "",
      authorUsername: null,
      authorName: asString(value.sender_name) ?? asString(from?.name),
      mediaId: asString(value.post_id) ?? asString(post?.id),
      contentType,
      commentedAt: numberDate(value.created_time) ?? receivedAt.toISOString(),
      isAd: asString(post?.promotion_status) === "active" || asString(value.post_type) === "ad",
      isLive: /live/i.test(status),
      isGroup: asString(value.group_id) !== null,
    });
  }
  for (const message of asArray(entry.messaging)) {
    events.push(readMessaging(accountId, message, receivedAt));
  }
  return events;
}

function readMessaging(accountId: string, value: unknown, receivedAt: Date): NormalizedEvent {
  const node = asObject(value);
  if (!node) return { kind: "ignore", externalAccountId: accountId, reason: "Malformed messaging event.", nativeId: null };
  if (node.read || node.delivery || node.reaction) {
    return { kind: "ignore", externalAccountId: accountId, reason: "Non-message messaging event.", nativeId: null };
  }
  const sender = asObject(node.sender);
  const edit = asObject(node.message_edit);
  if (edit) {
    const editedId = asString(edit.mid);
    const editorId = asString(sender?.id) ?? "";
    const editedText = asString(edit.text);
    const editCount = Number(edit.num_edit ?? 0);
    if (!editedId || !editedText || !(editCount >= 1) || editorId === accountId) {
      return { kind: "ignore", externalAccountId: accountId, reason: "Message edit has no customer text change.", nativeId: editedId };
    }
    return {
      kind: "message_edit",
      externalAccountId: accountId,
      messageId: editedId,
      senderId: editorId,
      text: editedText,
      editCount,
      editedAt: numberDate(node.timestamp) ?? receivedAt.toISOString(),
    };
  }
  const message = asObject(node.message);
  const messageId = asString(message?.mid);
  const senderId = asString(sender?.id);
  if (!message || !messageId || !senderId) {
    return { kind: "ignore", externalAccountId: accountId, reason: "Messaging event has no user text turn.", nativeId: null };
  }
  const referral = asObject(node.referral) ?? asObject(message.referral);
  const attachments = asArray(message.attachments).map(asObject);
  const audio = attachments.find((item) => asString(item?.type) === "audio");
  const other = attachments.find((item) => item && asString(item.type) !== "audio");
  const otherKind = other ? asString(other.type) ?? "attachment" : null;
  return {
    kind: "message",
    externalAccountId: accountId,
    messageId,
    senderId,
    text: asString(message.text) ?? "",
    sentAt: numberDate(node.timestamp) ?? receivedAt.toISOString(),
    isEcho: message.is_echo === true || senderId === accountId,
    referralCommentId: asString(referral?.comment_id) ?? asString(referral?.commentId),
    referralPostId: asString(referral?.post_id) ?? asString(referral?.postId),
    audioUrl: asString(asObject(audio?.payload)?.url),
    mediaKind: otherKind,
    imageUrl: otherKind === "image" ? asString(asObject(other?.payload)?.url) : null,
  };
}

function numberDate(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value > 10_000_000_000 ? value : value * 1000;
    return new Date(millis).toISOString();
  }
  return null;
}

export function routingDecision(connectionIds: string[]): { connectionId: string } | { reject: string } {
  if (connectionIds.length === 1 && connectionIds[0]) return { connectionId: connectionIds[0] };
  if (connectionIds.length === 0) return { reject: "Unknown account." };
  return { reject: "Conflicting account connections." };
}
