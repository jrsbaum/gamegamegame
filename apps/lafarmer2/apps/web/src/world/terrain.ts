import * as THREE from "three";
import { loadTexture } from "./assets";
import { groundMaskTexture } from "./groundMask";
import {
  HEIGHT_CACHE,
  TILE,
  WATER_LEVEL,
  computeGroundHeight,
  farmSignedDistance,
  fbm,
  groundHeight,
  nearObstacle,
  riverCenterTile,
  riverCenterWorld,
  riverHalfWidthTiles,
  valueNoise,
  worldToTile
} from "./height";
import { LAYER_MAIN, LAYER_MIRROR, LAYER_NO_REFLECT, withGlobals } from "./shared";

export type PetalSpot = { x: number; z: number; radius: number };

export type TerrainOptions = {
  /** Ground under the flowering trees, strewn with fallen petals. */
  petalSpots?: ReadonlyArray<PetalSpot>;
};

export type Terrain = {
  root: THREE.Group;
  dispose: () => void;
};

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

const FAR_EXTENT = 1100;
const FAR_STEP = 8;

type Splat = { grass: number; forest: number; rock: number; pebble: number };

/** Layer weights from slope, height, the river and the farm edge. Tilled soil and paths come from the ground mask. */
const splatAt = (wx: number, wz: number, height: number, slope: number, out: Splat): Splat => {
  const { x: tx, y: ty } = worldToTile(wx, wz);
  const fromRiver = (Math.abs(tx - riverCenterTile(ty)) - riverHalfWidthTiles(ty)) * TILE;
  const detail = valueNoise(wx * 0.06, wz * 0.06);
  const patches = fbm(wx * 0.017 + 5, wz * 0.017 - 3, 3);
  let rock = smoothstep(0.26 + 0.08 * detail, 0.46, slope);
  if (height > 40) rock = Math.max(rock, smoothstep(0.16, 0.32, slope));
  let pebble = smoothstep(0.75 + 0.45 * detail, -0.35, height - WATER_LEVEL) * smoothstep(9, 1, fromRiver + 2);
  pebble = Math.max(pebble, smoothstep(0.5, -0.8, height - WATER_LEVEL));
  const outside = farmSignedDistance(tx, ty);
  let forest = smoothstep(-0.5, 4, outside) * (0.55 + 0.45 * patches);
  forest = Math.max(forest, Math.max(0, patches * 1.4 - 0.78) * 0.9);
  if (nearObstacle(tx, ty, 0.8, ["tree"])) forest = Math.max(forest, 0.55);
  pebble *= 1 - rock;
  forest *= (1 - rock) * (1 - pebble);
  const grass = (1 - rock) * (1 - pebble) * (1 - forest);
  const total = rock + pebble + forest + grass;
  out.grass = grass / total;
  out.forest = forest / total;
  out.rock = rock / total;
  out.pebble = pebble / total;
  return out;
};

const petalCover = (wx: number, wz: number, spots: ReadonlyArray<PetalSpot>): number => {
  let cover = 0;
  for (const spot of spots) {
    const distance = Math.hypot(wx - spot.x, wz - spot.z);
    if (distance < spot.radius * 1.3) cover = Math.max(cover, smoothstep(spot.radius * 1.25, spot.radius * 0.3, distance));
  }
  return cover;
};

type Grid = {
  geometry: THREE.BufferGeometry;
  columns: number;
  rows: number;
};

type Placement = (column: number, row: number, out: [number, number]) => void;

/** Grid with alternating diagonals; `place` puts each vertex in the plane, `height` lifts it. */
const buildGrid = (columns: number, rows: number, place: Placement, height: (x: number, z: number) => number): Grid => {
  const positions = new Float32Array(columns * rows * 3);
  const planar: [number, number] = [0, 0];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = (row * columns + column) * 3;
      place(column, row, planar);
      const [x, z] = planar;
      positions[index] = x;
      positions[index + 1] = height(x, z);
      positions[index + 2] = z;
    }
  }
  const indices = new Uint32Array((columns - 1) * (rows - 1) * 6);
  let cursor = 0;
  for (let row = 0; row < rows - 1; row += 1) {
    for (let column = 0; column < columns - 1; column += 1) {
      const a = row * columns + column;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      if ((row + column) & 1) {
        indices[cursor++] = a; indices[cursor++] = c; indices[cursor++] = b;
        indices[cursor++] = b; indices[cursor++] = c; indices[cursor++] = d;
      } else {
        indices[cursor++] = a; indices[cursor++] = c; indices[cursor++] = d;
        indices[cursor++] = a; indices[cursor++] = d; indices[cursor++] = b;
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  return { geometry, columns, rows };
};

/** Splat weights and a cavity/petal attribute for every vertex of a grid. */
const paintGrid = (grid: Grid, step: number, spots: ReadonlyArray<PetalSpot>): void => {
  const { geometry, columns, rows } = grid;
  const positions = geometry.getAttribute("position").array as Float32Array;
  const normals = geometry.getAttribute("normal").array as Float32Array;
  const count = columns * rows;
  const splat = new Float32Array(count * 4);
  const aux = new Float32Array(count * 2);
  const weights: Splat = { grass: 1, forest: 0, rock: 0, pebble: 0 };
  const heightAt = (column: number, row: number): number => {
    const c = Math.min(columns - 1, Math.max(0, column));
    const r = Math.min(rows - 1, Math.max(0, row));
    return positions[(r * columns + c) * 3 + 1];
  };
  const near = Math.max(1, Math.round(5 / step));
  const far = Math.max(2, Math.round(16 / step));
  for (let index = 0; index < count; index += 1) {
    const x = positions[index * 3];
    const y = positions[index * 3 + 1];
    const z = positions[index * 3 + 2];
    splatAt(x, z, y, 1 - normals[index * 3 + 1], weights);
    splat[index * 4] = weights.grass;
    splat[index * 4 + 1] = weights.forest;
    splat[index * 4 + 2] = weights.rock;
    splat[index * 4 + 3] = weights.pebble;
    const column = index % columns;
    const row = (index / columns) | 0;
    const ringNear = (heightAt(column + near, row) + heightAt(column - near, row) + heightAt(column, row + near) + heightAt(column, row - near)) * 0.25;
    const ringFar = (heightAt(column + far, row) + heightAt(column - far, row) + heightAt(column, row + far) + heightAt(column, row - far)) * 0.25;
    const cavity = 1 - Math.min(0.55, Math.max(0, (ringNear - y) * 0.2 + (ringFar - y) * 0.035));
    aux[index * 2] = cavity;
    aux[index * 2 + 1] = spots.length ? petalCover(x, z, spots) * (0.6 + 0.4 * valueNoise(x * 0.06, z * 0.06)) : 0;
  }
  geometry.setAttribute("aSplat", new THREE.BufferAttribute(splat, 4));
  geometry.setAttribute("aAux", new THREE.BufferAttribute(aux, 2));
};

/** A curtain hanging below the edge of the near grid hides the seam with the coarse far grid. */
const addSkirt = (grid: Grid, drop: number): void => {
  const { geometry, columns, rows } = grid;
  const source = geometry.getAttribute("position").array as Float32Array;
  const edge: number[] = [];
  for (let column = 0; column < columns; column += 1) edge.push(column);
  for (let row = 1; row < rows; row += 1) edge.push(row * columns + columns - 1);
  for (let column = columns - 2; column >= 0; column -= 1) edge.push((rows - 1) * columns + column);
  for (let row = rows - 2; row > 0; row -= 1) edge.push(row * columns);
  edge.push(0);
  const count = columns * rows;
  const positions = new Float32Array((count + edge.length) * 3);
  positions.set(source);
  edge.forEach((vertex, offset) => {
    const target = (count + offset) * 3;
    positions[target] = source[vertex * 3];
    positions[target + 1] = source[vertex * 3 + 1] - drop;
    positions[target + 2] = source[vertex * 3 + 2];
  });
  const index = geometry.getIndex()!.array as Uint32Array;
  const indices = new Uint32Array(index.length + (edge.length - 1) * 6);
  indices.set(index);
  let cursor = index.length;
  for (let offset = 0; offset < edge.length - 1; offset += 1) {
    const a = edge[offset];
    const b = edge[offset + 1];
    const c = count + offset;
    const d = count + offset + 1;
    indices[cursor++] = a; indices[cursor++] = b; indices[cursor++] = c;
    indices[cursor++] = b; indices[cursor++] = d; indices[cursor++] = c;
  }
  const normals = new Float32Array(positions.length);
  normals.set(geometry.getAttribute("normal").array as Float32Array);
  const splat = new Float32Array((count + edge.length) * 4);
  splat.set(geometry.getAttribute("aSplat").array as Float32Array);
  const aux = new Float32Array((count + edge.length) * 2);
  aux.set(geometry.getAttribute("aAux").array as Float32Array);
  edge.forEach((vertex, offset) => {
    normals.copyWithin((count + offset) * 3, vertex * 3, vertex * 3 + 3);
    splat.copyWithin((count + offset) * 4, vertex * 4, vertex * 4 + 4);
    aux.copyWithin((count + offset) * 2, vertex * 2, vertex * 2 + 2);
  });
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("aSplat", new THREE.BufferAttribute(splat, 4));
  geometry.setAttribute("aAux", new THREE.BufferAttribute(aux, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
};

/** Every other vertex of the near grid: enough for the blurred, rippled mirror image. */
const mirrorGeometry = (grid: Grid): THREE.BufferGeometry => {
  const { geometry, columns, rows } = grid;
  const indices: number[] = [];
  for (let row = 0; row + 2 < rows; row += 2) {
    for (let column = 0; column + 2 < columns; column += 2) {
      const a = row * columns + column;
      const b = a + 2;
      const c = a + 2 * columns;
      const d = c + 2;
      indices.push(a, c, d, a, d, b);
    }
  }
  const mirror = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "aSplat", "aAux"]) mirror.setAttribute(name, geometry.getAttribute(name));
  mirror.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  mirror.boundingSphere = geometry.boundingSphere;
  mirror.boundingBox = geometry.boundingBox;
  return mirror;
};

const TERRAIN_VERTEX_PARS = /* glsl */ `
attribute vec4 aSplat;
attribute vec2 aAux;
varying vec4 vSplat;
varying vec2 vAux;
varying vec3 vTW;
varying vec3 vTN;
`;

const TERRAIN_VERTEX = /* glsl */ `
vSplat = aSplat;
vAux = aAux;
vTW = (modelMatrix * vec4(position, 1.0)).xyz;
vTN = normal;
`;

const TERRAIN_FRAGMENT_PARS = /* glsl */ `
uniform sampler2D tGrassC, tGrassN, tForestC, tDirtC, tDirtN, tRockC, tRockN, tPebC, tPebN, tSoilC, tSoilN;
varying vec4 vSplat;
varying vec2 vAux;
varying vec3 vTW;
varying vec3 vTN;
vec3 tBlendN;
float tRough;
float tCaust;

vec4 layerC(sampler2D t, vec2 uv, float far) {
  vec4 a = texture2D(t, uv);
  if (far > 0.2) a = mix(a, texture2D(t, uv * 0.21 + 0.37) * vec4(1.04, 1.02, 1.0, 1.0), far * 0.55);
  return a;
}
`;

const TERRAIN_SPLAT = /* glsl */ `
vec3 wp = vTW;
vec3 N = normalize(vTN);
float camD = length(wp - cameraPosition);
bool cheap = uReflect > 0.5 || camD > 260.0 || wp.y < uWaterLevel - 0.35;
float far = cheap ? 0.0 : smoothstep(18.0, 70.0, camD);
bool detailN = !cheap && camD < 75.0;
vec4 w = vSplat;
float macro = vnoise(wp.xz * 0.045) * 0.65 + vnoise(wp.xz * 0.11) * 0.35;

vec4 gm = groundMaskAt(wp.xz);
float edgeNoise = vnoise(wp.xz * 0.9) - 0.5;
float path = smoothstep(0.3, 0.7, gm.r + edgeNoise * 0.3);
float soil = smoothstep(0.35, 0.65, gm.g + edgeNoise * 0.18);
w *= (1.0 - path) * (1.0 - soil);
float wPath = path * (1.0 - soil);
float wSoil = soil;

vec2 uvG = wp.xz / 3.6, uvF = wp.xz / 4.2, uvD = wp.xz / 3.2, uvP = wp.xz / 2.3, uvS = wp.xz / 3.0;
vec4 cG = vec4(0.0), cF = vec4(0.0), cD = vec4(0.0), cP = vec4(0.0), cR = vec4(0.0), cS = vec4(0.0);
if (w.x > 0.004) cG = layerC(tGrassC, uvG, far);
if (w.y > 0.004) cF = layerC(tForestC, uvF, far);
if (w.w > 0.004) cP = layerC(tPebC, uvP, far);
if (wPath > 0.004) cD = layerC(tDirtC, uvD, far);
if (wSoil > 0.004) cS = layerC(tSoilC, uvS, far);

vec3 bw = pow(abs(N), vec3(4.0));
bw /= (bw.x + bw.y + bw.z);
float rs = 1.0 / 7.5;
if (w.z > 0.004) {
  if (cheap) cR = texture2D(tRockC, (abs(N.x) > abs(N.z) ? wp.zy : wp.xy) * rs);
  else {
    if (bw.x > 0.04) cR += layerC(tRockC, wp.zy * rs, far) * bw.x;
    if (bw.y > 0.04) cR += layerC(tRockC, wp.xz * rs, far) * bw.y;
    if (bw.z > 0.04) cR += layerC(tRockC, wp.xy * rs, far) * bw.z;
    cR /= max(bw.x * step(0.04, bw.x) + bw.y * step(0.04, bw.y) + bw.z * step(0.04, bw.z), 1e-3);
  }
}

// height-aware blend: the brighter grains of each layer poke through its neighbours
float hG = dot(cG.rgb, vec3(0.9)), hF = dot(cF.rgb, vec3(0.9)), hR = dot(cR.rgb, vec3(2.4)), hP = dot(cP.rgb, vec3(0.9));
float hD = dot(cD.rgb, vec3(2.0)), hS = dot(cS.rgb, vec3(1.5));
vec4 hw = w + vec4(hG, hF, hR, hP) * 0.55 + vec4(macro * 0.25, (1.0 - macro) * 0.2, 0.0, 0.0);
vec2 hx = vec2(wPath, wSoil) + vec2(hD, hS) * 0.55;
float mx = max(max(max(hw.x, hw.y), max(hw.z, hw.w)), max(hx.x, hx.y));
vec4 bl = max(hw - (mx - 0.22), 0.0) * step(0.004, w);
vec2 bx = max(hx - (mx - 0.22), 0.0) * step(0.004, vec2(wPath, wSoil));
float bsum = max(bl.x + bl.y + bl.z + bl.w + bx.x + bx.y, 1e-4);
bl /= bsum;
bx /= bsum;

vec3 grassTint = mix(vec3(0.86, 1.08, 0.62), vec3(1.02, 1.0, 0.7), macro);
vec3 alb = cG.rgb * bl.x * grassTint
  + cF.rgb * bl.y * vec3(0.95, 1.05, 0.8)
  + cR.rgb * bl.z * vec3(2.6, 2.9, 3.2)
  + cP.rgb * bl.w * vec3(0.95, 0.95, 0.92)
  + cD.rgb * bx.x * vec3(2.5, 2.45, 2.5)
  + cS.rgb * bx.y * vec3(1.1, 1.05, 1.0);
alb *= mix(vec3(0.84, 0.92, 0.8), vec3(1.1, 1.05, 0.92), macro);

// far slopes read as forest canopy, the way the valley looks from afar
float forestFar = smoothstep(110.0, 280.0, camD) * (1.0 - bl.z * 0.7) * smoothstep(3.0, 14.0, wp.y - uWaterLevel);
alb = mix(alb, vec3(0.04, 0.066, 0.042) * (0.7 + 0.6 * vnoise(wp.xz * 0.08)), forestFar * 0.85);

float wet = smoothstep(0.55, -0.05, wp.y - uWaterLevel);
alb *= mix(1.0, 0.55, wet);
alb = mix(alb, alb * vec3(0.75, 0.9, 0.7), smoothstep(0.0, -1.2, wp.y - uWaterLevel));

float pet = 0.0;
if (vAux.y > 0.01) {
  pet = vAux.y * smoothstep(0.62, 0.8, vnoise(wp.xz * 5.3) * 0.6 + vnoise(wp.xz * 13.0) * 0.4 + vAux.y * 0.25) * (1.0 - wSoil);
  alb = mix(alb, vec3(0.93, 0.62, 0.68), pet * 0.8);
}
alb *= vAux.x;
diffuseColor.rgb *= alb;

tRough = 0.9;
tBlendN = N;
if (detailN) {
  vec3 nG = (w.x + w.y) > 0.004 ? texture2D(tGrassN, uvG).xyz : vec3(0.5, 0.5, 1.0);
  vec3 nP = w.w > 0.004 ? texture2D(tPebN, uvP).xyz : vec3(0.5, 0.5, 1.0);
  vec3 nD = wPath > 0.004 ? texture2D(tDirtN, uvD).xyz : vec3(0.5, 0.5, 1.0);
  vec3 nS = wSoil > 0.004 ? texture2D(tSoilN, uvS).xyz : vec3(0.5, 0.5, 1.0);
  vec2 flatD = ((nG.xy * 2.0 - 1.0) * (bl.x + bl.y) + (nP.xy * 2.0 - 1.0) * bl.w + (nD.xy * 2.0 - 1.0) * bx.x + (nS.xy * 2.0 - 1.0) * bx.y * 1.4) * (1.0 - far * 0.6);
  tRough = 0.93 * (bl.x + bl.y) + 0.72 * bl.w + 0.86 * bx.x + 0.95 * bx.y + 0.8 * bl.z;
  tBlendN = normalize(vec3(N.x + flatD.x, N.y, N.z + flatD.y));
  if (bl.z > 0.01) {
    vec3 nX = texture2D(tRockN, wp.zy * rs).xyz, nY = texture2D(tRockN, wp.xz * rs).xyz, nZ = texture2D(tRockN, wp.xy * rs).xyz;
    vec2 tx = nX.xy * 2.0 - 1.0, ty = nY.xy * 2.0 - 1.0, tz = nZ.xy * 2.0 - 1.0;
    vec3 nwRock = normalize(bw.x * vec3(N.x, N.y + tx.y, N.z + tx.x) + bw.y * vec3(N.x + ty.x, N.y, N.z + ty.y) + bw.z * vec3(N.x + tz.x, N.y + tz.y, N.z));
    tBlendN = normalize(mix(tBlendN, nwRock, bl.z));
  }
  tBlendN = normalize(mix(tBlendN, N, pet * 0.6));
}
tRough = mix(tRough, 0.25, wet * 0.8);
tRough = mix(tRough, 1.0, smoothstep(-0.02, -0.15, wp.y - uWaterLevel));

tCaust = 0.0;
if (wp.y < uWaterLevel + 0.02 && uReflect < 0.5 && camD < 120.0) {
  float dep = uWaterLevel - wp.y;
  vec2 cp = wp.xz * 0.95;
  float ca = vnoise(cp + vec2(uTime * 0.55, uTime * 0.35));
  float cb = vnoise(cp * 1.6 - vec2(uTime * 0.42, -uTime * 0.3) + ca * 1.8);
  float cc = pow(1.0 - clamp(abs(ca - cb) * 2.4, 0.0, 1.0), 9.0);
  tCaust = cc * exp(-dep * 0.9) * smoothstep(0.0, 0.2, dep);
}
`;

const TERRAIN_LIGHT = /* glsl */ `
reflectedLight.directDiffuse += gSunColor * diffuseColor.rgb * tCaust * 1.3 * (1.0 - 0.5 * smoothstep(0.3, 0.8, uSunDir.y));
if (vTW.y < uWaterLevel) {
  float under = uWaterLevel - vTW.y;
  vec3 through = exp(-vec3(0.58, 0.16, 0.24) * 1.4 * under / max(uSunDir.y, 0.2)) * mix(1.0, 0.7, smoothstep(0.3, 0.8, uSunDir.y));
  reflectedLight.directDiffuse *= through;
  reflectedLight.indirectDiffuse *= mix(vec3(1.0), through, 0.6);
}
`;

const createTerrainMaterial = (): THREE.MeshStandardMaterial => {
  const tex = (slug: string, kind: "diff" | "nor"): THREE.Texture => loadTexture(`tex/${slug}_${kind}.webp`, { srgb: kind === "diff" });
  const uniforms = {
    tGrassC: { value: tex("forrest_ground_01", "diff") },
    tGrassN: { value: tex("forrest_ground_01", "nor") },
    tForestC: { value: tex("sparse_grass", "diff") },
    tDirtC: { value: tex("stony_dirt_path", "diff") },
    tDirtN: { value: tex("stony_dirt_path", "nor") },
    tRockC: { value: tex("lichen_rock", "diff") },
    tRockN: { value: tex("lichen_rock", "nor") },
    tPebC: { value: tex("river_small_rocks", "diff") },
    tPebN: { value: tex("river_small_rocks", "nor") },
    tSoilC: { value: tex("farm_soil", "diff") },
    tSoilN: { value: tex("farm_soil", "nor") }
  };
  groundMaskTexture();
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  return withGlobals(material, "terrain", (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${TERRAIN_VERTEX_PARS}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${TERRAIN_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${TERRAIN_FRAGMENT_PARS}`)
      .replace("#include <map_fragment>", TERRAIN_SPLAT)
      .replace("#include <roughnessmap_fragment>", "float roughnessFactor = clamp(tRough, 0.2, 1.0);")
      .replace("#include <normal_fragment_maps>", "normal = normalize((viewMatrix * vec4(tBlendN, 0.0)).xyz);")
      .replace("#include <lights_fragment_end>", `#include <lights_fragment_end>\n${TERRAIN_LIGHT}`);
  });
};

/** Half width of the fine strip that follows the river beyond the cached region. */
const CORRIDOR_SPAN = 36;
const CORRIDOR_STEP = 1.5;

/** Row positions of a corridor, finer close to the farm. `sign` -1 runs north, +1 south. */
const corridorRows = (start: number, sign: number): number[] => {
  const rows: number[] = [];
  for (let distance = start; distance <= FAR_EXTENT; distance += distance < 300 ? CORRIDOR_STEP : CORRIDOR_STEP * 2) rows.push(sign * distance);
  return rows;
};

/**
 * The valley floor: a one-unit grid over the cached region (with a cheaper copy for the water
 * mirror), fine strips along the river beyond it, and an eight-unit grid out to the far ranges,
 * sunk under the finer grids where they overlap.
 */
export const createTerrain = (options: TerrainOptions = {}): Terrain => {
  const spots = options.petalSpots ?? [];
  const material = createTerrainMaterial();
  const root = new THREE.Group();
  root.name = "terrain";
  const geometries: THREE.BufferGeometry[] = [];

  const { x0, z0, size, columns, rows } = HEIGHT_CACHE;
  const nearX1 = x0 + (columns - 1) * size;
  const nearZ1 = z0 + (rows - 1) * size;
  const insideNear = (x: number, z: number, margin: number): boolean => x > x0 + margin && x < nearX1 - margin && z > z0 + margin && z < nearZ1 - margin;

  const nearGrid = buildGrid(columns, rows, (column, row, out) => { out[0] = x0 + column * size; out[1] = z0 + row * size; }, groundHeight);
  paintGrid(nearGrid, size, spots);
  addSkirt(nearGrid, 4);
  const near = new THREE.Mesh(nearGrid.geometry, material);
  near.name = "terrain-near";
  near.receiveShadow = true;
  near.castShadow = true;
  near.frustumCulled = false;
  near.layers.set(LAYER_NO_REFLECT);
  const mirror = new THREE.Mesh(mirrorGeometry(nearGrid), material);
  mirror.name = "terrain-mirror";
  mirror.receiveShadow = true;
  mirror.frustumCulled = false;
  mirror.layers.set(LAYER_MIRROR);
  geometries.push(nearGrid.geometry, mirror.geometry);
  root.add(near, mirror);

  const inset = FAR_STEP * 1.5;
  const corridorColumns = Math.round((CORRIDOR_SPAN * 2) / CORRIDOR_STEP) + 1;
  for (const sign of [-1, 1]) {
    const start = (sign < 0 ? -z0 : nearZ1) - inset;
    const zs = corridorRows(start, sign);
    const grid = buildGrid(corridorColumns, zs.length, (column, row, out) => {
      const z = zs[row];
      out[0] = riverCenterWorld(z) - CORRIDOR_SPAN + column * CORRIDOR_STEP;
      out[1] = z;
    }, (x, z) => computeGroundHeight(x, z) - (insideNear(x, z, 0) ? 0.6 : 0));
    paintGrid(grid, CORRIDOR_STEP, spots);
    addSkirt(grid, 4);
    const corridor = new THREE.Mesh(grid.geometry, material);
    corridor.name = sign < 0 ? "terrain-river-north" : "terrain-river-south";
    corridor.receiveShadow = true;
    corridor.castShadow = true;
    corridor.layers.set(LAYER_MAIN);
    geometries.push(grid.geometry);
    root.add(corridor);
  }

  const farColumns = Math.floor((FAR_EXTENT * 2) / FAR_STEP) + 1;
  const farGrid = buildGrid(farColumns, farColumns, (column, row, out) => {
    out[0] = -FAR_EXTENT + column * FAR_STEP;
    out[1] = -FAR_EXTENT + row * FAR_STEP;
  }, (x, z) => {
    if (insideNear(x, z, inset)) return groundHeight(x, z) - 6;
    const beyond = z < z0 + inset || z > nearZ1 - inset;
    if (beyond && Math.abs(x - riverCenterWorld(z)) < CORRIDOR_SPAN - FAR_STEP * 1.25) return computeGroundHeight(x, z) - 6;
    const edge = Math.max(Math.abs(x), Math.abs(z));
    const height = computeGroundHeight(x, z);
    return height + (-40 - height) * smoothstep(880, FAR_EXTENT, edge);
  });
  paintGrid(farGrid, FAR_STEP, []);
  const farMesh = new THREE.Mesh(farGrid.geometry, material);
  farMesh.name = "terrain-far";
  farMesh.receiveShadow = true;
  farMesh.castShadow = true;
  farMesh.frustumCulled = false;
  farMesh.layers.set(LAYER_MAIN);
  geometries.push(farGrid.geometry);
  root.add(farMesh);

  const dispose = (): void => {
    geometries.forEach((geometry) => geometry.dispose());
    material.dispose();
  };

  return { root, dispose };
};
