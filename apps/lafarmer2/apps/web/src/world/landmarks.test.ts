import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { PLAYER_SPAWN, WORLD_CONNECTIONS, WORLD_OBSTACLES, isWorldTileWalkable } from "@lafarmer2/content";
import type { ArchMaterials } from "./architecture";
import { BODY_RADIUS } from "./controller";
import { BRIDGE, bridgeDeckHeight, groundHeight, pathMask, tileToWorldX, tileToWorldZ, worldToTile } from "./height";
import { LANDMARK_CLEARINGS, createLandmarks } from "./landmarks";
import { LAMPS } from "./shared";
import { insideClearing } from "./vegetationLayout";

const materials = new Proxy({}, { get: () => new THREE.MeshBasicMaterial() }) as ArchMaterials;
const landmarks = createLandmarks({ materials });
const BRIDGE_Z = (BRIDGE.z0 + BRIDGE.z1) / 2;

const footprint = (kind: string) => {
  const obstacle = WORLD_OBSTACLES.find((candidate) => candidate.kind === kind)!;
  return {
    x0: tileToWorldX(obstacle.x - 0.5),
    x1: tileToWorldX(obstacle.x + obstacle.width - 0.5),
    z0: tileToWorldZ(obstacle.y - 0.5),
    z1: tileToWorldZ(obstacle.y + obstacle.height - 0.5)
  };
};

const nearestCollider = (x: number, z: number): number =>
  Math.min(...landmarks.colliders.map((circle) => Math.hypot(x - circle.x, z - circle.z) - circle.radius));

describe("LANDMARK_CLEARINGS", () => {
  it("covers every building footprint and the pagoda", () => {
    for (const kind of ["barn", "house", "market"]) {
      const { x0, x1, z0, z1 } = footprint(kind);
      for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [(x0 + x1) / 2, (z0 + z1) / 2]]) {
        expect(insideClearing(x, z, LANDMARK_CLEARINGS), `${kind} at ${x},${z}`).toBe(true);
      }
    }
    expect(insideClearing(70.5, -103.5, LANDMARK_CLEARINGS)).toBe(true);
    expect(insideClearing(BRIDGE.x0, BRIDGE.z0, LANDMARK_CLEARINGS)).toBe(true);
    expect(insideClearing(BRIDGE.x1, BRIDGE.z1, LANDMARK_CLEARINGS)).toBe(true);
  });
});

describe("createLandmarks", () => {
  it("keeps the paths, the spawn and the region exits clear of colliders", () => {
    for (let x = -120; x <= 120; x += 0.5) {
      for (let z = -90; z <= 90; z += 0.5) {
        const tile = worldToTile(x, z);
        if (!isWorldTileWalkable(Math.round(tile.x), Math.round(tile.y)) || pathMask(tile.x, tile.y) < 0.9) continue;
        expect(nearestCollider(x, z), `path at ${x},${z}`).toBeGreaterThan(BODY_RADIUS * 0.5);
      }
    }
    const tiles = [PLAYER_SPAWN, ...WORLD_CONNECTIONS.map((connection) => connection.exit)];
    for (const tile of tiles) expect(nearestCollider(tileToWorldX(tile.x), tileToWorldZ(tile.y))).toBeGreaterThan(BODY_RADIUS);
  });

  it("lets walkers cross the bridge but not step off its sides", () => {
    for (let x = BRIDGE.x0 - 1; x <= BRIDGE.x1 + 1; x += 0.25) expect(nearestCollider(x, BRIDGE_Z)).toBeGreaterThan(BODY_RADIUS);
    for (const z of [BRIDGE.z0 + 0.1, BRIDGE.z1 - 0.1]) {
      for (let x = BRIDGE.x0; x <= BRIDGE.x1; x += 0.1) expect(nearestCollider(x, z)).toBeLessThan(BODY_RADIUS * 0.6);
    }
  });

  it("lays the bridge planks along the walkway", () => {
    const planks = landmarks.root.getObjectByName("landmark-bridge-planks") as THREE.Mesh;
    const position = planks.geometry.getAttribute("position");
    const highest = new Map<number, number>();
    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index);
      const y = position.getY(index);
      const deck = bridgeDeckHeight(THREE.MathUtils.clamp(x, BRIDGE.x0, BRIDGE.x1), BRIDGE_Z)!;
      expect(y).toBeLessThan(deck + 0.03);
      const bin = Math.round(x * 2);
      highest.set(bin, Math.max(highest.get(bin) ?? -Infinity, y));
    }
    for (const [bin, top] of highest) {
      const x = THREE.MathUtils.clamp(bin / 2, BRIDGE.x0, BRIDGE.x1);
      expect(top).toBeGreaterThan(bridgeDeckHeight(x, BRIDGE_Z)! - 0.04);
    }
  });

  it("fills the barn and stops above its roof", () => {
    const { x0, x1, z0, z1 } = footprint("barn");
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const ground = groundHeight(cx, cz);
    expect(landmarks.solid(cx, ground + 2, cz)).toBe(true);
    expect(landmarks.solid(cx, ground + 9, cz)).toBe(true);
    expect(landmarks.solid(cx, ground + 16, cz)).toBe(false);
    expect(landmarks.solid(cx, ground + 2, z1 + 4)).toBe(false);
  });

  it("leaves room under the market eave, with the roof slab above it", () => {
    const { x0, x1, z1 } = footprint("market");
    const x = (x0 + x1) / 2;
    const z = z1 + 0.6;
    const ground = groundHeight(x, z);
    const column = Array.from({ length: 80 }, (_, step) => landmarks.solid(x, ground + 0.1 + step * 0.1, z));
    const firstSolid = column.indexOf(true);
    expect(firstSolid * 0.1).toBeGreaterThan(2.4);
    expect(column.lastIndexOf(true)).toBeLessThan(column.length - 5);
    expect(column.slice(0, firstSolid).every((filled) => !filled)).toBe(true);
  });

  it("lets the road pass under the torii but not through its beams", () => {
    const x = -109.2;
    const z = -0.6;
    const ground = groundHeight(x, z);
    expect(landmarks.solid(x, ground + 1.7, z)).toBe(false);
    expect(landmarks.solid(x, ground + 6.2, z)).toBe(true);
    expect(landmarks.solid(x, ground + 11, z)).toBe(false);
  });

  it("merges each landmark into a few meshes within a triangle budget", () => {
    expect(landmarks.root.children.length).toBe(8);
    let triangles = 0;
    for (const group of landmarks.root.children) {
      expect(group.children.length).toBeGreaterThan(0);
      expect(group.children.length).toBeLessThan(20);
      for (const child of group.children) {
        const mesh = child as THREE.Mesh;
        triangles += mesh.geometry.getAttribute("position").count / 3;
        mesh.geometry.computeBoundingBox();
        expect(Number.isFinite(mesh.geometry.boundingBox!.max.y)).toBe(true);
      }
    }
    expect(triangles).toBeLessThan(420_000);
  });

  it("adds warm lamps and removes them on dispose", () => {
    const extra = createLandmarks({ materials });
    const before = LAMPS.length;
    expect(before).toBeGreaterThanOrEqual(2 * 17);
    extra.update(1.5, 0.016);
    extra.dispose();
    expect(LAMPS.length).toBe(before - 17);
  });
});
