import { describe, expect, it } from "vitest";
import { WORLD_OBSTACLES } from "@lafarmer2/content";
import { WATER_LEVEL, farmSignedDistance, groundHeight, tileToWorldX, tileToWorldZ, worldToTile } from "./height";
import { forestLayout, insideClearing, petalSpotsFor, treeLayout, type Clearing } from "./vegetationLayout";

const CLEARINGS: Clearing[] = [
  { x: 40, z: -20, radius: 9 },
  { x: -60, z: 70, radius: 7 }
];

describe("treeLayout", () => {
  it("is deterministic", () => {
    expect(treeLayout(CLEARINGS)).toEqual(treeLayout(CLEARINGS));
  });

  it("plants every server tree obstacle on its tile", () => {
    const obstacles = WORLD_OBSTACLES.filter((obstacle) => obstacle.kind === "tree");
    const planted = treeLayout(CLEARINGS).filter((site) => site.role === "obstacle");
    expect(planted).toHaveLength(obstacles.length);
    obstacles.forEach((obstacle, index) => {
      expect(planted[index].x).toBeCloseTo(tileToWorldX(obstacle.x));
      expect(planted[index].z).toBeCloseTo(tileToWorldZ(obstacle.y));
    });
  });

  it("keeps decorative trees out of clearings, off the water and apart from each other", () => {
    const decorative = treeLayout(CLEARINGS).filter((site) => site.role !== "obstacle");
    expect(decorative.length).toBeGreaterThan(40);
    for (const site of decorative) {
      expect(insideClearing(site.x, site.z, CLEARINGS, 2)).toBe(false);
      expect(groundHeight(site.x, site.z)).toBeGreaterThan(WATER_LEVEL + 0.1);
      expect(site.collider).toBeGreaterThan(0);
    }
    decorative.forEach((site, index) => {
      for (const other of decorative.slice(index + 1)) {
        expect(Math.hypot(site.x - other.x, site.z - other.z)).toBeGreaterThanOrEqual(6);
      }
    });
  });

  it("keeps the obstacles and bank trees at low quality and thins the rest", () => {
    const high = treeLayout(CLEARINGS, "high");
    const low = treeLayout(CLEARINGS, "low");
    const count = (sites: typeof high, role: string): number => sites.filter((site) => site.role === role).length;
    expect(count(low, "obstacle")).toBe(count(high, "obstacle"));
    expect(count(low, "bank")).toBe(count(high, "bank"));
    expect(low.length).toBeLessThan(high.length);
  });
});

describe("petalSpotsFor", () => {
  it("drops petals only under flowering cherries", () => {
    const sites = treeLayout(CLEARINGS);
    const flowering = sites.filter((site) => site.kind === "sakura" || site.kind === "weeping");
    expect(petalSpotsFor(sites)).toHaveLength(flowering.length);
  });
});

describe("forestLayout", () => {
  it("fills the valley walls outside the farm, away from clearings", () => {
    const trees = treeLayout(CLEARINGS);
    const forest = forestLayout(trees, CLEARINGS, 1500);
    expect(forest.length).toBeGreaterThan(1000);
    for (const site of forest) {
      const tile = worldToTile(site.x, site.z);
      expect(farmSignedDistance(tile.x, tile.y)).toBeGreaterThanOrEqual(4.5);
      expect(insideClearing(site.x, site.z, CLEARINGS, 6)).toBe(false);
      expect(site.y).toBeGreaterThan(WATER_LEVEL + 0.4);
    }
  });
});
