import { describe, expect, it } from "vitest";
import fixture from "./materials-fixture.json";
import { parseAgentSettings } from "../src/index";

describe("material settings", () => {
  it("keeps the materials when settings are read back", () => {
    const settings = parseAgentSettings({ materials: fixture.materials, warranty: fixture.warranty });
    expect(settings.materials).toHaveLength(9);
    expect(settings.warranty?.items).toHaveLength(5);
  });
});
