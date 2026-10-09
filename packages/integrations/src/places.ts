export type PlaceInfo = {
  name: string;
  locality: string | null;
  city: string | null;
  pincode: string | null;
  underConstruction: boolean;
  /** A listing says ready to move. Not the customer's own word. */
  readyToMove?: boolean;
  /** A year a listing mentions for possession or handover. Not a date to invent around. */
  possessionYear?: number | null;
  kind?: "apartment" | "villa" | null;
  address?: string | null;
  /** BHK sizes the project is advertised with. Not this customer's home. */
  bhkOptions?: number[];
  source?: "Google Maps" | "OpenStreetMap" | "Brave Search";
};

/** A place they named that looks like a project but could not be found, so the team can check it. */
export type PlaceMissing = { missing: string; source: "Google Maps" | "Brave Search" };

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

type BraveHit = { title?: string; description?: string };

function projectTitle(title: string, segment: string): string {
  const head = title.split(/\s+[|\-–—]\s+/)[0]?.trim() || title.trim();
  return nameInside(head, segment) ? head : segment;
}

function kindFromSearch(text: string): "apartment" | "villa" | null {
  const apartments = (text.match(/\b(?:apartments?|flats?|high-?rise)\b/gi) ?? []).length;
  const villas = (text.match(/\b(?:villas?|row ?houses?|bungalows?)\b/gi) ?? []).length;
  if (apartments === 0 && villas === 0) return null;
  if (villas > apartments && !/\bfloor villas?\b/i.test(text)) return "villa";
  return apartments > 0 ? "apartment" : "villa";
}

/** Sizes a listing advertises, such as "2, 3 and 4 BHK". A single customer's home is not inferred from this. */
function bhkOptionsFromSearch(text: string): number[] {
  const found = new Set<number>();
  for (const match of text.matchAll(/(?<![\d.])((?:\d\s*(?:[,/&]|and)\s*)*\d)\s*-?\s*bhk\b/gi)) {
    for (const digit of match[1]?.match(/\d/g) ?? []) {
      const value = Number(digit);
      if (value >= 1 && value <= 9) found.add(value);
    }
  }
  return [...found].sort((a, b) => a - b);
}

const AREA_SPELLING: [RegExp, string][] = [
  [/\bmadipakka\b/gi, "Madipakkam"],
  [/\bmadipakam\b/gi, "Madipakkam"],
  [/\bwhitefeild\b/gi, "Whitefield"],
  [/\bbanglore\b/gi, "Bengaluru"],
  [/\bbanaglore\b/gi, "Bengaluru"],
  [/\bkoramangla\b/gi, "Koramangala"],
  [/\bindira ?nagar\b/gi, "Indiranagar"],
  [/\bsarjapura\b/gi, "Sarjapur"],
  [/\byelankha\b/gi, "Yelahanka"],
  [/\bmarathalli\b/gi, "Marathahalli"],
  [/\bjaya ?nagar\b/gi, "Jayanagar"],
];

/** Corrects a misspelled area in a search query. The project name they typed is left as they typed it. */
export function correctAreaSpelling(text: string): string {
  return AREA_SPELLING.reduce((next, [from, to]) => next.replace(from, to), text);
}

function projectStage(text: string): { underConstruction: boolean; readyToMove: boolean; possessionYear: number | null } {
  const ready = /\bready[\s-]*to[\s-]*move\b|\brtm\b/i.test(text);
  const building = /\bunder construction\b|\bongoing project\b/i.test(text);
  const yearText = text.match(/\b(?:possession|handover|completion|ready by)\b[^.]{0,30}\b(20[2-3]\d)\b/i)
    ?? text.match(/\b(20[2-3]\d)\b[^.]{0,30}\b(?:possession|handover|completion)\b/i);
  return {
    underConstruction: building && !ready,
    readyToMove: ready && !building,
    possessionYear: yearText ? Number(yearText[1]) : null,
  };
}

function localityFromSearch(text: string): string | null {
  const road = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s+Road\b/);
  if (road && !/^(main|cross|outer|inner|ring)$/i.test(road[1]!)) return `${road[1]} Road`;
  const placed = text.match(/\b(?:in|at)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})(?=,)/);
  if (placed && !/bengaluru|bangalore/i.test(placed[1]!)) return placed[1]!;
  return null;
}

/**
 * Reads public web results for a project name. A result counts only when it contains the
 * project's own name. Home type, area, and the BHK sizes the project advertises are kept.
 */
export function bravePlaceLookup(options: { apiKey: string; fetcher?: typeof fetch; timeoutMs?: number; baseUrl?: string }): PlaceLookup {
  const fetcher = options.fetcher ?? fetch;
  const baseUrl = options.baseUrl ?? "https://api.search.brave.com/res/v1/web/search";
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
      if (nameWords(segment).length < 2) continue;
      const spelled = correctAreaSpelling(segment);
      const textQuery = city && !spelled.toLowerCase().includes(city.toLowerCase()) ? `${spelled} ${city}` : spelled;
      const response = await fetcher(`${baseUrl}?q=${encodeURIComponent(textQuery)}&count=8&country=IN&search_lang=en`, {
        headers: { Accept: "application/json", "X-Subscription-Token": options.apiKey },
        signal: AbortSignal.timeout(options.timeoutMs ?? 6_000),
      });
      if (!response.ok) throw new Error(`Web search lookup failed with ${response.status}.`);
      const results = ((await response.json()) as { web?: { results?: BraveHit[] } }).web?.results ?? [];
      const hits = results.filter((item) => {
        const text = `${item.title ?? ""} ${item.description ?? ""}`;
        return nameInside(text, segment) && !NOT_THE_HOMES.test(item.title ?? "");
      });
      if (!hits.length) {
        unmatched ??= segment;
        continue;
      }
      const written = hits.map((item) => `${item.title ?? ""}. ${item.description ?? ""}`).join(" ");
      const locality = localityFromSearch(written);
      const foundCity = /\b(?:bengaluru|bangalore)\b/i.test(written) ? "Bengaluru" : null;
      const bhkOptions = bhkOptionsFromSearch(written);
      const stage = projectStage(written);
      return {
        name: projectTitle(hits[0]?.title ?? segment, segment),
        locality,
        city: foundCity,
        pincode: written.match(/\b(560\d{3})\b/)?.[1] ?? null,
        underConstruction: stage.underConstruction,
        ...(stage.readyToMove ? { readyToMove: true } : {}),
        ...(stage.possessionYear ? { possessionYear: stage.possessionYear } : {}),
        kind: kindFromSearch(written),
        address: [locality, foundCity].filter(Boolean).join(", ") || null,
        ...(bhkOptions.length ? { bhkOptions } : {}),
        source: "Brave Search",
      };
    }
    return unmatched ? { missing: unmatched, source: "Brave Search" } : null;
  }
}

/** Google Maps first, then web search, then OpenStreetMap. The first real project match wins. */
export function bestPlaceLookup(google: PlaceLookup | null, osm: PlaceLookup, web: PlaceLookup | null = null): PlaceLookup {
  return async (query, city) => {
    const fromGoogle = google
      ? await google(query, city).catch((error: unknown) => {
          console.warn(`Google Maps project check failed, trying the next source: ${error instanceof Error ? error.message : String(error)}`);
          return undefined;
        })
      : undefined;
    if (fromGoogle && !("missing" in fromGoogle)) return fromGoogle;
    const fromWeb = web
      ? await web(query, city).catch((error: unknown) => {
          console.warn(`Web search project check failed, trying OpenStreetMap: ${error instanceof Error ? error.message : String(error)}`);
          return undefined;
        })
      : undefined;
    if (fromWeb && !("missing" in fromWeb) && fromWeb.kind) return fromWeb;
    const fromOsm = await osm(query, city).catch(() => null);
    if (fromOsm && !("missing" in fromOsm)) return fromOsm;
    if (fromWeb && !("missing" in fromWeb)) return fromWeb;
    return (fromWeb && "missing" in fromWeb ? fromWeb : null) ?? (fromGoogle && "missing" in fromGoogle ? fromGoogle : null) ?? null;
  };
}
