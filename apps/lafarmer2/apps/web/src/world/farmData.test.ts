import { describe, expect, it } from "vitest";
import { parseFarmItem, parseList, parsePlayer, parseStructure } from "./farmData";

describe("farm messages", () => {
  it("reads a farm item and drops a broken one", () => {
    const item = parseFarmItem({
      id: "item-1",
      ownerId: "owner",
      contentId: "tomato",
      position: { x: 10.2, y: 4.8 },
      stageId: "sprout",
      ready: true,
      pendingQuantity: 2,
      plantedAt: 50,
      appearanceVariantId: "default",
      careState: "awaiting-care"
    });
    expect(item).toMatchObject({ id: "item-1", x: 10, y: 5, stageId: "sprout", ready: true, pendingQuantity: 2, variant: "default", careState: "awaiting-care" });
    expect(parseFarmItem({ id: "item-1" })).toBeUndefined();
  });

  it("reads a structure footprint and rejects an unknown type", () => {
    const structure = parseStructure({ id: "s1", type: "field", footprint: [[1, 2], [5, 2], [5, 5], [1, 5]], regionId: "region-center" }, "owner");
    expect(structure).toMatchObject({ id: "s1", ownerId: "owner", type: "field", regionId: "region-center" });
    expect(parseStructure({ id: "s1", type: "castle", footprint: [[0, 0], [1, 0], [1, 1]] })).toBeUndefined();
    expect(parseStructure({ id: "s1", type: "field", footprint: [[0, 0]] })).toBeUndefined();
  });

  it("reads a neighbour and falls back when the look is unknown", () => {
    const raw = { id: "p2", name: "Ana", position: { x: 3, y: 4 }, currentRegionId: "region-east", appearance: { clothing: "nope", hair: "long" } };
    const player = parsePlayer(raw);
    expect(player).toMatchObject({ id: "p2", name: "Ana", regionId: "region-east", x: 3, y: 4, clothing: "forest", hair: "long" });
    expect(parseList([raw, { id: "" }, null], parsePlayer)).toHaveLength(1);
  });
});
