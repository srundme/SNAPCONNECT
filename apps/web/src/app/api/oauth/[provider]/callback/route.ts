import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { loadConfig, type AppConfig } from "@snapsocial/config";
import { getPrisma } from "@snapsocial/db";
import {
  encryptSecret,
  exchangeFacebookCode,
  exchangeInstagramCode,
  exchangeZohoCode,
  MetaOAuthError,
  subscribeFacebookPage,
  subscribeInstagramAccount,
} from "@snapsocial/integrations";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";

function back(config: AppConfig, params: Record<string, string>, path = "/integrations"): Response {
  const url = new URL(path, config.APP_BASE_URL);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value.slice(0, 300));
  return Response.redirect(url, 303);
}

function encrypt(config: AppConfig, plaintext: string): { ciphertext: string; keyId: string } {
  const key = Buffer.from(config.CREDENTIAL_ENCRYPTION_KEY, "base64");
  return { ciphertext: encryptSecret(plaintext, key, config.CREDENTIAL_ENCRYPTION_KEY_ID), keyId: config.CREDENTIAL_ENCRYPTION_KEY_ID };
}

async function lastWebhookVerification(channel: "INSTAGRAM" | "FACEBOOK"): Promise<Date | null> {
  const event = await getPrisma().auditEvent.findFirst({
    where: { action: "webhook.verified", entityType: channel },
    orderBy: { createdAt: "desc" },
  });
  return event?.createdAt ?? null;
}

export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params;
  const config = loadConfig();
  const url = new URL(request.url);
  const db = getPrisma();

  const state = url.searchParams.get("state") ?? "";
  const record = await db.oauthState.findUnique({ where: { stateHash: createHash("sha256").update(state).digest("hex") } });
  if (!record || record.usedAt || record.expiresAt < new Date() || record.provider !== provider) {
    return back(config, { error: "The connect link expired or was already used. Start Connect again." });
  }
  await db.oauthState.update({ where: { id: record.id }, data: { usedAt: new Date() } });

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.id !== record.userId) {
    return back(config, { error: "Sign in as the staff member who started Connect, then try again." });
  }
  const denied = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (denied) return back(config, { error: `Meta login was cancelled or refused: ${denied}` });
  const code = url.searchParams.get("code");
  if (!code) return back(config, { error: "Meta did not return an authorization code." });

  const workspace = await db.workspace.findUnique({ where: { id: record.workspaceId } });
  if (!workspace || workspace.mode !== "INTEGRATION") {
    return back(config, { error: "Real accounts can only be connected to an integration workspace (Own accounts)." });
  }
  if (provider === "zoho") {
    if (!config.ZOHO_CLIENT_ID || !config.ZOHO_CLIENT_SECRET) {
      return back(config, { error: "Zoho client id or secret is not configured on the server." });
    }
    try {
      const tokens = await exchangeZohoCode({
        accountsUrl: config.ZOHO_ACCOUNTS_URL,
        clientId: config.ZOHO_CLIENT_ID,
        clientSecret: config.ZOHO_CLIENT_SECRET,
        redirectUri: `${config.APP_BASE_URL}/api/oauth/zoho/callback`,
        code,
      });
      const access = encrypt(config, tokens.accessToken);
      const refresh = encrypt(config, tokens.refreshToken);
      await db.zohoConnection.upsert({
        where: { workspaceId: workspace.id },
        create: {
          workspaceId: workspace.id,
          mode: "INTEGRATION",
          accountsUrl: config.ZOHO_ACCOUNTS_URL,
          apiDomain: tokens.apiDomain,
          credentialCiphertext: access.ciphertext,
          credentialKeyId: access.keyId,
          refreshCiphertext: refresh.ciphertext,
          expiresAt: tokens.expiresAt,
          verifiedAt: new Date(),
        },
        update: {
          mode: "INTEGRATION",
          accountsUrl: config.ZOHO_ACCOUNTS_URL,
          apiDomain: tokens.apiDomain,
          credentialCiphertext: access.ciphertext,
          credentialKeyId: access.keyId,
          refreshCiphertext: refresh.ciphertext,
          expiresAt: tokens.expiresAt,
          verifiedAt: new Date(),
        },
      });
      await db.auditEvent.create({
        data: { actorId: session.user.id, workspaceId: workspace.id, action: "zoho.connected", entityType: "ZohoConnection", summary: "Zoho CRM connected." },
      });
      return back(config, { connected: "Zoho CRM" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Zoho could not be reached. Try Connect again.";
      return back(config, { error: message });
    }
  }
  if (provider !== "instagram" && provider !== "facebook") {
    return back(config, { error: `${provider} connect is not available yet.` });
  }

  const redirectUri = `${config.APP_BASE_URL}/api/oauth/${provider}/callback`;
  try {
    if (provider === "instagram") {
      if (!config.META_INSTAGRAM_APP_ID || !config.META_INSTAGRAM_APP_SECRET) {
        return back(config, { error: "Instagram app id or secret is not configured on the server." });
      }
      const account = await exchangeInstagramCode({
        appId: config.META_INSTAGRAM_APP_ID,
        appSecret: config.META_INSTAGRAM_APP_SECRET,
        redirectUri,
        code,
        graphBaseUrl: config.META_INSTAGRAM_GRAPH_BASE_URL,
        version: config.META_API_VERSION,
      });
      let subscribedFields: string[] = [];
      let subscribeError: string | null = null;
      try {
        subscribedFields = await subscribeInstagramAccount({
          token: account.token,
          graphBaseUrl: config.META_INSTAGRAM_GRAPH_BASE_URL,
          version: config.META_API_VERSION,
        });
      } catch (error) {
        subscribeError = error instanceof Error ? error.message : "Subscription failed.";
      }
      const now = new Date();
      const credential = encrypt(config, account.token);
      const webhookVerifiedAt = await lastWebhookVerification("INSTAGRAM");
      const connection = await db.channelConnection.upsert({
        where: { channel_mode_externalAccountId: { channel: "INSTAGRAM", mode: "INTEGRATION", externalAccountId: account.accountId } },
        create: {
          workspaceId: workspace.id,
          channel: "INSTAGRAM",
          mode: "INTEGRATION",
          externalAccountId: account.accountId,
          displayName: account.name ?? account.username ?? account.accountId,
          username: account.username,
          credentialCiphertext: credential.ciphertext,
          credentialKeyId: credential.keyId,
          scopes: account.scopes,
          subscribedFields,
          credentialCheckedAt: now,
          accountSubscribedAt: subscribeError ? null : now,
          webhookVerifiedAt,
        },
        update: {
          workspaceId: workspace.id,
          displayName: account.name ?? account.username ?? account.accountId,
          username: account.username,
          credentialCiphertext: credential.ciphertext,
          credentialKeyId: credential.keyId,
          scopes: account.scopes,
          subscribedFields,
          credentialCheckedAt: now,
          accountSubscribedAt: subscribeError ? null : now,
          webhookVerifiedAt,
          revokedAt: null,
        },
      });
      await db.auditEvent.create({
        data: {
          actorId: session.user.id,
          workspaceId: workspace.id,
          action: "connection.connected",
          entityType: "ChannelConnection",
          entityId: connection.id,
          summary: `Instagram @${account.username ?? account.accountId} connected${subscribeError ? " (subscription failed)" : ""}.`,
        },
      });
      return subscribeError
        ? back(config, { error: `Instagram @${account.username ?? account.accountId} saved, but ${subscribeError}` })
        : back(config, { connected: `Instagram @${account.username ?? account.accountId}` }, "/posts");
    }

    if (!config.META_FACEBOOK_APP_ID || !config.META_FACEBOOK_APP_SECRET) {
      return back(config, { error: "Facebook app id or secret is not configured on the server." });
    }
    const { pages, scopes } = await exchangeFacebookCode({
      appId: config.META_FACEBOOK_APP_ID,
      appSecret: config.META_FACEBOOK_APP_SECRET,
      redirectUri,
      code,
      graphBaseUrl: config.META_FACEBOOK_GRAPH_BASE_URL,
      version: config.META_API_VERSION,
    });
    if (pages.length === 0) {
      return back(config, { error: "Meta returned no Facebook Pages. Select at least one Page you manage during login." });
    }
    const webhookVerifiedAt = await lastWebhookVerification("FACEBOOK");
    const connected: string[] = [];
    const failed: string[] = [];
    for (const page of pages) {
      let subscribedFields: string[] = [];
      let subscribeError: string | null = null;
      try {
        subscribedFields = await subscribeFacebookPage({
          pageId: page.id,
          pageToken: page.token,
          graphBaseUrl: config.META_FACEBOOK_GRAPH_BASE_URL,
          version: config.META_API_VERSION,
        });
      } catch (error) {
        subscribeError = error instanceof Error ? error.message : "Subscription failed.";
      }
      const now = new Date();
      const credential = encrypt(config, page.token);
      const data = {
        workspaceId: workspace.id,
        displayName: page.name,
        credentialCiphertext: credential.ciphertext,
        credentialKeyId: credential.keyId,
        scopes,
        pageTasks: page.tasks,
        subscribedFields,
        credentialCheckedAt: now,
        accountSubscribedAt: subscribeError ? null : now,
        webhookVerifiedAt,
      };
      const connection = await db.channelConnection.upsert({
        where: { channel_mode_externalAccountId: { channel: "FACEBOOK", mode: "INTEGRATION", externalAccountId: page.id } },
        create: { ...data, channel: "FACEBOOK", mode: "INTEGRATION", externalAccountId: page.id },
        update: { ...data, revokedAt: null },
      });
      await db.auditEvent.create({
        data: {
          actorId: session.user.id,
          workspaceId: workspace.id,
          action: "connection.connected",
          entityType: "ChannelConnection",
          entityId: connection.id,
          summary: `Facebook Page ${page.name} connected${subscribeError ? " (subscription failed)" : ""}.`,
        },
      });
      if (subscribeError) failed.push(`${page.name}: ${subscribeError}`);
      else connected.push(page.name);
    }
    if (failed.length) {
      return back(config, { error: `Saved, but Page subscription failed for ${failed.join("; ")}` });
    }
    return back(config, { connected: `Facebook Page ${connected.join(", ")}` });
  } catch (error) {
    const message = error instanceof MetaOAuthError ? error.message : "Meta could not be reached. Try Connect again.";
    return back(config, { error: message });
  }
}
