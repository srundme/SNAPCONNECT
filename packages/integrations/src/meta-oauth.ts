import type { FetchLike } from "./channel";
import { assertAllowedUrl } from "./hosts";

export const INSTAGRAM_SUBSCRIBED_FIELDS = ["comments", "messages", "message_edit"] as const;
export const FACEBOOK_SUBSCRIBED_FIELDS = ["feed", "messages", "message_edits"] as const;

/** Safe to show staff: carries Meta's error message, never a token or secret. */
export class MetaOAuthError extends Error {
  constructor(step: string, detail: string) {
    super(`${step}: ${detail}`);
    this.name = "MetaOAuthError";
  }
}

type Json = Record<string, unknown>;

async function readJson(step: string, response: Response): Promise<Json> {
  const text = await response.text();
  let body: Json = {};
  try {
    body = JSON.parse(text) as Json;
  } catch {
    body = {};
  }
  const error = body.error as Json | string | undefined;
  if (!response.ok || error) {
    const message = typeof error === "string"
      ? String(body.error_message ?? error)
      : String((error as Json | undefined)?.message ?? body.error_message ?? `HTTP ${response.status}`);
    throw new MetaOAuthError(step, message.slice(0, 300));
  }
  return body;
}

function call(fetchImpl: FetchLike, url: URL | string, init: RequestInit = {}): Promise<Response> {
  return fetchImpl(String(url), { ...init, signal: AbortSignal.timeout(15_000) });
}

/** Instagram appends `#_` to the code in the redirect; Meta rejects it unless stripped. */
export function cleanOAuthCode(code: string): string {
  return code.replace(/#_$/, "").trim();
}

export type InstagramConnection = {
  accountId: string;
  username: string | null;
  name: string | null;
  token: string;
  expiresAt: Date | null;
  scopes: string[];
};

export async function exchangeInstagramCode(options: {
  appId: string;
  appSecret: string;
  redirectUri: string;
  code: string;
  graphBaseUrl: string;
  version: string;
  fetchImpl?: FetchLike;
}): Promise<InstagramConnection> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const graph = assertAllowedUrl(options.graphBaseUrl, "meta");
  const tokenUrl = assertAllowedUrl("https://api.instagram.com/oauth/access_token", "meta");

  const form = new URLSearchParams({
    client_id: options.appId,
    client_secret: options.appSecret,
    grant_type: "authorization_code",
    redirect_uri: options.redirectUri,
    code: cleanOAuthCode(options.code),
  });
  const short = await readJson("Instagram code exchange", await call(fetchImpl, tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
  }));
  const shortData = (Array.isArray(short.data) ? (short.data[0] as Json | undefined) : short) ?? {};
  const shortToken = String(shortData.access_token ?? "");
  if (!shortToken) throw new MetaOAuthError("Instagram code exchange", "No access token returned.");
  const granted = shortData.permissions;
  const scopes = Array.isArray(granted)
    ? granted.map(String)
    : String(granted ?? "").split(",").map((item) => item.trim()).filter(Boolean);

  const longUrl = new URL("/access_token", graph);
  longUrl.searchParams.set("grant_type", "ig_exchange_token");
  longUrl.searchParams.set("client_secret", options.appSecret);
  longUrl.searchParams.set("access_token", shortToken);
  const long = await readJson("Instagram long-lived token", await call(fetchImpl, longUrl));
  const token = String(long.access_token ?? "");
  if (!token) throw new MetaOAuthError("Instagram long-lived token", "No access token returned.");
  const expiresIn = Number(long.expires_in);

  const meUrl = new URL(`/${options.version}/me`, graph);
  meUrl.searchParams.set("fields", "user_id,username,name");
  const me = await readJson("Instagram profile", await call(fetchImpl, meUrl, {
    headers: { Authorization: `Bearer ${token}` },
  }));
  // Webhooks address the professional account id (`user_id`), not the app-scoped `id`.
  const accountId = String(me.user_id ?? shortData.user_id ?? "");
  if (!accountId) throw new MetaOAuthError("Instagram profile", "No Instagram account id returned.");

  return {
    accountId,
    username: me.username ? String(me.username) : null,
    name: me.name ? String(me.name) : null,
    token,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null,
    scopes,
  };
}

export async function subscribeInstagramAccount(options: {
  token: string;
  graphBaseUrl: string;
  version: string;
  fetchImpl?: FetchLike;
}): Promise<string[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const graph = assertAllowedUrl(options.graphBaseUrl, "meta");
  const url = new URL(`/${options.version}/me/subscribed_apps`, graph);
  url.searchParams.set("subscribed_fields", INSTAGRAM_SUBSCRIBED_FIELDS.join(","));
  const body = await readJson("Instagram subscription", await call(fetchImpl, url, {
    method: "POST",
    headers: { Authorization: `Bearer ${options.token}` },
  }));
  if (body.success !== true) throw new MetaOAuthError("Instagram subscription", "Meta did not confirm the subscription.");
  return [...INSTAGRAM_SUBSCRIBED_FIELDS];
}

export type FacebookPage = { id: string; name: string; token: string; tasks: string[] };

export async function exchangeFacebookCode(options: {
  appId: string;
  appSecret: string;
  redirectUri: string;
  code: string;
  graphBaseUrl: string;
  version: string;
  fetchImpl?: FetchLike;
}): Promise<{ pages: FacebookPage[]; scopes: string[] }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const graph = assertAllowedUrl(options.graphBaseUrl, "meta");

  const shortUrl = new URL(`/${options.version}/oauth/access_token`, graph);
  shortUrl.searchParams.set("client_id", options.appId);
  shortUrl.searchParams.set("client_secret", options.appSecret);
  shortUrl.searchParams.set("redirect_uri", options.redirectUri);
  shortUrl.searchParams.set("code", cleanOAuthCode(options.code));
  const short = await readJson("Facebook code exchange", await call(fetchImpl, shortUrl));
  const shortToken = String(short.access_token ?? "");
  if (!shortToken) throw new MetaOAuthError("Facebook code exchange", "No access token returned.");

  // Page tokens fetched with a long-lived user token do not expire.
  const longUrl = new URL(`/${options.version}/oauth/access_token`, graph);
  longUrl.searchParams.set("grant_type", "fb_exchange_token");
  longUrl.searchParams.set("client_id", options.appId);
  longUrl.searchParams.set("client_secret", options.appSecret);
  longUrl.searchParams.set("fb_exchange_token", shortToken);
  const long = await readJson("Facebook long-lived token", await call(fetchImpl, longUrl));
  const userToken = String(long.access_token ?? "");
  if (!userToken) throw new MetaOAuthError("Facebook long-lived token", "No access token returned.");

  const permsUrl = new URL(`/${options.version}/me/permissions`, graph);
  const perms = await readJson("Facebook permissions", await call(fetchImpl, permsUrl, {
    headers: { Authorization: `Bearer ${userToken}` },
  }));
  const scopes = (Array.isArray(perms.data) ? perms.data : [])
    .map((item) => item as Json)
    .filter((item) => item.status === "granted")
    .map((item) => String(item.permission));

  const pagesUrl = new URL(`/${options.version}/me/accounts`, graph);
  pagesUrl.searchParams.set("fields", "id,name,access_token,tasks");
  const pagesBody = await readJson("Facebook Pages", await call(fetchImpl, pagesUrl, {
    headers: { Authorization: `Bearer ${userToken}` },
  }));
  const pages = (Array.isArray(pagesBody.data) ? pagesBody.data : [])
    .map((item) => item as Json)
    .filter((item) => item.id && item.access_token)
    .map((item) => ({
      id: String(item.id),
      name: String(item.name ?? item.id),
      token: String(item.access_token),
      tasks: Array.isArray(item.tasks) ? item.tasks.map(String) : [],
    }));
  return { pages, scopes };
}

export async function subscribeFacebookPage(options: {
  pageId: string;
  pageToken: string;
  graphBaseUrl: string;
  version: string;
  fetchImpl?: FetchLike;
}): Promise<string[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const graph = assertAllowedUrl(options.graphBaseUrl, "meta");
  const url = new URL(`/${options.version}/${options.pageId}/subscribed_apps`, graph);
  url.searchParams.set("subscribed_fields", FACEBOOK_SUBSCRIBED_FIELDS.join(","));
  const body = await readJson("Facebook Page subscription", await call(fetchImpl, url, {
    method: "POST",
    headers: { Authorization: `Bearer ${options.pageToken}` },
  }));
  if (body.success !== true) throw new MetaOAuthError("Facebook Page subscription", "Meta did not confirm the subscription.");
  return [...FACEBOOK_SUBSCRIBED_FIELDS];
}
