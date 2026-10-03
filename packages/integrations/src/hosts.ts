const META_HOSTS = new Set(["graph.facebook.com", "graph.instagram.com", "www.facebook.com", "www.instagram.com"]);
const ZOHO_ACCOUNT_HOSTS = new Set([
  "accounts.zoho.com",
  "accounts.zoho.eu",
  "accounts.zoho.in",
  "accounts.zoho.com.au",
  "accounts.zoho.jp",
  "accounts.zoho.ca",
  "accounts.zoho.sa",
]);

export function assertAllowedUrl(value: string, kind: "meta" | "zoho-accounts" | "zoho-api"): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error("External integration URLs must use HTTPS.");
  }
  if (kind === "meta" && !META_HOSTS.has(url.hostname)) throw new Error(`Meta host ${url.hostname} is not allowed.`);
  if (kind === "zoho-accounts" && !ZOHO_ACCOUNT_HOSTS.has(url.hostname)) {
    throw new Error(`Zoho accounts host ${url.hostname} is not allowed.`);
  }
  if (kind === "zoho-api") {
    const allowed = [
      "www.zohoapis.com",
      "www.zohoapis.eu",
      "www.zohoapis.in",
      "www.zohoapis.com.au",
      "www.zohoapis.jp",
      "www.zohoapis.ca",
      "www.zohoapis.sa",
    ];
    if (!allowed.includes(url.hostname)) throw new Error("Zoho API domain is not allowed.");
  }
  return url;
}
