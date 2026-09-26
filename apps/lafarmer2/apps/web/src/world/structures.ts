import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  archMaterials,
  beam,
  boulder,
  box,
  chochin,
  cylinder,
  lathe,
  place,
  rod,
  roof,
  roofProfile,
  roofSeat,
  shell,
  shimenawa,
  type ArchMaterials,
  type Bay,
  type Frame,
  type RoofSpec,
  type Tint
} from "./architecture";
import type { Pen } from "./creatures";
import { clearBareSpots, clearTilledTiles, setBareSpots, setTilledTiles, type BareSpot } from "./groundMask";
import { createRandom, groundHeight, hashString, tileToWorldX, tileToWorldZ } from "./height";
import { addLamp, after, removeLamp, withGlobals, type Lamp } from "./shared";
import { Site, WALL_INSET, boxSolid, columnSolid, flicker, groundRange, plinth, roofSolid, solidTest, type Rect } from "./sites";

/*
 * What players build on their farm, drawn inside the footprint the server gave it: a vegetable
 * field behind a bamboo lattice fence (yotsume-gaki) with a scarecrow, an orchard with a low
 * bamboo fence, a ladder and baskets, a cattle pen with a thatched lean-to and a water trough,
 * a log palisade around the dinosaurs with a pond and a roped gate, and a small farmhouse.
 * The owner cannot step onto its own footprint (the server blocks it), so fences stand just
 * inside the edge and nothing needs a collider; the camera stops at walls, roofs and palisades.
 */

export type StructureType = "house" | "field" | "orchard" | "animal_pen" | "dinosaur_enclosure";

export const STRUCTURE_NAMES: Record<StructureType, string> = {
  house: "Casa",
  field: "Campo",
  orchard: "Pomar",
  animal_pen: "Curral",
  dinosaur_enclosure: "Recinto dos dinossauros"
};

export const isStructureType = (value: string): value is StructureType => Object.hasOwn(STRUCTURE_NAMES, value);

/** Tiles covered by a footprint: [x0, x1) × [y0, y1), as the server counts them. */
export type TileRect = { x0: number; y0: number; x1: number; y1: number };

export const footprintTiles = (footprint: ReadonlyArray<readonly [number, number]>): TileRect => {
  const xs = footprint.map(([x]) => x);
  const ys = footprint.map(([, y]) => y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
};

export const insideTiles = (tiles: TileRect, x: number, y: number): boolean => x >= tiles.x0 && x < tiles.x1 && y >= tiles.y0 && y < tiles.y1;

/** The world rectangle the tiles cover; tile centres sit on integer tile coordinates. */
export const tilesToWorld = (tiles: TileRect): Rect => ({
  x0: tileToWorldX(tiles.x0 - 0.5),
  x1: tileToWorldX(tiles.x1 - 0.5),
  z0: tileToWorldZ(tiles.y0 - 0.5),
  z1: tileToWorldZ(tiles.y1 - 0.5)
});

export type Structure = {
  readonly type: StructureType;
  readonly root: THREE.Group;
  readonly tiles: TileRect;
  /** Where its animals roam, in world units. */
  readonly pen: Pen;
  /** True inside a wall, roof or palisade, for the camera arm. */
  readonly solid: (x: number, y: number, z: number) => boolean;
  update: (time: number) => void;
  dispose: () => void;
};

export type StructureOptions = {
  /** Replaces the textured materials (tests have no images). */
  materials?: ArchMaterials;
};

const TAU = Math.PI * 2;
const v3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const tone = (tint: Tint, factor: number): Tint => [tint[0] * factor, tint[1] * factor, tint[2] * factor];

const BAMBOO: Tint = [1.1, 1.04, 0.86];
/** Weathered cedar on the dark timber material. */
const POST: Tint = [2.5, 2.25, 2];
const BEAM: Tint = [2.4, 2.25, 2.1];
/** Grey bark of unpeeled logs, and the pale wood where their points were cut. */
const LOG: Tint = [1.45, 1.55, 1.75];
const CUT: Tint = [0.66, 0.66, 0.7];
const RAIL: Tint = [0.8, 0.74, 0.66];
const HAY: Tint = [1.9, 1.62, 0.95];
/** Black palm-fibre rope (shuro-nawa) on the rope material. */
const TIE: Tint = [0.16, 0.13, 0.12];
const ORANGE: Tint = [0.95, 0.42, 0.05];

type Build = {
  readonly site: Site;
  readonly rect: Rect;
  readonly tiles: TileRect;
  readonly random: () => number;
  readonly waters: THREE.BufferGeometry[];
  readonly spots: BareSpot[];
  readonly tilled: Array<[number, number]>;
  pen: Pen;
};

const shrink = (rect: Rect, west: number, east = west, north = west, south = west): Rect => ({
  x0: rect.x0 + west,
  x1: rect.x1 - east,
  z0: rect.z0 + north,
  z1: rect.z1 - south
});

const allTiles = (tiles: TileRect): Array<[number, number]> => {
  const list: Array<[number, number]> = [];
  for (let y = tiles.y0; y < tiles.y1; y += 1) for (let x = tiles.x0; x < tiles.x1; x += 1) list.push([x, y]);
  return list;
};

/** Scales the 0..1 UVs of a cylinder: `around` whole turns of the texture keep its seam hidden. */
const wrapUV = (geometry: THREE.BufferGeometry, around: number, along: number): THREE.BufferGeometry => {
  const uv = geometry.getAttribute("uv");
  for (let index = 0; index < uv.count; index += 1) uv.setXY(index, uv.getX(index) * around, uv.getY(index) * along);
  return geometry;
};

/** A bamboo cane or log from `a` to `b` whose texture keeps its size along the length. */
const pole = (a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, sides = 6, wrap = 0.035, repeat = 0.4): THREE.BufferGeometry =>
  wrapUV(rod(a, b, r0, r1, sides), wrap, a.distanceTo(b) * repeat);

/** Bark repeats about every 1.1 m along a log. */
const BARK_REPEAT = 1 / 1.1;

/** Upright log centred at `y`, turned by `spin` so neighbours do not share their facets. */
const log = (radius: number, length: number, x: number, y: number, z: number, spin: number, sides = 8): THREE.BufferGeometry =>
  wrapUV(cylinder(radius * 0.96, radius, length, sides, { x, y, z, ry: spin }), radius > 0.2 ? 2 : 1, length * BARK_REPEAT);

/** Water surfaces are merged into one mesh, so they keep only positions and normals. */
const addWater = (build: Build, geometry: THREE.BufferGeometry): void => {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  if (flat !== geometry) geometry.dispose();
  for (const name of Object.keys(flat.attributes)) if (name !== "position" && name !== "normal") flat.deleteAttribute(name);
  if (!flat.getAttribute("normal")) flat.computeVertexNormals();
  build.waters.push(flat);
};

let stillWater: THREE.MeshStandardMaterial | undefined;

/** Dark, glassy water for ponds and troughs, stirred by a faint breeze. */
const stillWaterMaterial = (): THREE.MeshStandardMaterial =>
  (stillWater ??= withGlobals(new THREE.MeshStandardMaterial({ color: 0x122b27, roughness: 0.04, metalness: 0 }), "still-water", (shader) => {
    shader.fragmentShader = after(shader.fragmentShader, "normal_fragment_maps", /* glsl */ `
      #ifdef USE_FOG
      {
        vec2 p = vFogWP.xz;
        vec2 flow = vec2(uTime * 0.23, uTime * 0.17);
        float h0 = vnoise(p * 2.6 + flow) + 0.5 * vnoise(p * 6.1 - flow * 1.7);
        float hx = vnoise((p + vec2(0.05, 0.0)) * 2.6 + flow) + 0.5 * vnoise((p + vec2(0.05, 0.0)) * 6.1 - flow * 1.7);
        float hz = vnoise((p + vec2(0.0, 0.05)) * 2.6 + flow) + 0.5 * vnoise((p + vec2(0.0, 0.05)) * 6.1 - flow * 1.7);
        vec3 ripple = normalize(vec3((h0 - hx) * 0.7, 1.0, (h0 - hz) * 0.7));
        normal = normalize((viewMatrix * vec4(ripple, 0.0)).xyz);
      }
      #endif`);
  }));

/* ------------------------------------------------------------------ fence lines */

/** A straight stretch of fence; its inside lies toward (-dz, dx). */
type Run = { ax: number; az: number; bx: number; bz: number };

const runAxes = (run: Run): { length: number; dx: number; dz: number; nx: number; nz: number; yaw: number } => {
  const length = Math.hypot(run.bx - run.ax, run.bz - run.az);
  const dx = (run.bx - run.ax) / length;
  const dz = (run.bz - run.az) / length;
  return { length, dx, dz, nx: -dz, nz: dx, yaw: Math.atan2(-dz, dx) };
};

/** Evenly spaced points along a run, about `spacing` apart, both ends included. */
const stations = (run: Run, spacing: number): Array<{ x: number; z: number }> => {
  const count = Math.max(1, Math.round(runAxes(run).length / spacing));
  return Array.from({ length: count + 1 }, (_, index) => {
    const t = index / count;
    return { x: run.ax + (run.bx - run.ax) * t, z: run.az + (run.bz - run.az) * t };
  });
};

/** The sides of `rect` shrunk by `inset`, clockwise on the map, with the gate gap centred on the south side. */
const fenceLine = (rect: Rect, inset: number, gateWidth: number): { runs: Run[]; gate: Run } => {
  const x0 = rect.x0 + inset;
  const x1 = rect.x1 - inset;
  const z0 = rect.z0 + inset;
  const z1 = rect.z1 - inset;
  const cx = (x0 + x1) / 2;
  const gate = { ax: cx + gateWidth / 2, az: z1, bx: cx - gateWidth / 2, bz: z1 };
  return {
    runs: [
      { ax: x0, az: z0, bx: x1, bz: z0 },
      { ax: x1, az: z0, bx: x1, bz: z1 },
      { ax: x1, az: z1, bx: gate.ax, bz: z1 },
      { ax: gate.bx, az: z1, bx: x0, bz: z1 },
      { ax: x0, az: z1, bx: x0, bz: z0 }
    ],
    gate
  };
};

/** A frame on the middle of a run: +x along it, +z toward the inside, its origin on the ground. */
const runFrame = (site: Site, run: Run): Frame => {
  const x = (run.ax + run.bx) / 2;
  const z = (run.az + run.bz) / 2;
  return site.world.child({ x, y: groundHeight(x, z), z, ry: runAxes(run).yaw });
};

const LATTICE_RAILS = [0.3, 0.6, 0.9];
const LATTICE_TOP = 1.02;

/** Yotsume-gaki: cedar posts, three bamboo rails and canes alternating in front of and behind them, tied in black. */
const latticeFence = (build: Build, runs: readonly Run[]): void => {
  const { site, random } = build;
  const { world } = site;
  const plane = 0.075;
  for (const run of runs) {
    const { length, dx, dz, nx, nz, yaw } = runAxes(run);
    const posts = stations(run, 1.8);
    for (const post of posts) {
      const y = groundHeight(post.x, post.z);
      world.add("timber", cylinder(0.048, 0.055, LATTICE_TOP + 0.26, 7, { x: post.x, y: y - 0.2 + (LATTICE_TOP + 0.26) / 2, z: post.z }), tone(POST, 0.9 + random() * 0.2), 1.2);
      for (const height of LATTICE_RAILS) {
        world.add("rope", box(0.13, 0.05, 0.16, { x: post.x - nx * plane * 0.5, y: y + height, z: post.z - nz * plane * 0.5, ry: yaw }), TIE);
      }
    }
    for (let index = 0; index < posts.length - 1; index += 1) {
      const a = posts[index];
      const b = posts[index + 1];
      const ya = groundHeight(a.x, a.z);
      const yb = groundHeight(b.x, b.z);
      for (const height of LATTICE_RAILS) {
        const from = v3(a.x - nx * plane - dx * 0.06, ya + height, a.z - nz * plane - dz * 0.06);
        const to = v3(b.x - nx * plane + dx * 0.06, yb + height, b.z - nz * plane + dz * 0.06);
        world.add("bamboo", pole(from, to, 0.021, 0.019), tone(BAMBOO, 0.92 + random() * 0.14));
      }
    }
    const canes = Math.max(2, Math.round(length / 0.2));
    for (let index = 1; index < canes; index += 1) {
      const t = (index / canes) * length;
      const x = run.ax + dx * t;
      const z = run.az + dz * t;
      if (posts.some((post) => Math.hypot(post.x - x, post.z - z) < 0.1)) continue;
      const offset = plane + (index % 2 ? 0.04 : -0.04);
      const cx = x - nx * offset;
      const cz = z - nz * offset;
      const y = groundHeight(cx, cz);
      world.add("bamboo", pole(v3(cx, y - 0.1, cz), v3(cx, y + LATTICE_TOP - 0.04 + random() * 0.05, cz), 0.017, 0.015, 5), tone(BAMBOO, 0.85 + random() * 0.25));
      const ground = groundHeight(x, z);
      for (const height of LATTICE_RAILS) world.add("rope", box(0.04, 0.032, 0.11, { x: x - nx * plane, y: ground + height, z: z - nz * plane, ry: yaw }), TIE);
    }
  }
};

/** Bamboo gate of the field: stouter posts and a door of diagonal lattice, left ajar. */
const bambooGate = (build: Build, gate: Run): void => {
  const { site, random } = build;
  const { length } = runAxes(gate);
  const frame = runFrame(site, gate);
  for (const side of [-1, 1]) frame.add("timber", cylinder(0.066, 0.072, 1.62, 8, { x: side * (length / 2), y: 0.61 }), POST, 1.2);
  const width = length - 0.16;
  const door = frame.child({ x: length / 2 - 0.08, z: 0.02, ry: 0.55 });
  const x0 = -width;
  const x1 = 0;
  const y0 = 0.1;
  const y1 = 1.12;
  for (const x of [x0 + 0.02, x1 - 0.02]) door.add("bamboo", pole(v3(x, y0 - 0.02, 0), v3(x, y1 + 0.03, 0), 0.024, 0.022), BAMBOO);
  for (const y of [y0, (y0 + y1) / 2, y1]) door.add("bamboo", pole(v3(x0, y, 0), v3(x1, y, 0), 0.02, 0.02), BAMBOO);
  for (const slope of [1, -1]) {
    const [low, high] = slope > 0 ? [y0 - x1, y1 - x0] : [y0 + x0, y1 + x1];
    for (let c = low + 0.1; c < high; c += 0.2) {
      const start = slope > 0 ? Math.max(x0, y0 - c) : Math.max(x0, c - y1);
      const end = slope > 0 ? Math.min(x1, y1 - c) : Math.min(x1, c - y0);
      if (end - start < 0.06) continue;
      const z = slope * 0.016;
      door.add("bamboo", pole(v3(start, slope * start + c, z), v3(end, slope * end + c, z), 0.012, 0.012, 5), tone(BAMBOO, 0.9 + random() * 0.15));
    }
  }
};

/** Low bamboo fence of the orchard: cane posts every 2.4 units and two rails tied in black. */
const bambooRailFence = (build: Build, runs: readonly Run[]): void => {
  const { site, random } = build;
  const { world } = site;
  for (const run of runs) {
    const { dx, dz, nx, nz, yaw } = runAxes(run);
    const posts = stations(run, 2.4);
    for (const post of posts) {
      const y = groundHeight(post.x, post.z);
      world.add("bamboo", pole(v3(post.x, y - 0.2, post.z), v3(post.x, y + 0.86, post.z), 0.042, 0.038, 7), tone(BAMBOO, 0.9 + random() * 0.15));
      for (const height of [0.4, 0.76]) world.add("rope", box(0.12, 0.05, 0.15, { x: post.x - nx * 0.035, y: y + height, z: post.z - nz * 0.035, ry: yaw }), TIE);
    }
    for (let index = 0; index < posts.length - 1; index += 1) {
      const a = posts[index];
      const b = posts[index + 1];
      const ya = groundHeight(a.x, a.z);
      const yb = groundHeight(b.x, b.z);
      for (const height of [0.4, 0.76]) {
        const from = v3(a.x - nx * 0.065 - dx * 0.1, ya + height, a.z - nz * 0.065 - dz * 0.1);
        const to = v3(b.x - nx * 0.065 + dx * 0.1, yb + height, b.z - nz * 0.065 + dz * 0.1);
        world.add("bamboo", pole(from, to, 0.028, 0.025), tone(BAMBOO, 0.9 + random() * 0.15));
      }
    }
  }
};

/** Open gateway of the orchard: two tall canes with a crossbar lashed on top. */
const bambooArch = (build: Build, gate: Run): void => {
  const { length } = runAxes(gate);
  const frame = runFrame(build.site, gate);
  const half = length / 2;
  for (const side of [-1, 1]) {
    frame.add("bamboo", pole(v3(side * half, -0.25, 0), v3(side * half, 1.72, 0), 0.052, 0.046, 8), BAMBOO);
    frame.add("rope", box(0.14, 0.09, 0.14, { x: side * half, y: 1.55 }), TIE);
  }
  frame.add("bamboo", pole(v3(-half - 0.35, 1.55, -0.06), v3(half + 0.35, 1.58, -0.06), 0.036, 0.034, 7), BAMBOO);
  frame.add("bamboo", pole(v3(-half - 0.2, 1.3, -0.06), v3(half + 0.2, 1.3, -0.06), 0.026, 0.026, 6), BAMBOO);
};

/** Cattle fence: sawn posts every 2.3 units with three plank rails nailed on the outside. */
const railFence = (build: Build, runs: readonly Run[]): void => {
  const { site, random } = build;
  const { world } = site;
  for (const run of runs) {
    const { dx, dz, nx, nz, yaw } = runAxes(run);
    const posts = stations(run, 2.3);
    for (const post of posts) {
      const y = groundHeight(post.x, post.z);
      world.add("timber", box(0.15, 1.55, 0.15, { x: post.x, y: y + 1.55 / 2 - 0.3, z: post.z, ry: yaw + (random() - 0.5) * 0.12 }), tone(POST, 0.85 + random() * 0.3), 1.1);
    }
    for (let index = 0; index < posts.length - 1; index += 1) {
      const a = posts[index];
      const b = posts[index + 1];
      const ya = groundHeight(a.x, a.z);
      const yb = groundHeight(b.x, b.z);
      for (const height of [0.4, 0.75, 1.1]) {
        const sag = (random() - 0.5) * 0.03;
        const from = v3(a.x - nx * 0.1 - dx * 0.08, ya + height + sag, a.z - nz * 0.1 - dz * 0.08);
        const to = v3(b.x - nx * 0.1 + dx * 0.08, yb + height - sag, b.z - nz * 0.1 + dz * 0.08);
        world.add("planks", beam([from, to], 0.05, 0.14), tone(RAIL, 0.85 + random() * 0.3), 1.1);
      }
    }
  }
};

/** Five-bar gate of the cattle pen, shut, hung on stouter posts. */
const barGate = (build: Build, gate: Run): void => {
  const { length } = runAxes(gate);
  const frame = runFrame(build.site, gate);
  for (const side of [-1, 1]) frame.add("timber", box(0.2, 1.75, 0.2, { x: side * (length / 2 + 0.02), y: 1.75 / 2 - 0.3 }), POST, 1.1);
  const width = length - 0.26;
  const door = frame.child({ x: length / 2 - 0.12, z: -0.04 });
  door.add("planks", box(0.09, 1.2, 0.07, { x: -0.045, y: 0.72 }), RAIL, 1.2);
  door.add("planks", box(0.09, 1.2, 0.07, { x: -width + 0.045, y: 0.72 }), RAIL, 1.2);
  for (let bar = 0; bar < 5; bar += 1) door.add("planks", box(width, 0.1, 0.045, { x: -width / 2, y: 0.2 + bar * 0.24 }), tone(RAIL, 0.95 + bar * 0.02), 1.2);
  door.add("planks", beam([v3(-0.1, 0.22, 0.045), v3(-width + 0.1, 1.14, 0.045)], 0.04, 0.1), RAIL, 1.2);
  door.add("black", box(0.05, 0.14, 0.1, { x: -width + 0.02, y: 0.9 }));
};

const PALISADE_HEIGHT = 1.95;

/** Stockade of sharpened logs lashed with rope outside and bound by two rails inside. */
const palisade = (build: Build, runs: readonly Run[]): void => {
  const { site, random } = build;
  const { world } = site;
  for (const run of runs) {
    const { length, dx, dz, nx, nz } = runAxes(run);
    const count = Math.max(1, Math.round(length / 0.3));
    let low = Infinity;
    let high = -Infinity;
    for (let index = 0; index <= count; index += 1) {
      const t = (index / count) * length;
      const x = run.ax + dx * t;
      const z = run.az + dz * t;
      const y = groundHeight(x, z);
      low = Math.min(low, y);
      high = Math.max(high, y);
      const radius = 0.13 + random() * 0.035;
      const height = PALISADE_HEIGHT + (random() - 0.5) * 0.3;
      const spin = random() * TAU;
      world.add("bark", log(radius, height + 0.3, x, y - 0.3 + (height + 0.3) / 2, z, spin), tone(LOG, 0.75 + random() * 0.45));
      world.add("planks", cylinder(0.02, radius * 0.96, 0.32, 8, { x, y: y + height + 0.16, z, ry: spin }), tone(CUT, 0.8 + random() * 0.35), 1.6);
    }
    const rails = stations(run, 3);
    for (let index = 0; index < rails.length - 1; index += 1) {
      const a = rails[index];
      const b = rails[index + 1];
      const ya = groundHeight(a.x, a.z);
      const yb = groundHeight(b.x, b.z);
      for (const height of [0.55, 1.45]) {
        world.add("bark", pole(v3(a.x + nx * 0.25 - dx * 0.05, ya + height, a.z + nz * 0.25 - dz * 0.05), v3(b.x + nx * 0.25 + dx * 0.05, yb + height, b.z + nz * 0.25 + dz * 0.05), 0.085, 0.08, 7, 1, BARK_REPEAT), tone(LOG, 0.8));
        world.add("rope", pole(v3(a.x - nx * 0.165, ya + height, a.z - nz * 0.165), v3(b.x - nx * 0.165, yb + height, b.z - nz * 0.165), 0.03, 0.03, 5, 1, 2), [0.95, 0.84, 0.66]);
      }
    }
    const xs = [run.ax, run.bx];
    const zs = [run.az, run.bz];
    site.solids.push(boxSolid(Math.min(...xs) - 0.3, Math.max(...xs) + 0.3, Math.min(...zs) - 0.3, Math.max(...zs) + 0.3, low - 1, high + PALISADE_HEIGHT + 0.3));
  }
};

/** Tall gate of the palisade: log posts, a double lintel with a sacred rope and two paper lanterns; the doors stand shut. */
const palisadeGate = (build: Build, gate: Run): void => {
  const { site, random } = build;
  const { length, dx, dz } = runAxes(gate);
  const frame = runFrame(site, gate);
  const half = length / 2 + 0.1;
  const postTop = 3.7;
  const lintel = 3.2;
  for (const side of [-1, 1]) frame.add("bark", log(0.25, postTop + 0.4, side * half, postTop / 2 - 0.2, 0, side, 10), LOG);
  frame.add("bark", pole(v3(-half - 0.6, lintel, 0), v3(half + 0.6, lintel, 0), 0.19, 0.19, 10, 1, BARK_REPEAT), tone(LOG, 0.9));
  const reach = half + 1.1;
  const crown = Array.from({ length: 13 }, (_, index) => {
    const x = (-1 + index / 6) * reach;
    return v3(x, postTop + 0.08 + Math.pow(Math.abs(x) / reach, 2.2) * 0.28, 0);
  });
  frame.add("timber", beam(crown, 0.44, 0.3), BEAM, 0.8);
  frame.add("thatch", beam(crown.map((point) => point.clone().add(v3(0, 0.26, 0))), 0.62, 0.22), tone(HAY, 0.62), 0.8);
  shimenawa(frame, [v3(-half + 0.26, lintel - 0.2, -0.05), v3(half - 0.26, lintel - 0.2, -0.05)]);
  for (const side of [-1, 1]) {
    const x = side * (half - 0.75);
    frame.add("black", box(0.04, 0.04, 0.26, { x, y: lintel - 0.05, z: -0.18 }));
    frame.add("black", box(0.02, 0.28, 0.02, { x, y: lintel - 0.19, z: -0.3 }));
    site.light(chochin(frame.child({ x, y: lintel - 0.33, z: -0.3 }), 1), 6, 0xff7a3a);
  }
  const leaf = length / 2 - 0.12;
  const logs = Math.max(2, Math.round(leaf / 0.2));
  for (const side of [-1, 1]) {
    for (let index = 0; index < logs; index += 1) {
      const x = side * (0.06 + (index + 0.5) * (leaf / logs));
      const height = 2.35 + (random() - 0.5) * 0.08;
      const spin = random() * TAU;
      frame.add("bark", log(0.1, height, x, height / 2 + 0.05, 0, spin), tone(LOG, 0.8 + random() * 0.35));
      frame.add("planks", cylinder(0.015, 0.096, 0.2, 8, { x, y: height + 0.15, ry: spin }), tone(CUT, 0.85 + random() * 0.3), 1.6);
    }
    for (const y of [0.5, 1.8]) frame.add("planks", box(leaf, 0.16, 0.06, { x: side * (0.06 + leaf / 2), y, z: 0.13 }), RAIL, 1);
    for (const y of [0.7, 1.6]) frame.add("black", box(leaf, 0.07, 0.02, { x: side * (0.06 + leaf / 2), y, z: -0.108 }));
  }
  const cx = (gate.ax + gate.bx) / 2;
  const cz = (gate.az + gate.bz) / 2;
  const base = groundHeight(cx, cz);
  for (const side of [-1, 1]) site.solids.push(columnSolid(cx + dx * side * half, cz + dz * side * half, 0.35, base - 1, base + postTop + 0.6));
  site.solids.push(boxSolid(cx - Math.abs(dx) * reach - 0.35, cx + Math.abs(dx) * reach + 0.35, cz - Math.abs(dz) * reach - 0.35, cz + Math.abs(dz) * reach + 0.35, base - 1, base + postTop + 0.7));
};

/* ------------------------------------------------------------------ props */

/** Plank or stone trough full of water, its long side along `yaw`. */
const trough = (build: Build, x: number, z: number, yaw: number, spec: { length: number; width: number; height: number; wall: number; key: "planks" | "granite"; tint: Tint }): void => {
  const { length, width, height, wall, key, tint } = spec;
  const frame = build.site.world.child({ x, y: groundHeight(x, z) - 0.04, z, ry: yaw });
  frame.add(key, box(length, wall, width, { y: 0.06 + wall / 2 }), tint, 1.4);
  for (const side of [-1, 1]) {
    frame.add(key, box(length, height, wall, { y: height / 2, z: side * (width / 2 - wall / 2) }), tint, 1.4);
    frame.add(key, box(wall, height, width - 2 * wall, { x: side * (length / 2 - wall / 2), y: height / 2 }), tint, 1.4);
    if (key === "planks") frame.add("timber", box(0.1, 0.14, width + 0.16, { x: side * (length / 2 - 0.3), y: 0.07 }), POST, 1.2);
  }
  const surface = place(new THREE.PlaneGeometry(length - 2 * wall, width - 2 * wall), { rx: -Math.PI / 2, y: height - 0.07 });
  addWater(build, surface.applyMatrix4(frame.matrix));
};

/** A still pond ringed with mossy stones, its level just above the ground inside it. */
const pond = (build: Build, cx: number, cz: number, radius: number): void => {
  const { site, random } = build;
  const phase = [random() * TAU, random() * TAU];
  const reach = (angle: number): number => radius * (1 + 0.15 * Math.sin(3 * angle + phase[0]) + 0.08 * Math.sin(5 * angle + phase[1]));
  const segments = 40;
  const rim = Array.from({ length: segments }, (_, index) => {
    const angle = (index / segments) * TAU;
    const r = reach(angle);
    return { x: cx + Math.cos(angle) * r, z: cz + Math.sin(angle) * r };
  });
  let level = groundHeight(cx, cz);
  for (const point of rim) level = Math.max(level, groundHeight(cx + (point.x - cx) * 0.6, cz + (point.z - cz) * 0.6));
  level += 0.04;

  const surface: number[] = [];
  const bank: number[] = [];
  for (let index = 0; index < segments; index += 1) {
    const a = rim[index];
    const b = rim[(index + 1) % segments];
    surface.push(cx, level, cz, b.x, level, b.z, a.x, level, a.z);
    const top = level + 0.015;
    const ya = groundHeight(a.x, a.z) - 0.08;
    const yb = groundHeight(b.x, b.z) - 0.08;
    bank.push(a.x, top, a.z, b.x, top, b.z, a.x, ya, a.z, b.x, top, b.z, b.x, yb, b.z, a.x, ya, a.z);
  }
  const water = new THREE.BufferGeometry();
  water.setAttribute("position", new THREE.Float32BufferAttribute(surface, 3));
  addWater(build, water);
  const lip = new THREE.BufferGeometry();
  lip.setAttribute("position", new THREE.Float32BufferAttribute(bank, 3));
  lip.computeVertexNormals();
  site.world.add("rock", lip, [0.7, 0.72, 0.66], 1.2);

  const stones = 11;
  for (let index = 0; index < stones; index += 1) {
    const angle = (index / stones) * TAU + (random() - 0.5) * 0.35;
    const size = 0.26 + random() * 0.42;
    const squash = 0.5 + random() * 0.25;
    const r = reach(angle) + 0.08 + size * 0.2;
    const x = cx + Math.cos(angle) * r;
    const z = cz + Math.sin(angle) * r;
    boulder(site.world.child({ x, y: groundHeight(x, z) - size * squash * 0.35, z, ry: random() * TAU }), size, squash, Math.floor(random() * 1e6));
  }
  build.spots.push({ x: cx, z: cz, radius: radius * 1.25 + 1.4, dirt: true });
};

/** Kakashi: a post and crossbar dressed in an indigo jacket, a cloth face and a sedge hat. */
const scarecrow = (build: Build, x: number, z: number, facing: number): void => {
  const frame = build.site.world.child({ x, y: groundHeight(x, z) - 0.25, z, ry: facing });
  frame.add("timber", cylinder(0.035, 0.045, 2.1, 6, { y: 1.05 }), POST, 1.5);
  frame.add("bamboo", pole(v3(-0.78, 1.72, 0), v3(0.78, 1.72, 0), 0.024, 0.022), BAMBOO);
  frame.add("noren", cylinder(0.2, 0.27, 0.72, 10, { y: 1.46 }), [1.4, 1.5, 1.8]);
  for (const side of [-1, 1]) {
    frame.add("noren", cylinder(0.1, 0.125, 0.62, 8, { rz: Math.PI / 2, x: side * 0.42, y: 1.72 }), [1.4, 1.5, 1.8]);
    frame.add("thatch", cylinder(0.02, 0.09, 0.26, 7, { rz: side * Math.PI / 2, x: side * 0.84, y: 1.72 }), HAY, 2);
  }
  frame.add("rope", cylinder(0.275, 0.275, 0.07, 10, { y: 1.2 }), [1.3, 0.25, 0.2]);
  frame.add("thatch", cylinder(0.25, 0.37, 0.44, 10, { y: 0.93 }), HAY, 2);
  frame.add("shide", place(new THREE.SphereGeometry(0.16, 12, 9), { y: 2.02 }));
  for (const side of [-1, 1]) frame.add("black", box(0.035, 0.014, 0.01, { x: side * 0.055, y: 2.05, z: 0.152 }));
  frame.add("black", box(0.075, 0.01, 0.01, { y: 1.96, z: 0.152 }));
  frame.add("thatch", cylinder(0.012, 0.42, 0.22, 16, { y: 2.21 }), tone(HAY, 0.8), 2);
};

/** Tripod orchard ladder (kyatatsu) standing between the trees. */
const ladder = (build: Build, x: number, z: number, facing: number): void => {
  const frame = build.site.world.child({ x, y: groundHeight(x, z) - 0.05, z, ry: facing });
  const top = 2.3;
  for (const side of [-1, 1]) frame.add("planks", pole(v3(side * 0.28, 0, 0.35), v3(side * 0.07, top, 0), 0.03, 0.025, 6, 0.25, 0.5), RAIL);
  frame.add("planks", pole(v3(0, 0, -0.8), v3(0, top - 0.04, -0.03), 0.032, 0.026, 6, 0.25, 0.5), RAIL);
  for (let rung = 1; rung <= 7; rung += 1) {
    const t = rung / 8;
    const half = 0.28 + (0.07 - 0.28) * t;
    frame.add("planks", box(2 * half, 0.035, 0.07, { y: t * top, z: 0.35 * (1 - t) }), tone(RAIL, 1.05), 1.4);
  }
  frame.add("planks", box(0.22, 0.06, 0.12, { y: top + 0.02 }), RAIL, 1.4);
};

/** Woven bamboo basket (kago), `fill` of it heaped with oranges. */
const basket = (build: Build, x: number, z: number, fill: number): void => {
  const { site, random } = build;
  const y = groundHeight(x, z) - 0.02;
  const profile: Array<readonly [number, number]> = [[0, 0], [0.2, 0], [0.26, 0.08], [0.3, 0.3], [0.28, 0.33], [0.26, 0.3], [0.22, 0.09], [0.17, 0.04], [0, 0.04]];
  site.world.add("rope", lathe(profile, 16, { x, y, z }), [1.55, 1.35, 1], 3);
  const count = Math.round(fill * 14);
  for (let index = 0; index < count; index += 1) {
    const angle = random() * TAU;
    const r = Math.sqrt(random()) * 0.18;
    const layer = index < 8 ? 0 : 1;
    const shade = 0.85 + random() * 0.25;
    site.world.add("fruit", place(new THREE.SphereGeometry(0.07, 9, 7), { x: x + Math.cos(angle) * r, y: y + 0.2 + layer * 0.1 + random() * 0.03, z: z + Math.sin(angle) * r }), tone(ORANGE, shade));
  }
};

/** Straw bale bound with two ropes. */
const hayBale = (build: Build, x: number, y: number, z: number, yaw: number): void => {
  const frame = build.site.world.child({ x, y, z, ry: yaw });
  frame.add("thatch", box(0.95, 0.42, 0.52, { y: 0.21 }), tone(HAY, 0.9 + build.random() * 0.2), 1.6);
  for (const offset of [-0.25, 0.25]) frame.add("rope", box(0.035, 0.44, 0.54, { x: offset, y: 0.21 }), [1.2, 1.05, 0.8]);
};

/** Lean-to against the north fence: open to the south, thatched, with hay stacked inside. */
const shelter = (build: Build, area: Rect): void => {
  const { site, random } = build;
  const { world } = site;
  const { low, high } = groundRange(area);
  const width = area.x1 - area.x0;
  const cx = (area.x0 + area.x1) / 2;
  const frontZ = area.z1 - 0.12;
  const backZ = area.z0 + 0.12;
  const frontTop = high + 2.5;
  const backTop = high + 1.9;
  const bays = Math.max(2, Math.round(width / 2.4));
  const postX = (index: number): number => area.x0 + 0.12 + (index / bays) * (width - 0.24);
  for (let index = 0; index <= bays; index += 1) {
    for (const [z, top] of [[frontZ, frontTop], [backZ, backTop]] as const) {
      const y = groundHeight(postX(index), z) - 0.2;
      world.add("timber", box(0.16, top - y, 0.16, { x: postX(index), y: (top + y) / 2, z }), tone(POST, 0.9 + random() * 0.2), 1.1);
    }
  }
  world.add("timber", box(width, 0.18, 0.2, { x: cx, y: frontTop - 0.09, z: frontZ }), POST, 1.1);
  world.add("timber", box(width, 0.18, 0.2, { x: cx, y: backTop - 0.09, z: backZ }), POST, 1.1);
  const run = frontZ - backZ;
  const rise = frontTop - backTop;
  const length = Math.hypot(run, rise);
  const slope = Math.atan2(rise, run);
  const onRafter = (x: number, t: number): THREE.Vector3 => v3(x, backTop + 0.06 + rise * t, backZ + run * t);
  const overhang = 0.45 / length;
  for (let index = 0; index <= bays; index += 1) world.add("timber", beam([onRafter(postX(index), -overhang), onRafter(postX(index), 1 + overhang)], 0.08, 0.12), POST, 1.1);
  const middle = onRafter(cx, 0.5);
  const lift = 0.06 + 0.14;
  world.add("thatch", box(width + 0.9, 0.28, length + 1.0, { rx: -slope, x: cx, y: middle.y + Math.cos(slope) * lift, z: middle.z - Math.sin(slope) * lift }), [1.15, 1.05, 0.9], 0.6);
  world.add("planks", box(width, backTop - low + 0.1, 0.05, { x: cx, y: (backTop + low) / 2 - 0.05, z: area.z0 + 0.03 }), tone(RAIL, 0.75), 1);
  world.add("planks", box(0.05, backTop - low + 0.1, run, { x: area.x0 + 0.03, y: (backTop + low) / 2 - 0.05, z: (frontZ + backZ) / 2 }), tone(RAIL, 0.75), 1);
  const baleX = area.x0 + 0.75;
  const baleZ = backZ + 0.5;
  const floor = groundHeight(baleX, baleZ) - 0.03;
  hayBale(build, baleX, floor, baleZ, 0.05);
  hayBale(build, baleX + 1.02, floor, baleZ + 0.04, -0.04);
  hayBale(build, baleX + 0.5, floor + 0.42, baleZ + 0.02, 0.1);
  hayBale(build, baleX + 0.2, floor, baleZ + 0.75, Math.PI / 2 + 0.08);
  site.light(chochin(world.child({ x: cx, y: frontTop - 0.2, z: frontZ + 0.12 }), 0.85), 5, 0xff7a3a);
  site.solids.push(boxSolid(area.x0 - 0.45, area.x1 + 0.45, area.z0 - 0.45, area.z1 + 0.5, low - 0.5, frontTop + 0.55));
};

/* ------------------------------------------------------------------ structures */

const buildField = (build: Build): void => {
  const { rect } = build;
  const { runs, gate } = fenceLine(rect, 0.22, 1.3);
  latticeFence(build, runs);
  bambooGate(build, gate);
  scarecrow(build, rect.x1 - 1.5, rect.z0 + 3, 0.2);
  build.tilled.push(...allTiles(build.tiles));
};

const buildOrchard = (build: Build): void => {
  const { rect } = build;
  const { runs, gate } = fenceLine(rect, 0.2, 1.8);
  bambooRailFence(build, runs);
  bambooArch(build, gate);
  ladder(build, rect.x0 + 3, rect.z0 + 3, Math.PI * 0.25);
  const cx = (rect.x0 + rect.x1) / 2;
  basket(build, cx + 1.35, rect.z1 - 0.75, 1);
  basket(build, cx + 2.05, rect.z1 - 0.9, 0.55);
  basket(build, cx - 1.4, rect.z1 - 0.8, 0.2);
};

const buildPen = (build: Build): void => {
  const { rect } = build;
  const { runs, gate } = fenceLine(rect, 0.2, 2.6);
  railFence(build, runs);
  barGate(build, gate);
  const area = { x0: rect.x0 + 0.5, x1: Math.min(rect.x1 - 3, rect.x0 + 7.1), z0: rect.z0 + 0.45, z1: rect.z0 + 3.9 };
  shelter(build, area);
  const cz = (rect.z0 + rect.z1) / 2;
  trough(build, rect.x1 - 1.1, cz + 1, Math.PI / 2, { length: 2.2, width: 0.62, height: 0.46, wall: 0.06, key: "planks", tint: tone(RAIL, 0.8) });
  const cx = (rect.x0 + rect.x1) / 2;
  build.spots.push(
    { x: cx, z: rect.z1 - 1.3, radius: 2.8, dirt: true },
    { x: rect.x1 - 1.6, z: cz + 1, radius: 2.6, dirt: true },
    { x: (area.x0 + area.x1) / 2, z: area.z1, radius: 3.2, dirt: true }
  );
  build.pen = { x0: rect.x0 + 0.7, x1: rect.x1 - 2.2, z0: area.z1 + 0.5, z1: rect.z1 - 0.7 };
};

const buildEnclosure = (build: Build): void => {
  const { rect, site } = build;
  const { runs, gate } = fenceLine(rect, 0.6, 3.6);
  palisade(build, runs);
  palisadeGate(build, gate);
  pond(build, rect.x1 - 5.4, rect.z0 + 4.9, 2.3);
  trough(build, rect.x0 + 1.7, rect.z0 + 4, Math.PI / 2, { length: 2, width: 0.8, height: 0.5, wall: 0.13, key: "granite", tint: [0.9, 0.9, 0.86] });
  for (const [dx, dz, size, squash] of [[7, 2.6, 1, 0.62], [8.3, 3.3, 0.6, 0.7], [6.2, 3.6, 0.35, 0.8]] as const) {
    const x = rect.x0 + dx;
    const z = rect.z0 + dz;
    const y = groundHeight(x, z) - size * squash * 0.3;
    boulder(site.world.child({ x, y, z, ry: build.random() * TAU }), size, squash, Math.floor(build.random() * 1e6));
  }
  build.pen = { x0: rect.x0 + 1.2, x1: rect.x1 - 1.2, z0: rect.z0 + 8.5, z1: rect.z1 - 1.2 };
  const cx = (rect.x0 + rect.x1) / 2;
  build.spots.push(
    { x: rect.x0 + 5.5, z: rect.z0 + 11.5, radius: 4.8, dirt: true },
    { x: cx + 0.5, z: rect.z0 + 12.5, radius: 5.2, dirt: true },
    { x: rect.x1 - 6, z: rect.z0 + 11.8, radius: 4.6, dirt: true },
    { x: cx, z: rect.z1 - 1.5, radius: 3.4, dirt: true }
  );
};

/** Small farmhouse on a stone base: plaster walls, a shoji front on a veranda and a thatched irimoya roof. */
const buildHouse = (build: Build): void => {
  const { site, rect } = build;
  const { low, high } = groundRange(rect);
  const floor = high + 0.4;
  const cx = (rect.x0 + rect.x1) / 2;
  const cz = (rect.z0 + rect.z1) / 2;
  const halfW = (rect.x1 - rect.x0) / 2;
  const halfD = (rect.z1 - rect.z0) / 2;
  const engawa = 1.4;
  const width = 2 * (halfW - WALL_INSET);
  const front = halfD - engawa;
  const back = -(halfD - WALL_INSET);
  const depth = front - back;
  const height = 2.8;
  plinth(site, rect, floor, low - 0.6);

  const house = site.world.child({ x: cx, y: floor, z: cz });
  const bays = Math.max(3, Math.round(width / 2.2));
  const door = Math.floor(bays / 2);
  const sideBays = Math.max(2, Math.round(depth / 2.3));
  shell(house.child({ z: (front + back) / 2 }), width, depth, height, "plaster", {
    front: Array.from({ length: bays }, (_, index): Bay => (index === door ? "door" : "shoji")),
    back: Array.from({ length: bays }, (_, index): Bay => (index % 2 ? "window" : "wall")),
    left: Array.from({ length: sideBays }, (_, index): Bay => (index === 1 ? "window" : "wall")),
    right: Array.from({ length: sideBays }, (_, index): Bay => (index === 1 ? "window" : "wall"))
  }, 0.75);

  const roofFront = halfD - 0.3;
  const roofZ = (roofFront + back) / 2;
  const spec: RoofSpec = {
    width: width + 0.3, depth: roofFront - back, height: 4.4, eave: 1.4, lift: 0.3, irimoya: true, gableRatio: 0.55,
    curve: 1.2, thickness: 0.6, res: 0.35, cover: "thatch", fascia: "thatch"
  };
  const eave = height - roofSeat(spec) - 0.05;
  roof(house.child({ y: eave, z: roofZ }), spec);
  site.solids.push(roofSolid(cx, cz + roofZ, floor + eave, spec, low - 1));

  const deckTop = 0.34;
  house.add("planks", box(width + 0.3, 0.08, halfD - front - 0.05, { y: deckTop - 0.04, z: (front + halfD - 0.05) / 2 }), [0.74, 0.62, 0.5], 1.2);
  house.add("timber", box(width + 0.4, 0.2, 0.14, { y: deckTop - 0.12, z: halfD - 0.1 }), [0.72, 0.62, 0.52], 1);
  for (let index = 0; index <= bays; index += 1) {
    const x = -width / 2 + (index / bays) * width;
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
  const doorX = -width / 2 + (door + 0.5) * (width / bays);
  site.light(chochin(house.child({ x: doorX, y: height - 0.28, z: roofFront + 0.02 }), 0.9), 5, 0xff7a3a);
  build.tilled.push(...allTiles(build.tiles));
};

const BUILDERS: Record<StructureType, (build: Build) => void> = {
  house: buildHouse,
  field: buildField,
  orchard: buildOrchard,
  animal_pen: buildPen,
  dinosaur_enclosure: buildEnclosure
};

/** The structure on its footprint, already merged into a few meshes; `id` seeds its details. */
export const createStructure = (type: StructureType, id: string, footprint: ReadonlyArray<readonly [number, number]>, options: StructureOptions = {}): Structure => {
  const tiles = footprintTiles(footprint);
  const rect = tilesToWorld(tiles);
  const seed = hashString(id);
  const site = new Site(`structure-${type}`, seed);
  const build: Build = { site, rect, tiles, random: createRandom(seed ^ 0x5bd1e995), waters: [], spots: [], tilled: [], pen: shrink(rect, 1.2) };
  BUILDERS[type](build);

  const root = new THREE.Group();
  root.name = site.name;
  root.userData.structureId = id;
  const meshes = site.parts.build(options.materials ?? archMaterials(), root, site.name);
  if (build.waters.length) {
    const merged = mergeGeometries(build.waters, false);
    build.waters.forEach((geometry) => geometry.dispose());
    if (merged) {
      merged.computeBoundingSphere();
      const water = new THREE.Mesh(merged, stillWaterMaterial());
      water.name = `${site.name}-water`;
      water.receiveShadow = true;
      root.add(water);
      meshes.push(water);
    }
  }

  const maskKey = `structure-${id}`;
  if (build.tilled.length) setTilledTiles(maskKey, build.tilled);
  if (build.spots.length) setBareSpots(maskKey, build.spots);
  const phase = (seed % 628) / 100;
  const lamps: Array<{ lamp: Lamp; base: number; phase: number }> = site.lights.map((light, index) => ({
    lamp: addLamp(light.position, light.intensity, light.color),
    base: light.intensity,
    phase: phase + index * 2.3
  }));

  return {
    type,
    root,
    tiles,
    pen: build.pen,
    solid: solidTest(site.solids),
    update: (time) => {
      for (const entry of lamps) entry.lamp.intensity = entry.base * flicker(time, entry.phase);
    },
    dispose: () => {
      lamps.forEach(({ lamp }) => removeLamp(lamp));
      meshes.forEach((mesh) => mesh.geometry.dispose());
      clearTilledTiles(maskKey);
      clearBareSpots(maskKey);
      root.removeFromParent();
    }
  };
};
