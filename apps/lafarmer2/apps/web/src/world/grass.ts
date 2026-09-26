import * as THREE from "three";
import { createRng, type Rng } from "./foliage";
import { MASK_RECT } from "./groundMask";
import { WATER_LEVEL, farmSignedDistance, fbm, groundHeight, groundNormal, valueNoise, worldToTile } from "./height";
import { LAYER_NO_REFLECT, TRANSLUCENCY, after, withGlobals } from "./shared";
import { glsl } from "./trees";
import { insideClearing, type Clearing, type TreeSite } from "./vegetationLayout";

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/* ---------------------------------------------------------------- blade tufts */

/** A tuft of curved blades ending in a point. `aH` runs 0 at the root to 1 at the tip. */
export const bladeTuft = (blades: number, rng: Rng, height: number, width = 1, spread = 0.16, segments = 3): THREE.BufferGeometry => {
  const positions: number[] = [];
  const normals: number[] = [];
  const heights: number[] = [];
  const indices: number[] = [];
  for (let blade = 0; blade < blades; blade += 1) {
    const rootAngle = rng.range(0, Math.PI * 2);
    const rootOffset = rng.range(0, spread);
    const rootX = Math.cos(rootAngle) * rootOffset;
    const rootZ = Math.sin(rootAngle) * rootOffset;
    const bladeHeight = rng.range(0.35, 0.75) * height;
    const bladeWidth = rng.range(0.025, 0.045) * width;
    const lean = rng.range(0.15, 0.55);
    const facing = rng.range(0, Math.PI * 2);
    const fx = Math.cos(facing);
    const fz = Math.sin(facing);
    const first = positions.length / 3;
    const nx = fx * 0.35 + rootX * 1.5;
    const nz = fz * 0.35 + rootZ * 1.5;
    const length = Math.hypot(nx, 1, nz);
    for (let row = 0; row <= segments; row += 1) {
      const t = row / segments;
      const forward = lean * bladeHeight * t * t;
      const cx = rootX + fx * forward;
      const cz = rootZ + fz * forward;
      if (row === segments) {
        positions.push(cx, bladeHeight, cz);
        normals.push(nx / length, 1 / length, nz / length);
        heights.push(1);
        break;
      }
      const half = bladeWidth * (1 - t * 0.85);
      positions.push(cx + fz * half, bladeHeight * t, cz - fx * half, cx - fz * half, bladeHeight * t, cz + fx * half);
      normals.push(nx / length, 1 / length, nz / length, nx / length, 1 / length, nz / length);
      heights.push(t, t);
      const a = first + row * 2;
      if (row < segments - 1) indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      else indices.push(a, a + 1, a + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("aH", new THREE.Float32BufferAttribute(heights, 1));
  geometry.setIndex(indices);
  return geometry;
};

export type BladeLook = {
  base: THREE.Color;
  tip: THREE.Color;
  /** Distance over which the tufts shrink away. */
  fade: [number, number];
  /** Hide on paths, tilled soil and other bare ground of the mask. */
  respectMask: boolean;
  translucency: number;
};

const BLADE_FRAGMENT_LIGHT = (translucency: number): string => `{
  ${TRANSLUCENCY}
  float wideBack = pow(saturate(dot(-normalize(vViewPosition), sunLv)), 2.0);
  reflectedLight.directDiffuse += sunC * diffuseColor.rgb * (wideBack * 1.2 + sunBack * 1.2 + 0.25) * vH * ${glsl(translucency)};
}`;

/** Instanced blades bend with the wind, part around the player and shrink away with distance. */
export const bladeMaterial = (key: string, look: BladeLook): THREE.MeshLambertMaterial => {
  const material = new THREE.MeshLambertMaterial({ color: 0xf2f2f2, side: THREE.DoubleSide });
  return withGlobals(material, `blades-${key}`, (shader) => {
    shader.uniforms.uBase = { value: look.base };
    shader.uniforms.uTip = { value: look.tip };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aH;\nvarying float vH;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
  vec3 bladeRoot = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float keep = 1.0 - smoothstep(${glsl(look.fade[0])}, ${glsl(look.fade[1])}, distance(bladeRoot, cameraPosition));
  ${look.respectMask ? "keep *= 1.0 - smoothstep(0.25, 0.7, groundMaskAt(bladeRoot.xz).b);" : ""}
  float bend = aH * aH;
  vec3 sway = windSway(bladeRoot + position, 0.45, bladeRoot.x * 0.7 + bladeRoot.z * 0.3);
  vec3 flick = vec3(sin(uTime * 7.0 + bladeRoot.x * 3.0 + position.x * 20.0), 0.0, cos(uTime * 6.3 + bladeRoot.z * 3.0)) * 0.03 * windGust(bladeRoot);
  vec2 away = bladeRoot.xz - uPlayer.xz;
  float awayLength = max(length(away), 1e-3);
  float nearPlayer = (1.0 - smoothstep(0.3, 1.6, awayLength)) * step(abs(bladeRoot.y - uPlayer.y), 2.5);
  vec3 push = vec3(away.x / awayLength, -0.55, away.y / awayLength) * nearPlayer * 0.6;
  transformed = (transformed + inverse(mat3(instanceMatrix)) * ((sway + flick + push) * bend)) * keep;
  vH = aH;`
      );
    let fragment = shader.fragmentShader.replace("#include <common>", "#include <common>\nuniform vec3 uBase;\nuniform vec3 uTip;\nvarying float vH;");
    fragment = after(fragment, "color_fragment", "diffuseColor.rgb *= mix(uBase, uTip, smoothstep(0.0, 1.0, vH)) * mix(0.45, 1.0, smoothstep(0.0, 0.5, vH));");
    fragment = after(fragment, "normal_fragment_begin", "normal = normalize(vNormal);");
    fragment = after(fragment, "lights_fragment_begin", BLADE_FRAGMENT_LIGHT(look.translucency));
    shader.fragmentShader = fragment;
  });
};

/* ---------------------------------------------------------------- the lawn around the camera */

/*
 * The lawn is one tuft layout repeated over BLOCKS x BLOCKS square blocks that hop by PERIOD to
 * stay centred on the camera, so the grass is dense near the eye at a fixed cost. When a block
 * hops, the CPU refills its tufts' height, density, turn and look for the new ground, nearest
 * blocks first. Blocks only hop while they are farther than FADE_END, which must stay below
 * PERIOD / 2 - BLOCK / 2, and every tuft farther than FULL_UNTIL thins out by rank.
 */
const BLOCK = 16;
const BLOCKS = 10;
const PERIOD = BLOCK * BLOCKS;
const FULL_UNTIL = 10;
const THIN_UNTIL = 60;
const FADE_END = 70;
/** Share of tufts left at THIN_UNTIL; the survivors widen to keep the ground covered. */
const FAR_SHARE = 0.15;
const MAX_WIDEN = 1.8;
/** Rank stored for tufts that never grow. */
const NEVER = 99;
/** Blocks refilled per frame once the first frame has filled them all. */
const FILLS_PER_FRAME = 3;

/** Share of tufts kept at `distance`, the same curve as the vertex shader. */
const shareAt = (distance: number): number => 1 + (FAR_SHARE - 1) * smoothstep(FULL_UNTIL, THIN_UNTIL, distance);

/** How many of the ascending `ranks` are below `limit`. */
const countBelow = (ranks: Float32Array, limit: number): number => {
  let low = 0;
  let high = ranks.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (ranks[middle] < limit) low = middle + 1;
    else high = middle;
  }
  return low;
};

type DensityMap = { data: Float32Array; columns: number; rows: number };

/** Where grass grows, 0..1, one sample per unit over MASK_RECT: fields and banks, not water, slopes, clearings or trunks. */
const bakeDensity = (trees: ReadonlyArray<TreeSite>, clearings: ReadonlyArray<Clearing>): DensityMap => {
  const columns = MASK_RECT.width + 1;
  const rows = MASK_RECT.depth + 1;
  const data = new Float32Array(columns * rows);
  for (let row = 0; row < rows; row += 1) {
    const z = MASK_RECT.z0 + row;
    for (let column = 0; column < columns; column += 1) {
      const x = MASK_RECT.x0 + column;
      const tile = worldToTile(x, z);
      const outside = farmSignedDistance(tile.x, tile.y);
      if (outside > 4) continue;
      const dry = smoothstep(WATER_LEVEL + 0.06, WATER_LEVEL + 0.3, groundHeight(x, z));
      if (dry <= 0) continue;
      const flat = smoothstep(0.74, 0.84, groundNormal(x, z, 0.8).y);
      if (flat <= 0 || insideClearing(x, z, clearings, 0.5)) continue;
      const patch = fbm(x * 0.05, z * 0.05, 3) * 0.7 + 0.5 - smoothstep(0.5, 4, outside) * 0.6;
      data[row * columns + column] = Math.min(1, Math.max(0, patch)) * dry * flat;
    }
  }
  for (const tree of trees) {
    const radius = Math.max(0.8, tree.collider * tree.scale + 0.35);
    const c0 = Math.max(0, Math.floor(tree.x - radius - MASK_RECT.x0));
    const c1 = Math.min(columns - 1, Math.ceil(tree.x + radius - MASK_RECT.x0));
    const r0 = Math.max(0, Math.floor(tree.z - radius - MASK_RECT.z0));
    const r1 = Math.min(rows - 1, Math.ceil(tree.z + radius - MASK_RECT.z0));
    for (let row = r0; row <= r1; row += 1) {
      for (let column = c0; column <= c1; column += 1) {
        if (Math.hypot(MASK_RECT.x0 + column - tree.x, MASK_RECT.z0 + row - tree.z) < radius) data[row * columns + column] = 0;
      }
    }
  }
  return { data, columns, rows };
};

const densityAt = (map: DensityMap, x: number, z: number): number => {
  const gx = x - MASK_RECT.x0;
  const gz = z - MASK_RECT.z0;
  if (gx < 0 || gz < 0 || gx >= map.columns - 1 || gz >= map.rows - 1) return 0;
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const fx = gx - ix;
  const fz = gz - iz;
  const index = iz * map.columns + ix;
  const a = map.data[index];
  const b = map.data[index + 1];
  const c = map.data[index + map.columns];
  const d = map.data[index + map.columns + 1];
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
};

/** Stable 0..1 value for a world position; `salt` picks independent streams. */
const hashAt = (x: number, z: number, salt: number): number => {
  let h = Math.imul(Math.round(x * 64) | 0, 374761393) ^ Math.imul(Math.round(z * 64) | 0, 668265263) ^ Math.imul(salt, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/*
 * aTuft: xyz root relative to the block (y is the ground height), w the rank: the tuft shows when
 * rank < share of tufts kept at its distance. aLook: turn, size, height stretch, dryness.
 */
const FIELD_VERTEX_PARS = /* glsl */ `
attribute vec4 aTuft;
attribute vec4 aLook;
attribute float aH;
varying float vH;
varying float vTone;
varying float vDry;
`;

const FIELD_TURN = /* glsl */ `#include <beginnormal_vertex>
  mat2 tuftTurn = mat2(cos(aLook.x), sin(aLook.x), -sin(aLook.x), cos(aLook.x));
  objectNormal.xz = tuftTurn * objectNormal.xz;`;

const FIELD_PLACE = /* glsl */ `
  vec3 tuftRoot = (modelMatrix * vec4(aTuft.xyz, 1.0)).xyz;
  float tuftDistance = distance(tuftRoot, cameraPosition);
  float share = mix(1.0, ${glsl(FAR_SHARE)}, smoothstep(${glsl(FULL_UNTIL)}, ${glsl(THIN_UNTIL)}, tuftDistance));
  float bare = smoothstep(0.25, 0.7, groundMaskAt(tuftRoot.xz).b);
  float keep = step(aTuft.w, share * (1.0 - bare)) * (1.0 - smoothstep(${glsl(THIN_UNTIL)}, ${glsl(FADE_END)}, tuftDistance));
  vec3 blade = position;
  blade.xz = tuftTurn * (blade.xz * aLook.y * min(inversesqrt(share), ${glsl(MAX_WIDEN)}));
  blade.y *= aLook.y * aLook.z;
  float bladeLength = blade.y / max(aH, 0.05);
  vec3 sway = windSway(tuftRoot, 0.24, tuftRoot.x * 0.7 + tuftRoot.z * 0.3 + position.x * 9.0);
  vec3 flick = vec3(sin(uTime * 7.0 + tuftRoot.x * 3.0 + position.x * 20.0), 0.0, cos(uTime * 6.3 + tuftRoot.z * 3.0 + position.z * 20.0)) * 0.06 * windGust(tuftRoot);
  vec2 away = tuftRoot.xz - uPlayer.xz;
  float awayLength = max(length(away), 1e-3);
  float nearPlayer = (1.0 - smoothstep(0.3, 1.4, awayLength)) * step(abs(tuftRoot.y - uPlayer.y), 2.5);
  vec3 bent = (sway + flick + vec3(away.x, 0.0, away.y) / awayLength * nearPlayer * 0.9) * bladeLength * aH * aH;
  bent.y -= dot(bent.xz, bent.xz) / max(2.0 * bladeLength, 0.1);
  vec3 transformed = aTuft.xyz + (blade + bent) * keep;
  vH = aH;
  vTone = mix(0.8, 1.15, fract(aLook.x * 7.31));
  vDry = aLook.w;`;

type FieldLook = { base: THREE.Color; tip: THREE.Color; dry: THREE.Color; translucency: number };

const fieldMaterial = (look: FieldLook): THREE.MeshLambertMaterial => {
  const material = new THREE.MeshLambertMaterial({ color: 0xf2f2f2, side: THREE.DoubleSide });
  return withGlobals(material, "grass-field", (shader) => {
    shader.uniforms.uBase = { value: look.base };
    shader.uniforms.uTip = { value: look.tip };
    shader.uniforms.uDry = { value: look.dry };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${FIELD_VERTEX_PARS}`)
      .replace("#include <beginnormal_vertex>", FIELD_TURN)
      .replace("#include <begin_vertex>", FIELD_PLACE);
    let fragment = shader.fragmentShader.replace(
      "#include <common>",
      "#include <common>\nuniform vec3 uBase;\nuniform vec3 uTip;\nuniform vec3 uDry;\nvarying float vH;\nvarying float vTone;\nvarying float vDry;"
    );
    fragment = after(
      fragment,
      "color_fragment",
      "diffuseColor.rgb *= mix(uBase, mix(uTip, uDry, vDry), smoothstep(0.0, 1.0, vH)) * mix(0.4, 1.0, smoothstep(0.0, 0.55, vH)) * vTone;"
    );
    fragment = after(fragment, "normal_fragment_begin", "normal = normalize(vNormal);");
    fragment = after(fragment, "lights_fragment_begin", BLADE_FRAGMENT_LIGHT(look.translucency));
    shader.fragmentShader = fragment;
  });
};

export type GrassFieldOptions = {
  trees: ReadonlyArray<TreeSite>;
  clearings: ReadonlyArray<Clearing>;
  /** Tufts per square unit where the lawn is full. */
  density: number;
};

export type GrassField = {
  root: THREE.Group;
  /** Moves the blocks under the camera and hides the ones beyond the fade. */
  update: (camera: THREE.Camera) => void;
  dispose: () => void;
};

type Block = {
  mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material>;
  tuft: THREE.InstancedBufferAttribute;
  look: THREE.InstancedBufferAttribute;
  /** Tuft ranks in ascending order, as the instances are stored. */
  ranks: Float32Array;
  column: number;
  row: number;
  x: number;
  z: number;
  low: number;
  high: number;
  grows: boolean;
  /** Moved but not refilled yet; hidden until then. */
  stale: boolean;
  nearest: number;
};

export const createGrassField = (options: GrassFieldOptions): GrassField => {
  const root = new THREE.Group();
  root.name = "grass";
  const rng = createRng(4242);
  const tuft = bladeTuft(7, rng, 0.7, 1.3, 0.2, 2);
  const side = Math.max(4, Math.round(BLOCK * Math.sqrt(options.density)));
  const count = side * side;
  const layout = new Float32Array(count * 2);
  for (let row = 0; row < side; row += 1) {
    for (let column = 0; column < side; column += 1) {
      const index = (row * side + column) * 2;
      layout[index] = ((column + rng.next()) / side) * BLOCK;
      layout[index + 1] = ((row + rng.next()) / side) * BLOCK;
    }
  }
  const density = bakeDensity(options.trees, options.clearings);
  const material = fieldMaterial({
    base: new THREE.Color(0.06, 0.09, 0.025),
    tip: new THREE.Color(0.46, 0.5, 0.15),
    dry: new THREE.Color(0.62, 0.5, 0.2),
    translucency: 1
  });

  const scratchTuft = new Float32Array(count * 4);
  const scratchLook = new Float32Array(count * 4);
  const scratchRank = new Float32Array(count);
  /** Quantised rank in the high 16 bits, tuft index in the low 16, so a numeric sort orders by rank. */
  const order = new Uint32Array(count);

  /** Rewrites a block for its new ground, tufts sorted by rank so far blocks can draw a prefix. */
  const fill = (block: Block): void => {
    let low = Infinity;
    let high = -Infinity;
    for (let index = 0; index < count; index += 1) {
      const localX = layout[index * 2];
      const localZ = layout[index * 2 + 1];
      const x = block.x + localX;
      const z = block.z + localZ;
      const grow = densityAt(density, x, z);
      const at = index * 4;
      scratchTuft[at] = localX;
      scratchTuft[at + 2] = localZ;
      if (grow < 0.004) {
        scratchTuft[at + 1] = 0;
        scratchTuft[at + 3] = NEVER;
        scratchRank[index] = NEVER;
        continue;
      }
      const y = groundHeight(x, z) - 0.03;
      low = Math.min(low, y);
      high = Math.max(high, y);
      const meadow = smoothstep(0.35, 0.8, valueNoise(x * 0.045 + 3, z * 0.045 + 3));
      const rank = hashAt(x, z, 1) / grow;
      scratchTuft[at + 1] = y;
      scratchTuft[at + 3] = rank;
      scratchRank[index] = rank;
      scratchLook[at] = hashAt(x, z, 2) * Math.PI * 2;
      scratchLook[at + 1] = (0.75 + 0.5 * hashAt(x, z, 3)) * (0.8 + 0.35 * grow);
      scratchLook[at + 2] = 0.7 + 0.8 * meadow;
      scratchLook[at + 3] = smoothstep(0.5, 0.9, valueNoise(x * 0.06 - 7, z * 0.06 - 7) * 0.75 + hashAt(x, z, 4) * 0.3) * (1 - meadow * 0.4);
    }
    for (let index = 0; index < count; index += 1) {
      order[index] = ((Math.min(65535, Math.floor(scratchRank[index] * 65535)) << 16) | index) >>> 0;
    }
    order.sort();
    const tufts = block.tuft.array as Float32Array;
    const looks = block.look.array as Float32Array;
    for (let target = 0; target < count; target += 1) {
      const source = order[target] & 0xffff;
      for (let lane = 0; lane < 4; lane += 1) {
        tufts[target * 4 + lane] = scratchTuft[source * 4 + lane];
        looks[target * 4 + lane] = scratchLook[source * 4 + lane];
      }
      block.ranks[target] = scratchRank[source];
    }
    block.stale = false;
    block.grows = low <= high;
    block.low = block.grows ? low : 0;
    block.high = block.grows ? high : 0;
    const sphere = block.mesh.geometry.boundingSphere ?? new THREE.Sphere();
    sphere.center.set(BLOCK / 2, (block.low + block.high) / 2, BLOCK / 2);
    sphere.radius = Math.hypot(BLOCK * 0.71, (block.high - block.low) / 2 + 1.5);
    block.mesh.geometry.boundingSphere = sphere;
    block.tuft.needsUpdate = true;
    block.look.needsUpdate = true;
  };

  const blocks: Block[] = [];
  for (let row = 0; row < BLOCKS; row += 1) {
    for (let column = 0; column < BLOCKS; column += 1) {
      const geometry = new THREE.InstancedBufferGeometry();
      geometry.setIndex(tuft.getIndex());
      for (const name of ["position", "normal", "aH"]) geometry.setAttribute(name, tuft.getAttribute(name));
      const tuftAttribute = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4).setUsage(THREE.DynamicDrawUsage);
      const lookAttribute = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4).setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute("aTuft", tuftAttribute);
      geometry.setAttribute("aLook", lookAttribute);
      geometry.instanceCount = count;
      const mesh = new THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material>(geometry, material);
      mesh.name = "grass";
      mesh.receiveShadow = true;
      mesh.visible = false;
      mesh.layers.set(LAYER_NO_REFLECT);
      root.add(mesh);
      blocks.push({
        mesh,
        tuft: tuftAttribute,
        look: lookAttribute,
        ranks: new Float32Array(count),
        column,
        row,
        x: Number.NaN,
        z: Number.NaN,
        low: 0,
        high: 0,
        grows: false,
        stale: true,
        nearest: Infinity
      });
    }
  }

  const eye = new THREE.Vector3();
  const measure = (block: Block): void => {
    const dx = Math.max(block.x - eye.x, 0, eye.x - block.x - BLOCK);
    const dz = Math.max(block.z - eye.z, 0, eye.z - block.z - BLOCK);
    const dy = Math.max(block.low - eye.y, 0, eye.y - block.high - 1.5);
    block.nearest = Math.hypot(dx, dy, dz);
  };
  const stale: Block[] = [];
  let warmed = false;
  const update = (camera: THREE.Camera): void => {
    camera.getWorldPosition(eye);
    stale.length = 0;
    for (const block of blocks) {
      const x = block.column * BLOCK + Math.round((eye.x - (block.column + 0.5) * BLOCK) / PERIOD) * PERIOD;
      const z = block.row * BLOCK + Math.round((eye.z - (block.row + 0.5) * BLOCK) / PERIOD) * PERIOD;
      if (x !== block.x || z !== block.z) {
        block.x = x;
        block.z = z;
        block.mesh.position.set(x, 0, z);
        block.stale = true;
      }
      measure(block);
      if (block.stale) stale.push(block);
    }
    stale.sort((a, b) => a.nearest - b.nearest);
    const fills = warmed ? Math.min(FILLS_PER_FRAME, stale.length) : stale.length;
    for (let index = 0; index < fills; index += 1) {
      fill(stale[index]);
      measure(stale[index]);
    }
    warmed = true;
    for (const block of blocks) {
      const drawn = !block.stale && block.grows && block.nearest < FADE_END ? countBelow(block.ranks, shareAt(block.nearest)) : 0;
      block.mesh.geometry.instanceCount = drawn;
      block.mesh.visible = drawn > 0;
    }
  };

  const dispose = (): void => {
    blocks.forEach((block) => block.mesh.geometry.dispose());
    tuft.dispose();
    material.dispose();
  };

  return { root, update, dispose };
};

