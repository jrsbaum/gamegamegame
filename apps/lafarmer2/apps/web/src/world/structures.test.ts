import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { ArchMaterials } from "./architecture";
import { sampleGroundMask } from "./groundMask";
import { groundHeight, tileToWorldX, tileToWorldZ } from "./height";
import { LAMPS } from "./shared";
import { createStructure, footprintTiles, insideTiles, isStructureType, tilesToWorld, type StructureType } from "./structures";

const materials = new Proxy({}, { get: () => new THREE.MeshBasicMaterial() }) as ArchMaterials;

/** The footprint the server stores for a structure at (x, y). */
const footprint = (x: number, y: number, width: number, height: number): Array<[number, number]> => [
  [x, y],
  [x + width, y],
  [x + width, y + height],
  [x, y + height]
];

const SIZES: Record<StructureType, [number, number]> = {
  house: [5, 3],
  field: [4, 3],
  orchard: [5, 4],
  animal_pen: [6, 5],
  dinosaur_enclosure: [8, 6]
};

const bounds = (root: THREE.Object3D): THREE.Box3 => {
  root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(root);
};

const triangles = (root: THREE.Object3D): number => {
  let total = 0;
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh) total += mesh.geometry.getAttribute("position").count / 3;
  });
  return total;
};

describe("footprints", () => {
  it("covers the tiles the server blocks and maps them to the world", () => {
    const tiles = footprintTiles(footprint(12, 20, 4, 3));
    expect(tiles).toEqual({ x0: 12, y0: 20, x1: 16, y1: 23 });
    expect(insideTiles(tiles, 12, 20)).toBe(true);
    expect(insideTiles(tiles, 15, 22)).toBe(true);
    expect(insideTiles(tiles, 16, 22)).toBe(false);
    expect(insideTiles(tiles, 12, 23)).toBe(false);
    const rect = tilesToWorld(tiles);
    expect(rect.x0).toBeCloseTo(tileToWorldX(11.5));
    expect(rect.x1 - rect.x0).toBeCloseTo(12);
    expect(rect.z1 - rect.z0).toBeCloseTo(9);
    expect(isStructureType("field")).toBe(true);
    expect(isStructureType("toString")).toBe(false);
  });
});

describe("createStructure", () => {
  it("keeps every structure but the house roof inside its footprint, within a triangle budget", () => {
    for (const type of Object.keys(SIZES) as StructureType[]) {
      const [width, height] = SIZES[type];
      const structure = createStructure(type, `test-${type}`, footprint(14, 20, width, height), { materials });
      const rect = tilesToWorld(structure.tiles);
      const box = bounds(structure.root);
      const slack = type === "house" ? 1.6 : 0.02;
      expect(box.min.x, type).toBeGreaterThan(rect.x0 - slack);
      expect(box.max.x, type).toBeLessThan(rect.x1 + slack);
      expect(box.min.z, type).toBeGreaterThan(rect.z0 - slack);
      expect(box.max.z, type).toBeLessThan(rect.z1 + slack);
      expect(triangles(structure.root), type).toBeLessThan(150_000);
      expect(structure.root.children.length, type).toBeLessThan(20);
      const { pen } = structure;
      expect(pen.x0, type).toBeGreaterThan(rect.x0);
      expect(pen.x1, type).toBeLessThan(rect.x1);
      expect(pen.z0, type).toBeGreaterThan(rect.z0);
      expect(pen.z1, type).toBeLessThan(rect.z1);
      expect(pen.x1 - pen.x0, type).toBeGreaterThan(4);
      expect(pen.z1 - pen.z0, type).toBeGreaterThan(4);
      structure.dispose();
    }
  });

  it("marks its ground while it stands and restores it when removed", () => {
    const fieldTile = { x: 30, y: 36 };
    const penRect = tilesToWorld(footprintTiles(footprint(30, 40, 6, 5)));
    const insideGate = { x: (penRect.x0 + penRect.x1) / 2, z: penRect.z1 - 1.5 };
    const tilledBefore = sampleGroundMask(tileToWorldX(fieldTile.x), tileToWorldZ(fieldTile.y));
    const dirtBefore = sampleGroundMask(insideGate.x, insideGate.z);
    const field = createStructure("field", "mask-field", footprint(fieldTile.x, fieldTile.y, 4, 3), { materials });
    const pen = createStructure("animal_pen", "mask-pen", footprint(30, 40, 6, 5), { materials });
    expect(sampleGroundMask(tileToWorldX(fieldTile.x + 1), tileToWorldZ(fieldTile.y + 1)).tilled).toBe(1);
    expect(sampleGroundMask(insideGate.x, insideGate.z)).toMatchObject({ path: 1, bare: 1 });
    field.dispose();
    pen.dispose();
    expect(sampleGroundMask(tileToWorldX(fieldTile.x), tileToWorldZ(fieldTile.y))).toEqual(tilledBefore);
    expect(sampleGroundMask(insideGate.x, insideGate.z)).toEqual(dirtBefore);
  });

  it("lights its lanterns and puts them out on dispose", () => {
    const before = LAMPS.length;
    const enclosure = createStructure("dinosaur_enclosure", "lamps", footprint(20, 26, 8, 6), { materials });
    expect(LAMPS.length).toBe(before + 2);
    enclosure.update(3.2);
    expect(enclosure.root.parent).toBeNull();
    const parent = new THREE.Group();
    parent.add(enclosure.root);
    enclosure.dispose();
    expect(LAMPS.length).toBe(before);
    expect(enclosure.root.parent).toBeNull();
  });

  it("stops the camera at the palisade and the house, not over the open enclosure", () => {
    const enclosure = createStructure("dinosaur_enclosure", "solid", footprint(20, 26, 8, 6), { materials });
    const rect = tilesToWorld(enclosure.tiles);
    const x = (rect.x0 + rect.x1) / 2 - 5;
    const north = rect.z0 + 0.6;
    expect(enclosure.solid(x, groundHeight(x, north) + 1, north)).toBe(true);
    expect(enclosure.solid(x, groundHeight(x, north) + 4, north)).toBe(false);
    const middle = (rect.z0 + rect.z1) / 2 + 2;
    expect(enclosure.solid(x, groundHeight(x, middle) + 1.5, middle)).toBe(false);
    enclosure.dispose();

    const house = createStructure("house", "solid-house", footprint(20, 36, 5, 3), { materials });
    const home = tilesToWorld(house.tiles);
    const cx = (home.x0 + home.x1) / 2;
    const cz = (home.z0 + home.z1) / 2;
    expect(house.solid(cx, groundHeight(cx, cz) + 2, cz)).toBe(true);
    expect(house.solid(cx, groundHeight(cx, cz) + 14, cz)).toBe(false);
    house.dispose();
  });
});
