export type PlaceInfo = {
  name: string;
  locality: string | null;
  city: string | null;
  pincode: string | null;
  underConstruction: boolean;
  kind?: "apartment" | "villa" | null;
  address?: string | null;
  source?: "Google Maps" | "OpenStreetMap";
};

/** A place they named that looks like a project but could not be found, so the team can check it. */
export type PlaceMissing = { missing: string; source: "Google Maps" };

export type PlaceLookup = (query: string, city?: string) => Promise<PlaceInfo | PlaceMissing | null>;

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
        source: "OpenStreetMap",
      };
    }
    return null;
  }
}

type GooglePlace = {
  displayName?: { text?: string };
  formattedAddress?: string;
  types?: string[];
  addressComponents?: { longText?: string; types?: string[] }[];
};

const AREA_TYPES = new Set(["locality", "sublocality", "sublocality_level_1", "sublocality_level_2", "sublocality_level_3", "neighborhood", "route", "political", "administrative_area_level_3", "postal_code"]);
const APARTMENT_TYPES = new Set(["apartment_building", "apartment_complex", "condominium_complex"]);
const NAME_FILLER = new Set(["the", "and", "apartment", "apartments", "apts", "apt", "flat", "flats", "villa", "villas", "phase", "block", "tower", "towers", "wing", "bangalore", "bengaluru", "layout", "road", "main", "cross", "sector", "stage", "nagar", "near", "opp", "india", "karnataka"]);
const NOT_THE_HOMES = /\b(sales|site|corporate|head) office\b|\boffice\b|\bexperience (?:cent(?:re|er)|zone)\b|\bshowroom\b|\bmodel (?:flat|villa|apartment)\b|\bhospital\b|\bschool\b|\bmall\b|\bhotel\b|\bpg\b/i;
function nameWords(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 2 && !NAME_FILLER.has(word));
}

function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  return a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5);
}

/** Google's name must be fully inside what they typed, so a different project by the same builder never matches. */
function nameInside(typed: string, name: string): boolean {
  const said = nameWords(typed);
  const named = nameWords(name);
  return named.length >= 2 && named.every((word) => said.some((typedWord) => sameWord(typedWord, word)));
}

function placeKind(place: GooglePlace): "apartment" | "villa" | null {
  const name = place.displayName?.text ?? "";
  if (/\bvillas?\b|\brow ?houses?\b|\bbungalows?\b/i.test(name)) return "villa";
  if ((place.types ?? []).some((type) => APARTMENT_TYPES.has(type)) || /\bapartments?\b|\bflats\b/i.test(name)) return "apartment";
  return null;
}

function component(place: GooglePlace, ...types: string[]): string | null {
  for (const type of types) {
    const found = place.addressComponents?.find((part) => part.types?.includes(type))?.longText;
    if (found) return found;
  }
  return null;
}

/**
 * Finds the apartment or villa project they named on Google Maps (Places API, New).
 * Strict on purpose: a match must carry every distinctive word of the project's name and sit in the city.
 */
export function googlePlaceLookup(options: { apiKey: string; fetcher?: typeof fetch; timeoutMs?: number; baseUrl?: string }): PlaceLookup {
  const fetcher = options.fetcher ?? fetch;
  const baseUrl = options.baseUrl ?? "https://places.googleapis.com/v1";
  const cache = new Map<string, PlaceInfo | PlaceMissing | null>();
  return async (query, city) => {
    const key = `${query.toLowerCase()}|${city ?? ""}`;
    if (cache.has(key)) return cache.get(key)!;
    const found = await search(query, city);
    if (cache.size > 2_000) cache.clear();
    cache.set(key, found);
    return found;
  };

  async function search(query: string, city?: string): Promise<PlaceInfo | PlaceMissing | null> {
    let unmatched: string | null = null;
    for (const segment of projectSegments(query)) {
      if (nameWords(segment).length === 0) continue;
      const textQuery = city && !segment.toLowerCase().includes(city.toLowerCase()) ? `${segment}, ${city}` : segment;
      const response = await fetcher(`${baseUrl}/places:searchText`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": options.apiKey,
          "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.types,places.addressComponents",
        },
        body: JSON.stringify({ textQuery, maxResultCount: 5, regionCode: "IN", languageCode: "en" }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 5_000),
      });
      if (!response.ok) throw new Error(`Google Maps lookup failed with ${response.status}.`);
      const places = ((await response.json()) as { places?: GooglePlace[] }).places ?? [];
      const inCity = (place: GooglePlace) => !city || [city, city === "Bengaluru" ? "Bangalore" : city === "Bangalore" ? "Bengaluru" : city]
        .some((name) => (place.formattedAddress ?? "").toLowerCase().includes(name.toLowerCase()));
      const isArea = (place: GooglePlace) => (place.types ?? []).some((type) => AREA_TYPES.has(type)) && !(place.types ?? []).some((type) => APARTMENT_TYPES.has(type) || type === "housing_complex");
      const match = places.find((place) => {
        const name = place.displayName?.text ?? "";
        return name && !isArea(place) && !NOT_THE_HOMES.test(name) && inCity(place) && nameInside(segment, name);
      });
      if (match) {
        const name = match.displayName!.text!.trim();
        return {
          name,
          locality: component(match, "sublocality_level_1", "sublocality", "neighborhood", "sublocality_level_2"),
          city: component(match, "locality", "administrative_area_level_3"),
          pincode: component(match, "postal_code"),
          underConstruction: false,
          kind: placeKind(match),
          address: match.formattedAddress ?? null,
          source: "Google Maps",
        };
      }
      const justArea = places.some((place) => isArea(place) && nameWords(segment).every((word) => nameWords(place.displayName?.text ?? "").some((areaWord) => sameWord(word, areaWord))));
      if (!justArea) unmatched ??= segment;
    }
    return unmatched ? { missing: unmatched, source: "Google Maps" } : null;
  }
}

/** Google Maps first when there is a key, OpenStreetMap when Google finds nothing or fails. */
export function bestPlaceLookup(google: PlaceLookup | null, osm: PlaceLookup): PlaceLookup {
  if (!google) return osm;
  return async (query, city) => {
    const fromGoogle = await google(query, city).catch(() => undefined);
    if (fromGoogle && !("missing" in fromGoogle)) return fromGoogle;
    const fromOsm = await osm(query, city).catch(() => null);
    return fromOsm && !("missing" in fromOsm) ? fromOsm : fromGoogle ?? null;
  };
}
