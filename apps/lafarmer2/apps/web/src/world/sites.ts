import * as THREE from "three";
import { Frame, Parts, box, roofProfile, stoneLantern, type RoofSpec } from "./architecture";
import type { Circle } from "./controller";
import { groundHeight } from "./height";

/*
 * What every built thing in the valley shares: its pieces merged per material, the lamps it
 * lights, the round obstacles the walker slides around and the solids the camera arm stops at.
 */

export type Rect = { x0: number; x1: number; z0: number; z1: number };

/** Bounds the camera tests first; `inside` refines them when the shape is not a box. */
export type Solid = { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; inside?: (x: number, y: number, z: number) => boolean };

/** Walls stand this far inside their blocked footprint; the stone base fills the rest. */
export const WALL_INSET = 0.8;

export const groundRange = (rect: Rect): { low: number; high: number } => {
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

export const boxSolid = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number): Solid => ({ x0, x1, y0, y1, z0, z1 });

export const columnSolid = (x: number, z: number, radius: number, y0: number, y1: number): Solid => ({
  x0: x - radius,
  x1: x + radius,
  y0,
  y1,
  z0: z - radius,
  z1: z + radius,
  inside: (px, _py, pz) => (px - x) ** 2 + (pz - z) ** 2 < radius * radius
});

/** Solid from the floor to the roof inside the walls; under the eaves only the roof slab itself. */
export const roofSolid = (cx: number, cz: number, eaveY: number, spec: RoofSpec, floorY: number): Solid => {
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

export const ellipsoidSolid = (x: number, y: number, z: number, radius: number, squash: number): Solid => ({
  x0: x - radius * 1.15,
  x1: x + radius * 1.15,
  y0: y - radius,
  y1: y + radius * squash * 1.15,
  z0: z - radius * 1.15,
  z1: z + radius * 1.15,
  inside: (px, py, pz) => ((px - x) / (radius * 1.12)) ** 2 + ((py - y) / (radius * squash * 1.12)) ** 2 + ((pz - z) / (radius * 1.12)) ** 2 < 1
});

/** One test over many solids, cheapest bounds first. */
export const solidTest = (solids: readonly Solid[]) => (x: number, y: number, z: number): boolean => {
  for (const shape of solids) {
    if (x < shape.x0 || x > shape.x1 || z < shape.z0 || z > shape.z1 || y < shape.y0 || y > shape.y1) continue;
    if (!shape.inside || shape.inside(x, y, z)) return true;
  }
  return false;
};

export type LightSpec = { position: THREE.Vector3; intensity: number; color: number };

/** Candle-like unsteadiness of a lantern flame, around 1. */
export const flicker = (time: number, phase: number): number =>
  0.92 + 0.05 * Math.sin(time * 7.3 + phase) + 0.03 * Math.sin(time * 17.9 + phase * 1.7);

/** One built thing: its pieces (merged per material), lights, colliders and camera solids. */
export class Site {
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
}

/** Stone base filling a footprint, level on top and reaching below the lowest ground under it. */
export const plinth = (site: Site, rect: Rect, top: number, bottom: number): void => {
  const width = rect.x1 - rect.x0;
  const depth = rect.z1 - rect.z0;
  const cx = (rect.x0 + rect.x1) / 2;
  const cz = (rect.z0 + rect.z1) / 2;
  site.world.add("stone", box(width - 0.08, top - 0.12 - bottom, depth - 0.08, { x: cx, y: (top - 0.12 + bottom) / 2, z: cz }), [0.92, 0.9, 0.86], 0.55);
  site.world.add("granite", box(width, 0.14, depth, { x: cx, y: top - 0.07, z: cz }), [0.82, 0.8, 0.76], 0.8);
  site.solids.push(boxSolid(rect.x0, rect.x1, rect.z0, rect.z1, bottom, top));
};
