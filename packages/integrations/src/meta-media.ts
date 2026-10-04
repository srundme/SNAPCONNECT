import type { FetchLike } from "./channel";
import { assertAllowedUrl } from "./hosts";

export type RemotePost = {
  externalId: string;
  caption: string | null;
  contentType: string;
  permalink: string | null;
  previewUrl: string | null;
  publishedAt: string | null;
  supportStatus: "SUPPORTED" | "UNSUPPORTED";
  unsupportedReason: string | null;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function supportFor(contentType: string): Pick<RemotePost, "supportStatus" | "unsupportedReason"> {
  if (contentType === "AD") return { supportStatus: "UNSUPPORTED", unsupportedReason: "Paid ads are not automated." };
  return { supportStatus: "SUPPORTED", unsupportedReason: null };
}

async function readPages(
  start: string,
  token: string,
  fetchImpl: FetchLike,
  mapRow: (row: Record<string, unknown>) => RemotePost | null,
): Promise<RemotePost[]> {
  const posts: RemotePost[] = [];
  let next: string | null = start;
  for (let page = 0; page < 3 && next; page += 1) {
    const url = assertAllowedUrl(next, "meta");
    const response = await fetchImpl(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Meta returned HTTP ${response.status}.`);
    const body = (await response.json()) as { data?: Array<Record<string, unknown>>; paging?: { next?: string } };
    for (const row of body.data ?? []) {
      const mapped = mapRow(row);
      if (mapped) posts.push(mapped);
    }
    next = asString(body.paging?.next);
  }
  return posts;
}

export async function listInstagramPosts(options: {
  baseUrl: string;
  version: string;
  accountId: string;
  token: string;
  fetchImpl?: FetchLike;
}): Promise<RemotePost[]> {
  const base = assertAllowedUrl(options.baseUrl, "meta");
  const start = `${base.origin}/${options.version}/${encodeURIComponent(options.accountId)}/media?fields=id,caption,media_type,media_product_type,permalink,timestamp,thumbnail_url,media_url&limit=25`;
  return readPages(start, options.token, options.fetchImpl ?? fetch, (row) => {
    const externalId = asString(row.id);
    if (!externalId) return null;
    const contentType = asString(row.media_product_type) ?? asString(row.media_type) ?? "FEED";
    return {
      externalId,
      caption: asString(row.caption),
      contentType,
      permalink: asString(row.permalink),
      previewUrl: asString(row.thumbnail_url) ?? asString(row.media_url),
      publishedAt: asString(row.timestamp),
      ...supportFor(contentType),
    };
  });
}

export async function listFacebookPosts(options: {
  baseUrl: string;
  version: string;
  pageId: string;
  token: string;
  fetchImpl?: FetchLike;
}): Promise<RemotePost[]> {
  const base = assertAllowedUrl(options.baseUrl, "meta");
  const start = `${base.origin}/${options.version}/${encodeURIComponent(options.pageId)}/posts?fields=id,message,permalink_url,created_time,full_picture&limit=25`;
  return readPages(start, options.token, options.fetchImpl ?? fetch, (row) => {
    const externalId = asString(row.id);
    if (!externalId) return null;
    return {
      externalId,
      caption: asString(row.message),
      contentType: "FEED",
      permalink: asString(row.permalink_url),
      previewUrl: asString(row.full_picture),
      publishedAt: asString(row.created_time),
      supportStatus: "SUPPORTED",
      unsupportedReason: null,
    };
  });
}
