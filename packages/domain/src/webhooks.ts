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
};

export type NormalizedIgnore = {
  kind: "ignore";
  externalAccountId: string;
  reason: string;
  nativeId: string | null;
};

export type NormalizedEvent = NormalizedComment | NormalizedMessage | NormalizedIgnore;

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
  const events: NormalizedEvent[] = [];
  for (const entry of asArray(root.entry)) {
    const item = asObject(entry);
    if (!item) continue;
    const accountId = asString(item.id) ?? "unknown";
    if (channel === "INSTAGRAM") events.push(...instagramEntry(accountId, item, receivedAt));
    else events.push(...facebookEntry(accountId, item, receivedAt));
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
      isAd: Boolean(post?.promotion_status) || asString(value.post_type) === "ad",
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
  const message = asObject(node.message);
  const sender = asObject(node.sender);
  const messageId = asString(message?.mid);
  const senderId = asString(sender?.id);
  if (!message || !messageId || !senderId) {
    return { kind: "ignore", externalAccountId: accountId, reason: "Messaging event has no user text turn.", nativeId: null };
  }
  const referral = asObject(node.referral) ?? asObject(message.referral);
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
