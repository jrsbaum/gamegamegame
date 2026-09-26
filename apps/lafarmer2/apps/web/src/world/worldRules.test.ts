import { describe, expect, it } from "vitest";
import type { TileRect } from "./structures";
import { errorText, pickAction, tileBlocked, type ActionContext, type RuleItem, type RuleStructure } from "./worldRules";

const field = (id: string, ownerId: string, tiles: TileRect, type = "field"): RuleStructure => ({ id, ownerId, type, tiles, regionId: "region-center" });

const base = (patch: Partial<ActionContext> = {}): ActionContext => ({
  tile: { x: 20, y: 12 },
  facing: "right",
  regionId: "region-center",
  playerId: "me",
  inventory: {},
  presence: [],
  structures: [],
  items: [],
  ...patch
});

const tomato = (patch: Partial<RuleItem> = {}): RuleItem => ({
  id: "tomato-1",
  ownerId: "me",
  contentId: "tomato",
  structureId: null,
  x: 21,
  y: 12,
  ready: true,
  pendingQuantity: 0,
  careState: "attended",
  ...patch
});

describe("tileBlocked", () => {
  const own = field("field-1", "me", { x0: 22, y0: 12, x1: 26, y1: 15 });
  const foreign = field("field-2", "neighbour", { x0: 30, y0: 12, x1: 34, y1: 15 });

  it("blocks the owner's own footprint even when they are standing on it", () => {
    expect(tileBlocked(22, 12, { x: 22, y: 12 }, "region-center", "me", [own])).toBe(true);
    expect(tileBlocked(21, 12, { x: 22, y: 12 }, "region-center", "me", [own])).toBe(false);
  });

  it("lets a visitor leave a neighbour structure they are already inside", () => {
    expect(tileBlocked(30, 12, { x: 20, y: 12 }, "region-center", "me", [foreign])).toBe(true);
    expect(tileBlocked(31, 13, { x: 30, y: 12 }, "region-center", "me", [foreign])).toBe(false);
  });

  it("blocks tiles the world itself rejects", () => {
    expect(tileBlocked(-1, 0, { x: 20, y: 12 }, "region-center", "me", [])).toBe(true);
  });
});

describe("pickAction", () => {
  it("prefers the bridge when someone lives on the other side", () => {
    const action = pickAction(base({ tile: { x: 40, y: 4 }, presence: [{ homeRegionId: "region-north" }], items: [tomato({ x: 40, y: 5 })] }));
    expect(action?.kind).toBe("visit");
    if (action?.kind === "visit") expect(action.regionId).toBe("region-north");
  });

  it("harvests the nearest ready crop of the player", () => {
    const action = pickAction(base({ items: [tomato(), tomato({ id: "far", x: 24, y: 12 })] }));
    expect(action).toMatchObject({ kind: "work", action: "farm.harvest", itemId: "tomato-1" });
  });

  it("plants inside the player's field before the tile in front", () => {
    const action = pickAction(base({
      inventory: { "tomato-seed": 1 },
      structures: [field("field-1", "me", { x0: 22, y0: 12, x1: 26, y1: 15 })],
      items: [tomato({ x: 23, y: 13, ready: false, careState: "attended" })]
    }));
    expect(action).toMatchObject({ kind: "plant", contentId: "tomato", tile: { x: 24, y: 13 } });
  });

  it("plants on the tile in front when there is no field", () => {
    const action = pickAction(base({ inventory: { "tomato-seed": 1 }, facing: "down" }));
    expect(action).toMatchObject({ kind: "plant", contentId: "tomato", tile: { x: 20, y: 13 } });
  });

  it("adopts into a nearby pen that still has room", () => {
    const pen = field("pen-1", "me", { x0: 18, y0: 14, x1: 24, y1: 19 }, "animal_pen");
    const action = pickAction(base({ tile: { x: 17, y: 14 }, inventory: { feed: 1 }, structures: [pen] }));
    expect(action).toMatchObject({ kind: "adopt", contentId: "cow" });
  });

  it("does not adopt from across the meadow", () => {
    const pen = field("pen-1", "me", { x0: 40, y0: 40, x1: 46, y1: 45 }, "animal_pen");
    const action = pickAction(base({ inventory: { feed: 1 }, structures: [pen] }));
    expect(action).toBeUndefined();
  });
});

describe("errorText", () => {
  it("speaks the server codes in Portuguese", () => {
    expect(errorText("inventory_full")).toBe("O estoque está cheio.");
    expect(errorText("something_else")).toBe("Não deu para fazer isso agora.");
  });
});
