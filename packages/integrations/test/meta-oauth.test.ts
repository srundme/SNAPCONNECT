import { describe, expect, it } from "vitest";
import {
  cleanOAuthCode,
  exchangeFacebookCode,
  exchangeInstagramCode,
  MetaOAuthError,
  subscribeFacebookPage,
  subscribeInstagramAccount,
} from "../src/meta-oauth";

type Call = { url: string; init: RequestInit };

function mockFetch(routes: Array<[RegExp, unknown, number?]>) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const route = routes.find(([pattern]) => pattern.test(url));
    if (!route) return new Response(JSON.stringify({ error: { message: `unexpected ${url}` } }), { status: 404 });
    return new Response(JSON.stringify(route[1]), { status: route[2] ?? 200 });
  };
  return { calls, fetchImpl };
}

describe("Meta OAuth", () => {
  it("strips Instagram's #_ suffix from the code", () => {
    expect(cleanOAuthCode("abc123#_")).toBe("abc123");
  });

  it("exchanges an Instagram code for a long-lived token and the webhook account id", async () => {
    const { calls, fetchImpl } = mockFetch([
      [/api\.instagram\.com\/oauth\/access_token/, { data: [{ access_token: "short", user_id: "app-scoped", permissions: "instagram_business_basic,instagram_business_manage_comments" }] }],
      [/graph\.instagram\.com\/access_token/, { access_token: "long", token_type: "bearer", expires_in: 5_184_000 }],
      [/graph\.instagram\.com\/v23\.0\/me\?/, { user_id: "17841400000000001", username: "studio", name: "Studio" }],
    ]);
    const result = await exchangeInstagramCode({
      appId: "app",
      appSecret: "secret",
      redirectUri: "https://example.app/api/oauth/instagram/callback",
      code: "code#_",
      graphBaseUrl: "https://graph.instagram.com",
      version: "v23.0",
      fetchImpl,
    });
    expect(result.accountId).toBe("17841400000000001");
    expect(result.username).toBe("studio");
    expect(result.token).toBe("long");
    expect(result.scopes).toEqual(["instagram_business_basic", "instagram_business_manage_comments"]);
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(new URLSearchParams(String(calls[0]!.init.body)).get("code")).toBe("code");
    expect((calls[2]!.init.headers as Record<string, string>).Authorization).toBe("Bearer long");
  });

  it("surfaces Meta's error message without the secret", async () => {
    const { fetchImpl } = mockFetch([
      [/api\.instagram\.com/, { error_type: "OAuthException", code: 400, error_message: "Invalid redirect_uri" }, 400],
    ]);
    const attempt = exchangeInstagramCode({
      appId: "app",
      appSecret: "top-secret",
      redirectUri: "https://example.app/cb",
      code: "c",
      graphBaseUrl: "https://graph.instagram.com",
      version: "v23.0",
      fetchImpl,
    });
    await expect(attempt).rejects.toBeInstanceOf(MetaOAuthError);
    await expect(attempt).rejects.toThrow(/Invalid redirect_uri/);
    await expect(attempt).rejects.not.toThrow(/top-secret/);
  });

  it("subscribes an Instagram account to comments and messages", async () => {
    const { calls, fetchImpl } = mockFetch([[/me\/subscribed_apps/, { success: true }]]);
    const fields = await subscribeInstagramAccount({ token: "long", graphBaseUrl: "https://graph.instagram.com", version: "v23.0", fetchImpl });
    expect(fields).toEqual(["comments", "messages"]);
    expect(calls[0]!.url).toContain("subscribed_fields=comments%2Cmessages");
    expect(calls[0]!.init.method).toBe("POST");
  });

  it("returns Facebook Pages with their own tokens and granted scopes", async () => {
    const { fetchImpl } = mockFetch([
      [/oauth\/access_token\?client_id=app&client_secret=secret&redirect_uri/, { access_token: "short-user" }],
      [/grant_type=fb_exchange_token/, { access_token: "long-user" }],
      [/me\/permissions/, { data: [{ permission: "pages_messaging", status: "granted" }, { permission: "pages_read_user_content", status: "declined" }] }],
      [/me\/accounts/, { data: [{ id: "1001", name: "Studio Page", access_token: "page-token", tasks: ["MESSAGING", "MODERATE"] }] }],
    ]);
    const result = await exchangeFacebookCode({
      appId: "app",
      appSecret: "secret",
      redirectUri: "https://example.app/api/oauth/facebook/callback",
      code: "code",
      graphBaseUrl: "https://graph.facebook.com",
      version: "v23.0",
      fetchImpl,
    });
    expect(result.scopes).toEqual(["pages_messaging"]);
    expect(result.pages).toEqual([{ id: "1001", name: "Studio Page", token: "page-token", tasks: ["MESSAGING", "MODERATE"] }]);
  });

  it("subscribes a Page to feed and messages with the Page token", async () => {
    const { calls, fetchImpl } = mockFetch([[/1001\/subscribed_apps/, { success: true }]]);
    const fields = await subscribeFacebookPage({ pageId: "1001", pageToken: "page-token", graphBaseUrl: "https://graph.facebook.com", version: "v23.0", fetchImpl });
    expect(fields).toEqual(["feed", "messages"]);
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer page-token");
  });
});
