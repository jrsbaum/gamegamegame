import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { getContentDefinition, type GrowthStage } from "@lafarmer2/content";
import { rod } from "./architecture";
import { SURFACES } from "./assets";
import type { Circle } from "./controller";
import { atlasCell, createRng, strawTexture, tomatoLeafTexture, type Rng } from "./foliage";
import { clearBareSpots, clearTilledTiles, setBareSpots, setTilledTiles } from "./groundMask";
import { cycleProgress, growthProgress, type GrowthProgress } from "./growth";
import { groundHeight, hashString, tileToWorldX, tileToWorldZ, valueNoise } from "./height";
import { surfaceMaterial, tintMaterial } from "./materials";
import { withGlobals } from "./shared";
import { buildTrees, leafMaterial, type TreeBuild } from "./trees";

/*
 * Crops as they grow on the farm. A tomato bed is a ridged mound with six plants climbing an
 * A-frame of bamboo canes; an orange tree grows from a staked sapling into a fruiting tree. The
 * server decides stages and harvests; the plants only show how far along their stage they are.
 */

/** What the server says about a crop, enough to draw it. */
export type CropState = {
  stageId: string;
  plantedAt: number;
  ready: boolean;
  pendingQuantity: number;
  nextProductionAt: number | null;
};

export type Crop = {
  readonly root: THREE.Group;
  /** Height above the ground where a status marker floats; grows with the plant. */
  readonly markerHeight: number;
  /** Where the walker cannot pass, in world units. */
  readonly colliders: ReadonlyArray<Circle>;
  /** Cheap when nothing visible changed: call it when a new state arrives and every second or so. */
  update: (state: CropState, now: number) => void;
  dispose: () => void;
};

type Tint = readonly [number, number, number];

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const WHITE: Tint = [1, 1, 1];

const linear = (hex: number): Tint => {
  const color = new THREE.Color(hex);
  return [color.r, color.g, color.b];
};

const mix = (a: Tint, b: Tint, t: number): Tint => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const shade = (tint: Tint, factor: number): Tint => [tint[0] * factor, tint[1] * factor, tint[2] * factor];

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const smooth = (edge0: number, edge1: number, value: number): number => {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

const COLORS = {
  cane: linear(0xb89e66),
  caneNode: linear(0x8a7448),
  twine: linear(0xa48a5a),
  stem: linear(0x5f8a30),
  calyx: linear(0x3e6c22),
  unripe: linear(0x8cb244),
  breaker: linear(0xea962e),
  ripe: linear(0xd22e18),
  orangeGreen: linear(0x5e8e2c),
  orangeTurning: linear(0xc9b434),
  orange: linear(0xf28a14),
  fruitStem: linear(0x4b5a2a)
};

type CropMaterials = { soil: THREE.Material; matte: THREE.Material; gloss: THREE.Material; leaf: THREE.Material; hanging: THREE.Material; straw: THREE.Material };
let shared: CropMaterials | undefined;

/** Fruit that rides the sway of the leaf cards it hangs among; `aWind` = (flex, phase) of that card. */
const hangingFruitMaterial = (): THREE.MeshStandardMaterial =>
  withGlobals(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.46, metalness: 0, vertexColors: true }), "crop-hanging-fruit", (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 aWind;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
  vec3 windBase = (modelMatrix * vec4(transformed, 1.0)).xyz;
  float windFlex = aWind.x;
  transformed += windSway(windBase, 0.018 * windFlex * windFlex + 0.004 * windFlex, aWind.y) * min(windFlex, 8.0) * 0.16;`
      );
  });

/** Shared by every crop, never disposed per crop. */
const materials = (): CropMaterials =>
  (shared ??= {
    soil: surfaceMaterial(SURFACES.soil, { color: new THREE.Color(1.05, 1, 0.95), vertexColors: true }),
    matte: tintMaterial(0xffffff, { roughness: 0.78, vertexColors: true }),
    gloss: tintMaterial(0xffffff, { roughness: 0.26, vertexColors: true }),
    leaf: leafMaterial(tomatoLeafTexture(), "tomato", { translucency: 0.7, flutter: 0.35, roughness: 0.62 }),
    hanging: hangingFruitMaterial(),
    straw: withGlobals(new THREE.MeshStandardMaterial({ map: strawTexture(), alphaTest: 0.5, roughness: 0.92, metalness: 0, vertexColors: true }), "crop-straw")
  });

/** Collects pieces per material and merges them into one mesh per material. */
class Batch {
  private readonly lists = new Map<THREE.Material, THREE.BufferGeometry[]>();

  add(material: THREE.Material, geometry: THREE.BufferGeometry, tint: Tint = WHITE): void {
    const count = geometry.getAttribute("position").count;
    if (!geometry.index) geometry.setIndex(Array.from({ length: count }, (_, index) => index));
    if (!geometry.getAttribute("color")) {
      const colors = new Float32Array(count * 3);
      for (let index = 0; index < count; index += 1) colors.set(tint, index * 3);
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    }
    const list = this.lists.get(material) ?? [];
    list.push(geometry);
    this.lists.set(material, list);
  }

  build(parent: THREE.Object3D, name: string): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    for (const [material, list] of this.lists) {
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (list.length > 1) list.forEach((geometry) => geometry.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = name;
      mesh.castShadow = material !== shared?.straw;
      mesh.receiveShadow = true;
      parent.add(mesh);
      meshes.push(mesh);
    }
    this.lists.clear();
    return meshes;
  }
}

const disposeMeshes = (meshes: readonly THREE.Mesh[]): void => {
  for (const mesh of meshes) {
    mesh.removeFromParent();
    mesh.geometry.dispose();
  }
};

/** Tapered tube through `points`. */
const tube = (points: readonly THREE.Vector3[], radii: readonly number[], sides = 5): THREE.BufferGeometry => {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();
  const lift = new THREE.Vector3();
  const ring = new THREE.Vector3();
  points.forEach((point, at) => {
    tangent.subVectors(points[Math.min(points.length - 1, at + 1)], points[Math.max(0, at - 1)]).normalize();
    side.crossVectors(tangent, Math.abs(tangent.y) < 0.95 ? UP : X_AXIS).normalize();
    lift.crossVectors(side, tangent).normalize();
    for (let step = 0; step <= sides; step += 1) {
      const angle = (step / sides) * TAU;
      ring.copy(side).multiplyScalar(Math.cos(angle)).addScaledVector(lift, Math.sin(angle));
      positions.push(point.x + ring.x * radii[at], point.y + ring.y * radii[at], point.z + ring.z * radii[at]);
      normals.push(ring.x, ring.y, ring.z);
      uvs.push(step / sides, at / Math.max(1, points.length - 1));
    }
  });
  for (let at = 0; at < points.length - 1; at += 1) {
    for (let step = 0; step < sides; step += 1) {
      const a = at * (sides + 1) + step;
      const c = a + sides + 1;
      index.push(a, c, a + 1, a + 1, c, c + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  return geometry;
};

/** Horizontal loop of twine centred at `at`. */
const twine = (at: THREE.Vector3, radius: number): THREE.BufferGeometry =>
  new THREE.TorusGeometry(radius, 0.0035, 4, 10).rotateX(Math.PI / 2).translate(at.x, at.y, at.z);

/** Five-pointed calyx lying on top of a fruit at `at`, its sepals curling down. */
const calyx = (at: THREE.Vector3, radius: number, turn: number): THREE.BufferGeometry => {
  const positions = [at.x, at.y + radius * 0.12, at.z];
  for (let point = 0; point < 10; point += 1) {
    const angle = turn + (point / 10) * TAU;
    const reach = point % 2 === 0 ? radius : radius * 0.32;
    positions.push(at.x + Math.cos(angle) * reach, at.y + (point % 2 === 0 ? -radius * 0.18 : radius * 0.04), at.z + Math.sin(angle) * reach);
  }
  const index: number[] = [];
  for (let point = 0; point < 10; point += 1) index.push(0, 1 + ((point + 1) % 10), 1 + point);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(22), 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
};

type LeafCard = {
  base: THREE.Vector3;
  azimuth: number;
  length: number;
  width: number;
  /** Elevation of the petiole above the horizon. */
  rise: number;
  /** How much the outer half bends down from the inner half. */
  droop: number;
  roll: number;
  cell: number;
  tint: Tint;
  flex: number;
  phase: number;
};

/**
 * Bent leaf cards from the tomato atlas: three rows from the stem out to the drooping tip, with a
 * raised midrib. `aWind` = (flex, phase, 1), the flex growing toward the tip.
 */
const leafCards = (cards: readonly LeafCard[]): THREE.BufferGeometry => {
  const count = cards.length;
  const positions = new Float32Array(count * 27);
  const normals = new Float32Array(count * 27);
  const uvs = new Float32Array(count * 18);
  const colors = new Float32Array(count * 27);
  const wind = new Float32Array(count * 27);
  const index: number[] = [];
  const forward = new THREE.Vector3();
  const across = new THREE.Vector3();
  const along = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const bent = new THREE.Vector3();
  const point = new THREE.Vector3();
  const rows = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  cards.forEach((card, cardIndex) => {
    forward.set(Math.cos(card.azimuth), 0, Math.sin(card.azimuth));
    across.crossVectors(UP, forward).normalize().applyAxisAngle(forward, card.roll);
    const half = card.length / 2;
    rows[0].copy(card.base);
    rows[1].copy(card.base).addScaledVector(forward, half * Math.cos(card.rise)).addScaledVector(UP, half * Math.sin(card.rise));
    rows[2].copy(rows[1]).addScaledVector(forward, half * Math.cos(card.rise - card.droop)).addScaledVector(UP, half * Math.sin(card.rise - card.droop));
    along.subVectors(rows[2], rows[0]).normalize();
    normal.crossVectors(along, across).normalize();
    if (normal.y < 0) normal.negate();
    const [u0, v0, cellWidth, cellHeight] = atlasCell(card.cell, 2, 2);
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        const vertex = cardIndex * 9 + row * 3 + column;
        const offset = column - 1;
        point.copy(rows[row]).addScaledVector(across, offset * card.width * 0.5);
        if (offset === 0 && row > 0) point.addScaledVector(normal, card.width * 0.1);
        positions.set([point.x, point.y, point.z], vertex * 3);
        bent.copy(normal).addScaledVector(UP, 0.5).addScaledVector(across, offset * 0.25).normalize();
        normals.set([bent.x, bent.y, bent.z], vertex * 3);
        uvs.set([u0 + (column / 2) * cellWidth, v0 + (row / 2) * cellHeight], vertex * 2);
        const light = row === 0 ? 0.85 : 1;
        colors.set([card.tint[0] * light, card.tint[1] * light, card.tint[2] * light], vertex * 3);
        wind.set([card.flex + row * 0.45, card.phase, 1], vertex * 3);
      }
    }
    for (let row = 0; row < 2; row += 1) {
      for (let column = 0; column < 2; column += 1) {
        const a = cardIndex * 9 + row * 3 + column;
        index.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
      }
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aWind", new THREE.BufferAttribute(wind, 3));
  geometry.setIndex(index);
  return geometry;
};

/** A grid sample of a straw mat, in the crop's local units; `edge` is its distance to the border. */
type StrawSample = { x: number; z: number; edge: number };

/**
 * Straw mulch lying on `surface`, sampled on a grid. Vertex alpha thins the straw out raggedly
 * near the border, so the mat has no visible outline. `cx`, `cz` anchor the texture in the world.
 */
const strawMat = (columns: number, rows: number, sample: (u: number, v: number) => StrawSample, surface: (x: number, z: number) => number, cx: number, cz: number): THREE.BufferGeometry => {
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const index: number[] = [];
  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      const { x, z, edge } = sample(column / columns, row / rows);
      const wx = cx + x;
      const wz = cz + z;
      positions.push(x, surface(x, z) + 0.012, z);
      uvs.push(wx / 0.9, wz / 0.9);
      const light = 0.8 + 0.28 * valueNoise(wx * 3.1, wz * 3.1);
      const ragged = edge - 0.03 + (valueNoise(wx * 11, wz * 11) - 0.5) * 0.14;
      colors.push(light, light, light * 0.97, clamp01(ragged / 0.1));
    }
  }
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = row * (columns + 1) + column;
      const c = a + columns + 1;
      index.push(a, c, a + 1, a + 1, c, c + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 4));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
};

/* ------------------------------------------------------------------ tomato bed */

/** The ridge runs along the bed's X; its slopes reach the ground at these half extents. */
const BED = { halfLength: 1.3, halfWidth: 0.62, height: 0.18 };
const PLANT_X = [-0.75, 0, 0.75];
const ROW_Z = 0.3;
/** Canes stand this far along X from their plant, and cross this high above the ridge. */
const CANE_OFFSET = 0.04;
const CROSSING = 1.42;
const NODE_START = 0.14;
const NODE_STEP = 0.1;
const TRUSS_HEIGHTS = [0.38, 0.62, 0.86, 1.1];

/** Height of the ridge above the surrounding ground at (x, z) of the bed. */
const ridge = (x: number, z: number): number =>
  BED.height * (1 - smooth(0.6, 1, Math.abs(z) / BED.halfWidth)) * (1 - smooth(0.85, 1, Math.abs(x) / BED.halfLength));

/** The ridge following the terrain; its outer ring sinks below the ground to hide the seam. */
const moundGeometry = (cx: number, cz: number, base: number): THREE.BufferGeometry => {
  const columns = 26;
  const rows = 12;
  const extentX = BED.halfLength + 0.08;
  const extentZ = BED.halfWidth + 0.08;
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const index: number[] = [];
  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      const x = ((column / columns) * 2 - 1) * extentX;
      const z = ((row / rows) * 2 - 1) * extentZ;
      const edge = row === 0 || row === rows || column === 0 || column === columns;
      const lift = ridge(x, z);
      const clods = (valueNoise((cx + x) * 7.3, (cz + z) * 7.3) - 0.5) * 0.025 * (lift / BED.height);
      positions.push(x, groundHeight(cx + x, cz + z) - base + (edge ? -0.05 : lift + clods), z);
      uvs.push((cx + x) / 3, (cz + z) / 3);
      const light = 0.72 + 0.3 * smooth(0.25, 1, lift / BED.height);
      colors.push(light, light * 0.98, light * 0.95);
    }
  }
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = row * (columns + 1) + column;
      const c = a + columns + 1;
      index.push(a, c, a + 1, a + 1, c, c + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
};

type LeafPlan = { azimuth: number; size: number; rise: number; droop: number; roll: number; cell: number; shade: number; phase: number };
type TrussPlan = { turn: number; fruits: number; size: number };
type PlantPlan = { phase: number; leaves: LeafPlan[]; trusses: TrussPlan[] };

/** Everything random about a plant, drawn once so it keeps its look as it grows. */
const planPlant = (rng: Rng): PlantPlan => {
  const phase = rng.range(0, TAU);
  return {
    phase,
    leaves: Array.from({ length: 16 }, (_, index) => ({
      azimuth: phase + index * 2.4 + rng.range(-0.35, 0.35),
      size: rng.range(0.85, 1.15),
      rise: rng.range(0.35, 0.7),
      droop: rng.range(1.2, 1.8),
      roll: (rng.next() < 0.5 ? -1 : 1) * rng.range(0.25, 0.7),
      cell: rng.int(0, 1),
      shade: rng.range(0.88, 1.08),
      phase: rng.range(0, TAU)
    })),
    trusses: TRUSS_HEIGHTS.map(() => ({ turn: rng.range(-0.5, 0.5), fruits: rng.int(4, 6), size: rng.range(0.88, 1.12) }))
  };
};

/** A plant rooted on the ridge, its cane leaning in to cross its partner's above the bed. */
type PlantSpot = { base: THREE.Vector3; entry: THREE.Vector3; crossing: THREE.Vector3; plan: PlantPlan };

type TrussShape = { flowers: boolean; fruitSize: number; ripeness: number };
type TomatoShape = { height: number; seedling: boolean; ripe: boolean; trusses: TrussShape[] };

/** How tall the plants stand and how far each truss has come. Trusses develop as the stem grows past them. */
const tomatoShape = (progress: GrowthProgress, last: number): TomatoShape => {
  if (progress.stage === 0) return { height: 0.07 + 0.2 * progress.fraction, seedling: true, ripe: false, trusses: [] };
  const ripe = progress.stage >= last;
  const height = ripe ? 1.38 : 0.3 + 0.8 * progress.fraction;
  const trusses = TRUSS_HEIGHTS.filter((at) => at + 0.1 < height).map((at, index) => {
    const age = (height - at - 0.1) / 0.5;
    const ripeness = ripe ? clamp01((age - 0.3) * 1.4) : index === 0 ? clamp01((progress.fraction - 0.85) / 0.15) * 0.4 : 0;
    return { flowers: age < 0.55, fruitSize: smooth(0.2, 1, age), ripeness };
  });
  return { height, seedling: false, ripe, trusses };
};

/** A point on the stem `s` above its base: beside the cane, with a gentle zig-zag. */
const stemPoint = (spot: PlantSpot, s: number, out = new THREE.Vector3()): THREE.Vector3 => {
  const y = spot.base.y + s;
  out.lerpVectors(spot.entry, spot.crossing, (y - spot.entry.y) / (spot.crossing.y - spot.entry.y));
  out.x += -CANE_OFFSET + Math.sin(s * 19 + spot.plan.phase) * 0.012 * Math.min(1, s / 0.3);
  out.z += Math.cos(s * 15 + spot.plan.phase) * 0.008 * Math.min(1, s / 0.3);
  out.y = y;
  return out;
};

const tomatoColor = (ripeness: number): Tint =>
  ripeness < 0.5 ? mix(COLORS.unripe, COLORS.breaker, ripeness * 2) : mix(COLORS.breaker, COLORS.ripe, (ripeness - 0.5) * 2);

const addPlant = (batch: Batch, cards: LeafCard[], spot: PlantSpot, shape: TomatoShape, rng: Rng): void => {
  const mats = materials();
  const { plan } = spot;
  const height = shape.height;
  const samples = Math.max(4, Math.ceil(height / 0.05));
  const stem: THREE.Vector3[] = [];
  const radii: number[] = [];
  const rootRadius = 0.004 + 0.007 * Math.min(1, height);
  for (let step = 0; step <= samples; step += 1) {
    const s = (step / samples) * height;
    stem.push(stemPoint(spot, s - (step === 0 ? 0.03 : 0)));
    radii.push(THREE.MathUtils.lerp(rootRadius, rootRadius * 0.4, step / samples));
  }
  batch.add(mats.matte, tube(stem, radii, 5), shade(COLORS.stem, rng.range(0.9, 1.05)));

  if (shape.seedling) {
    for (const side of [0, Math.PI]) {
      cards.push({ base: stemPoint(spot, 0.025), azimuth: plan.phase + side, length: 0.05, width: 0.022, rise: 0.35, droop: 0.3, roll: 0, cell: 2, tint: [0.95, 1, 0.9], flex: 0.5, phase: plan.phase });
    }
    for (let node = 0; ; node += 1) {
      const s = 0.045 + node * 0.04;
      if (s > height - 0.015) break;
      const leaf = plan.leaves[node];
      const length = Math.min(0.16, 0.06 + 0.5 * (height - s));
      cards.push({ base: stemPoint(spot, s), azimuth: leaf.azimuth, length, width: length * 0.85, rise: 0.6, droop: 0.5, roll: leaf.roll, cell: 2, tint: shade(WHITE, leaf.shade), flex: 0.6, phase: leaf.phase });
    }
    return;
  }

  for (let tie = 0.3; tie < height - 0.1; tie += 0.3) {
    const at = stemPoint(spot, tie);
    at.x += CANE_OFFSET / 2;
    batch.add(mats.matte, twine(at, 0.026), COLORS.twine);
  }

  for (let node = 0; node < plan.leaves.length; node += 1) {
    const s = NODE_START + node * NODE_STEP;
    if (s > height - 0.02) break;
    const leaf = plan.leaves[node];
    const youth = clamp01((height - s) / 0.3);
    const length = 0.42 * leaf.size * (0.35 + 0.65 * Math.max(0.2, youth));
    const rise = leaf.rise + (1 - youth) * 0.6;
    let droop = leaf.droop * (0.5 + 0.5 * youth);
    const tipHeight = (): number => s + (length / 2) * (Math.sin(rise) + Math.sin(rise - droop));
    while (droop > 0.2 && tipHeight() < 0.06) droop -= 0.1;
    const light = leaf.shade * (0.72 + 0.3 * Math.min(1, s / 1.4));
    const tint: Tint = shape.ripe && node < 2 ? [light * 1.1, light, light * 0.6] : [light, light, light];
    const card: LeafCard = {
      base: stemPoint(spot, s),
      azimuth: leaf.azimuth,
      length,
      width: length * 0.95,
      rise,
      droop,
      roll: leaf.roll,
      cell: youth < 0.55 ? 2 : leaf.cell,
      tint,
      flex: 0.7 + Math.min(1, s / 1.4),
      phase: leaf.phase
    };
    cards.push(card);
    // A second card across the first keeps the leaf visible from the side, where one card is only a sliver.
    if (youth > 0.3) {
      cards.push({
        ...card,
        azimuth: card.azimuth + 0.3,
        length: length * 0.8,
        width: length * 0.76,
        droop: droop * 0.85,
        roll: card.roll + (card.roll >= 0 ? -1.25 : 1.25),
        cell: card.cell === 2 ? 2 : 1 - card.cell,
        phase: card.phase + 1.3
      });
    }
  }

  shape.trusses.forEach((truss, index) => {
    const s = TRUSS_HEIGHTS[index];
    const plannedTruss = plan.trusses[index];
    const nearest = plan.leaves[Math.min(plan.leaves.length - 1, Math.round((s - NODE_START) / NODE_STEP))];
    const azimuth = nearest.azimuth + Math.PI * 0.8 + plannedTruss.turn;
    const out = new THREE.Vector3(Math.cos(azimuth), 0, Math.sin(azimuth));
    const side = new THREE.Vector3(-out.z, 0, out.x);
    const node = stemPoint(spot, s);
    if (truss.flowers) {
      cards.push({ base: node.clone(), azimuth, length: 0.13, width: 0.12, rise: -0.15, droop: 0.35, roll: 0, cell: 3, tint: WHITE, flex: 1.2, phase: plan.phase + index });
    }
    if (truss.fruitSize < 0.08) return;
    const pedicels: THREE.Vector3[] = [node.clone(), node.clone().addScaledVector(out, 0.05).addScaledVector(UP, 0.01)];
    for (let fruit = 0; fruit < plannedTruss.fruits; fruit += 1) {
      pedicels.push(node.clone().addScaledVector(out, 0.07 + 0.026 * fruit).addScaledVector(UP, -0.03 - 0.032 * fruit).addScaledVector(side, (fruit % 2 ? 1 : -1) * 0.03));
    }
    batch.add(mats.matte, tube(pedicels, pedicels.map((_, at) => 0.004 - at * 0.0003), 4), COLORS.stem);
    for (let fruit = 0; fruit < plannedTruss.fruits; fruit += 1) {
      const radius = 0.034 * plannedTruss.size * truss.fruitSize * (1 - 0.05 * fruit);
      const ripeness = clamp01(truss.ripeness * 1.15 - fruit * 0.07);
      const centre = pedicels[fruit + 2].clone().addScaledVector(UP, -radius * 0.9).addScaledVector(side, (fruit % 2 ? 1 : -1) * 0.01);
      const body = new THREE.SphereGeometry(1, 10, 7).scale(radius, radius * 0.88, radius).translate(centre.x, centre.y, centre.z);
      batch.add(mats.gloss, body, shade(tomatoColor(ripeness), rng.range(0.92, 1.06)));
      batch.add(mats.matte, calyx(centre.clone().addScaledVector(UP, radius * 0.86), radius * 0.75, rng.range(0, TAU)), COLORS.calyx);
    }
  });
};

const createTomatoBed = (id: string, tile: { x: number; y: number }, stages: readonly GrowthStage[], seed: number): Omit<Crop, "update"> & { grow: (progress: GrowthProgress) => void } => {
  const mats = materials();
  const rng = createRng(seed);
  const cx = tileToWorldX(tile.x);
  const cz = tileToWorldZ(tile.y);
  const base = groundHeight(cx, cz);
  const root = new THREE.Group();
  root.name = "tomato-bed";
  root.position.set(cx, base, cz);
  const surface = (x: number, z: number): number => groundHeight(cx + x, cz + z) - base + ridge(x, z);

  const spots: PlantSpot[] = [];
  const frame = new Batch();
  frame.add(mats.soil, moundGeometry(cx, cz, base));
  const crossings: THREE.Vector3[] = [];
  for (const px of PLANT_X) {
    const entries = [-1, 1].map((side) => new THREE.Vector3(px + CANE_OFFSET, surface(px + CANE_OFFSET, side * ROW_Z), side * ROW_Z));
    const crossing = new THREE.Vector3(px + CANE_OFFSET, Math.max(entries[0].y, entries[1].y) + CROSSING, 0);
    crossings.push(crossing);
    for (const entry of entries) {
      spots.push({ base: new THREE.Vector3(px, surface(px, entry.z), entry.z), entry, crossing, plan: planPlant(rng) });
      const down = entry.clone().sub(crossing).normalize();
      frame.add(mats.matte, rod(entry.clone().addScaledVector(down, 0.2), crossing.clone().addScaledVector(down, -0.2), 0.011, 0.009), shade(COLORS.cane, rng.range(0.9, 1.08)));
      const length = entry.distanceTo(crossing) + 0.2;
      for (let at = 0.22 + rng.range(0, 0.1); at < length; at += rng.range(0.28, 0.36)) {
        const knot = entry.clone().addScaledVector(down, -at);
        frame.add(mats.matte, rod(knot.clone().addScaledVector(down, 0.006), knot.clone().addScaledVector(down, -0.006), 0.0125, 0.0125), COLORS.caneNode);
      }
    }
    frame.add(mats.matte, twine(crossing, 0.022), COLORS.twine);
    frame.add(mats.matte, new THREE.TorusGeometry(0.022, 0.0035, 4, 10).translate(crossing.x, crossing.y, crossing.z), COLORS.twine);
  }
  const ridgeCane = [crossings[0].clone().add(new THREE.Vector3(-0.38, 0, 0)), ...crossings, crossings[crossings.length - 1].clone().add(new THREE.Vector3(0.38, 0, 0))]
    .map((point) => point.clone().add(new THREE.Vector3(0, 0.014, 0)));
  frame.add(mats.matte, tube(ridgeCane, ridgeCane.map(() => 0.011), 6), COLORS.cane);
  const mulch = { halfLength: BED.halfLength - 0.1, halfWidth: 0.46 };
  frame.add(
    mats.straw,
    strawMat(
      48,
      18,
      (u, v) => {
        const x = (u * 2 - 1) * mulch.halfLength;
        const z = (v * 2 - 1) * mulch.halfWidth;
        return { x, z, edge: Math.min(mulch.halfLength - Math.abs(x), mulch.halfWidth - Math.abs(z)) };
      },
      surface,
      cx,
      cz
    )
  );
  const frameMeshes = frame.build(root, "tomato-bed");

  const tilledKey = `crop-${id}`;
  setTilledTiles(tilledKey, [[Math.round(tile.x), Math.round(tile.y)]]);

  let plantMeshes: THREE.Mesh[] = [];
  const last = stages.length - 1;
  return {
    root,
    markerHeight: CROSSING + 0.45,
    colliders: [
      { x: cx - 0.6, z: cz, radius: 0.62 },
      { x: cx + 0.6, z: cz, radius: 0.62 }
    ],
    grow: (progress) => {
      disposeMeshes(plantMeshes);
      const shape = tomatoShape(progress, last);
      const batch = new Batch();
      const cards: LeafCard[] = [];
      const plantRng = createRng(seed ^ 0x5bd1e995);
      for (const spot of spots) addPlant(batch, cards, spot, shape, plantRng);
      if (cards.length) batch.add(mats.leaf, leafCards(cards));
      plantMeshes = batch.build(root, "tomato-plants");
    },
    dispose: () => {
      disposeMeshes(plantMeshes);
      disposeMeshes(frameMeshes);
      clearTilledTiles(tilledKey);
      root.removeFromParent();
    }
  };
};

/* ------------------------------------------------------------------ orange tree */

const ORANGE_SCALE = 0.95;

type FruitSpot = { position: THREE.Vector3; flex: number; phase: number };

const SHELL_AZIMUTHS = 16;
const SHELL_ELEVATIONS = 8;

/** Direction bin on a sphere around the crown, 16 around by 8 from bottom to top. */
const shellBin = (direction: THREE.Vector3): number => {
  const azimuth = Math.floor(((Math.atan2(direction.z, direction.x) / TAU + 1) % 1) * SHELL_AZIMUTHS) % SHELL_AZIMUTHS;
  const elevation = Math.min(SHELL_ELEVATIONS - 1, Math.floor((Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1)) / Math.PI + 0.5) * SHELL_ELEVATIONS));
  return elevation * SHELL_AZIMUTHS + azimuth;
};

/**
 * Places on the outside of the crown where oranges can hang in view, shuffled and kept apart:
 * the outermost leaf card in each direction from the crown centre sets how far out the fruit goes.
 */
const fruitSpots = (build: TreeBuild, rng: Rng): FruitSpot[] => {
  const tree = build.trees[0];
  const foliage = build.root.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh && child.name === "foliage-citrus");
  if (!foliage) return [];
  const position = foliage.geometry.getAttribute("position");
  const wind = foliage.geometry.getAttribute("aWind");
  const corner = new THREE.Vector3();
  const shell = new Float32Array(SHELL_AZIMUTHS * SHELL_ELEVATIONS);
  const cards: Array<{ direction: THREE.Vector3; reach: number; bin: number; flex: number; phase: number }> = [];
  for (let card = 0; card * 4 + 3 < position.count; card += 1) {
    const offset = new THREE.Vector3();
    for (let vertex = 0; vertex < 4; vertex += 1) offset.add(corner.fromBufferAttribute(position, card * 4 + vertex));
    offset.multiplyScalar(0.25).sub(tree.crown);
    const reach = offset.length();
    if (reach < 1e-3) continue;
    const direction = offset.divideScalar(reach);
    const bin = shellBin(direction);
    shell[bin] = Math.max(shell[bin], reach);
    cards.push({ direction, reach, bin, flex: wind.getX(card * 4), phase: wind.getY(card * 4) });
  }
  const spots: FruitSpot[] = [];
  for (const card of cards) {
    if (card.direction.y > 0.5 || card.direction.y < -0.8 || card.reach < shell[card.bin] * 0.72) continue;
    spots.push({ position: tree.crown.clone().addScaledVector(card.direction, shell[card.bin] + 0.03), flex: card.flex, phase: card.phase });
  }
  for (let index = spots.length - 1; index > 0; index -= 1) {
    const other = rng.int(0, index);
    [spots[index], spots[other]] = [spots[other], spots[index]];
  }
  const kept: FruitSpot[] = [];
  for (const spot of spots) {
    if (kept.every((other) => other.position.distanceToSquared(spot.position) > 0.18 * 0.18)) kept.push(spot);
  }
  return kept;
};

/** Oranges on show: none on a sapling, a ripe crop while units wait for harvest, green fruit ripening otherwise. */
const orangeFruit = (state: CropState, progress: GrowthProgress, now: number, cycleSeconds: number | null): { count: number; ripeness: number; size: number } => {
  if (progress.stage === 0) return { count: 0, ripeness: 0, size: 0 };
  if (state.pendingQuantity > 0) return { count: Math.min(36, 14 + 6 * state.pendingQuantity), ripeness: 1, size: 1 };
  const cycle = cycleProgress(state.nextProductionAt, cycleSeconds, now);
  return { count: 12, ripeness: cycle, size: 0.55 + 0.45 * cycle };
};

const orangeColor = (ripeness: number): Tint =>
  ripeness < 0.6 ? mix(COLORS.orangeGreen, COLORS.orangeTurning, ripeness / 0.6) : mix(COLORS.orangeTurning, COLORS.orange, (ripeness - 0.6) / 0.4);

const orangeGeometry = (spot: FruitSpot, radius: number): THREE.BufferGeometry => {
  const geometry = new THREE.SphereGeometry(radius, 12, 9).scale(1, 0.94, 1).translate(spot.position.x, spot.position.y, spot.position.z);
  const count = geometry.getAttribute("position").count;
  const wind = new Float32Array(count * 2);
  for (let vertex = 0; vertex < count; vertex += 1) wind.set([spot.flex, spot.phase], vertex * 2);
  geometry.setAttribute("aWind", new THREE.BufferAttribute(wind, 2));
  return geometry;
};

const createOrangeTree = (id: string, tile: { x: number; y: number }, seed: number): Omit<Crop, "update" | "markerHeight"> & {
  grow: (progress: GrowthProgress, fruit: { count: number; ripeness: number; size: number }) => number;
} => {
  const mats = materials();
  const rng = createRng(seed);
  const cx = tileToWorldX(tile.x);
  const cz = tileToWorldZ(tile.y);
  const base = groundHeight(cx, cz);
  const root = new THREE.Group();
  root.name = "orange-tree";
  root.position.set(cx, base, cz);

  const build = buildTrees([{ kind: "citrus", x: 0, z: 0, scale: ORANGE_SCALE, lean: rng.range(0, TAU), variant: seed % 100_000 }]);
  const tree = build.trees[0];
  const top = new THREE.Box3().setFromObject(build.root).max.y - tree.y - 0.15;
  const spots = fruitSpots(build, rng);
  const growth = new THREE.Group();
  const crown = new THREE.Group();
  crown.position.y = -tree.y - 0.15;
  crown.add(build.root);
  growth.add(crown);
  root.add(growth);

  const surface = (x: number, z: number): number => groundHeight(cx + x, cz + z) - base;
  const ground = new Batch();
  const disc = new THREE.CircleGeometry(0.75, 24).rotateX(-Math.PI / 2);
  const discPosition = disc.getAttribute("position");
  const discColors = new Float32Array(discPosition.count * 3);
  for (let vertex = 0; vertex < discPosition.count; vertex += 1) {
    const x = discPosition.getX(vertex);
    const z = discPosition.getZ(vertex);
    const reach = Math.hypot(x, z) / 0.75;
    discPosition.setY(vertex, surface(x, z) + 0.02 - reach * 0.012);
    discColors.set([0.7 + 0.15 * reach, 0.68 + 0.14 * reach, 0.66 + 0.13 * reach], vertex * 3);
    disc.getAttribute("uv").setXY(vertex, (cx + x) / 3, (cz + z) / 3);
  }
  disc.setAttribute("color", new THREE.BufferAttribute(discColors, 3));
  disc.computeVertexNormals();
  ground.add(mats.soil, disc);
  const ring = { inner: 0.12, outer: 0.66 };
  ground.add(
    mats.straw,
    strawMat(
      40,
      8,
      (u, v) => {
        const angle = u * TAU;
        const reach = ring.inner + v * (ring.outer - ring.inner);
        return { x: Math.cos(angle) * reach, z: -Math.sin(angle) * reach, edge: Math.min(reach - ring.inner, ring.outer - reach) };
      },
      (x, z) => surface(x, z) + 0.02,
      cx,
      cz
    )
  );
  const groundMeshes = ground.build(root, "orange-mulch");
  const bareKey = `crop-${id}`;
  setBareSpots(bareKey, [{ x: cx, z: cz, radius: 0.85 }]);

  const stake = new THREE.Group();
  root.add(stake);
  const stakeParts = new Batch();
  stakeParts.add(mats.matte, rod(new THREE.Vector3(0.07, -0.2, 0.03), new THREE.Vector3(0.07, 1.25, 0.03), 0.012, 0.01), COLORS.cane);
  for (const y of [0.45, 0.85]) stakeParts.add(mats.matte, twine(new THREE.Vector3(0.035, y, 0.015), 0.045), COLORS.twine);
  const stakeMeshes = stakeParts.build(stake, "orange-stake");

  let fruitMeshes: THREE.Mesh[] = [];
  return {
    root,
    colliders: [{ x: cx, z: cz, radius: 0.3 }],
    grow: (progress, fruit) => {
      const size = progress.stage === 0 ? 0.32 + 0.56 * progress.fraction : 1;
      growth.scale.setScalar(size);
      stake.visible = progress.stage === 0;
      disposeMeshes(fruitMeshes);
      fruitMeshes = [];
      if (fruit.count) {
        const batch = new Batch();
        const fruitRng = createRng(seed ^ 0x27d4eb2d);
        spots.slice(0, fruit.count).forEach((spot, index) => {
          const radius = 0.06 * fruit.size * fruitRng.range(0.9, 1.1);
          const ripeness = clamp01(fruit.ripeness * fruitRng.range(0.85, 1.15) - (index % 3) * 0.04 * (1 - fruit.ripeness));
          batch.add(mats.hanging, orangeGeometry(spot, radius), shade(orangeColor(ripeness), fruitRng.range(0.9, 1.05)));
        });
        fruitMeshes = batch.build(crown, "oranges");
      }
      return top * size + 0.3;
    },
    dispose: () => {
      disposeMeshes(fruitMeshes);
      disposeMeshes(groundMeshes);
      disposeMeshes(stakeMeshes);
      clearBareSpots(bareKey);
      build.dispose();
      root.removeFromParent();
    }
  };
};

/* ------------------------------------------------------------------ factory */

/** The crop for a farm item on its tile, already grown to `state`; undefined for content that is not a crop. */
export const createCrop = (contentId: string, id: string, tile: { x: number; y: number }, state: CropState, now: number): Crop | undefined => {
  const definition = getContentDefinition(contentId);
  if (!definition || definition.kind !== "crop") return undefined;
  const seed = hashString(id);
  if (contentId === "tomato") {
    const bed = createTomatoBed(id, tile, definition.stages, seed);
    let shown = "";
    const update = (next: CropState, time: number): void => {
      const progress = growthProgress(definition.stages, next.plantedAt, time, next.stageId);
      const key = progress.stage >= definition.stages.length - 1 ? "ripe" : `${progress.stage}:${Math.floor(progress.fraction * 12)}`;
      if (key === shown) return;
      shown = key;
      bed.grow(progress);
    };
    update(state, now);
    return { root: bed.root, markerHeight: bed.markerHeight, colliders: bed.colliders, update, dispose: bed.dispose };
  }
  if (contentId === "orange-tree") {
    const tree = createOrangeTree(id, tile, seed);
    let shown = "";
    let marker = 1.5;
    const update = (next: CropState, time: number): void => {
      const progress = growthProgress(definition.stages, next.plantedAt, time, next.stageId);
      const fruit = orangeFruit(next, progress, time, definition.cycleSeconds);
      const growthStep = progress.stage === 0 ? Math.floor(progress.fraction * 24) : 24;
      const key = `${progress.stage}:${growthStep}:${fruit.count}:${Math.round(fruit.ripeness * 8)}:${Math.round(fruit.size * 8)}`;
      if (key === shown) return;
      shown = key;
      marker = tree.grow(progress, fruit);
    };
    update(state, now);
    return {
      root: tree.root,
      get markerHeight() {
        return marker;
      },
      colliders: tree.colliders,
      update,
      dispose: tree.dispose
    };
  }
  return undefined;
};
