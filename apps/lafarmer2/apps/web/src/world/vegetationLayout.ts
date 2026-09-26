import { FARM_BOUNDARY, WORLD_OBSTACLES } from "@lafarmer2/content";
import { createRng, type Rng } from "./foliage";
import {
  TILE,
  WATER_LEVEL,
  computeGroundHeight,
  farmSignedDistance,
  fbm,
  groundHeight,
  nearObstacle,
  pathMask,
  riverCenterTile,
  riverCenterWorld,
  riverHalfWidthTiles,
  tileToWorldX,
  tileToWorldZ,
  waterField,
  worldToTile
} from "./height";
import type { PetalSpot } from "./terrain";
import type { TreeKind, TreePlacement } from "./trees";

const TAU = Math.PI * 2;

/** Ground kept free of vegetation (landmark platforms, plazas). World units. */
export type Clearing = { x: number; z: number; radius: number };

export type TreeRole = "obstacle" | "bank" | "corridor" | "edge";

export type TreeSite = TreePlacement & {
  role: TreeRole;
  /** Trunk radius for the walking controller, world units. */
  collider: number;
};

export type ForestSite = { x: number; y: number; z: number; scale: number; seed: number; broadleaf: boolean; blossom: boolean };

export const insideClearing = (x: number, z: number, clearings: ReadonlyArray<Clearing>, margin = 0): boolean =>
  clearings.some((clearing) => Math.hypot(x - clearing.x, z - clearing.z) < clearing.radius + margin);

const pickKind = (roll: number, weights: ReadonlyArray<readonly [TreeKind, number]>): TreeKind => {
  const total = weights.reduce((sum, [, weight]) => sum + weight, 0);
  let remaining = roll * total;
  for (const [kind, weight] of weights) {
    remaining -= weight;
    if (remaining <= 0) return kind;
  }
  return weights[weights.length - 1][0];
};

/** Kinds for the server's tree obstacles, in WORLD_OBSTACLES order. */
const OBSTACLE_KINDS: TreeKind[] = ["sakura", "sakura", "maple", "pine", "sakura", "pine", "sakura", "weeping", "maple", "pine", "sakura"];

/** Where the road and the river crossings leave the farm; edge trees keep away from them. Tiles. */
const EXITS: ReadonlyArray<readonly [number, number]> = [[3.5, 28.5], [1, 29.5], [76.5, 29.5]];

/** First bank column past the water on one side of a river row, in tiles. */
const bankColumn = (ty: number, side: number): number => {
  let tx = riverCenterTile(ty);
  for (let step = 0; step < 100 && waterField(tx, ty) > 0.25; step += 1) tx += side * 0.05;
  return tx;
};

const obstacleTrees = (rng: Rng): TreeSite[] =>
  WORLD_OBSTACLES.filter((obstacle) => obstacle.kind === "tree").map((obstacle, index) => ({
    kind: OBSTACLE_KINDS[index % OBSTACLE_KINDS.length],
    x: tileToWorldX(obstacle.x),
    z: tileToWorldZ(obstacle.y),
    scale: rng.range(0.98, 1.14),
    lean: rng.range(0, TAU),
    variant: index % 4,
    role: "obstacle",
    collider: 0.6
  }));

/** Cherries rooted at the waterline inside the farm, leaning over the river; the bridge rows stay open. */
const bankTrees = (rng: Rng, clearings: ReadonlyArray<Clearing>): TreeSite[] => {
  const sites: TreeSite[] = [];
  let side = rng.sign();
  for (let ty = 7 + rng.range(0, 2); ty < 54; ty += rng.range(3.2, 5.2)) {
    if (ty > 25.5 && ty < 33.5) continue;
    const sides = rng.next() < 0.25 ? [-1, 1] : [side];
    side = -side;
    for (const bankSide of sides) {
      const tx = bankColumn(ty, bankSide) + bankSide * rng.range(0.2, 0.4);
      const x = tileToWorldX(tx);
      const z = tileToWorldZ(ty);
      if (groundHeight(x, z) < WATER_LEVEL + 0.12 || farmSignedDistance(tx, ty) > -0.5) continue;
      if (pathMask(tx, ty) > 0.15 || nearObstacle(tx, ty, 0.6) || insideClearing(x, z, clearings, 2)) continue;
      sites.push({
        kind: pickKind(rng.next(), [["sakura", 70], ["weeping", 12], ["maple", 10], ["pine", 8]]),
        x,
        z,
        scale: rng.range(0.85, 1.1),
        lean: (bankSide > 0 ? Math.PI : 0) + rng.range(-0.3, 0.3),
        variant: rng.int(0, 3),
        role: "bank",
        collider: 0.45
      });
    }
  }
  return sites;
};

/** Both banks of the river beyond the farm, upstream and downstream. */
const corridorTrees = (rng: Rng, clearings: ReadonlyArray<Clearing>): TreeSite[] => {
  const sites: TreeSite[] = [];
  for (const direction of [-1, 1]) {
    let side = rng.sign();
    for (let distance = 84 + rng.range(0, 10); distance < 520; distance += rng.range(16, 30)) {
      const z = direction * distance;
      const sides = rng.next() < 0.3 ? [-1, 1] : [side];
      side = -side;
      for (const bankSide of sides) {
        const ty = worldToTile(0, z).y;
        const x = riverCenterWorld(z) + bankSide * (riverHalfWidthTiles(ty) * TILE + rng.range(3.5, 11));
        const tx = worldToTile(x, z).x;
        if (farmSignedDistance(tx, ty) < 0.3 || insideClearing(x, z, clearings, 3)) continue;
        if (groundHeight(x, z) < WATER_LEVEL + 0.15) continue;
        sites.push({
          kind: pickKind(rng.next(), [["sakura", 55], ["maple", 20], ["pine", 18], ["weeping", 7]]),
          x,
          z,
          scale: rng.range(0.9, 1.15),
          lean: (bankSide > 0 ? Math.PI : 0) + rng.range(-0.3, 0.3),
          variant: rng.int(0, 3),
          role: "corridor",
          collider: 0.5
        });
      }
    }
  }
  return sites;
};

/** A ring of trees just outside the farm boundary, leaning toward the open meadow. */
const edgeTrees = (rng: Rng, clearings: ReadonlyArray<Clearing>): TreeSite[] => {
  const sites: TreeSite[] = [];
  FARM_BOUNDARY.forEach(([ax, ay], index) => {
    const [bx, by] = FARM_BOUNDARY[(index + 1) % FARM_BOUNDARY.length];
    const length = Math.hypot(bx - ax, by - ay);
    const nx = (by - ay) / length;
    const ny = -(bx - ax) / length;
    for (let along = rng.range(1, 5); along < length; along += rng.range(4.5, 7)) {
      const px = ax + ((bx - ax) * along) / length;
      const py = ay + ((by - ay) * along) / length;
      const offset = rng.range(1.2, 4.2);
      let tx = px + nx * offset;
      let ty = py + ny * offset;
      if (farmSignedDistance(tx, ty) < 0) {
        tx = px - nx * offset;
        ty = py - ny * offset;
      }
      if (farmSignedDistance(tx, ty) < 0.9 || Math.abs(tx - riverCenterTile(ty)) < 7) continue;
      if (EXITS.some(([ex, ey]) => Math.hypot(tx - ex, ty - ey) < 5)) continue;
      const x = tileToWorldX(tx);
      const z = tileToWorldZ(ty);
      if (insideClearing(x, z, clearings, 3)) continue;
      sites.push({
        kind: pickKind(rng.next(), [["sakura", 35], ["pine", 30], ["maple", 25], ["weeping", 10]]),
        x,
        z,
        scale: rng.range(0.9, 1.25),
        lean: Math.atan2(py - ty, px - tx) + rng.range(-0.4, 0.4),
        variant: rng.int(0, 3),
        role: "edge",
        collider: 0.5
      });
    }
  });
  return sites;
};

export type LayoutQuality = "high" | "low";

/** Every hand-placed tree of the valley. Deterministic; obstacle trees sit on their server tiles. */
export const treeLayout = (clearings: ReadonlyArray<Clearing> = [], quality: LayoutQuality = "high"): TreeSite[] => {
  const candidates = [
    ...obstacleTrees(createRng(7101)),
    ...bankTrees(createRng(7202), clearings),
    ...corridorTrees(createRng(7303), clearings),
    ...edgeTrees(createRng(7404), clearings)
  ];
  const kept: TreeSite[] = [];
  for (const site of candidates) {
    if (site.role !== "obstacle" && kept.some((other) => Math.hypot(other.x - site.x, other.z - site.z) < 6)) continue;
    kept.push(site);
  }
  if (quality === "high") return kept;
  return kept.filter((site, index) => site.role === "obstacle" || site.role === "bank" || index % 2 === 0);
};

/** Ground under the flowering crowns, for the fallen petals the terrain paints. */
export const petalSpotsFor = (sites: ReadonlyArray<TreeSite>): PetalSpot[] =>
  sites
    .filter((site) => site.kind === "sakura" || site.kind === "weeping")
    .map((site) => ({
      x: site.x + Math.cos(site.lean) * 1.2 * site.scale,
      z: site.z + Math.sin(site.lean) * 1.2 * site.scale,
      radius: (site.kind === "weeping" ? 4.2 : 5) * site.scale
    }));

/**
 * Billboard forest on the valley walls and along the river beyond the farm: cedars higher up,
 * broadleaves (a few in blossom) lower down, with noise clearings and a tree line.
 */
export const forestLayout = (trees: ReadonlyArray<TreeSite>, clearings: ReadonlyArray<Clearing>, target: number): ForestSite[] => {
  const rng = createRng(4242);
  const sites: ForestSite[] = [];
  for (let attempt = 0; attempt < target * 8 && sites.length < target; attempt += 1) {
    const z = rng.range(-1050, 1050);
    const ty = worldToTile(0, z).y;
    const fromRiver = rng.range(14, 480) * (rng.next() < 0.5 ? rng.next() : 1);
    const x = riverCenterWorld(z) + rng.sign() * (riverHalfWidthTiles(ty) * TILE + 14 + fromRiver);
    if (Math.abs(x) > 820) continue;
    const tx = worldToTile(x, z).x;
    const outside = farmSignedDistance(tx, ty);
    if (outside < 4.5) continue;
    if (fbm(x * 0.02, z * 0.02, 3) < 0.36 - (fromRiver < 40 ? 0.1 : 0)) continue;
    if (insideClearing(x, z, clearings, 6)) continue;
    if (trees.some((tree) => Math.abs(tree.x - x) < 6 && Math.abs(tree.z - z) < 6)) continue;
    const y = computeGroundHeight(x, z);
    if (y < WATER_LEVEL + 0.4 || y > 135 + fbm(x * 0.01, z * 0.01, 2) * 30) continue;
    const slope = Math.hypot(computeGroundHeight(x + 2, z) - y, computeGroundHeight(x, z + 2) - y) / 2;
    if (slope > 1.25) continue;
    const broadleaf = fbm(x * 0.012 + 40, z * 0.012, 3) + (y < 25 ? 0.3 : -0.25) > 0.52;
    sites.push({
      x,
      y,
      z,
      scale: rng.range(0.8, 1.3) * (fromRiver > 120 ? 1.3 : 1),
      seed: rng.next(),
      broadleaf,
      blossom: broadleaf && rng.next() < 0.22
    });
  }
  return sites;
};
