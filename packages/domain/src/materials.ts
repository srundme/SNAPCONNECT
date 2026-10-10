/**
 * The firm's material specification and warranty, kept as separate entries so a question about
 * the kitchen gets the kitchen fact only, never the whole sheet.
 */
export type MaterialEntry = {
  id: string;
  area: string;
  material: string;
  brand: string;
  madeIn: string;
  /** Why this material suits this area, in one plain line, for "why" and "what is the difference" questions. */
  why?: string;
  /** Words a customer would use when asking about this area. */
  keywords: string[];
};

export type WarrantyTerms = {
  items: Array<{ item: string; term: string }>;
  covers: string;
  notCovered: string;
};

export function parseMaterials(value: unknown): MaterialEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const text = (key: string, limit: number) => String(item[key] ?? "").trim().slice(0, limit);
    const entry: MaterialEntry = {
      id: text("id", 60),
      area: text("area", 120),
      material: text("material", 600),
      brand: text("brand", 120),
      madeIn: text("madeIn", 80),
      ...(text("why", 300) ? { why: text("why", 300) } : {}),
      keywords: Array.isArray(item.keywords) ? item.keywords.map((word) => String(word).trim().toLowerCase()).filter(Boolean).slice(0, 30) : [],
    };
    return entry.id && entry.area && entry.material ? [entry] : [];
  }).slice(0, 30);
}

export function parseWarranty(value: unknown): WarrantyTerms | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const items = Array.isArray(record.items)
    ? record.items.flatMap((raw) => {
        const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
        const name = String(item.item ?? "").trim().slice(0, 120);
        const term = String(item.term ?? "").trim().slice(0, 160);
        return name && term ? [{ item: name, term }] : [];
      }).slice(0, 15)
    : [];
  if (!items.length) return null;
  return {
    items,
    covers: String(record.covers ?? "").trim().slice(0, 600),
    notCovered: String(record.notCovered ?? "").trim().slice(0, 1000),
  };
}

