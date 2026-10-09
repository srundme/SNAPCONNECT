import { afterAll, describe, expect, it } from "vitest";
import { createPrisma } from "../src/client";
import { applyProjectAliases, knownProject, lookupProject, projectKey } from "../src/index";

const databaseUrl = process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

describe("project short forms", () => {
  it("replaces the team's short forms before any search", () => {
    const aliases = "APR = Adarsh Palm Retreat\nPLH: Prestige Lakeside Habitat";
    expect(applyProjectAliases("APR, Bellandur", aliases)).toBe("Adarsh Palm Retreat, Bellandur");
    expect(applyProjectAliases("my flat is in plh", aliases)).toBe("my flat is in Prestige Lakeside Habitat");
    expect(applyProjectAliases("April 2026", aliases)).toBe("April 2026");
    expect(projectKey("Concorde Manhattans, Bengaluru", "Bengaluru")).toBe(projectKey("concorde manhattans", "Bengaluru"));
  });
});

describeDb("project memory", () => {
  const db = createPrisma(databaseUrl ?? "postgresql://unused");
  afterAll(async () => {
    await db.$disconnect();
  });

  it("searches a project once and remembers it", async () => {
    const name = `Test Towers ${Date.now()}`;
    let searches = 0;
    const lookup = async () => {
      searches += 1;
      return { name, locality: "Whitefield", city: "Bengaluru", pincode: null, underConstruction: false, kind: "apartment" as const, builder: "Prestige", source: "Brave Search" as const };
    };
    const now = new Date();
    const first = await lookupProject(db, lookup, name, "Bengaluru", { allowSearch: true, now });
    const second = await lookupProject(db, lookup, `${name.toLowerCase()}, Bengaluru`, "Bengaluru", { allowSearch: true, now });
    expect(searches).toBe(1);
    expect(second).toEqual(first);
    expect((await knownProject(db, name, "Bengaluru"))?.builder).toBe("Prestige");
  });

  it("never searches when not allowed, and retries a miss after a day", async () => {
    const name = `Nowhere Heights ${Date.now()}`;
    let searches = 0;
    const lookup = async () => {
      searches += 1;
      return { missing: name, source: "Brave Search" as const };
    };
    expect(await lookupProject(db, lookup, name, "Bengaluru", { allowSearch: false, now: new Date() })).toBeNull();
    expect(searches).toBe(0);
    await lookupProject(db, lookup, name, "Bengaluru", { allowSearch: true, now: new Date() });
    await lookupProject(db, lookup, name, "Bengaluru", { allowSearch: true, now: new Date() });
    expect(searches).toBe(1);
    await lookupProject(db, lookup, name, "Bengaluru", { allowSearch: true, now: new Date(Date.now() + 2 * 86_400_000) });
    expect(searches).toBe(2);
  });
});
