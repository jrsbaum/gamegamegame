import * as THREE from "three";
import { WORLD_OBSTACLES, type WorldObstacleKind } from "@lafarmer2/content";
import {
  Frame,
  Parts,
  archMaterials,
  beam,
  boulder,
  box,
  brackets,
  chochin,
  cylinder,
  lathe,
  place,
  roof,
  roofProfile,
  roofSeat,
  shell,
  shimenawa,
  stoneLantern,
  torii,
  type ArchMaterials,
  type RoofSpec,
  type Tint
} from "./architecture";
import type { Circle } from "./controller";
import { BRIDGE, WATER_LEVEL, bridgeDeckHeight, createRandom, groundHeight, tileToWorldX, tileToWorldZ } from "./height";
import { addLamp, removeLamp, type Lamp } from "./shared";
import type { Clearing } from "./vegetationLayout";

/*
 * The valley's landmarks: the red arched bridge, a thatched minka barn, the farmhouse with its
 * veranda, the tiled market stall, a torii over the west road, mossy boulders, stone lanterns
 * along the paths and a five-storey pagoda on the northern slope. Buildings fill their blocked
 * footprints with a stone base; whatever stands on walkable ground carries a circle collider,
 * and `solid` lets the camera arm stop short of walls and roofs while passing under eaves.
 */

type Rect = { x0: number; x1: number; z0: number; z1: number };

/** Bounds the camera tests first; `inside` refines them when the shape is not a box. */
type Solid = { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; inside?: (x: number, y: number, z: number) => boolean };

export type Landmarks = {
  root: THREE.Group;
  /** Round obstacles on walkable tiles (posts, lanterns, railings, the drying rack). */
  colliders: Circle[];
  /** True inside a wall, roof, rock or post. */
  solid: (x: number, y: number, z: number) => boolean;
  update: (time: number, dt: number) => void;
  dispose: () => void;
};

export type LandmarkOptions = {
  /** Replaces the textured materials (tests have no images). */
  materials?: ArchMaterials;
};

const WHITE: Tint = [1, 1, 1];
/** Walls stand this far inside their blocked footprint; the stone base fills the rest. */
const WALL_INSET = 0.8;

const obstacleRect = (kind: WorldObstacleKind, index = 0): Rect => {
  const obstacle = WORLD_OBSTACLES.filter((candidate) => candidate.kind === kind)[index];
  return {
    x0: tileToWorldX(obstacle.x - 0.5),
    x1: tileToWorldX(obstacle.x + obstacle.width - 0.5),
    z0: tileToWorldZ(obstacle.y - 0.5),
    z1: tileToWorldZ(obstacle.y + obstacle.height - 0.5)
  };
};

const BARN = obstacleRect("barn");
const HOUSE = obstacleRect("house");
const MARKET = obstacleRect("market");
const BRIDGE_Z = (BRIDGE.z0 + BRIDGE.z1) / 2;

/** Across the west road where it leaves the farm; the posts clear the road on both sides. */
const TORII = { x: -109.2, z: -0.6, scale: 1.39 };
/** On the slope north-east of the farm, facing the valley. */
const PAGODA = { x: 70.5, z: -103.5, half: 6.25 };
/** Rice-drying rack (hazakake) east of the barn, running along z. */
const RACK = { x: -81.2, z0: -47.5, z1: -40.5 };

type LanternGroup = "bridge" | "torii" | "market" | "house" | "barn";
/** Stone lanterns at the bridge ends, the torii and where the spurs meet the buildings, off the paths. */
const LANTERNS: ReadonlyArray<{ x: number; z: number; group: LanternGroup }> = [
  { x: -0.8, z: -6.4, group: "bridge" },
  { x: -6.6, z: 3.7, group: "bridge" },
  { x: 18.6, z: -5.7, group: "bridge" },
  { x: 18.6, z: 3.7, group: "bridge" },
  { x: -106.2, z: -4.6, group: "torii" },
  { x: -106.2, z: 3.5, group: "torii" },
  { x: 70.4, z: -14.4, group: "market" },
  { x: 77.2, z: -14.4, group: "market" },
  { x: -32.7, z: 38.6, group: "house" },
  { x: -25.9, z: 38.6, group: "house" },
  { x: -97.4, z: -33.6, group: "barn" },
  { x: -90.6, z: -33.6, group: "barn" }
];

/** Boulders filling the rock tiles, two clusters. */
const BOULDERS: ReadonlyArray<{ x: number; z: number; radius: number; squash: number; seed: number; cluster: number }> = [
  { x: -17.6, z: -60.1, radius: 1.55, squash: 0.62, seed: 3, cluster: 0 },
  { x: -15.1, z: -59.7, radius: 1.25, squash: 0.7, seed: 5, cluster: 0 },
  { x: -14.2, z: -61, radius: 0.5, squash: 0.8, seed: 7, cluster: 0 },
  { x: -12, z: -60, radius: 1.3, squash: 0.75, seed: 11, cluster: 0 },
  { x: 51.3, z: 54.1, radius: 1.5, squash: 0.65, seed: 13, cluster: 1 },
  { x: 53.8, z: 53.7, radius: 1.2, squash: 0.7, seed: 17, cluster: 1 },
  { x: 55, z: 55, radius: 0.45, squash: 0.8, seed: 19, cluster: 1 }
];

/** Circles along the long axis of a rectangle that together cover it with `pad` to spare. */
const rectClearings = (rect: Rect, pad: number): Clearing[] => {
  const width = rect.x1 - rect.x0;
  const depth = rect.z1 - rect.z0;
  const alongX = width >= depth;
  const long = alongX ? width : depth;
  const short = alongX ? depth : width;
  const radius = short / 2 + pad;
  const reach = Math.sqrt(radius * radius - (short / 2) ** 2);
  const count = Math.max(1, Math.ceil(long / (2 * reach)));
  const cx = (rect.x0 + rect.x1) / 2;
  const cz = (rect.z0 + rect.z1) / 2;
  return Array.from({ length: count }, (_, index) => {
    const offset = -long / 2 + (index + 0.5) * (long / count);
    return alongX ? { x: cx + offset, z: cz, radius } : { x: cx, z: cz + offset, radius };
  });
};

/** Where trees, flowers and grass keep away from the landmarks. */
export const LANDMARK_CLEARINGS: Clearing[] = [
  ...rectClearings(BARN, 2),
  ...rectClearings(HOUSE, 2),
  ...rectClearings(MARKET, 2),
  ...rectClearings({ x0: BRIDGE.x0 - 2, x1: BRIDGE.x1 + 2, z0: BRIDGE.z0, z1: BRIDGE.z1 }, 1.5),
  ...rectClearings({ x0: RACK.x - 0.6, x1: RACK.x + 0.6, z0: RACK.z0, z1: RACK.z1 }, 1),
  { x: TORII.x, z: TORII.z, radius: 5 },
  { x: PAGODA.x, z: PAGODA.z, radius: 11 },
  ...LANTERNS.map(({ x, z }) => ({ x, z, radius: 0.8 })),
  ...BOULDERS.map(({ x, z, radius }) => ({ x, z, radius: radius + 0.4 }))
];

/* ------------------------------------------------------------------ helpers */

const groundRange = (rect: Rect): { low: number; high: number } => {
  let low = Infinity;
  let high = -Infinity;
  for (let x = rect.x0; x <= rect.x1 + 1e-6; x += 0.5) {
    for (let z = rect.z0; z <= rect.z1 + 1e-6; z += 0.5) {
      const height = groundHeight(x, z);
      low = Math.min(low, height);
      high = Math.max(high, height);
    }
  }
  return { low, high };
};

const boxSolid = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number): Solid => ({ x0, x1, y0, y1, z0, z1 });

const columnSolid = (x: number, z: number, radius: number, y0: number, y1: number): Solid => ({
  x0: x - radius,
  x1: x + radius,
  y0,
  y1,
  z0: z - radius,
  z1: z + radius,
  inside: (px, _py, pz) => (px - x) ** 2 + (pz - z) ** 2 < radius * radius
});

/** Solid from the floor to the roof inside the walls; under the eaves only the roof slab itself. */
const roofSolid = (cx: number, cz: number, eaveY: number, spec: RoofSpec, floorY: number): Solid => {
  const profile = roofProfile(spec);
  const hx = spec.width / 2 + spec.eave;
  const hz = spec.depth / 2 + spec.eave;
  return {
    x0: cx - hx,
    x1: cx + hx,
    y0: floorY,
    y1: eaveY + spec.height + (spec.lift ?? 0.55) + 1.2,
    z0: cz - hz,
    z1: cz + hz,
    inside: (x, y, z) => {
      const lx = x - cx;
      const lz = z - cz;
      const at = profile(lx, lz);
      if (!at || y > eaveY + at.top + 0.45) return false;
      if (Math.abs(lx) <= spec.width / 2 && Math.abs(lz) <= spec.depth / 2) return true;
      return y > eaveY + at.under - 0.15;
    }
  };
};

const ellipsoidSolid = (x: number, y: number, z: number, radius: number, squash: number): Solid => ({
  x0: x - radius * 1.15,
  x1: x + radius * 1.15,
  y0: y - radius,
  y1: y + radius * squash * 1.15,
  z0: z - radius * 1.15,
  z1: z + radius * 1.15,
  inside: (px, py, pz) => ((px - x) / (radius * 1.12)) ** 2 + ((py - y) / (radius * squash * 1.12)) ** 2 + ((pz - z) / (radius * 1.12)) ** 2 < 1
});

type LightSpec = { position: THREE.Vector3; intensity: number; color: number };

/** One landmark: its pieces (merged per material), lights, colliders and camera solids. */
class Site {
  readonly parts: Parts;
  readonly world: Frame;
  readonly lights: LightSpec[] = [];
  readonly colliders: Circle[] = [];
  readonly solids: Solid[] = [];

  constructor(readonly name: string, seed: number) {
    this.parts = new Parts(seed);
    this.world = new Frame(this.parts);
  }

  light(position: THREE.Vector3, intensity: number, color: number): void {
    this.lights.push({ position, intensity, color });
  }

  lantern(x: number, z: number, s = 1, base = groundHeight(x, z) - 0.05): void {
    this.light(stoneLantern(this.world.child({ x, y: base, z, ry: Math.atan2(x, z) }), s), 7 * s, 0xff9a4d);
    this.colliders.push({ x, z, radius: 0.5 * s });
    this.solids.push(columnSolid(x, z, 0.55 * s, base - 1, base + 2.65 * s));
  }

  lanterns(group: LanternGroup): void {
    for (const lantern of LANTERNS) if (lantern.group === group) this.lantern(lantern.x, lantern.z);
  }
}

/** Stone base filling a footprint, level on top and reaching below the lowest ground under it. */
const plinth = (site: Site, rect: Rect, top: number, bottom: number): void => {
  const width = rect.x1 - rect.x0;
  const depth = rect.z1 - rect.z0;
  const cx = (rect.x0 + rect.x1) / 2;
  const cz = (rect.z0 + rect.z1) / 2;
  site.world.add("stone", box(width - 0.08, top - 0.12 - bottom, depth - 0.08, { x: cx, y: (top - 0.12 + bottom) / 2, z: cz }), [0.92, 0.9, 0.86], 0.55);
  site.world.add("granite", box(width, 0.14, depth, { x: cx, y: top - 0.07, z: cz }), [0.82, 0.8, 0.76], 0.8);
  site.solids.push(boxSolid(rect.x0, rect.x1, rect.z0, rect.z1, bottom, top));
};

const barrel = (frame: Frame, x: number, y: number, z: number, radius: number, height: number): void => {
  const profile: Array<readonly [number, number]> = [];
  for (let i = 0; i <= 8; i += 1) {
    const t = i / 8;
    profile.push([radius * (0.86 + 0.14 * Math.sin(Math.PI * t)), height * t]);
  }
  frame.add("planks", lathe([[0, 0], ...profile, [0, height]], 14, { x, y, z }), [0.66, 0.5, 0.36]);
  for (const t of [0.12, 0.5, 0.88]) {
    const r = radius * (0.86 + 0.14 * Math.sin(Math.PI * t)) + 0.012;
    frame.add("bamboo", place(new THREE.TorusGeometry(r, 0.022, 4, 18), { rx: Math.PI / 2, x, y: y + height * t, z }), [0.8, 0.75, 0.6]);
  }
};

type Produce = { tint: Tint; radius: number; stretch?: number };
const PRODUCE: ReadonlyArray<Produce> = [
  { tint: [0.6, 0.05, 0.03], radius: 0.075 },
  { tint: [0.95, 0.42, 0.05], radius: 0.085 },
  { tint: [0.15, 0.04, 0.19], radius: 0.065, stretch: 2.3 },
  { tint: [0.4, 0.62, 0.18], radius: 0.15 },
  { tint: [0.92, 0.9, 0.84], radius: 0.055, stretch: 4.5 },
  { tint: [0.86, 0.33, 0.04], radius: 0.07 },
  { tint: [0.72, 0.1, 0.07], radius: 0.08 },
  { tint: [0.16, 0.28, 0.11], radius: 0.19 }
];

/** Wooden crate heaped with one kind of produce, its base at `y`. */
const crate = (frame: Frame, x: number, y: number, z: number, produce: Produce, random: () => number): void => {
  frame.add("planks", box(0.8, 0.2, 0.54, { x, y: y + 0.1, z }), [0.72, 0.6, 0.46], 1.6);
  const stretch = produce.stretch ?? 1;
  const columns = Math.max(1, Math.floor(0.72 / (produce.radius * 2.05 * stretch)));
  const rows = Math.max(1, Math.floor(0.46 / (produce.radius * 2.05)));
  for (let layer = 0; layer < 2; layer += 1) {
    const inset = layer * produce.radius;
    for (let column = 0; column < columns - layer; column += 1) {
      for (let row = 0; row < rows - layer; row += 1) {
        const px = x - 0.36 + inset + ((column + 0.5) * 0.72) / columns + (random() - 0.5) * 0.02;
        const pz = z - 0.23 + inset + ((row + 0.5) * 0.46) / rows + (random() - 0.5) * 0.02;
        const shade = 0.85 + random() * 0.3;
        const piece = place(new THREE.SphereGeometry(produce.radius, 8, 6), {
          s: [stretch, 0.92, 1],
          ry: (random() - 0.5) * 0.5,
          x: px,
          y: y + 0.18 + produce.radius * (0.85 + layer * 1.45),
          z: pz
        });
        frame.add("fruit", piece, [produce.tint[0] * shade, produce.tint[1] * shade, produce.tint[2] * shade]);
      }
    }
  }
};

/* ------------------------------------------------------------------ bridge */

const buildBridge = (): Site => {
  const site = new Site("landmark-bridge", 41);
  const { world } = site;
  const { x0, x1 } = BRIDGE;
  const span = x1 - x0;
  const width = BRIDGE.z1 - BRIDGE.z0;
  const half = width / 2;
  const deck = (x: number): number => bridgeDeckHeight(THREE.MathUtils.clamp(x, x0, x1), BRIDGE_Z) ?? groundHeight(x, BRIDGE_Z);
  const slope = (x: number): number => {
    const a = Math.max(x0, x - 0.05);
    const b = Math.min(x1, x + 0.05);
    return (deck(b) - deck(a)) / (b - a);
  };
  const along = (y: (x: number) => number, z: number): THREE.Vector3[] =>
    Array.from({ length: 41 }, (_, index) => {
      const x = x0 + (index / 40) * span;
      return new THREE.Vector3(x, y(x), z);
    });

  const planks = Math.round(span / 0.28);
  for (let index = 0; index < planks; index += 1) {
    const x = x0 + ((index + 0.5) / planks) * span;
    world.add("planks", box(span / planks - 0.016, 0.1, width - 0.16, { rz: Math.atan(slope(x)), x, y: deck(x) - 0.05, z: BRIDGE_Z }), [0.56 + (index % 3) * 0.05, 0.47, 0.4], 1);
  }

  for (const side of [-1, 1]) {
    const z = BRIDGE_Z + side * (half - 0.1);
    world.add("lacquer", beam(along((x) => deck(x) - 0.27, BRIDGE_Z + side * (half - 0.06)), 0.22, 0.42), WHITE, 1);
    const posts = 16;
    for (let index = 0; index <= posts; index += 1) {
      const x = x0 + (index / posts) * span;
      const y = deck(x);
      world.add("lacquer", box(0.17, 1.15, 0.17, { x, y: y + 0.575, z }), WHITE, 1);
      if (index === 0 || index === posts || index === posts / 2) {
        world.add("bronze", lathe([[0, 0], [0.14, 0], [0.15, 0.08], [0.18, 0.2], [0.12, 0.34], [0.03, 0.46], [0, 0.52]], 12, { x, y: y + 1.15, z }));
      }
    }
    world.add("lacquer", beam(along((x) => deck(x) + 1.05, z), 0.13, 0.11), WHITE, 1);
    world.add("lacquer", beam(along((x) => deck(x) + 0.62, z), 0.09, 0.09), WHITE, 1);
    for (let x = x0 - 0.1; x <= x1 + 0.1 + 1e-6; x += 0.45) site.colliders.push({ x, z, radius: 0.14 });
  }

  for (let pier = 1; pier < 6; pier += 1) {
    const x = x0 + (pier / 6) * span;
    const top = deck(x) - 0.35;
    let bed = Infinity;
    for (const side of [-1, 1]) {
      const z = BRIDGE_Z + side * (half - 0.4);
      const bottom = groundHeight(x, z) - 0.4;
      bed = Math.min(bed, bottom + 0.4);
      if (top - bottom > 0.2) world.add("timber", cylinder(0.17, 0.2, top - bottom, 10, { x, y: (top + bottom) / 2, z }), [0.72, 0.64, 0.56], 0.8);
    }
    world.add("timber", box(0.3, 0.32, width + 0.5, { x, y: top - 0.05, z: BRIDGE_Z }), [0.62, 0.55, 0.48], 1);
    if (top - bed > 1.6) {
      const tie = Math.max(bed, WATER_LEVEL) + 0.55;
      world.add("timber", box(0.2, 0.2, width - 0.6, { x, y: tie, z: BRIDGE_Z }), [0.56, 0.5, 0.44], 1);
      const run = width - 0.9;
      const rise = top - 0.2 - tie;
      world.add("timber", box(0.12, Math.hypot(run, rise), 0.12, { rx: Math.atan2(run, rise), x, y: (top - 0.2 + tie) / 2, z: BRIDGE_Z }), [0.52, 0.46, 0.4], 1);
    }
  }

  for (const [end, outward] of [[x0, -1], [x1, 1]] as const) {
    const top = deck(end) - 0.12;
    const bottom = Math.min(groundHeight(end, BRIDGE_Z), groundHeight(end - outward * 1.5, BRIDGE_Z)) - 1.2;
    world.add("stone", box(2.2, top - bottom, width + 0.3, { x: end - outward * 0.3, y: (top + bottom) / 2, z: BRIDGE_Z }), [0.85, 0.85, 0.82], 0.6);
  }

  site.lanterns("bridge");
  return site;
};

/* ------------------------------------------------------------------ barn */

const buildBarn = (): Site => {
  const site = new Site("landmark-barn", 21);
  const { world } = site;
  const { low, high } = groundRange(BARN);
  const floor = high + 0.45;
  const cx = (BARN.x0 + BARN.x1) / 2;
  const cz = (BARN.z0 + BARN.z1) / 2;
  const width = BARN.x1 - BARN.x0 - 2 * WALL_INSET;
  const depth = BARN.z1 - BARN.z0 - 2 * WALL_INSET;
  const height = 3.4;
  plinth(site, BARN, floor, low - 0.8);

  const barn = world.child({ x: cx, y: floor, z: cz });
  shell(barn, width, depth, height, "mud", {
    front: ["wall", "window", "wall", "door", "door", "window", "wall"],
    back: ["wall", "window", "wall", "wall", "wall", "window", "wall"],
    left: ["wall", "window", "window", "wall"],
    right: ["wall", "lattice", "wall", "wall"]
  }, 0.9);
  const spec: RoofSpec = { width: width + 0.3, depth: depth + 0.3, height: 6.4, eave: 1.7, lift: 0.3, curve: 1.12, thickness: 0.8, res: 0.4, cover: "thatch", fascia: "thatch" };
  const eave = height - roofSeat(spec) - 0.05;
  roof(barn.child({ y: eave }), spec);
  site.solids.push(roofSolid(cx, cz, floor + eave, spec, low - 1));

  const random = createRandom(77);
  const woodX = -width / 2 - WALL_INSET / 2;
  for (let row = 0; row < 9; row += 1) {
    for (let column = 0; column < 34; column += 1) {
      const radius = 0.075 + random() * 0.02;
      const z = -3.2 + column * 0.18 + (row % 2) * 0.09;
      barn.add("planks", cylinder(radius, radius, 0.5 + random() * 0.08, 6, { rz: Math.PI / 2, x: woodX + (random() - 0.5) * 0.06, y: 0.1 + row * 0.165, z }), [0.62 + random() * 0.12, 0.5, 0.36], 3);
    }
  }
  barrel(barn, width / 2 + WALL_INSET / 2, 0, depth / 2 + WALL_INSET / 2, 0.3, 0.72);
  barrel(barn, -width / 2 - WALL_INSET / 2, 0, depth / 2 + WALL_INSET / 2, 0.28, 0.66);

  const bay = width / 7;
  const doorX = -width / 2 + 4 * bay;
  barn.add("granite", box(2 * bay - 0.5, 0.16, 0.5, { x: doorX, y: 0.08, z: depth / 2 + 0.38 }), [0.9, 0.9, 0.88], 0.9);

  const poleZ = depth / 2 + 0.5;
  const poleY = eave + roofProfile(spec)(0, poleZ)!.under - 0.18;
  barn.add("bamboo", cylinder(0.035, 0.035, width - 0.8, 8, { rz: Math.PI / 2, y: poleY, z: poleZ }), WHITE);
  for (let string = 0; string < 12; string += 1) {
    const x = -width / 2 + 0.8 + (string / 11) * (width - 1.6);
    if (Math.abs(x - doorX) < bay + 0.3) continue;
    barn.add("rope", box(0.014, 1.2, 0.014, { x, y: poleY - 0.6, z: poleZ }));
    for (let fruit = 0; fruit < 11; fruit += 1) {
      const shade = 0.75 + random() * 0.3;
      barn.add("fruit", place(new THREE.SphereGeometry(0.055, 7, 5), { s: [1, 0.85, 1], x: x + (random() - 0.5) * 0.03, y: poleY - 0.14 - fruit * 0.098, z: poleZ }), [0.78 * shade, 0.28 * shade, 0.04 * shade]);
    }
  }
  site.light(chochin(barn.child({ x: doorX, y: poleY - 0.04, z: poleZ + 0.02 }), 1), 6, 0xff7a3a);

  const rack = world.child({ x: RACK.x, y: 0, z: 0 });
  const length = RACK.z1 - RACK.z0;
  const ground = (z: number): number => groundHeight(RACK.x, z);
  for (let post = 0; post <= 3; post += 1) {
    const z = RACK.z0 + (post / 3) * length;
    for (const lean of [-1, 1]) rack.add("timber", cylinder(0.05, 0.06, 2.75, 7, { rz: lean * 0.2, x: lean * 0.27, y: ground(z) + 1.28, z }), [0.9, 0.8, 0.68], 1);
  }
  const poles = [1, 1.55, 2.1];
  for (const pole of poles) {
    const y = ground((RACK.z0 + RACK.z1) / 2) + pole;
    rack.add("bamboo", cylinder(0.04, 0.04, length + 0.6, 8, { rx: Math.PI / 2, y, z: (RACK.z0 + RACK.z1) / 2 }), WHITE);
  }
  for (const pole of poles.slice(1)) {
    for (let z = RACK.z0 + 0.15; z < RACK.z1 - 0.1; z += 0.2) {
      const y = ground((RACK.z0 + RACK.z1) / 2) + pole;
      for (const side of [-1, 1]) {
        rack.add("thatch", box(0.1, 0.72 + random() * 0.1, 0.19, { rz: side * (0.1 + random() * 0.06), x: side * 0.07, y: y - 0.34, z: z + (random() - 0.5) * 0.04 }), [1.9, 1.6, 0.9], 2);
      }
    }
  }
  for (let z = RACK.z0; z <= RACK.z1 + 1e-6; z += length / 11) site.colliders.push({ x: RACK.x, z, radius: 0.4 });
  site.solids.push(boxSolid(RACK.x - 0.5, RACK.x + 0.5, RACK.z0 - 0.3, RACK.z1 + 0.3, ground(RACK.z0) - 1, ground(RACK.z0) + 2.6));

  site.lanterns("barn");
  return site;
};

/* ------------------------------------------------------------------ farmhouse */

const buildHouse = (): Site => {
  const site = new Site("landmark-house", 31);
  const { world } = site;
  const { low, high } = groundRange(HOUSE);
  const floor = high + 0.4;
  const cx = (HOUSE.x0 + HOUSE.x1) / 2;
  const cz = (HOUSE.z0 + HOUSE.z1) / 2;
  const halfW = (HOUSE.x1 - HOUSE.x0) / 2;
  const halfD = (HOUSE.z1 - HOUSE.z0) / 2;
  const engawa = 1.5;
  const width = 2 * (halfW - WALL_INSET);
  const front = halfD - engawa;
  const back = -(halfD - WALL_INSET);
  const depth = front - back;
  const height = 2.9;
  plinth(site, HOUSE, floor, low - 0.8);

  // the veranda faces north, toward the road: local +z is world -z
  const house = world.child({ x: cx, y: floor, z: cz, ry: Math.PI });
  shell(house.child({ z: (front + back) / 2 }), width, depth, height, "plaster", {
    front: ["shoji", "shoji", "shoji", "shoji", "shoji", "shoji"],
    back: ["wall", "window", "wall", "wall", "window", "wall"],
    left: ["wall", "window", "wall"],
    right: ["wall", "wall", "window"]
  }, 0.75);

  const roofFront = halfD - 0.3;
  const roofZ = (roofFront + back) / 2;
  const spec: RoofSpec = {
    width: width + 0.3, depth: roofFront - back, height: 4.8, eave: 1.5, lift: 0.3, irimoya: true, gableRatio: 0.55,
    curve: 1.2, thickness: 0.65, res: 0.35, cover: "thatch", fascia: "thatch"
  };
  const eave = height - roofSeat(spec) - 0.05;
  roof(house.child({ y: eave, z: roofZ }), spec);
  site.solids.push(roofSolid(cx, cz - roofZ, floor + eave, spec, low - 1));

  const deckTop = 0.34;
  house.add("planks", box(width + 0.3, 0.08, halfD - front - 0.05, { y: deckTop - 0.04, z: (front + halfD - 0.05) / 2 }), [0.74, 0.62, 0.5], 1.2);
  house.add("timber", box(width + 0.4, 0.2, 0.14, { y: deckTop - 0.12, z: halfD - 0.1 }), [0.72, 0.62, 0.52], 1);
  const posts = 6;
  for (let index = 0; index <= posts; index += 1) {
    const x = -width / 2 + (index / posts) * width;
    house.add("timber", box(0.18, height - deckTop, 0.18, { x, y: deckTop + (height - deckTop) / 2, z: roofFront }), [0.75, 0.66, 0.58], 0.9);
  }
  house.add("timber", box(width + 0.5, 0.26, 0.26, { y: height - 0.13, z: roofFront }), [0.7, 0.6, 0.5], 0.9);
  const gap = eave + roofProfile(spec)(0, front - roofZ)!.under - height;
  if (gap > 0.05) house.add("plaster", box(width, gap + 0.12, 0.12, { y: height + gap / 2 - 0.06, z: front }), [0.95, 0.93, 0.87], 0.45);

  for (const side of [-1, 1]) {
    const x = side * (width / 2 - 0.35);
    house.add("mud", lathe([[0, 0], [0.16, 0], [0.22, 0.2], [0.2, 0.32], [0, 0.32]], 12, { x, y: deckTop, z: halfD - 0.45 }), [0.62, 0.32, 0.2]);
    house.add("fruit", place(new THREE.IcosahedronGeometry(0.3, 1), { s: [1.2, 0.75, 1], x, y: deckTop + 0.55, z: halfD - 0.45 }), [0.08, 0.2, 0.06]);
  }

  const basin = world.child({ x: HOUSE.x1 + 1.2, y: groundHeight(HOUSE.x1 + 1.2, HOUSE.z0 - 0.9) - 0.05, z: HOUSE.z0 - 0.9 });
  basin.add("granite", cylinder(0.42, 0.48, 0.5, 12, { y: 0.25 }), WHITE, 1.4);
  basin.add("black", cylinder(0.33, 0.33, 0.02, 16, { y: 0.47 }));
  basin.add("bamboo", cylinder(0.04, 0.04, 1, 8, { y: 0.5, x: 0.62 }), WHITE);
  basin.add("bamboo", cylinder(0.035, 0.035, 0.75, 8, { rz: Math.PI / 2 + 0.25, x: 0.3, y: 0.92 }), WHITE);
  site.colliders.push({ x: HOUSE.x1 + 1.35, z: HOUSE.z0 - 0.9, radius: 0.65 });

  site.lanterns("house");
  return site;
};

/* ------------------------------------------------------------------ market */

const buildMarket = (): Site => {
  const site = new Site("landmark-market", 61);
  const { world } = site;
  const { low, high } = groundRange(MARKET);
  const floor = high + 0.4;
  const cx = (MARKET.x0 + MARKET.x1) / 2;
  const cz = (MARKET.z0 + MARKET.z1) / 2;
  const halfW = (MARKET.x1 - MARKET.x0) / 2;
  const halfD = (MARKET.z1 - MARKET.z0) / 2;
  const counterBand = 1.1;
  const width = 2 * (halfW - WALL_INSET);
  const front = halfD - counterBand;
  const back = -(halfD - WALL_INSET);
  const depth = front - back;
  const wallsZ = (front + back) / 2;
  const height = 3.6;
  plinth(site, MARKET, floor, low - 0.8);

  const market = world.child({ x: cx, y: floor, z: cz });
  shell(market.child({ z: wallsZ }), width, depth, height, "plaster", {
    front: ["open", "open", "open", "open", "open", "open"],
    back: ["wall", "window", "wall", "wall", "window", "wall"],
    left: ["wall", "lattice", "wall", "wall"],
    right: ["wall", "wall", "lattice", "wall"]
  }, 1.1);
  const spec: RoofSpec = {
    width: width + 0.3, depth: depth + 0.3, height: 4.4, eave: 1.8, lift: 0.8, irimoya: true, gableRatio: 0.5,
    res: 0.3, cover: "tiles", fascia: "timber", rafters: true
  };
  const eave = height - roofSeat(spec) - 0.05;
  roof(market.child({ y: eave, z: wallsZ }), spec);
  site.solids.push(roofSolid(cx, cz + wallsZ, floor + eave, spec, low - 1));

  market.add("planks", box(width - 0.2, 0.06, depth - 0.2, { y: 0.03, z: wallsZ }), [0.6, 0.5, 0.4], 0.9);
  const counterZ = front + counterBand / 2 - 0.05;
  market.add("planks", box(width - 0.8, 0.82, 0.86, { y: 0.41, z: counterZ }), [0.5, 0.4, 0.32], 1.2);
  market.add("planks", box(width - 0.6, 0.06, 0.98, { y: 0.85, z: counterZ }), [0.76, 0.63, 0.5], 1.2);
  const random = createRandom(5);
  const crates = 16;
  for (let index = 0; index < crates; index += 1) {
    const x = -(width - 1.6) / 2 + ((index + 0.5) * (width - 1.6)) / crates;
    crate(market, x, 0.88, counterZ, PRODUCE[index % PRODUCE.length], random);
  }

  const bay = width / 6;
  for (let index = 0; index < 6; index += 1) {
    const x = -width / 2 + (index + 0.5) * bay;
    const cloth = bay - 0.3;
    for (let panel = 0; panel < 3; panel += 1) {
      market.add("noren", box(cloth / 3 - 0.03, 0.55, 0.012, { x: x - cloth / 2 + ((panel + 0.5) * cloth) / 3, y: height - 0.58, z: front + 0.14 }));
    }
    market.add("shide", cylinder(0.13, 0.13, 0.01, 18, { rx: Math.PI / 2, x, y: height - 0.6, z: front + 0.155 }));
  }
  for (const side of [-1, 1]) {
    site.light(chochin(market.child({ x: side * (width / 2 - 0.1), y: height - 0.3, z: front + 0.5 }), 1.15), 6, 0xff6a30);
  }

  for (const shelfY of [1.05, 1.75]) market.add("planks", box(width - 1.2, 0.05, 0.5, { y: shelfY, z: back + 0.4 }), [0.6, 0.5, 0.4], 1.2);
  for (let index = 0; index < 9; index += 1) {
    const x = -width / 2 + 1.1 + index * ((width - 2.2) / 8);
    if (index % 3 === 1) barrel(market, x, 0.06, back + 0.45, 0.32, 0.78);
    else market.add("rope", place(new THREE.SphereGeometry(0.34, 10, 7), { s: [1, 0.62, 0.78], x, y: 0.28, z: back + 0.45 }), [1.3, 1.15, 0.85]);
    market.add("mud", lathe([[0, 0], [0.13, 0], [0.18, 0.14], [0.15, 0.3], [0.07, 0.36], [0, 0.36]], 10, { x: x + 0.3, y: 1.075, z: back + 0.4 }), [0.45, 0.28, 0.2]);
  }
  for (const side of [-1, 1]) barrel(market, side * (width / 2 + WALL_INSET / 2), 0, front - 0.5, 0.28, 0.7);

  site.lanterns("market");
  return site;
};

/* ------------------------------------------------------------------ torii */

const buildTorii = (): Site => {
  const site = new Site("landmark-torii", 51);
  const { world } = site;
  const s = TORII.scale;
  const span = 4.6 * s;
  const height = 5.3 * s;
  const posts = [TORII.z - span / 2, TORII.z + span / 2];
  const base = Math.min(...posts.map((z) => groundHeight(TORII.x, z))) - 0.1;
  const gate = world.child({ x: TORII.x, y: base, z: TORII.z, ry: Math.PI / 2 });
  torii(gate, s);
  const ropeY = height * 0.74 - 0.55 * s;
  shimenawa(world, [gate.point(-span / 2 + 0.32 * s, ropeY, 0), gate.point(span / 2 - 0.32 * s, ropeY, 0)]);
  for (const z of posts) {
    site.colliders.push({ x: TORII.x, z, radius: 0.36 * s + 0.08 });
    site.solids.push(columnSolid(TORII.x, z, 0.36 * s + 0.1, base - 1, base + height));
  }
  const reach = span / 2 + 1.6 * s;
  site.solids.push(boxSolid(TORII.x - 0.45 * s, TORII.x + 0.45 * s, TORII.z - reach, TORII.z + reach, base + height * 0.74 - 0.3 * s, base + height + 0.9 * s));
  site.lanterns("torii");
  return site;
};

/* ------------------------------------------------------------------ boulders */

const buildBoulders = (cluster: number): Site => {
  const site = new Site(`landmark-rocks-${cluster}`, 71 + cluster);
  for (const rock of BOULDERS) {
    if (rock.cluster !== cluster) continue;
    const y = groundHeight(rock.x, rock.z) - rock.radius * rock.squash * 0.3;
    boulder(site.world.child({ x: rock.x, y, z: rock.z, ry: rock.seed }), rock.radius, rock.squash, rock.seed);
    site.solids.push(ellipsoidSolid(rock.x, y, rock.z, rock.radius, rock.squash));
  }
  return site;
};

/* ------------------------------------------------------------------ pagoda */

const buildPagoda = (): Site => {
  const site = new Site("landmark-pagoda", 81);
  const { world } = site;
  const { x, z, half } = PAGODA;
  const rect = { x0: x - half, x1: x + half, z0: z - half, z1: z + half };
  const { low } = groundRange(rect);
  const top = groundHeight(x, z) + 1.1;
  plinth(site, rect, top, low - 0.8);

  const foot = groundHeight(x, rect.z1 + 2);
  const steps = Math.max(3, Math.ceil((top - foot) / 0.24));
  for (let step = 0; step < steps; step += 1) {
    const stepTop = top - ((step + 1) * (top - foot)) / steps;
    const stepZ = rect.z1 + 0.2 + step * 0.4;
    const bottom = groundHeight(x, stepZ) - 0.5;
    if (stepTop > bottom) world.add("stone", box(3.4, stepTop - bottom, 0.42, { x, y: (stepTop + bottom) / 2, z: stepZ }), [0.86, 0.85, 0.82], 0.5);
  }

  const tower = world.child({ x, y: 0, z });
  const plaster: Tint = [0.95, 0.93, 0.87];
  const tips: THREE.Vector3[] = [];
  let y = top;
  for (let tier = 0; tier < 5; tier += 1) {
    const size = 8 - tier * 0.78;
    const storey = tier === 0 ? 3.7 : 2.6;
    const c = size / 2;
    for (const f of [-c, -c / 3, c / 3, c]) {
      for (const d of [-c, c]) {
        tower.add("lacquer", box(0.28, storey, 0.28, { x: f, y: y + storey / 2, z: d }), WHITE, 1);
        tower.add("lacquer", box(0.28, storey, 0.28, { x: d, y: y + storey / 2, z: f }), WHITE, 1);
      }
    }
    for (const side of [-1, 1]) {
      tower.add("plaster", box(size - 0.2, storey - 0.5, 0.12, { y: y + storey / 2 + 0.1, z: side * (c - 0.06) }), plaster, 0.45);
      tower.add("plaster", box(0.12, storey - 0.5, size - 0.2, { x: side * (c - 0.06), y: y + storey / 2 + 0.1 }), plaster, 0.45);
      tower.add("lacquer", box(size + 0.3, 0.26, 0.2, { y: y + storey - 0.2, z: side * c }), WHITE, 1);
      tower.add("lacquer", box(0.2, 0.26, size + 0.3, { x: side * c, y: y + storey - 0.2 }), WHITE, 1);
    }
    if (tier === 0) {
      for (const side of [-1, 1]) {
        const doorWidth = size / 3 - 0.3;
        tower.add(side > 0 ? "paper" : "black", box(doorWidth, storey - 0.9, 0.06, { y: 0.2 + y + (storey - 0.9) / 2, z: side * (c + 0.02) }), [0.95, 0.9, 0.8]);
        for (let bar = 0; bar <= 6; bar += 1) {
          tower.add("lacquer", box(0.05, storey - 0.9, 0.05, { x: -doorWidth / 2 + (bar / 6) * doorWidth, y: 0.2 + y + (storey - 0.9) / 2, z: side * (c + 0.06) }), WHITE);
        }
      }
    } else {
      tower.add("timber", box(size + 1.2, 0.15, size + 1.2, { y: y + 0.05 }), [0.6, 0.48, 0.38], 1);
      for (const side of [-1, 1]) {
        const edge = side * (c + 0.55);
        tower.add("lacquer", box(size + 1.1, 0.08, 0.08, { y: y + 0.7, z: edge }), WHITE, 1);
        tower.add("lacquer", box(0.08, 0.08, size + 1.1, { x: edge, y: y + 0.7 }), WHITE, 1);
        for (let post = 0; post <= 6; post += 1) {
          const p = -c - 0.55 + (post / 6) * (size + 1.1);
          tower.add("lacquer", box(0.08, 0.7, 0.08, { x: p, y: y + 0.4, z: edge }), WHITE, 1);
          tower.add("lacquer", box(0.08, 0.7, 0.08, { x: edge, y: y + 0.4, z: p }), WHITE, 1);
        }
      }
    }
    for (const [bx, bz] of [[-c, -c], [c, -c], [-c, c], [c, c], [0, -c], [0, c], [-c, 0], [c, 0]]) {
      brackets(tower, bx, y + storey - 0.05, bz, "lacquer", [0.85, 0.85, 0.85], 0.62);
    }
    const rise = 1.9 - tier * 0.1;
    const spec: RoofSpec = { width: size + 0.6, depth: size + 0.6, height: rise, eave: 2.6 - tier * 0.14, lift: 0.62 - tier * 0.04, cover: "tiles", fascia: "lacquer", res: 0.4 };
    tips.push(...roof(tower.child({ y: y + storey + 1.05 }), spec).cornerTips);
    y += storey + 1.05 + rise * 0.55;
  }

  tower.add("bronze", box(1.1, 0.5, 1.1, { y: y + 0.25 }));
  tower.add("bronze", cylinder(0.12, 0.14, 8.2, 10, { y: y + 4.4 }));
  tower.add("bronze", place(new THREE.SphereGeometry(0.45, 12, 8), { s: [1, 0.7, 1], y: y + 0.9 }));
  for (let ring = 0; ring < 9; ring += 1) tower.add("bronze", place(new THREE.TorusGeometry(0.46 - ring * 0.012, 0.07, 6, 18), { rx: Math.PI / 2, y: y + 1.6 + ring * 0.55 }));
  for (let plate = 0; plate < 4; plate += 1) tower.add("bronze", box(0.9, 1.1, 0.04, { y: y + 7, ry: (plate * Math.PI) / 4 }));
  tower.add("gold", place(new THREE.SphereGeometry(0.26, 12, 8), { y: y + 8 }));
  tower.add("gold", place(new THREE.ConeGeometry(0.12, 0.4, 8), { y: y + 8.35 }));
  for (const tip of tips) {
    world.add("bronze", cylinder(0.012, 0.012, 0.3, 4, { x: tip.x, y: tip.y - 0.15, z: tip.z }));
    world.add("bronze", lathe([[0, 0], [0.1, 0], [0.09, 0.08], [0.07, 0.2], [0, 0.24]], 8, { x: tip.x, y: tip.y - 0.54, z: tip.z }));
  }
  site.solids.push(columnSolid(x, z, 6.5, top, y + 8.6));

  for (const side of [-1, 1]) site.lantern(x + side * 3.4, rect.z1 - 1.2, 1.1, top);
  return site;
};

/* ------------------------------------------------------------------ assembly */

export const createLandmarks = (options: LandmarkOptions = {}): Landmarks => {
  const materials = options.materials ?? archMaterials();
  const sites = [buildBridge(), buildBarn(), buildHouse(), buildMarket(), buildTorii(), buildBoulders(0), buildBoulders(1), buildPagoda()];
  const root = new THREE.Group();
  root.name = "landmarks";
  const meshes: THREE.Mesh[] = [];
  const lamps: Array<{ lamp: Lamp; base: number; phase: number }> = [];
  const colliders: Circle[] = [];
  const solids: Solid[] = [];
  sites.forEach((site, index) => {
    const group = new THREE.Group();
    group.name = site.name;
    root.add(group);
    meshes.push(...site.parts.build(materials, group, site.name));
    site.lights.forEach((light, order) => {
      lamps.push({ lamp: addLamp(light.position, light.intensity, light.color), base: light.intensity, phase: index * 7.1 + order * 2.3 });
    });
    colliders.push(...site.colliders);
    solids.push(...site.solids);
  });

  const solid = (x: number, y: number, z: number): boolean => {
    for (const shape of solids) {
      if (x < shape.x0 || x > shape.x1 || z < shape.z0 || z > shape.z1 || y < shape.y0 || y > shape.y1) continue;
      if (!shape.inside || shape.inside(x, y, z)) return true;
    }
    return false;
  };

  const update = (time: number): void => {
    for (const entry of lamps) {
      entry.lamp.intensity = entry.base * (0.92 + 0.05 * Math.sin(time * 7.3 + entry.phase) + 0.03 * Math.sin(time * 17.9 + entry.phase * 1.7));
    }
  };

  const dispose = (): void => {
    lamps.forEach(({ lamp }) => removeLamp(lamp));
    meshes.forEach((mesh) => mesh.geometry.dispose());
    root.removeFromParent();
  };

  return { root, colliders, solid, update, dispose };
};
