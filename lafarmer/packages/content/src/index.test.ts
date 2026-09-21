import { describe, expect, it } from "vitest";
import { CONTENT_CATALOG, getContentDefinition, isWorldTileWalkable, isWorldWaterTile, STARTING_COINS, WORLD_HEIGHT_TILES, WORLD_WIDTH_TILES } from "./index.js";

describe("content catalog", () => {
  it("contains the MVP content families", () => {
    expect(CONTENT_CATALOG.map((item) => item.id)).toEqual([
      "tomato",
      "orange-tree",
      "cow",
      "dinosaur"
    ]);
  });

  it("keeps growth visuals data-driven", () => {
    expect(getContentDefinition("dinosaur")?.stages.map((stage) => stage.visualKey)).toEqual([
      "dinosaur-fossil",
      "dinosaur-egg",
      "dinosaur-hatchling",
      "dinosaur-adult"
    ]);
    expect(STARTING_COINS).toBe(1_000);
  });

  it("defines a connected 40 by 30 world with water, bridge and solid obstacles", () => {
    expect([WORLD_WIDTH_TILES, WORLD_HEIGHT_TILES]).toEqual([40, 30]);
    expect(isWorldWaterTile(25, 10)).toBe(true);
    expect(isWorldTileWalkable(25, 10)).toBe(false);
    expect(isWorldTileWalkable(25, 14)).toBe(true);
    expect(isWorldTileWalkable(8, 5)).toBe(false);
    expect(isWorldTileWalkable(5, 5)).toBe(true);
  });
});
