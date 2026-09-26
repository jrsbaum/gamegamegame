import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DISTANCE,
  DEFAULT_PITCH,
  GROUND_CLEARANCE,
  MAX_DISTANCE,
  MAX_PITCH,
  MIN_DISTANCE,
  TARGET_HEIGHT,
  WATER_CLEARANCE,
  createChaseCamera,
  type ChaseCameraOptions,
  type Planar,
  type Point
} from "./chaseCamera";

const FLAT = 5;
const flat = (): number => FLAT;

const settle = (options: ChaseCameraOptions, feet: Point, seconds = 2, velocity: Planar = { x: 0, z: 0 }) => {
  const rig = createChaseCamera(options);
  const camera = new THREE.PerspectiveCamera();
  for (let elapsed = 0; elapsed < seconds; elapsed += 1 / 60) rig.update(camera, feet, velocity, 1 / 60);
  return { rig, camera };
};

/** Lowest clearance between the view line (aim to camera) and the ground under it. */
const lineClearance = (from: THREE.Vector3, to: THREE.Vector3, ground: (x: number, z: number) => number): number => {
  let lowest = Infinity;
  for (let t = 0.25; t <= 1; t += 0.05) {
    const point = from.clone().lerp(to, t);
    lowest = Math.min(lowest, point.y - ground(point.x, point.z));
  }
  return lowest;
};

describe("createChaseCamera", () => {
  it("sits behind and above the player at the default arm", () => {
    const feet = { x: 10, y: FLAT, z: 20 };
    const { rig, camera } = settle({ yaw: Math.PI / 2, ground: flat }, feet);
    expect(camera.position.x).toBeCloseTo(feet.x - DEFAULT_DISTANCE * Math.cos(DEFAULT_PITCH), 1);
    expect(camera.position.z).toBeCloseTo(feet.z, 3);
    expect(camera.position.y).toBeCloseTo(FLAT + TARGET_HEIGHT + DEFAULT_DISTANCE * Math.sin(DEFAULT_PITCH), 1);
    expect(rig.aim.distanceTo(new THREE.Vector3(feet.x, FLAT + TARGET_HEIGHT, feet.z))).toBeLessThan(1e-6);
    const view = new THREE.Vector3();
    camera.getWorldDirection(view);
    expect(view.x).toBeGreaterThan(0.9);
  });

  it("rides over a hill between the camera and the player", () => {
    const hill = (x: number): number => FLAT + 3.5 * Math.exp(-((x + 4) ** 2) / 4);
    const ground = (x: number): number => hill(x);
    const feet = { x: 0, y: FLAT, z: 0 };
    const { rig, camera } = settle({ yaw: Math.PI / 2, ground }, feet);
    expect(lineClearance(rig.aim, camera.position, ground)).toBeGreaterThan(0.3);
    const { camera: open } = settle({ yaw: Math.PI / 2, ground: flat }, feet);
    expect(camera.position.y).toBeGreaterThan(open.position.y + 0.5);
  });

  it("never goes under the ground or the river", () => {
    const steep = (x: number): number => FLAT + Math.max(0, -x - 2) * 1.5;
    const low = settle({ yaw: Math.PI / 2, pitch: 0.08, ground: steep }, { x: 0, y: FLAT, z: 0 });
    expect(low.camera.position.y).toBeGreaterThanOrEqual(steep(low.camera.position.x) + GROUND_CLEARANCE * 0.8 - 1e-6);
    const riverbed = (): number => -1.5;
    const wet = settle({ yaw: 0, pitch: 0.08, ground: riverbed }, { x: 0, y: -0.14, z: 0 });
    expect(wet.camera.position.y).toBeGreaterThanOrEqual(WATER_CLEARANCE * 0.8 - 1e-6);
  });

  it("shortens the arm in front of a building instead of entering it", () => {
    const wall = (x: number, y: number, z: number): boolean => x < -3 && x > -12 && Math.abs(z) < 6 && y < FLAT + 7;
    const feet = { x: 0, y: FLAT, z: 0 };
    const { camera } = settle({ yaw: Math.PI / 2, ground: flat, solid: wall }, feet);
    expect(camera.position.x).toBeGreaterThan(-3);
    expect(Math.hypot(camera.position.x - feet.x, camera.position.z - feet.z)).toBeLessThan(DEFAULT_DISTANCE - 2);
  });

  it("stays at full length under an eave the arm passes beneath, and pulls in when it would cross it", () => {
    const eave = (lowest: number) => (x: number, y: number): boolean => x < -2 && x > -12 && y > FLAT + lowest && y < FLAT + lowest + 0.6;
    const feet = { x: 0, y: FLAT, z: 0 };
    const under = settle({ yaw: Math.PI / 2, ground: flat, solid: eave(5) }, feet);
    expect(feet.x - under.camera.position.x).toBeCloseTo(DEFAULT_DISTANCE * Math.cos(DEFAULT_PITCH), 1);
    const through = settle({ yaw: Math.PI / 2, ground: flat, solid: eave(3.2) }, feet);
    expect(feet.x - through.camera.position.x).toBeLessThan(DEFAULT_DISTANCE * Math.cos(DEFAULT_PITCH) - 1.5);
    expect(through.camera.position.y).toBeLessThan(FLAT + 3.2);
  });

  it("lets the arm grow back once the building is out of the way", () => {
    let walled = true;
    const wall = (x: number): boolean => walled && x < -3 && x > -12;
    const rig = createChaseCamera({ yaw: Math.PI / 2, ground: flat, solid: wall });
    const camera = new THREE.PerspectiveCamera();
    const feet = { x: 0, y: FLAT, z: 0 };
    for (let frame = 0; frame < 60; frame += 1) rig.update(camera, feet, { x: 0, z: 0 }, 1 / 60);
    walled = false;
    rig.update(camera, feet, { x: 0, z: 0 }, 1 / 60);
    const justAfter = feet.x - camera.position.x;
    for (let frame = 0; frame < 180; frame += 1) rig.update(camera, feet, { x: 0, z: 0 }, 1 / 60);
    expect(justAfter).toBeLessThan(4);
    expect(feet.x - camera.position.x).toBeCloseTo(DEFAULT_DISTANCE * Math.cos(DEFAULT_PITCH), 1);
  });

  it("turns with the drag and keeps pitch and zoom within bounds", () => {
    const rig = createChaseCamera({ yaw: Math.PI / 2 });
    const before = rig.right();
    rig.drag(100, 0);
    const after = rig.forward();
    expect(after.x * before.x + after.z * before.z).toBeGreaterThan(0.4);
    rig.drag(0, 10_000);
    expect(rig.pitch()).toBe(MAX_PITCH);
    rig.zoom(100_000);
    expect(rig.distance()).toBe(MAX_DISTANCE);
    rig.zoom(-100_000);
    expect(rig.distance()).toBe(MIN_DISTANCE);
  });

  it("swings behind a player walking roughly away from it, but not sideways", () => {
    const heading = Math.PI / 2 + 0.4;
    const velocity = { x: Math.sin(heading) * 5, z: Math.cos(heading) * 5 };
    const ahead = settle({ yaw: Math.PI / 2, ground: flat }, { x: 0, y: FLAT, z: 0 }, 6, velocity);
    expect(Math.abs(ahead.rig.yaw() - heading)).toBeLessThan(0.05);
    const side = settle({ yaw: 0, ground: flat }, { x: 0, y: FLAT, z: 0 }, 6, { x: 5, z: 0 });
    expect(side.rig.yaw()).toBe(0);
  });

  it("waits after a manual turn before following again", () => {
    const rig = createChaseCamera({ yaw: Math.PI / 2, ground: flat });
    const camera = new THREE.PerspectiveCamera();
    const feet = { x: 0, y: FLAT, z: 0 };
    rig.update(camera, feet, { x: 0, z: 0 }, 1 / 60);
    rig.turn(0.3);
    const turned = rig.yaw();
    for (let frame = 0; frame < 50; frame += 1) rig.update(camera, feet, { x: 5, z: 0 }, 1 / 60);
    expect(rig.yaw()).toBe(turned);
    for (let frame = 0; frame < 240; frame += 1) rig.update(camera, feet, { x: 5, z: 0 }, 1 / 60);
    expect(Math.abs(rig.yaw() - Math.PI / 2)).toBeLessThan(0.05);
  });

  it("eases after the player unless snapped", () => {
    const rig = createChaseCamera({ yaw: Math.PI / 2, ground: flat });
    const camera = new THREE.PerspectiveCamera();
    rig.update(camera, { x: 0, y: FLAT, z: 0 }, { x: 0, z: 0 }, 1 / 60);
    const start = camera.position.clone();
    rig.update(camera, { x: 30, y: FLAT, z: 0 }, { x: 0, z: 0 }, 1 / 60);
    expect(camera.position.x - start.x).toBeGreaterThan(0);
    expect(camera.position.x - start.x).toBeLessThan(10);
    rig.snap();
    rig.update(camera, { x: 30, y: FLAT, z: 0 }, { x: 0, z: 0 }, 1 / 60);
    expect(camera.position.x).toBeCloseTo(30 - DEFAULT_DISTANCE * Math.cos(DEFAULT_PITCH), 3);
  });
});
