import { TILE, tileToWorldX, tileToWorldZ, worldToTile } from "./height";
import type { Direction } from "./movement";

/*
 * Continuous walking over the tile-authoritative world. The body moves freely and slides along
 * blocked tiles and tree trunks; its centre never enters a blocked tile, and every time the centre
 * crosses into a neighbouring tile the walker reports that step so the server can validate it.
 */

export const BODY_RADIUS = 0.38;
/** World units per second. */
export const WALK_SPEED = 5.2;
export const RUN_SPEED = 9;
const ACCELERATION = 11;
const BRAKING = 14;
const TURN_RATE = 11;
/** Longest move resolved at once; faster frames are split so the body cannot tunnel. */
const MAX_SUBSTEP = BODY_RADIUS * 0.5;

export type Circle = { x: number; z: number; radius: number };

export type WalkerWorld = {
  /** Tiles the centre may not enter: server rules plus the player's own structures. */
  blocked: (tileX: number, tileY: number) => boolean;
  /** Client-side solids the body slides around (trunks, lantern posts). */
  circles: ReadonlyArray<Circle>;
};

export type Walker = {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Yaw the body faces; 0 looks along +Z. */
  heading: number;
  /** Tile under the centre, as last reported. */
  tileX: number;
  tileY: number;
};

/** Desired direction in world XZ (length up to 1, scaled by stick pressure) and gait. */
export type WalkIntent = { x: number; z: number; run: boolean };

export const tileOf = (x: number, z: number): { x: number; y: number } => {
  const tile = worldToTile(x, z);
  return { x: Math.round(tile.x), y: Math.round(tile.y) };
};

const tileCentre = (tileX: number, tileY: number): { x: number; z: number } => ({ x: tileToWorldX(tileX), z: tileToWorldZ(tileY) });

export const createWalker = (x: number, z: number, heading = 0): Walker => {
  const tile = tileOf(x, z);
  return { x, z, vx: 0, vz: 0, heading, tileX: tile.x, tileY: tile.y };
};

/** Puts the walker on a tile centre at rest, e.g. when the server corrects it. */
export const placeWalker = (walker: Walker, tileX: number, tileY: number): void => {
  const centre = tileCentre(tileX, tileY);
  walker.x = centre.x;
  walker.z = centre.z;
  walker.vx = 0;
  walker.vz = 0;
  walker.tileX = tileX;
  walker.tileY = tileY;
};

const directionBetween = (fromX: number, fromY: number, toX: number, toY: number): Direction => {
  if (toX > fromX) return "right";
  if (toX < fromX) return "left";
  return toY > fromY ? "down" : "up";
};

/** Removes the part of the velocity pushing into a surface with outward normal (nx, nz). */
const slide = (walker: Walker, nx: number, nz: number): void => {
  const into = walker.vx * nx + walker.vz * nz;
  if (into >= 0) return;
  walker.vx -= nx * into;
  walker.vz -= nz * into;
};

const pushOutOfTiles = (walker: Walker, world: WalkerWorld): void => {
  const half = TILE / 2;
  const reach = BODY_RADIUS / TILE + 0.5;
  const centre = worldToTile(walker.x, walker.z);
  const standingOnBlocked = world.blocked(walker.tileX, walker.tileY);
  for (let tileY = Math.round(centre.y - reach); tileY <= Math.round(centre.y + reach); tileY += 1) {
    for (let tileX = Math.round(centre.x - reach); tileX <= Math.round(centre.x + reach); tileX += 1) {
      if (standingOnBlocked && tileX === walker.tileX && tileY === walker.tileY) continue;
      if (!world.blocked(tileX, tileY)) continue;
      const square = tileCentre(tileX, tileY);
      const closestX = Math.min(Math.max(walker.x, square.x - half), square.x + half);
      const closestZ = Math.min(Math.max(walker.z, square.z - half), square.z + half);
      let dx = walker.x - closestX;
      let dz = walker.z - closestZ;
      let distance = Math.hypot(dx, dz);
      if (distance >= BODY_RADIUS) continue;
      if (distance < 1e-6) {
        const toLeft = walker.x - (square.x - half);
        const toRight = square.x + half - walker.x;
        const toTop = walker.z - (square.z - half);
        const toBottom = square.z + half - walker.z;
        const least = Math.min(toLeft, toRight, toTop, toBottom);
        dx = least === toLeft ? -1 : least === toRight ? 1 : 0;
        dz = least === toTop ? -1 : least === toBottom ? 1 : 0;
        distance = 0;
        walker.x += dx * (least + BODY_RADIUS);
        walker.z += dz * (least + BODY_RADIUS);
      } else {
        dx /= distance;
        dz /= distance;
        walker.x += dx * (BODY_RADIUS - distance);
        walker.z += dz * (BODY_RADIUS - distance);
      }
      slide(walker, dx, dz);
    }
  }
};

const pushOutOfCircles = (walker: Walker, world: WalkerWorld): void => {
  for (const circle of world.circles) {
    const dx = walker.x - circle.x;
    const dz = walker.z - circle.z;
    const reach = BODY_RADIUS + circle.radius;
    if (Math.abs(dx) >= reach || Math.abs(dz) >= reach) continue;
    const distance = Math.hypot(dx, dz);
    if (distance >= reach) continue;
    const nx = distance > 1e-6 ? dx / distance : 1;
    const nz = distance > 1e-6 ? dz / distance : 0;
    walker.x = circle.x + nx * reach;
    walker.z = circle.z + nz * reach;
    slide(walker, nx, nz);
  }
};

/**
 * Tile steps from the reported tile to the one under the centre, through walkable tiles only.
 * Returns undefined when no such path exists (the move must be undone).
 */
const stepsTo = (walker: Walker, tileX: number, tileY: number, world: WalkerWorld): Direction[] | undefined => {
  const steps: Direction[] = [];
  let x = walker.tileX;
  let y = walker.tileY;
  while (x !== tileX || y !== tileY) {
    const alongX = x !== tileX ? { x: x + Math.sign(tileX - x), y } : undefined;
    const alongY = y !== tileY ? { x, y: y + Math.sign(tileY - y) } : undefined;
    const next = [alongX, alongY].find((candidate) => candidate && !world.blocked(candidate.x, candidate.y));
    if (!next) return undefined;
    steps.push(directionBetween(x, y, next.x, next.y));
    x = next.x;
    y = next.y;
  }
  return steps;
};

/** Advances the walker by `dt` seconds and returns the tile steps its centre crossed, in order. */
export const stepWalker = (walker: Walker, intent: WalkIntent, dt: number, world: WalkerWorld): Direction[] => {
  const pressure = Math.min(1, Math.hypot(intent.x, intent.z));
  const speed = (intent.run ? RUN_SPEED : WALK_SPEED) * pressure;
  const targetX = pressure > 0 ? (intent.x / Math.hypot(intent.x, intent.z)) * speed : 0;
  const targetZ = pressure > 0 ? (intent.z / Math.hypot(intent.x, intent.z)) * speed : 0;
  const blend = 1 - Math.exp(-(pressure > 0 ? ACCELERATION : BRAKING) * dt);
  walker.vx += (targetX - walker.vx) * blend;
  walker.vz += (targetZ - walker.vz) * blend;
  if (pressure === 0 && Math.hypot(walker.vx, walker.vz) < 0.05) {
    walker.vx = 0;
    walker.vz = 0;
  }

  const steps: Direction[] = [];
  const travel = Math.hypot(walker.vx, walker.vz) * dt;
  const substeps = Math.max(1, Math.ceil(travel / MAX_SUBSTEP));
  const slice = dt / substeps;
  for (let substep = 0; substep < substeps; substep += 1) {
    const fromX = walker.x;
    const fromZ = walker.z;
    walker.x += walker.vx * slice;
    walker.z += walker.vz * slice;
    for (let pass = 0; pass < 2; pass += 1) {
      pushOutOfCircles(walker, world);
      pushOutOfTiles(walker, world);
    }
    const tile = tileOf(walker.x, walker.z);
    if (tile.x === walker.tileX && tile.y === walker.tileY) continue;
    const crossed = world.blocked(tile.x, tile.y) ? undefined : stepsTo(walker, tile.x, tile.y, world);
    if (!crossed) {
      walker.x = fromX;
      walker.z = fromZ;
      walker.vx = 0;
      walker.vz = 0;
      break;
    }
    steps.push(...crossed);
    walker.tileX = tile.x;
    walker.tileY = tile.y;
  }

  const moving = Math.hypot(walker.vx, walker.vz);
  if (moving > 0.3) {
    const goal = Math.atan2(walker.vx, walker.vz);
    const delta = Math.atan2(Math.sin(goal - walker.heading), Math.cos(goal - walker.heading));
    walker.heading += delta * (1 - Math.exp(-TURN_RATE * dt));
  }
  return steps;
};

/** The cardinal direction the walker faces, for actions on the tile in front of it. */
export const facingDirection = (walker: Walker): Direction => {
  const x = Math.sin(walker.heading);
  const z = Math.cos(walker.heading);
  if (Math.abs(x) >= Math.abs(z)) return x >= 0 ? "right" : "left";
  return z >= 0 ? "down" : "up";
};
