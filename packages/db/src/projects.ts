import type { PlaceInfo, PlaceMissing } from "@snapsocial/integrations";
import type { Db } from "./client";
import type { Prisma } from "./generated/prisma/client";

type Lookup = (query: string, city?: string) => Promise<PlaceInfo | PlaceMissing | null>;

const FOUND_FOR_MS = 30 * 86_400_000;
const MISSING_FOR_MS = 86_400_000;

/** "Concorde Manhattans, Bengaluru" and "concorde manhattans" are the same project. */
export function projectKey(text: string, city?: string | null): string {
  const name = text
    .toLowerCase()
    .replace(/\b(bengaluru|bangalore|blr|karnataka|india)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return `${name}|${(city ?? "").toLowerCase().trim()}`;
}

/**
 * The firm's own short forms, one per line, like "APR = Adarsh Palm Retreat". They are applied before
 * any search, so a name the team knows never depends on the web.
 */
export function applyProjectAliases(text: string, aliases: string): string {
  let out = text;
  for (const line of aliases.split(/\n+/)) {
    const [short, full] = line.split(/\s*[=:→-]>?\s*/).map((part) => part?.trim() ?? "");
    if (!short || !full || short.length > 40) continue;
    const pattern = new RegExp(`(^|[^A-Za-z0-9])${short.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^A-Za-z0-9])`, "i");
    out = out.replace(pattern, (_match, before: string) => `${before}${full}`);
  }
  return out;
}

const GENERIC_WORDS = /^(?:apartments?|villas?|flats?|homes?|houses?|project|property|properties|residency|residences|enclave|towers?|phase|bengaluru|bangalore|sale|for|the|and|road|layout|nagar|city|ecity|electronic)$/i;

/** A search hit is theirs only if its name shares a real word with what they typed ("Villas for Sale" never is). */
export function matchesTyped(typed: string, found: { name: string; shortForm?: string | null; correctedFrom?: string | null }): boolean {
  if (found.shortForm || found.correctedFrom) return true;
  const words = typed.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4 && !GENERIC_WORDS.test(word));
  if (!words.length) return true;
  return found.name.toLowerCase().split(/[^a-z0-9]+/).some((word) => word.length >= 4 && !GENERIC_WORDS.test(word) && words.some((part) => part.slice(0, 4) === word.slice(0, 4)));
}

/**
 * Looks a project up once and remembers it: found projects for 30 days, misses for a day. Searches only
 * when allowed (not on follow-ups, and only a few times per chat), so replies stay fast and cheap.
 */
export async function lookupProject(
  db: Db,
  lookup: Lookup | undefined,
  text: string,
  city: string | undefined,
  options: { allowSearch: boolean; now: Date },
): Promise<PlaceInfo | PlaceMissing | null> {
  const key = projectKey(text, city);
  const cached = await db.projectLookup.findUnique({ where: { key } });
  const cachedResult = cached?.result as PlaceInfo | PlaceMissing | null | undefined;
  // An older bad match in the cache is searched again rather than trusted.
  if (cached && cachedResult && !("missing" in cachedResult) && !matchesTyped(text, cachedResult)) {
    await db.projectLookup.update({ where: { key }, data: { found: false, result: { missing: `"${cachedResult.name}" did not match what they typed`, source: cachedResult.source ?? "search" } as unknown as Prisma.InputJsonValue } });
    return null;
  }
  const fresh = cached && options.now.getTime() - cached.updatedAt.getTime() < (cached.found ? FOUND_FOR_MS : MISSING_FOR_MS);
  if (cached && (fresh || !options.allowSearch || !lookup)) {
    await db.projectLookup.update({ where: { key }, data: { hits: { increment: 1 } } }).catch(() => undefined);
    return (cached.result as PlaceInfo | PlaceMissing | null) ?? null;
  }
  if (!options.allowSearch || !lookup) return null;
  let result = await lookup(text, city).catch((error: unknown) => {
    console.warn(`Project lookup failed: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  });
  if (result === undefined) return (cached?.result as PlaceInfo | PlaceMissing | null) ?? null;
  // A listing page or another project is not theirs: remembered as not found.
  if (result && !("missing" in result) && !matchesTyped(text, result)) result = { missing: `"${result.name}" did not match what they typed`, source: result.source ?? "search" } as PlaceMissing;
  const found = Boolean(result && !("missing" in result));
  await db.projectLookup.upsert({
    where: { key },
    update: { query: text.slice(0, 200), found, result: (result ?? null) as Prisma.InputJsonValue, hits: { increment: 1 } },
    create: { key, query: text.slice(0, 200), found, result: (result ?? null) as Prisma.InputJsonValue, hits: 1 },
  });
  return result;
}

/** What is already known about a project, without searching. For the inbox project card. */
export async function knownProject(db: Db, text: string, city?: string | null): Promise<PlaceInfo | null> {
  if (!text.trim()) return null;
  const cached = await db.projectLookup.findUnique({ where: { key: projectKey(text, city) } });
  const result = cached?.result as PlaceInfo | PlaceMissing | null | undefined;
  return result && !("missing" in result) && matchesTyped(text, result) ? result : null;
}
