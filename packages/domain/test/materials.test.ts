import { describe, expect, it } from "vitest";
import fixture from "./materials-fixture.json";
import { materialLine, parseAgentSettings, parseMaterials, parseWarranty } from "../src/index";

const materials = parseMaterials(fixture.materials);
const warranty = parseWarranty(fixture.warranty);

describe("material questions get only the matching facts", () => {
  it("answers a kitchen question with the kitchen ply only", () => {
    const line = materialLine("which plywood do you use for kitchen?", materials, warranty)!;
    expect(line).toMatch(/Club Prime/);
    expect(line).not.toMatch(/Aristo|Siemens|WIN MR/);
  });

  it("answers a hinge question with Blum only", () => {
    const line = materialLine("what hinges do u use", materials, warranty)!;
    expect(line).toMatch(/Blum Clip/);
    expect(line).not.toMatch(/Century|Aristo/);
  });

  it("gives a short overview for a general materials question", () => {
    const line = materialLine("what materials do you use?", materials, warranty)!;
    expect(line).toMatch(/overview/);
    expect(line).toMatch(/which area/);
    expect(line).not.toMatch(/Aristo|Siemens|lacquered/i);
  });

  it("answers warranty for the item asked, and exclusions only when asked", () => {
    const wardrobe = materialLine("is there warranty on wardrobe?", materials, warranty)!;
    expect(wardrobe).toMatch(/Wardrobes: Lifetime/);
    expect(wardrobe).not.toMatch(/Not covered/);
    expect(materialLine("what is not covered in warranty?", materials, warranty)).toMatch(/Not covered: Misuse/);
  });

  it("stays out of chats that are not about materials", () => {
    expect(materialLine("I want interiors for my new 3 BHK house", materials, warranty)).toBeNull();
    expect(materialLine("my flat is in Whitefield", materials, warranty)).toBeNull();
  });

  it("keeps the materials when settings are read back", () => {
    const settings = parseAgentSettings({ materials: fixture.materials, warranty: fixture.warranty });
    expect(settings.materials).toHaveLength(9);
    expect(settings.warranty?.items).toHaveLength(5);
  });
});
