import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { loadConfig } from "@snapsocial/config";
import { assertAllowedUrl } from "@snapsocial/integrations";
import { getPrisma } from "@snapsocial/db";
import { can } from "@snapsocial/domain";
import { auth } from "@/lib/auth";

export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const workspaceId = new URL(request.url).searchParams.get("workspaceId");
  if (!workspaceId || !["instagram", "facebook", "zoho"].includes(provider)) return new Response("Bad request", { status: 400 });
  const user = await getPrisma().user.findUnique({ where: { id: session.user.id }, include: { memberships: true } });
  if (!user || user.suspendedAt) return new Response("Unauthorized", { status: 401 });
  const actor = {
    userId: user.id,
    platformRole: user.platformRole,
    suspended: false,
    memberships: user.memberships.map((item) => ({ workspaceId: item.workspaceId, role: item.role })),
  };
  if (!can(actor, "integration.manage", workspaceId)) return new Response("Forbidden", { status: 403 });
  const config = loadConfig();
  const state = randomBytes(24).toString("base64url");
  await getPrisma().oauthState.create({
    data: {
      stateHash: createHash("sha256").update(state).digest("hex"),
      workspaceId,
      userId: session.user.id,
      provider,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });
  if (provider === "zoho") {
    if (!config.ZOHO_CLIENT_ID || !config.ZOHO_CLIENT_SECRET) {
      return Response.redirect(new URL("/integrations?error=Zoho%20is%20not%20configured%20on%20the%20server%20yet.%20Add%20the%20Zoho%20client%20id%20and%20secret%2C%20then%20use%20Connect%20Zoho.", config.APP_BASE_URL));
    }
    const accounts = assertAllowedUrl(config.ZOHO_ACCOUNTS_URL, "zoho-accounts");
    const redirect = new URL("/oauth/v2/auth", accounts);
    redirect.searchParams.set("client_id", config.ZOHO_CLIENT_ID);
    redirect.searchParams.set("response_type", "code");
    redirect.searchParams.set("access_type", "offline");
    redirect.searchParams.set("scope", config.ZOHO_SCOPES);
    redirect.searchParams.set("redirect_uri", `${config.APP_BASE_URL}/api/oauth/zoho/callback`);
    redirect.searchParams.set("state", state);
    return Response.redirect(redirect);
  }
  const appId = provider === "instagram" ? config.META_INSTAGRAM_APP_ID : config.META_FACEBOOK_APP_ID;
  if (!appId) return Response.json({ pending: true, reason: `${provider} app id is not configured. Live verification remains pending.` });
  const base = assertAllowedUrl(provider === "instagram" ? config.META_INSTAGRAM_OAUTH_BASE_URL : config.META_FACEBOOK_OAUTH_BASE_URL, "meta");
  const redirect = new URL(provider === "instagram" ? "/oauth/authorize" : "/v23.0/dialog/oauth", base);
  redirect.searchParams.set("client_id", appId);
  redirect.searchParams.set("redirect_uri", `${config.APP_BASE_URL}/api/oauth/${provider}/callback`);
  redirect.searchParams.set("state", state);
  redirect.searchParams.set("response_type", "code");
  redirect.searchParams.set("scope", provider === "instagram"
    ? "instagram_business_basic,instagram_business_manage_comments,instagram_business_manage_messages"
    : "pages_show_list,pages_read_engagement,pages_read_user_content,pages_manage_metadata,pages_messaging");
  return Response.redirect(redirect);
}
