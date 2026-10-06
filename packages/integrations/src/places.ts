export type PlaceInfo = {
  name: string;
  locality: string | null;
  city: string | null;
  pincode: string | null;
  underConstruction: boolean;
};

export type PlaceLookup = (query: string, city?: string) => Promise<PlaceInfo | null>;

type NominatimResult = {
  name?: string;
  category?: string;
  type?: string;
  address?: Record<string, string>;
};

/** Only named homes and buildings count; a plain locality or road is not a project. */
const PROJECT_TYPES = new Set(["residential", "apartments", "construction", "building", "house", "detached", "terrace", "yes"]);

function projectSegments(text: string): string[] {
  return text
    .split(/[,\n]+|\band\b/i)
    .map((part) => part.replace(/^\s*(?:it'?s |my |our |the )?(?:flat|home|house|apartment|villa|place)?\s*(?:is )?(?:in|at)\s+/i, "").trim())
    .filter((part) => part.length >= 4 && /[a-z]{3}/i.test(part))
    .slice(0, 2);
}

function sameName(query: string, name: string): boolean {
  const words = (value: string) => value.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3);
  const wanted = words(query);
  const got = new Set(words(name));
  return wanted.length > 0 && wanted.filter((word) => got.has(word)).length / wanted.length >= 0.6;
}

/**
 * Finds an apartment project or building by name on OpenStreetMap, to learn its locality.
 * Free, no key; the usage policy asks for an identifying user agent and at most one request a second.
 */
export function osmPlaceLookup(options: { userAgent: string; baseUrl?: string; fetcher?: typeof fetch; timeoutMs?: number }): PlaceLookup {
  const fetcher = options.fetcher ?? fetch;
  const baseUrl = options.baseUrl ?? "https://nominatim.openstreetmap.org";
  const cache = new Map<string, PlaceInfo | null>();
  return async (query, city) => {
    const key = `${query.toLowerCase()}|${city ?? ""}`;
    if (cache.has(key)) return cache.get(key)!;
    const found = await search(query, city);
    if (cache.size > 2_000) cache.clear();
    cache.set(key, found);
    return found;
  };

  async function search(query: string, city?: string): Promise<PlaceInfo | null> {
    for (const segment of projectSegments(query)) {
      const q = city && !segment.toLowerCase().includes(city.toLowerCase()) ? `${segment}, ${city}` : segment;
      const url = `${baseUrl}/search?format=jsonv2&addressdetails=1&limit=3&countrycodes=in&q=${encodeURIComponent(q)}`;
      const response = await fetcher(url, {
        headers: { "User-Agent": options.userAgent, "Accept-Language": "en" },
        signal: AbortSignal.timeout(options.timeoutMs ?? 4_000),
      });
      if (!response.ok) throw new Error(`Map lookup failed with ${response.status}.`);
      const results = (await response.json()) as NominatimResult[];
      const match = results.find((item) => item.name && PROJECT_TYPES.has(item.type ?? "") && sameName(segment, item.name));
      if (!match) continue;
      const address = match.address ?? {};
      return {
        name: match.name!.replace(/\s*\(u\/c\)\s*$/i, ""),
        locality: address.suburb ?? address.neighbourhood ?? address.quarter ?? address.village ?? null,
        city: address.city ?? address.town ?? address.state_district ?? null,
        pincode: address.postcode ?? null,
        underConstruction: match.type === "construction" || /\(u\/c\)/i.test(match.name ?? ""),
      };
    }
    return null;
  }
}
