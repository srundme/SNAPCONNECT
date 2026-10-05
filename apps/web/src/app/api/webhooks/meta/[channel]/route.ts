import { loadConfig } from "@snapsocial/config";
import { normalizeMetaPayload, verifyAnyMetaSignature } from "@snapsocial/domain";
import { getPrisma, ingestEvents } from "@snapsocial/db";
import { decryptSecret } from "@snapsocial/integrations";

export const runtime = "nodejs";

type WebhookChannel = "INSTAGRAM" | "FACEBOOK" | "WHATSAPP";

function key() {
  const config = loadConfig();
  return { id: config.CREDENTIAL_ENCRYPTION_KEY_ID, raw: Buffer.from(config.CREDENTIAL_ENCRYPTION_KEY, "base64") };
}

function channelFrom(path: string): WebhookChannel | null {
  if (path === "instagram") return "INSTAGRAM";
  if (path === "facebook") return "FACEBOOK";
  if (path === "whatsapp") return "WHATSAPP";
  return null;
}

export async function GET(request: Request, context: { params: Promise<{ channel: string }> }) {
  const { channel } = await context.params;
  const normalized = channelFrom(channel);
  if (!normalized) return new Response("not found", { status: 404 });
  const url = new URL(request.url);
  if (url.searchParams.get("hub.mode") !== "subscribe") return new Response("bad request", { status: 400 });
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  const token = url.searchParams.get("hub.verify_token") ?? "";
  const secrets = await verifyTokens(normalized);
  if (!secrets.includes(token)) return new Response("forbidden", { status: 403 });
  const db = getPrisma();
  const now = new Date();
  await db.auditEvent.create({
    data: { action: "webhook.verified", entityType: normalized, summary: `Meta verified the ${channel} webhook callback.` },
  });
  await db.channelConnection.updateMany({
    where: { channel: normalized, mode: "INTEGRATION", revokedAt: null },
    data: { webhookVerifiedAt: now },
  });
  return new Response(challenge, { status: 200 });
}

export async function POST(request: Request, context: { params: Promise<{ channel: string }> }) {
  const { channel } = await context.params;
  const normalized = channelFrom(channel);
  if (!normalized) return new Response("not found", { status: 404 });
  const raw = await request.text();
  if (raw.length > 1_000_000) return new Response("payload too large", { status: 413 });
  const secrets = await appSecrets(normalized);
  if (secrets.length === 0) return new Response("app secret is not configured", { status: 503 });
  if (!verifyAnyMetaSignature(raw, request.headers.get("x-hub-signature-256"), secrets)) {
    return new Response("invalid signature", { status: 401 });
  }
  const events = normalizeMetaPayload(normalized, JSON.parse(raw) as unknown, new Date());
  const db = getPrisma();
  const pending = await db.channelConnection.findMany({
    where: { channel: normalized, mode: "INTEGRATION", revokedAt: null, webhookVerifiedAt: null },
    select: { id: true },
  });
  if (pending.length) {
    const now = new Date();
    await db.auditEvent.create({
      data: { action: "webhook.verified", entityType: normalized, summary: `Meta delivered a signed ${channel} webhook.` },
    });
    await db.channelConnection.updateMany({
      where: { id: { in: pending.map((row) => row.id) } },
      data: { webhookVerifiedAt: now },
    });
  }
  await ingestEvents(db, { channel: normalized, mode: "INTEGRATION", events, receivedAt: new Date() });
  return Response.json({ received: true });
}

async function storedRows(channel: WebhookChannel) {
  const scopes = channel === "WHATSAPP" ? ["WHATSAPP", "FACEBOOK", "SHARED"] : [channel, "SHARED"];
  return getPrisma().metaAppConfig.findMany({ where: { scope: { in: scopes } } });
}

async function appSecrets(channel: WebhookChannel) {
  const config = loadConfig();
  const envSecrets = channel === "INSTAGRAM"
    ? [config.META_INSTAGRAM_APP_SECRET]
    : channel === "FACEBOOK"
      ? [config.META_FACEBOOK_APP_SECRET]
      : [config.META_WHATSAPP_APP_SECRET, config.META_FACEBOOK_APP_SECRET];
  const stored = (await storedRows(channel)).map((row) => decryptSecret(row.secretCiphertext, { [key().id]: key().raw }));
  return [...stored, ...envSecrets].filter((item): item is string => Boolean(item));
}

async function verifyTokens(channel: WebhookChannel) {
  const config = loadConfig();
  const envTokens = channel === "INSTAGRAM"
    ? [config.META_INSTAGRAM_VERIFY_TOKEN]
    : channel === "FACEBOOK"
      ? [config.META_FACEBOOK_VERIFY_TOKEN]
      : [config.META_WHATSAPP_VERIFY_TOKEN, config.META_FACEBOOK_VERIFY_TOKEN];
  const stored = (await storedRows(channel)).map((row) => decryptSecret(row.verifyTokenCiphertext, { [key().id]: key().raw }));
  return [...stored, ...envTokens].filter((item): item is string => Boolean(item));
}
