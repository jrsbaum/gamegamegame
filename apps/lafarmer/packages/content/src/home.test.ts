import { describe, expect, it } from "vitest";
import {
  HOME_FURNITURE_CATALOG,
  HOME_HEIGHT_TILES,
  HOME_ROOMS,
  HOME_WIDTH_TILES,
  createDefaultHomeFurniture,
  isHomeFurniturePlacementValid,
  isHomeTileWalkable
} from "./home.js";

describe("shared home content", () => {
  it("defines four domestic zones and unique furnished starter items", () => {
    const furniture = createDefaultHomeFurniture();
    expect(HOME_ROOMS.map((room) => room.id)).toEqual(["living-kitchen", "office", "bedroom", "bathroom"]);
    expect(new Set(HOME_FURNITURE_CATALOG.map((item) => item.type)).size).toBe(HOME_FURNITURE_CATALOG.length);
    expect(new Set(furniture.map((item) => item.id)).size).toBe(furniture.length);
    expect(furniture.map((item) => item.type)).toContain("radio");
    expect(furniture.map((item) => item.type)).toContain("work-desk");
  });

  it("keeps all default furniture inside the room without overlap", () => {
    const furniture = createDefaultHomeFurniture();
    for (const item of furniture) expect(isHomeFurniturePlacementValid(furniture, item.id, item.x, item.y)).toBe(true);
    expect(HOME_WIDTH_TILES).toBe(22);
    expect(HOME_HEIGHT_TILES).toBe(14);
  });

  it("rejects invalid, overlapping, wall and out-of-bounds placements", () => {
    const furniture = createDefaultHomeFurniture();
    expect(isHomeFurniturePlacementValid(furniture, "radio", 2, 2)).toBe(false); // overlaps sofa
    expect(isHomeFurniturePlacementValid(furniture, "radio", 0, 2)).toBe(false);
    expect(isHomeFurniturePlacementValid(furniture, "radio", 21, 2)).toBe(false);
    expect(isHomeFurniturePlacementValid(furniture, "unknown", 4, 4)).toBe(false);
    expect(isHomeFurniturePlacementValid(furniture, "radio", 1.5, 3)).toBe(false);
    expect(isHomeFurniturePlacementValid(furniture, "radio", 4, 7)).toBe(false); // internal wall
    expect(isHomeTileWalkable(3, 7, furniture)).toBe(true); // office doorway
    expect(isHomeTileWalkable(4, 7, furniture)).toBe(false);
  });
});
