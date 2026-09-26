import * as THREE from "three";
import { WATER_LEVEL, groundHeight } from "./height";

/*
 * Third-person camera on a spring arm behind the player. Yaw and pitch come from the player
 * (drag, keys); the arm shortens in front of buildings and rides over hills, so the player
 * stays in view without the camera ever going under the ground or the river.
 */

export const DEFAULT_PITCH = 0.32;
export const MIN_PITCH = 0.08;
export const MAX_PITCH = 1.1;
export const DEFAULT_DISTANCE = 7.5;
export const MIN_DISTANCE = 3.5;
export const MAX_DISTANCE = 16;
/** Height of the aim point above the feet. */
export const TARGET_HEIGHT = 1.5;
/** The camera keeps at least this far above the ground under it. */
export const GROUND_CLEARANCE = 0.6;
/** And this far above the water. */
export const WATER_CLEARANCE = 0.5;

/** Radians per pixel of drag. */
const DRAG_YAW = 0.005;
const DRAG_PITCH = 0.004;
/** The camera only swings behind a player walking roughly away from it. */
const FOLLOW_CONE = 0.6;
const FOLLOW_RATE = 0.9;
/** Seconds after a manual turn before the camera starts following again. */
const FOLLOW_DELAY = 1.2;
const FOLLOW_MIN_SPEED = 1;
const TARGET_RATE = 12;
const ZOOM_RATE = 8;
const ARM_OUT_RATE = 3;
const ARM_IN_RATE = 25;
const LIFT_UP_RATE = 12;
const LIFT_DOWN_RATE = 4;
/** Seconds of velocity the aim point leads by, capped at LOOK_AHEAD_MAX units. */
const LOOK_AHEAD = 0.15;
const LOOK_AHEAD_MAX = 1.4;
const ARM_MIN = 1.4;
const SOLID_MARGIN = 0.35;
const TERRAIN_SAMPLES = 10;
/** Samples this close to the aim point are covered by the player's own clearance. */
const TERRAIN_NEAREST = 0.22;
const TERRAIN_MARGIN = 0.45;

export type Planar = { x: number; z: number };
export type Point = { x: number; y: number; z: number };

export type ChaseCameraOptions = {
  yaw?: number;
  pitch?: number;
  distance?: number;
  /** Ground height; the cached valley ground by default. */
  ground?: (x: number, z: number) => number;
  /** Top of a solid (building, rock) covering (x, z), or undefined for open air. */
  solidTop?: (x: number, z: number) => number | undefined;
};

export type ChaseCamera = {
  readonly yaw: () => number;
  readonly pitch: () => number;
  /** Arm length the player asked for (wheel, pinch). */
  readonly distance: () => number;
  /** Where the camera is after the last update. */
  readonly position: THREE.Vector3;
  /** Where it looks. */
  readonly aim: THREE.Vector3;
  /** Horizontal forward of the view, for camera-relative movement. */
  forward: () => Planar;
  /** Screen right, horizontal. */
  right: () => Planar;
  /** Pointer drag in pixels: right turns the view right, down tilts it down toward the ground. */
  drag: (dx: number, dy: number) => void;
  /** Turns by `radians` (keys); positive turns the view left. */
  turn: (radians: number) => void;
  /** Positive zooms out; one wheel notch is about 100. */
  zoom: (delta: number) => void;
  setYaw: (yaw: number) => void;
  /** Jumps straight to the goal on the next update (spawn, teleport, region change). */
  snap: () => void;
  update: (camera: THREE.Camera, feet: Point, velocity: Planar, dt: number) => void;
};

const wrapAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

const approach = (value: number, goal: number, rate: number, dt: number): number => value + (goal - value) * (1 - Math.exp(-rate * dt));

export const createChaseCamera = (options: ChaseCameraOptions = {}): ChaseCamera => {
  const ground = options.ground ?? groundHeight;
  const solidTop = options.solidTop;
  let yaw = options.yaw ?? 0;
  let pitch = THREE.MathUtils.clamp(options.pitch ?? DEFAULT_PITCH, MIN_PITCH, MAX_PITCH);
  let distance = THREE.MathUtils.clamp(options.distance ?? DEFAULT_DISTANCE, MIN_DISTANCE, MAX_DISTANCE);
  let zoomed = distance;
  let arm = distance;
  let lift = 0;
  let clock = 0;
  let lastManual = -Infinity;
  let snapped = false;
  const target = new THREE.Vector3();
  const lead = new THREE.Vector3();
  const position = new THREE.Vector3();
  const aim = new THREE.Vector3();

  const floorAt = (x: number, z: number): number => Math.max(ground(x, z), WATER_LEVEL);

  /** Longest free arm along the view ray before it would enter a solid. */
  const freeArm = (from: THREE.Vector3, dirX: number, dirY: number, dirZ: number, length: number): number => {
    if (!solidTop) return length;
    for (let along = 0.5; along <= length; along += 0.3) {
      const top = solidTop(from.x + dirX * along, from.z + dirZ * along);
      if (top !== undefined && from.y + dirY * along < top + SOLID_MARGIN) return Math.max(ARM_MIN, along - SOLID_MARGIN);
    }
    return length;
  };

  /** Height the camera must reach so the line to the aim point clears the ground along the way. */
  const clearHeight = (from: THREE.Vector3, toX: number, toY: number, toZ: number): number => {
    let needed = toY;
    for (let sample = 1; sample <= TERRAIN_SAMPLES; sample += 1) {
      const t = sample / TERRAIN_SAMPLES;
      if (t < TERRAIN_NEAREST) continue;
      const floor = floorAt(from.x + (toX - from.x) * t, from.z + (toZ - from.z) * t) + TERRAIN_MARGIN;
      needed = Math.max(needed, from.y + (floor - from.y) / t);
    }
    return Math.max(needed, ground(toX, toZ) + GROUND_CLEARANCE, WATER_LEVEL + WATER_CLEARANCE);
  };

  const update = (camera: THREE.Camera, feet: Point, velocity: Planar, dt: number): void => {
    clock += dt;
    const speed = Math.hypot(velocity.x, velocity.z);
    if (snapped && speed > FOLLOW_MIN_SPEED && clock - lastManual > FOLLOW_DELAY) {
      const delta = wrapAngle(Math.atan2(velocity.x, velocity.z) - yaw);
      if (Math.abs(delta) < FOLLOW_CONE) yaw = wrapAngle(yaw + delta * (1 - Math.exp(-FOLLOW_RATE * dt)));
    }

    const scale = Math.min(1, (LOOK_AHEAD_MAX / Math.max(speed * LOOK_AHEAD, 1e-6)));
    const goalLeadX = velocity.x * LOOK_AHEAD * scale;
    const goalLeadZ = velocity.z * LOOK_AHEAD * scale;
    if (!snapped) {
      target.set(feet.x, feet.y + TARGET_HEIGHT, feet.z);
      lead.set(goalLeadX, 0, goalLeadZ);
      zoomed = distance;
    } else {
      zoomed = approach(zoomed, distance, ZOOM_RATE, dt);
      const blend = 1 - Math.exp(-TARGET_RATE * dt);
      target.x += (feet.x - target.x) * blend;
      target.y += (feet.y + TARGET_HEIGHT - target.y) * blend;
      target.z += (feet.z - target.z) * blend;
      lead.x = approach(lead.x, goalLeadX, 4, dt);
      lead.z = approach(lead.z, goalLeadZ, 4, dt);
    }

    const cosPitch = Math.cos(pitch);
    const dirX = -Math.sin(yaw) * cosPitch;
    const dirY = Math.sin(pitch);
    const dirZ = -Math.cos(yaw) * cosPitch;
    const free = freeArm(target, dirX, dirY, dirZ, zoomed);
    if (!snapped) arm = free;
    else if (free < arm) arm = Math.min(approach(arm, free, ARM_IN_RATE, dt), free + 0.05);
    else if (arm < zoomed - 0.05) arm = approach(arm, free, ARM_OUT_RATE, dt);
    else arm = free;

    const goalX = target.x + dirX * arm;
    const goalZ = target.z + dirZ * arm;
    const baseY = target.y + dirY * arm;
    const goalLift = clearHeight(target, goalX, baseY, goalZ) - baseY;
    lift = snapped ? approach(lift, goalLift, goalLift > lift ? LIFT_UP_RATE : LIFT_DOWN_RATE, dt) : goalLift;
    const floor = Math.max(ground(goalX, goalZ) + GROUND_CLEARANCE * 0.8, WATER_LEVEL + WATER_CLEARANCE * 0.8);
    position.set(goalX, Math.max(baseY + lift, floor), goalZ);
    aim.set(target.x + lead.x, target.y, target.z + lead.z);
    snapped = true;

    camera.position.copy(position);
    camera.lookAt(aim);
    camera.updateMatrixWorld();
  };

  return {
    yaw: () => yaw,
    pitch: () => pitch,
    distance: () => distance,
    position,
    aim,
    forward: () => ({ x: Math.sin(yaw), z: Math.cos(yaw) }),
    right: () => ({ x: -Math.cos(yaw), z: Math.sin(yaw) }),
    drag: (dx, dy) => {
      yaw = wrapAngle(yaw - dx * DRAG_YAW);
      pitch = THREE.MathUtils.clamp(pitch + dy * DRAG_PITCH, MIN_PITCH, MAX_PITCH);
      lastManual = clock;
    },
    turn: (radians) => {
      yaw = wrapAngle(yaw + radians);
      lastManual = clock;
    },
    zoom: (delta) => {
      distance = THREE.MathUtils.clamp(distance * Math.exp(delta * 0.001), MIN_DISTANCE, MAX_DISTANCE);
    },
    setYaw: (value) => {
      yaw = wrapAngle(value);
    },
    snap: () => {
      snapped = false;
    },
    update
  };
};
