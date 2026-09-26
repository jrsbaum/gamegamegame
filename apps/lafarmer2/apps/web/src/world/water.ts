import * as THREE from "three";
import { TILE, WATER_LEVEL, createRandom, groundHeight, riverCenterWorld, riverHalfWidthTiles, worldToTile } from "./height";
import { GLOBALS, LAYER_WATER } from "./shared";

/** The water surface reaches this far past the river's nominal half width. */
const SPREAD = 1.75;
const Z0 = -1100;
const Z1 = 1100;
const MAP_COLUMNS = 64;
const MAP_ROWS = 2048;
export const MAX_FLOATING_LIGHTS = 16;

const halfWidthAt = (z: number): number => riverHalfWidthTiles(worldToTile(0, z).y) * TILE;

/**
 * River map along the channel. R: water depth, G: slope of the centre line (dx/dz),
 * B: flow speed (faster mid-stream and in the narrows), A: half width in world units.
 */
const createRiverMap = (): THREE.DataTexture => {
  const data = new Uint16Array(MAP_COLUMNS * MAP_ROWS * 4);
  for (let row = 0; row < MAP_ROWS; row += 1) {
    const z = Z0 + (Z1 - Z0) * (row / (MAP_ROWS - 1));
    const center = riverCenterWorld(z);
    const half = halfWidthAt(z);
    const slope = (riverCenterWorld(z + 1) - riverCenterWorld(z - 1)) / 2;
    for (let column = 0; column < MAP_COLUMNS; column += 1) {
      const p = -SPREAD + (2 * SPREAD * column) / (MAP_COLUMNS - 1);
      const x = center + p * half;
      const index = (row * MAP_COLUMNS + column) * 4;
      const across = 1 - Math.min(1, Math.abs(p)) ** 2;
      data[index] = THREE.DataUtils.toHalfFloat(WATER_LEVEL - groundHeight(x, z));
      data[index + 1] = THREE.DataUtils.toHalfFloat(slope);
      data[index + 2] = THREE.DataUtils.toHalfFloat((0.35 + 0.65 * across) * (6.5 / half) ** 0.8);
      data[index + 3] = THREE.DataUtils.toHalfFloat(half);
    }
  }
  const texture = new THREE.DataTexture(data, MAP_COLUMNS, MAP_ROWS, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
};

/**
 * Tileable ripple normals. RG: gradient of sharp ridged ripples, BA: gradient of broad
 * swells stretched along the flow.
 */
const createRippleNormals = (size = 512): THREE.DataTexture => {
  const random = createRandom(99);
  type Lattice = { values: Float32Array; width: number; height: number };
  const lattice = (width: number, height: number): Lattice => {
    const values = new Float32Array(width * height);
    for (let index = 0; index < values.length; index += 1) values[index] = random();
    return { values, width, height };
  };
  const sample = (layer: Lattice, u: number, v: number): number => {
    const px = u * layer.width;
    const py = v * layer.height;
    const ix = Math.floor(px);
    const iy = Math.floor(py);
    const fx = px - ix;
    const fy = py - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const at = (x: number, y: number): number => layer.values[(((y % layer.height) + layer.height) % layer.height) * layer.width + (((x % layer.width) + layer.width) % layer.width)];
    return (at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx) * (1 - sy) + (at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx) * sy;
  };
  const ridgedLayers = ([[8, 8, 1], [16, 16, 0.5], [32, 32, 0.28], [64, 64, 0.14]] as const).map(([w, h, a]) => ({ layer: lattice(w, h), amp: a }));
  const swellLayers = ([[12, 3, 1], [24, 6, 0.55], [48, 12, 0.3], [96, 24, 0.15]] as const).map(([w, h, a]) => ({ layer: lattice(w, h), amp: a }));
  const ridged = new Float32Array(size * size);
  const swell = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      let r = 0;
      let s = 0;
      for (const { layer, amp } of ridgedLayers) r += (1 - Math.abs(sample(layer, u, v) * 2 - 1)) * amp;
      for (const { layer, amp } of swellLayers) s += sample(layer, u, v) * amp;
      ridged[y * size + x] = r;
      swell[y * size + x] = s;
    }
  }
  const at = (field: Float32Array, x: number, y: number): number => field[(((y + size) % size) * size) + ((x + size) % size)];
  const clampByte = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      let dx = (at(ridged, x + 1, y) - at(ridged, x - 1, y)) * 3;
      let dy = (at(ridged, x, y + 1) - at(ridged, x, y - 1)) * 3;
      data[index] = clampByte(128 - dx * 127);
      data[index + 1] = clampByte(128 - dy * 127);
      dx = (at(swell, x + 1, y) - at(swell, x - 1, y)) * 4;
      dy = (at(swell, x, y + 1) - at(swell, x, y - 1)) * 4;
      data[index + 2] = clampByte(128 - dx * 127);
      data[index + 3] = clampByte(128 - dy * 127);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
};

/** Strips across the river, dense near the farm and coarse far away. */
const createSurface = (): THREE.BufferGeometry => {
  const rows: number[] = [];
  for (let z = Z0; z <= Z1;) {
    rows.push(z);
    const distance = Math.abs(z);
    z += distance < 160 ? 0.7 : distance < 420 ? 1.6 : 5;
  }
  const segments = 56;
  const positions = new Float32Array(rows.length * (segments + 1) * 3);
  const uvs = new Float32Array(rows.length * (segments + 1) * 2);
  let vertex = 0;
  for (const z of rows) {
    const center = riverCenterWorld(z);
    const half = halfWidthAt(z);
    for (let segment = 0; segment <= segments; segment += 1) {
      const d = -1 + (2 * segment) / segments;
      const p = Math.sign(d) * Math.abs(d) ** 0.8 * SPREAD;
      positions[vertex * 3] = center + p * half;
      positions[vertex * 3 + 1] = WATER_LEVEL;
      positions[vertex * 3 + 2] = z;
      uvs[vertex * 2] = p;
      uvs[vertex * 2 + 1] = z;
      vertex += 1;
    }
  }
  const indices: number[] = [];
  for (let row = 0; row < rows.length - 1; row += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const a = row * (segments + 1) + segment;
      const b = a + 1;
      const c = a + segments + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
};

const WATER_VERTEX = /* glsl */ `
#include <common>
uniform sampler2D tMap;
uniform mat4 uTexMatrix;
uniform float uMapT;
uniform vec2 uMapZ;
varying vec3 vW;
varying vec2 vRU;
varying vec4 vRefl;
varying float vViewZ;
void main() {
  vec3 p = position;
  vec2 muv = vec2((uv.x + uMapT) / (2.0 * uMapT), (uv.y - uMapZ.x) / (uMapZ.y - uMapZ.x));
  vec4 m = texture2D(tMap, muv);
  float s = uv.y;
  float sp = m.b * 2.2;
  float wave = sin(s * 3.1 - uTime * 7.0 * sp * 0.4 + uv.x * 2.0) * 0.5 + sin(s * 5.3 + uv.x * 7.0 - uTime * 5.0) * 0.5;
  p.y += wave * 0.035 * smoothstep(0.02, 0.4, m.r);
  vW = (modelMatrix * vec4(p, 1.0)).xyz;
  vRU = uv;
  vRefl = uTexMatrix * vec4(vW, 1.0);
  vec4 mv = viewMatrix * vec4(vW, 1.0);
  vViewZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const WATER_FRAGMENT = /* glsl */ `
#include <common>
uniform sampler2D tMap;
uniform sampler2D tNormals;
uniform sampler2D tRefl;
uniform sampler2D tScene;
uniform vec2 uRes;
uniform float uMapT;
uniform vec2 uMapZ;
uniform float uHasRefl;
uniform vec4 uFloat[${MAX_FLOATING_LIGHTS}];
uniform int uFloatN;
varying vec3 vW;
varying vec2 vRU;
varying vec4 vRefl;
varying float vViewZ;

vec3 sampleFlowNormal(vec2 p, float speed) {
  float period = 1.6;
  float ph0 = fract(uTime / period);
  float ph1 = fract(uTime / period + 0.5);
  float w0 = 1.0 - abs(1.0 - 2.0 * ph0);
  vec2 f = vec2(0.0, speed * period);
  vec2 p0 = p - f * ph0;
  vec2 p1 = p - f * ph1 + 0.37;
  vec4 a0 = texture2D(tNormals, p0 * vec2(0.18, 0.12));
  vec4 a1 = texture2D(tNormals, p1 * vec2(0.18, 0.12));
  vec4 b0 = texture2D(tNormals, p0 * vec2(0.55, 0.42) + 0.13);
  vec4 b1 = texture2D(tNormals, p1 * vec2(0.55, 0.42) + 0.61);
  vec4 A = mix(a1, a0, w0);
  vec4 B = mix(b1, b0, w0);
  vec2 n = (A.ba * 2.0 - 1.0) * 0.55 + (B.rg * 2.0 - 1.0) * 0.35;
  vec2 wr = texture2D(tNormals, vW.xz * 0.9 + vec2(uTime * 0.11, -uTime * 0.07)).rg * 2.0 - 1.0;
  n += wr * 0.12;
  return n.xyy;
}

void main() {
  vec2 muv = vec2((vRU.x + uMapT) / (2.0 * uMapT), (vRU.y - uMapZ.x) / (uMapZ.y - uMapZ.x));
  vec4 m = texture2D(tMap, muv);
  float depth = m.r;
  if (depth < -0.02) discard;
  float speed = m.b * 2.1;
  vec2 rp = vec2(vRU.x * m.a, vRU.y);
  vec3 fn = sampleFlowNormal(rp, speed);
  float camD = length(vW - cameraPosition);
  float nstr = mix(1.0, 0.35, smoothstep(20.0, 160.0, camD));
  vec2 dir = normalize(vec2(m.g, 1.0));
  vec2 nxz = fn.x * vec2(dir.y, -dir.x) + fn.y * dir;
  vec3 N = normalize(vec3(nxz.x * 0.5 * nstr, 1.0, nxz.y * 0.5 * nstr));

  vec3 V = normalize(cameraPosition - vW);
  float NdV = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);

  vec2 rdist = N.xz * (0.9 / (1.0 + camD * 0.02)) * 0.07;
  vec3 refl = uHasRefl > 0.5 ? texture2D(tRefl, vRefl.xy / vRefl.w + rdist).rgb * 0.88 : skyFogColor(reflect(-V, N)) * 0.8;

  vec2 suv = gl_FragCoord.xy / uRes;
  vec2 off = N.xz * 0.06 * clamp(depth, 0.0, 1.5) / (1.0 + camD * 0.03);
  vec4 sc = texture2D(tScene, suv + off);
  if (sc.a < vViewZ) sc = texture2D(tScene, suv);
  float bedDist = max(sc.a - vViewZ, 0.0);
  float path = min(bedDist, depth / max(V.y, 0.12));
  path = mix(path, depth / max(V.y, 0.12), step(sc.a, vViewZ + 0.01));
  vec3 absorb = vec3(0.58, 0.16, 0.24);
  vec3 Tr = exp(-absorb * path * 1.15);
  vec3 scatter = vec3(0.009, 0.036, 0.028) * (1.0 + 0.8 * max(uSunDir.y, 0.0)) * uAmbient;
  vec3 under = sc.rgb * Tr + scatter * (1.0 - Tr);
  vec3 col = mix(under, refl, fres);

  vec3 Hh = normalize(uSunDir + V);
  float spec = pow(max(dot(N, Hh), 0.0), 380.0) * 6.0 + pow(max(dot(N, Hh), 0.0), 60.0) * 0.06;
  col += uSunCol * spec * (0.6 + 0.4 * fres);

  if (uLampOn > 0.001) {
    for (int li = 0; li < ${8}; li++) {
      if (li >= uLampN) break;
      vec4 LP = uLamps[li];
      vec3 lv = LP.xyz - vW;
      float d2 = dot(lv, lv);
      if (d2 > 6400.0) continue;
      vec3 Hl = normalize(lv * inversesqrt(d2) + V);
      float nh = max(dot(N, Hl), 0.0);
      float g = pow(nh, 70.0) * 0.5 + pow(nh, 700.0) * 5.0;
      col += uLampCol[li] * LP.w * uLampOn * g * (0.35 + 0.65 * fres) / (1.0 + d2 * 0.012);
    }
    for (int fi = 0; fi < ${MAX_FLOATING_LIGHTS}; fi++) {
      if (fi >= uFloatN) break;
      vec4 FP = uFloat[fi];
      vec3 lv = FP.xyz - vW;
      float d2 = dot(lv, lv);
      if (d2 > 3600.0) continue;
      vec3 Hl = normalize(lv * inversesqrt(d2) + V);
      float nh = max(dot(N, Hl), 0.0);
      float g = pow(nh, 60.0) * 0.4 + pow(nh, 600.0) * 3.0;
      col += vec3(1.0, 0.55, 0.22) * FP.w * uLampOn * g * (0.35 + 0.65 * fres) / (1.0 + d2 * 0.02);
      col += vec3(1.0, 0.5, 0.2) * FP.w * uLampOn * 0.05 * exp(-d2 * 0.5);
    }
  }

  float t = uTime;
  if (depth < 0.13) {
    vec2 fp = rp * vec2(1.4, 0.55) - vec2(0.0, t * speed * 0.55);
    float fnz = fbm3(fp * 1.6) * 0.65 + vnoise(fp * 6.0 + vec2(0.0, -t * 0.5)) * 0.35;
    float shore = smoothstep(0.12, 0.03, depth) * smoothstep(0.55, 0.85, vnoise(vec2(rp.y * 1.3 - t * 0.35, rp.x * 3.0)) * 0.7 + fnz * 0.5 + 0.12 * sin(t * 1.3 + rp.y * 0.7));
    float foam = clamp(shore * 0.4, 0.0, 1.0);
    float ndl = max(dot(N, uSunDir), 0.0) * 0.6 + 0.4;
    vec3 foamCol = vec3(0.62, 0.70, 0.74) * 0.55 * uAmbient + uSunCol * 0.11 * ndl;
    col = mix(col, foamCol, foam * 0.78);
  }

  float alpha = smoothstep(0.0, 0.07, depth);
  col = applyAtmosphere(col, vW);
  gl_FragColor = vec4(col, alpha);
}
`;

export type Water = {
  mesh: THREE.Mesh;
  uniforms: {
    tRefl: { value: THREE.Texture | null };
    tScene: { value: THREE.Texture | null };
    uTexMatrix: { value: THREE.Matrix4 };
    uRes: { value: THREE.Vector2 };
    uHasRefl: { value: number };
  };
  /** Floating lanterns (xyz, strength) glinting on the surface after dusk. */
  setFloatingLights: (lights: ReadonlyArray<THREE.Vector4>) => void;
  dispose: () => void;
};

export const createWater = (): Water => {
  const floating = Array.from({ length: MAX_FLOATING_LIGHTS }, () => new THREE.Vector4(0, -999, 0, 0));
  const uniforms = {
    ...GLOBALS,
    tMap: { value: createRiverMap() },
    tNormals: { value: createRippleNormals() },
    tRefl: { value: null as THREE.Texture | null },
    tScene: { value: null as THREE.Texture | null },
    uTexMatrix: { value: new THREE.Matrix4() },
    uRes: { value: new THREE.Vector2(1, 1) },
    uHasRefl: { value: 0 },
    uMapT: { value: SPREAD },
    uMapZ: { value: new THREE.Vector2(Z0, Z1) },
    uFloat: { value: floating },
    uFloatN: { value: 0 }
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
    transparent: true,
    depthWrite: false
  });
  material.userData.globals = true;
  const mesh = new THREE.Mesh(createSurface(), material);
  mesh.name = "water";
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.layers.set(LAYER_WATER);

  const setFloatingLights = (lights: ReadonlyArray<THREE.Vector4>): void => {
    const count = Math.min(MAX_FLOATING_LIGHTS, lights.length);
    for (let index = 0; index < MAX_FLOATING_LIGHTS; index += 1) {
      if (index < count) floating[index].copy(lights[index]);
      else floating[index].set(0, -999, 0, 0);
    }
    uniforms.uFloatN.value = count;
  };

  const dispose = (): void => {
    mesh.geometry.dispose();
    material.dispose();
    uniforms.tMap.value.dispose();
    uniforms.tNormals.value.dispose();
  };

  return { mesh, uniforms, setFloatingLights, dispose };
};
