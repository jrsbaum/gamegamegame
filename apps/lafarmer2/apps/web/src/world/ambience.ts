import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { TILE, WATER_LEVEL, createRandom, groundHeight, riverCenterWorld, riverHalfWidthTiles, worldToTile } from "./height";
import { GLOBALS, LAYER_MAIN, LAYER_NO_REFLECT, LAYER_WATER } from "./shared";
import { MAX_FLOATING_LIGHTS } from "./water";

export type Ambience = {
  root: THREE.Group;
  /** Lanterns on the river (xyz on the water, w strength) for the water's glints. Empty by day. */
  floatingLights: THREE.Vector4[];
  update: (dt: number, timeSec: number, camera: THREE.PerspectiveCamera, focus: THREE.Vector3) => void;
  dispose: () => void;
};

export type AmbienceOptions = {
  /** Crown centres of the flowering trees. Without them the petals only drift around the focus. */
  blossomTrees: ReadonlyArray<THREE.Vector3>;
};

const CROWN_SLOTS = 12;
const PETALS_PER_CROWN = 120;
/** How far blossoms reach from a crown centre; keep in step with the canopies grown in trees.ts. */
const CROWN_RADIUS = 5.5;
const CROWN_FADE_SECONDS = 1.6;
const CROWN_REFRESH_SECONDS = 0.5;
const AIR_PETALS = 650;
const AIR_PETALS_WITHOUT_TREES = 1400;
const WATER_PETALS = 520;
const PETAL_SIZE = 0.085;
const AIR_BOX = new THREE.Vector3(60, 22, 60);
const WATER_WINDOW = 150;

const MOTE_COUNT = 1400;
const MOTE_BOX = new THREE.Vector3(40, 16, 40);

const FIREFLY_COUNT = 720;
const FIREFLY_HALO = 0.32;
const FIREFLY_CORE = 0.035;
const WISP_COUNT = 10;
const WISP_RADIUS = 0.85;

const LANTERN_COUNT = MAX_FLOATING_LIGHTS;
/** Lanterns drift through a window of the river this long, starting upstream of the focus. */
export const LANTERN_SPAN = 170;
export const LANTERN_UPSTREAM = 95;
const LANTERN_HALO = 1.5;
/** The glint source sits above the paper so the reflection stretches toward the viewer. */
const LANTERN_LIGHT_HEIGHT = 0.45;
const LANTERN_LIGHT = 2.6;

const BIRD_SCALE = 1.9;
/**
 * Flocks circle over the river while travelling along it through a window this long around the
 * focus. Within 20 units of the river the valley floor stays below 10 units, so they never clip.
 */
const FLOCK_SPAN = 380;
const FLOCKS = [
  { seed: 0.12, birds: 7, radius: 15, travel: 1.1, height: 16, turn: 0.32 },
  { seed: 0.47, birds: 5, radius: 11, travel: -0.8, height: 13.5, turn: -0.4 },
  { seed: 0.81, birds: 8, radius: 16, travel: 1.4, height: 18, turn: 0.26 }
];

const RIVER_Z0 = -1100;
const RIVER_Z1 = 1100;
const RIVER_SAMPLES = 1024;

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

const wrap = (value: number, span: number): number => ((value % span) + span) % span;

const float = (value: number): string => (Number.isInteger(value) ? value.toFixed(1) : String(value));

const vec3 = (value: THREE.Vector3): string => `vec3(${float(value.x)}, ${float(value.y)}, ${float(value.z)})`;

export const riverHalfWidth = (z: number): number => riverHalfWidthTiles(worldToTile(0, z).y) * TILE;

/** R: river centre line x, G: half width, sampled along z. */
const createRiverLine = (): THREE.DataTexture => {
  const data = new Uint16Array(RIVER_SAMPLES * 4);
  for (let sample = 0; sample < RIVER_SAMPLES; sample += 1) {
    const z = RIVER_Z0 + ((RIVER_Z1 - RIVER_Z0) * sample) / (RIVER_SAMPLES - 1);
    data[sample * 4] = THREE.DataUtils.toHalfFloat(riverCenterWorld(z));
    data[sample * 4 + 1] = THREE.DataUtils.toHalfFloat(riverHalfWidth(z));
  }
  const texture = new THREE.DataTexture(data, RIVER_SAMPLES, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
};

const ROTATE_GLSL = /* glsl */ `
mat3 rotateAxis(vec3 axis, float angle) {
  float s = sin(angle);
  float c = cos(angle);
  float oc = 1.0 - c;
  return mat3(
    oc * axis.x * axis.x + c, oc * axis.x * axis.y + axis.z * s, oc * axis.z * axis.x - axis.y * s,
    oc * axis.x * axis.y - axis.z * s, oc * axis.y * axis.y + c, oc * axis.y * axis.z + axis.x * s,
    oc * axis.z * axis.x + axis.y * s, oc * axis.y * axis.z - axis.x * s, oc * axis.z * axis.z + c
  );
}
`;

const RIVER_GLSL = /* glsl */ `
uniform sampler2D tRiver;
vec2 riverAt(float z) {
  float u = clamp((z - (${float(RIVER_Z0)})) / ${float(RIVER_Z1 - RIVER_Z0)}, 0.0, 1.0);
  return texture2D(tRiver, vec2((u * ${float(RIVER_SAMPLES - 1)} + 0.5) / ${float(RIVER_SAMPLES)}, 0.5)).xy;
}
`;

/** Glow sprites keep a minimum on-screen size and give back the lost area as dimmer light, so they never shimmer. */
const SPRITE_GLSL = /* glsl */ `
uniform float uViewH;
float pixelWorld(float depth) {
  return 2.0 * max(depth, 1e-3) / (projectionMatrix[1][1] * uViewH);
}
`;

const GLOW_FRAGMENT = /* glsl */ `
varying vec2 vCorner;
varying vec3 vColor;
varying vec3 vShape;
void main() {
  float r2 = dot(vCorner, vCorner);
  if (r2 >= 1.0) discard;
  float window = (1.0 - r2) * (1.0 - r2);
  float core = exp(-r2 * vShape.x) * vShape.y;
  float halo = (exp(-r2 * 5.0) + exp(-sqrt(r2) * 3.0) * 0.25) * vShape.z;
  gl_FragColor = vec4((vColor * (core + halo) + vec3(core * 0.3 * dot(vColor, vec3(0.33)))) * window, 1.0);
}
`;

const PETAL_VERTEX = /* glsl */ `
#include <common>
${ROTATE_GLSL}
${RIVER_GLSL}
uniform vec4 uCrowns[${CROWN_SLOTS}];
uniform float uCrownFade[${CROWN_SLOTS}];
uniform vec3 uAirCenter;
uniform vec3 uFocus;
attribute vec4 aSeed;
attribute vec4 aSpin;
attribute vec4 aKind;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vWorld;
varying float vTone;

void main() {
  vec3 windDir = vec3(uWind.x, 0.0, uWind.y);
  float size = ${float(PETAL_SIZE)} * (0.8 + aSeed.w * 0.5);
  vec3 center;
  mat3 R;
  if (aKind.x < 0.5) {
    // shed from a crown: falls to the ground below it, rests a moment, and a new petal leaves the canopy
    int slot = int(aKind.y + 0.5);
    vec4 crown = uCrowns[slot];
    float fall = 0.7 + aSeed.w * 0.45;
    float duration = (max(crown.y - crown.w, 1.0) + ${float(CROWN_RADIUS * 0.25)}) / fall;
    float cycle = duration + 2.4;
    float clock = uTime + aSeed.x * 97.0;
    float life = mod(clock, cycle);
    float lap = floor(clock / cycle);
    // the canopy hides whatever starts inside it, so petals leave from its rim and underside
    float angle = hash12(vec2(lap, aSeed.y * 131.0)) * 6.2832;
    float radius = (0.7 + 0.3 * sqrt(hash12(vec2(lap * 1.7, aSeed.z * 173.0)))) * ${float(CROWN_RADIUS)};
    float lift = mix(-0.35, 0.25, hash12(vec2(lap * 2.3, aSeed.w * 197.0))) * ${float(CROWN_RADIUS)};
    vec3 start = crown.xyz + vec3(cos(angle) * radius, lift, sin(angle) * radius);
    float airborne = min(life, duration);
    float k = airborne / duration;
    center = start + windDir * airborne * (0.5 * uWind.z + windGust(start) * 0.9);
    center += vec3(sin(airborne * 1.9 + aSeed.y * 20.0), 0.0, cos(airborne * 1.4 + aSeed.z * 20.0)) * 0.45;
    center.y = mix(start.y, crown.w, k) + sin(airborne * 2.3 + aSeed.w * 9.0) * 0.12 * (1.0 - k);
    R = rotateAxis(aSpin.xyz, airborne * aSpin.w * 2.6 + aSeed.w * 6.2832);
    size *= uCrownFade[slot] * smoothstep(0.0, 0.3, life) * (1.0 - smoothstep(duration + 1.4, cycle, life));
  } else if (aKind.x < 1.5) {
    // drifting through a box that travels with the focus
    vec3 box = ${vec3(AIR_BOX)};
    vec3 p = aSeed.xyz * box;
    float t = uTime * aSpin.w;
    p += windDir * uTime * (0.6 + aSeed.w * 0.8) * (0.4 + 0.6 * uWind.z);
    p.y -= uTime * (0.45 + aSeed.w * 0.5);
    p += vec3(sin(t * 1.7 + aSeed.w * 30.0) * 0.6, sin(t * 2.1 + aSeed.y * 13.0) * 0.25, cos(t * 1.3 + aSeed.x * 20.0) * 0.6);
    vec3 low = uAirCenter - box * vec3(0.5, 0.3, 0.5);
    center = mod(p - low, box) + low;
    vec3 rel = (center - uAirCenter) / (box * 0.5);
    float edge = 1.0 - smoothstep(0.7, 1.0, max(abs(rel.x), abs(rel.z)));
    edge *= smoothstep(-0.6, -0.45, rel.y) * (1.0 - smoothstep(1.2, 1.4, rel.y));
    R = rotateAxis(aSpin.xyz, t * 2.6 + aSeed.w * 6.2832);
    size *= edge;
  } else {
    // afloat: slower near the banks, wrapped into a stretch of river around the focus
    float across = aKind.z * 2.0 - 1.0;
    float speed = (0.3 + 0.8 * (1.0 - across * across)) * (0.8 + aSeed.w * 0.4);
    float start = uFocus.z - ${float(WATER_WINDOW / 2)};
    float z = start + mod(aSeed.x * ${float(WATER_WINDOW)} + uTime * speed - start, ${float(WATER_WINDOW)});
    vec2 river = riverAt(z);
    float x = river.x + across * river.y * 0.9 + sin(uTime * 0.4 + aSeed.z * 30.0) * 0.2;
    float offset = z - start;
    size *= smoothstep(0.0, 10.0, offset) * (1.0 - smoothstep(${float(WATER_WINDOW - 10)}, ${float(WATER_WINDOW)}, offset));
    R = rotateAxis(vec3(0.0, 1.0, 0.0), aSeed.z * 6.2832 + uTime * (aSeed.w - 0.5) * 0.5) * rotateAxis(vec3(1.0, 0.0, 0.0), 1.5708 + (aSeed.y - 0.5) * 0.4);
    center = vec3(x, ${float(WATER_LEVEL + 0.07)} + sin(uTime * 2.0 + aSeed.x * 40.0) * 0.01, z);
  }
  // no depth of field softens a petal brushing past the lens, so it shrinks away instead
  size *= smoothstep(0.5, 1.5, distance(center, cameraPosition));
  vec3 world = center + R * (position * size);
  vWorld = world;
  vUv = uv;
  vNormalW = R * vec3(0.0, 0.0, 1.0);
  vTone = 0.82 + aSeed.w * 0.3;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const PETAL_FRAGMENT = /* glsl */ `
#include <common>
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vWorld;
varying float vTone;

void main() {
  // notched sakura petal: narrow at the stalk (v = 0), two lobes at the tip
  float x = abs(vUv.x - 0.5) * 2.0;
  float y = vUv.y;
  float halfWidth = sqrt(y) * (1.0 - 0.61 * y * y * y) * 1.45;
  if (x > halfWidth || y > 0.86 + 0.3 * x) discard;
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorld);
  if (dot(N, V) < 0.0) N = -N;
  vec3 albedo = mix(vec3(0.93, 0.55, 0.64), vec3(1.0, 0.9, 0.92), smoothstep(0.05, 0.7, y)) * vTone;
  // thin petals pass light through either face, strongest when they sit in front of the sun
  float diffuse = abs(dot(N, uSunDir)) * 0.45 + 0.15;
  float through = pow(max(dot(-V, uSunDir), 0.0), 5.0);
  vec3 ambient = uAmbient * mix(vec3(0.2, 0.21, 0.27), vec3(0.3, 0.27, 0.25), N.y * 0.5 + 0.5);
  vec3 col = albedo * (ambient + uSunCol * (diffuse + through * 0.8));
  gl_FragColor = vec4(applyAtmosphere(col, vWorld), 1.0);
}
`;

const MOTE_VERTEX = /* glsl */ `
#include <common>
${SPRITE_GLSL}
uniform vec3 uMoteCenter;
attribute vec4 aSeed;
varying vec2 vCorner;
varying vec3 vColor;

void main() {
  vec3 box = ${vec3(MOTE_BOX)};
  vec3 p = aSeed.xyz * box;
  float t = uTime * (0.15 + aSeed.w * 0.2);
  p += vec3(sin(t * 1.3 + aSeed.w * 40.0), sin(t * 0.9 + aSeed.w * 17.0) * 0.6, cos(t * 1.1 + aSeed.w * 23.0)) * 1.6;
  p += vec3(uWind.x, 0.12, uWind.y) * uTime * 0.3 * (0.5 + 0.5 * uWind.z);
  vec3 low = uMoteCenter - box * 0.5;
  vec3 world = mod(p - low, box) + low;
  vec3 rel = (world - uMoteCenter) / (box * 0.5);
  float edge = 1.0 - smoothstep(0.65, 1.0, max(max(abs(rel.x), abs(rel.z)), abs(rel.y)));
  vec3 ray = world - cameraPosition;
  float dist = length(ray);
  // forward scattering: the dust lights up against the sun, most of all when it is low
  float toward = pow(max(dot(ray / max(dist, 1e-3), uSunDir), 0.0), 4.0);
  float golden = 1.0 - smoothstep(0.1, 0.5, uSunDir.y);
  float twinkle = 0.6 + 0.4 * sin(uTime * (1.5 + aSeed.w * 2.5) + aSeed.x * 60.0);
  float strength = edge * uSunVis * (1.0 - uNight) * twinkle * (0.05 + toward * (1.2 + 2.4 * golden)) * smoothstep(0.4, 1.5, dist);
  vec4 view = viewMatrix * vec4(world, 1.0);
  float size = 0.016 + aSeed.w * 0.018;
  float shown = max(size, pixelWorld(-view.z) * 1.2);
  vColor = uSunCol * strength * 0.3 * (size * size) / (shown * shown);
  vCorner = position.xy;
  view.xy += position.xy * shown;
  gl_Position = projectionMatrix * view;
  if (strength < 0.002 || world.y < ${float(WATER_LEVEL + 0.05)}) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const MOTE_FRAGMENT = /* glsl */ `
varying vec2 vCorner;
varying vec3 vColor;
void main() {
  float r2 = dot(vCorner, vCorner);
  if (r2 >= 1.0) discard;
  gl_FragColor = vec4(vColor * exp(-r2 * 5.0) * (1.0 - r2), 1.0);
}
`;

const FIREFLY_VERTEX = /* glsl */ `
#include <common>
${SPRITE_GLSL}
attribute vec4 aHome;
attribute vec4 aMotion;
varying vec2 vCorner;
varying vec3 vColor;
varying vec3 vShape;

void main() {
  float t = uTime * aMotion.y + aMotion.w;
  vec3 world = aHome.xyz + vec3(
    sin(t * 0.37) * aMotion.x + sin(t * 1.31 + 1.7) * 0.22,
    sin(t * 0.61 + 0.4) * 0.3 + sin(t * 2.1) * 0.06,
    cos(t * 0.29 + 0.8) * aMotion.x * 1.2 + cos(t * 1.13) * 0.22
  );
  float flash = pow(max(sin(uTime * aMotion.z + aHome.w * 90.0), 0.0), 6.0);
  float glow = (0.06 + flash) * smoothstep(0.35, 0.8, uNight);
  vec4 view = viewMatrix * vec4(world, 1.0);
  float depth = -view.z;
  float pixel = pixelWorld(depth);
  float radius = max(${float(FIREFLY_HALO)}, pixel * 1.5);
  float core = max(${float(FIREFLY_CORE)}, pixel * 0.6);
  float fade = smoothstep(0.8, 2.5, depth) * (1.0 - smoothstep(100.0, 150.0, depth));
  vColor = vec3(0.72, 1.0, 0.3) * glow * fade;
  vShape = vec3(radius * radius / (core * core), 7.0 * ${float(FIREFLY_CORE * FIREFLY_CORE)} / (core * core), 0.45 * ${float(FIREFLY_HALO * FIREFLY_HALO)} / (radius * radius));
  vCorner = position.xy;
  view.xy += position.xy * radius;
  gl_Position = projectionMatrix * view;
  if (glow * fade < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

/** Lantern halos (no core: the paper is the core) and wisps, placed on the CPU every frame. */
const RIVER_GLOW_VERTEX = /* glsl */ `
#include <common>
${SPRITE_GLSL}
attribute vec4 aCenter;
attribute vec4 aColor;
varying vec2 vCorner;
varying vec3 vColor;
varying vec3 vShape;

void main() {
  vec4 view = viewMatrix * vec4(aCenter.xyz, 1.0);
  float depth = -view.z;
  float pixel = pixelWorld(depth);
  float radius = max(aCenter.w, pixel * 2.0);
  float coreSize = aCenter.w * 0.035;
  float core = max(coreSize, pixel * 0.7);
  vShape = vec3(radius * radius / (core * core), aColor.w * 5.0 * coreSize * coreSize / (core * core), aCenter.w * aCenter.w / (radius * radius));
  vColor = aColor.rgb * smoothstep(aCenter.w * 0.6, aCenter.w * 1.6, depth);
  vCorner = position.xy;
  view.xy += position.xy * radius;
  gl_Position = projectionMatrix * view;
  if (aCenter.w <= 0.0 || dot(vColor, vec3(1.0)) < 1e-4) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const LANTERN_VERTEX = /* glsl */ `
#include <common>
${ROTATE_GLSL}
attribute float aPart;
attribute vec4 aPlace;
attribute vec4 aPose;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec2 vUv;
varying float vPart;
varying float vGlow;

void main() {
  mat3 R = rotateAxis(vec3(0.0, 1.0, 0.0), aPlace.w) * rotateAxis(vec3(1.0, 0.0, 0.0), aPose.x) * rotateAxis(vec3(0.0, 0.0, 1.0), aPose.y);
  vec3 world = aPlace.xyz + R * (position * aPose.z);
  vWorld = world;
  vNormalW = R * normal;
  vUv = uv;
  vPart = aPart;
  vGlow = aPose.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  if (aPose.z < 1e-3) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const LANTERN_FRAGMENT = /* glsl */ `
#include <common>
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec2 vUv;
varying float vPart;
varying float vGlow;

void main() {
  vec3 N = normalize(vNormalW);
  vec3 light = uAmbient * 0.35 + uSunCol * max(dot(N, uSunDir), 0.0) * 0.3;
  vec3 wood = vec3(0.08, 0.05, 0.035);
  vec3 col;
  if (vPart < 0.5) {
    // paper walls: cream near the candle, amber toward the rim, a thin wooden frame
    float frame = max(max(1.0 - smoothstep(0.035, 0.065, vUv.x), smoothstep(0.935, 0.965, vUv.x)), max(1.0 - smoothstep(0.03, 0.06, vUv.y), smoothstep(0.93, 0.96, vUv.y)));
    vec3 paper = mix(vec3(1.0, 0.84, 0.58), vec3(0.96, 0.5, 0.2), smoothstep(0.05, 1.0, vUv.y));
    float across = abs(vUv.x - 0.5) * 2.0;
    vec3 glow = paper * vec3(1.0, 0.55, 0.22) * vGlow * (1.15 - 0.6 * vUv.y) * (1.0 - 0.45 * across * across);
    col = mix(glow + paper * light * 0.6, wood * (light + vGlow * 0.5), frame);
  } else if (vPart < 1.5) {
    // the open top shows the flame
    float r = length(vUv - 0.5) * 2.0;
    col = mix(vec3(1.0, 0.78, 0.42) * 3.0, vec3(0.95, 0.5, 0.2) * 0.9, smoothstep(0.0, 0.8, r)) * vGlow;
    col = mix(col, wood * (light + vGlow * 0.5), smoothstep(0.84, 0.92, max(abs(vUv.x - 0.5), abs(vUv.y - 0.5)) * 2.0));
  } else {
    col = wood * light + vec3(0.3, 0.14, 0.05) * vGlow * max(N.y, 0.0);
  }
  gl_FragColor = vec4(applyAtmosphere(col, vWorld), 1.0);
}
`;

const BIRD_VERTEX = /* glsl */ `
#include <common>
${RIVER_GLSL}
uniform vec3 uFocus;
attribute float aFlex;
attribute vec4 aFlock;
attribute vec4 aFlight;
varying vec3 vWorld;
varying float vShade;

void main() {
  float start = uFocus.z - ${float(FLOCK_SPAN / 2)};
  float travelZ = start + mod(aFlock.x * ${float(FLOCK_SPAN)} + uTime * aFlock.z - start, ${float(FLOCK_SPAN)});
  float offset = travelZ - start;
  float fade = smoothstep(0.0, 30.0, offset) * (1.0 - smoothstep(${float(FLOCK_SPAN - 30)}, ${float(FLOCK_SPAN)}, offset));
  float shown = (1.0 - smoothstep(0.25, 0.6, uNight)) * smoothstep(0.0, 0.4, uSunVis + 0.2) * fade;
  float travelX = riverAt(travelZ).x;
  float slope = (riverAt(travelZ + 3.0).x - riverAt(travelZ - 3.0).x) / 6.0;
  // each flock circles over its stretch of river; birds wobble within the group and bank into the turn
  float angle = uTime * aFlight.w + aFlight.z + sin(uTime * 0.05 + aFlight.z * 17.0) * 0.12;
  float radius = aFlock.y + aFlight.x;
  float height = ${float(WATER_LEVEL)} + aFlock.w + aFlight.y + sin(uTime * 0.3 + aFlight.z * 9.0) * 1.5;
  vec3 center = vec3(travelX + cos(angle) * radius, height, travelZ + sin(angle) * radius * 0.7);
  vec3 velocity = vec3(slope * aFlock.z - sin(angle) * radius * aFlight.w, 0.0, aFlock.z + cos(angle) * radius * 0.7 * aFlight.w);
  if (dot(velocity, velocity) < 1e-6) velocity = vec3(0.0, 0.0, 1.0);
  vec3 forward = normalize(velocity);
  vec3 inward = -normalize(vec3(cos(angle), 0.0, sin(angle) * 0.7));
  vec3 up = normalize(vec3(0.0, 1.0, 0.0) + inward * 0.3);
  vec3 right = normalize(cross(forward, up));
  up = cross(right, forward);
  // flap in bouts and glide in between; the wing tips lift further than the elbows
  float bout = smoothstep(0.2, 0.6, sin(uTime * 0.35 + aFlight.z * 13.0) * 0.5 + 0.5);
  float flap = sin(uTime * 9.0 + aFlight.z * 20.0) * bout;
  float dihedral = (flap * 0.6 + 0.12) * (0.55 + 0.45 * aFlex) * step(0.01, aFlex);
  vec3 p = position;
  float span = abs(p.x);
  p.x = sign(p.x) * span * cos(dihedral);
  p.y += span * sin(dihedral);
  p *= ${float(BIRD_SCALE)} * shown;
  vec3 world = center + right * p.x + up * p.y + forward * p.z;
  vWorld = world;
  vShade = 0.6 + 0.4 * aFlex;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  if (shown < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const BIRD_FRAGMENT = /* glsl */ `
#include <common>
varying vec3 vWorld;
varying float vShade;
void main() {
  vec3 col = vec3(0.03, 0.028, 0.03) * vShade + uSunCol * 0.004 + uAmbient * 0.008;
  gl_FragColor = vec4(applyAtmosphere(col, vWorld), 1.0);
}
`;

const instanced = (base: THREE.BufferGeometry, count: number): THREE.InstancedBufferGeometry => {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = base.index;
  for (const [name, attribute] of Object.entries(base.attributes)) geometry.setAttribute(name, attribute);
  geometry.instanceCount = count;
  return geometry;
};

const createQuad = (): THREE.BufferGeometry => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
};

/** A petal cupped across its width and bent along its length, one unit long. */
const createPetalShape = (): THREE.BufferGeometry => {
  const columns = 3;
  const rows = 4;
  const positions: number[] = [];
  const uvs: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    const v = row / (rows - 1);
    for (let column = 0; column < columns; column += 1) {
      const u = column / (columns - 1);
      const across = u - 0.5;
      positions.push(across * 0.8, v - 0.5, -across * across * 0.55 + (v - 0.5) * (v - 0.5) * 0.2);
      uvs.push(u, v);
    }
  }
  const indices: number[] = [];
  for (let row = 0; row < rows - 1; row += 1) {
    for (let column = 0; column < columns - 1; column += 1) {
      const a = row * columns + column;
      const c = a + columns;
      indices.push(a, a + 1, c, a + 1, c + 1, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
};

/** Paper box on a wooden float. aPart: 0 paper wall, 1 open top, 2 wood. */
const createLanternShape = (): THREE.BufferGeometry => {
  const paper = new THREE.BoxGeometry(0.34, 0.4, 0.34);
  paper.translate(0, 0.25, 0);
  const float = new THREE.BoxGeometry(0.46, 0.06, 0.46);
  float.translate(0, 0.02, 0);
  const tag = (geometry: THREE.BufferGeometry, part: (vertex: number) => number): void => {
    const count = geometry.getAttribute("position").count;
    geometry.setAttribute("aPart", new THREE.Float32BufferAttribute(Array.from({ length: count }, (_, vertex) => part(vertex)), 1));
  };
  // BoxGeometry lists its faces as +x, -x, +y, -y, +z, -z with four vertices each
  tag(paper, (vertex) => (vertex >= 8 && vertex < 12 ? 1 : 0));
  tag(float, () => 2);
  const merged = mergeGeometries([paper, float]);
  paper.dispose();
  float.dispose();
  return merged;
};

/** Body and two jointed wings; aFlex grows from the shoulder (0) to the wing tip (1). */
const createBirdShape = (): THREE.BufferGeometry => {
  const positions: number[] = [];
  const flex: number[] = [];
  const indices: number[] = [];
  const vertex = (x: number, y: number, z: number, weight: number): number => {
    positions.push(x, y, z);
    flex.push(weight);
    return flex.length - 1;
  };
  const nose = vertex(0, 0, 0.32, 0);
  const tail = vertex(0, 0.01, -0.3, 0);
  const tailLeft = vertex(-0.08, 0.01, -0.38, 0);
  const tailRight = vertex(0.08, 0.01, -0.38, 0);
  const back = vertex(0, 0.045, 0.04, 0);
  const belly = vertex(0, -0.035, 0, 0);
  indices.push(nose, back, tail, nose, tail, belly, tail, tailLeft, tailRight);
  for (const side of [-1, 1]) {
    const rootFront = vertex(side * 0.05, 0.02, 0.1, 0.05);
    const rootBack = vertex(side * 0.05, 0.02, -0.08, 0.05);
    const elbowFront = vertex(side * 0.34, 0.03, 0.07, 0.55);
    const elbowBack = vertex(side * 0.3, 0.03, -0.11, 0.55);
    const tip = vertex(side * 0.64, 0.02, -0.05, 1);
    indices.push(rootFront, elbowFront, rootBack, rootBack, elbowFront, elbowBack, elbowFront, tip, elbowBack);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aFlex", new THREE.Float32BufferAttribute(flex, 1));
  geometry.setIndex(indices);
  return geometry;
};

const shaderMaterial = (parameters: THREE.ShaderMaterialParameters & { uniforms: Record<string, THREE.IUniform> }): THREE.ShaderMaterial => {
  const material = new THREE.ShaderMaterial({ ...parameters, uniforms: { ...GLOBALS, ...parameters.uniforms } });
  material.userData.globals = true;
  return material;
};

const additive = { transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending } as const;

const particleMesh = (geometry: THREE.BufferGeometry, material: THREE.ShaderMaterial, name: string, layer: number, renderOrder = 0): THREE.Mesh => {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.layers.set(layer);
  mesh.renderOrder = renderOrder;
  return mesh;
};

export type CrownSlot = { crown: number; fade: number };

/**
 * Moves the slots toward the wanted crowns. A slot holding an unwanted crown fades out before it
 * takes a wanted crown nobody holds, so shed petals never jump from one tree to another.
 */
export const stepCrownSlots = (slots: CrownSlot[], wanted: ReadonlyArray<number>, dt: number, fadeSeconds: number): void => {
  const step = dt / fadeSeconds;
  for (const slot of slots) {
    if (slot.crown >= 0 && wanted.includes(slot.crown)) {
      slot.fade = Math.min(1, slot.fade + step);
      continue;
    }
    slot.fade = Math.max(0, slot.fade - step);
    if (slot.fade > 0) continue;
    slot.crown = wanted.find((crown) => !slots.some((other) => other.crown === crown)) ?? -1;
  }
};

export type LanternDrift = { seed: number; across: number; speed: number; phase: number };

/**
 * Where a lantern floating down the river is at `timeSec`. The lanterns wrap through a stretch of
 * river that follows `focusZ`; w fades them in and out at the two ends of that stretch.
 */
export const lanternDrift = (lantern: LanternDrift, timeSec: number, focusZ: number, out: THREE.Vector4): THREE.Vector4 => {
  const start = focusZ - LANTERN_UPSTREAM;
  const z = start + wrap(lantern.seed * LANTERN_SPAN + timeSec * lantern.speed - start, LANTERN_SPAN);
  const offset = z - start;
  const x = riverCenterWorld(z) + lantern.across * riverHalfWidth(z) + Math.sin(timeSec * 0.3 + lantern.phase) * 0.3;
  const edge = smoothstep(0, 14, offset) * (1 - smoothstep(LANTERN_SPAN - 14, LANTERN_SPAN, offset));
  return out.set(x, WATER_LEVEL, z, edge);
};

/** Firefly homes (xyz, seed) over the meadow and the banks, crowded along the river. */
export const createFireflyHomes = (count: number, random: () => number): Float32Array => {
  const homes = new Float32Array(count * 4);
  let placed = 0;
  for (let attempt = 0; placed < count && attempt < count * 40; attempt += 1) {
    const x = -135 + random() * 270;
    const z = -115 + random() * 230;
    const ground = groundHeight(x, z);
    if (ground > WATER_LEVEL + 6) continue;
    const fromBank = Math.abs(x - riverCenterWorld(z)) - riverHalfWidth(z);
    const chance = fromBank < -1 ? 0.3 : fromBank < 16 ? 1 : 0.35;
    if (random() > chance) continue;
    const floor = Math.max(ground, WATER_LEVEL);
    homes.set([x, floor + 0.4 + random() * (fromBank < 0 ? 1.1 : 1.9), z, random()], placed * 4);
    placed += 1;
  }
  return homes.slice(0, placed * 4);
};

type Wisp = { base: THREE.Vector3; position: THREE.Vector3; alive: boolean; fade: number; phase: number; amplitude: number; pace: number; tint: THREE.Color };

const WISP_COOL = new THREE.Color(0.45, 0.75, 1);
const WISP_WARM = new THREE.Color(1, 0.72, 0.42);
const LANTERN_TINT = new THREE.Color(1, 0.55, 0.22);

export const createAmbience = ({ blossomTrees }: AmbienceOptions): Ambience => {
  const root = new THREE.Group();
  root.name = "ambience";
  const random = createRandom(4051);
  const viewport = { value: 720 };
  const bufferSize = new THREE.Vector2();
  const trackViewport = (mesh: THREE.Mesh): void => {
    mesh.onBeforeRender = (renderer) => {
      const target = renderer.getRenderTarget();
      viewport.value = target ? target.height : renderer.getDrawingBufferSize(bufferSize).y;
    };
  };
  const riverLine = createRiverLine();

  const crowns = blossomTrees.map((crown) => crown.clone());
  const crownFloors = crowns.map((crown) => {
    let floor = groundHeight(crown.x, crown.z);
    for (let side = 0; side < 8; side += 1) {
      const angle = (side * Math.PI) / 4;
      floor = Math.min(floor, groundHeight(crown.x + Math.cos(angle) * CROWN_RADIUS, crown.z + Math.sin(angle) * CROWN_RADIUS));
    }
    return Math.max(floor, WATER_LEVEL) + 0.03;
  });
  const slots: CrownSlot[] = Array.from({ length: Math.min(CROWN_SLOTS, crowns.length) }, () => ({ crown: -1, fade: 0 }));
  const wantedCrowns: number[] = [];
  const crownOrder = crowns.map((_, index) => index);
  const crownDistance = new Float32Array(crowns.length);
  let crownTimer = 0;

  const crownPetals = slots.length * PETALS_PER_CROWN;
  const airPetals = crowns.length > 0 ? AIR_PETALS : AIR_PETALS_WITHOUT_TREES;
  const petalCount = crownPetals + airPetals + WATER_PETALS;
  const petalSeeds = new Float32Array(petalCount * 4);
  const petalSpins = new Float32Array(petalCount * 4);
  const petalKinds = new Float32Array(petalCount * 4);
  const axis = new THREE.Vector3();
  for (let index = 0; index < petalCount; index += 1) {
    const kind = index < crownPetals ? 0 : index < crownPetals + airPetals ? 1 : 2;
    petalSeeds.set([random(), random(), random(), random()], index * 4);
    axis.set(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1);
    if (axis.lengthSq() < 1e-4) axis.set(0, 1, 0);
    axis.normalize();
    petalSpins.set([axis.x, axis.y, axis.z, 0.7 + random() * 0.6], index * 4);
    const nearBank = random() < 0.55;
    const across = nearBank ? (random() < 0.5 ? -1 : 1) * (0.6 + random() * 0.38) : random() * 1.2 - 0.6;
    petalKinds.set([kind, kind === 0 ? Math.floor(index / PETALS_PER_CROWN) : 0, (across + 1) / 2, 0], index * 4);
  }
  const petalGeometry = instanced(createPetalShape(), petalCount);
  petalGeometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(petalSeeds, 4));
  petalGeometry.setAttribute("aSpin", new THREE.InstancedBufferAttribute(petalSpins, 4));
  petalGeometry.setAttribute("aKind", new THREE.InstancedBufferAttribute(petalKinds, 4));
  const petalUniforms = {
    uCrowns: { value: Array.from({ length: CROWN_SLOTS }, () => new THREE.Vector4(0, -999, 0, -999)) },
    uCrownFade: { value: new Float32Array(CROWN_SLOTS) },
    uAirCenter: { value: new THREE.Vector3() },
    uFocus: { value: new THREE.Vector3() },
    tRiver: { value: riverLine }
  };
  const petals = particleMesh(
    petalGeometry,
    shaderMaterial({ uniforms: petalUniforms, vertexShader: PETAL_VERTEX, fragmentShader: PETAL_FRAGMENT, side: THREE.DoubleSide }),
    "petals",
    LAYER_NO_REFLECT
  );

  const moteSeeds = new Float32Array(MOTE_COUNT * 4).map(() => random());
  const moteGeometry = instanced(createQuad(), MOTE_COUNT);
  moteGeometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(moteSeeds, 4));
  const moteUniforms = { uMoteCenter: { value: new THREE.Vector3() }, uViewH: viewport };
  const motes = particleMesh(moteGeometry, shaderMaterial({ uniforms: moteUniforms, vertexShader: MOTE_VERTEX, fragmentShader: MOTE_FRAGMENT, ...additive }), "motes", LAYER_WATER, 10);
  trackViewport(motes);

  const homes = createFireflyHomes(FIREFLY_COUNT, random);
  const fireflyCount = homes.length / 4;
  const fireflyMotion = new Float32Array(fireflyCount * 4);
  for (let index = 0; index < fireflyCount; index += 1) {
    fireflyMotion.set([0.6 + random() * 1.2, 0.35 + random() * 0.5, 0.5 + random() * 0.9, random() * 100], index * 4);
  }
  const fireflyGeometry = instanced(createQuad(), fireflyCount);
  fireflyGeometry.setAttribute("aHome", new THREE.InstancedBufferAttribute(homes, 4));
  fireflyGeometry.setAttribute("aMotion", new THREE.InstancedBufferAttribute(fireflyMotion, 4));
  const fireflies = particleMesh(
    fireflyGeometry,
    shaderMaterial({ uniforms: { uViewH: viewport }, vertexShader: FIREFLY_VERTEX, fragmentShader: GLOW_FRAGMENT, ...additive }),
    "fireflies",
    LAYER_WATER,
    11
  );
  trackViewport(fireflies);

  const glowCount = LANTERN_COUNT + WISP_COUNT;
  const glowCenters = new THREE.InstancedBufferAttribute(new Float32Array(glowCount * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const glowColors = new THREE.InstancedBufferAttribute(new Float32Array(glowCount * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const glowGeometry = instanced(createQuad(), glowCount);
  glowGeometry.setAttribute("aCenter", glowCenters);
  glowGeometry.setAttribute("aColor", glowColors);
  const glows = particleMesh(
    glowGeometry,
    shaderMaterial({ uniforms: { uViewH: viewport }, vertexShader: RIVER_GLOW_VERTEX, fragmentShader: GLOW_FRAGMENT, ...additive }),
    "river-glows",
    LAYER_WATER,
    12
  );
  trackViewport(glows);

  const lanternPlaces = new THREE.InstancedBufferAttribute(new Float32Array(LANTERN_COUNT * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const lanternPoses = new THREE.InstancedBufferAttribute(new Float32Array(LANTERN_COUNT * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const lanternShape = createLanternShape();
  const lanternGeometry = instanced(lanternShape, LANTERN_COUNT);
  lanternGeometry.setAttribute("aPlace", lanternPlaces);
  lanternGeometry.setAttribute("aPose", lanternPoses);
  const lanternMesh = particleMesh(lanternGeometry, shaderMaterial({ uniforms: {}, vertexShader: LANTERN_VERTEX, fragmentShader: LANTERN_FRAGMENT }), "toro-lanterns", LAYER_MAIN);
  const lanterns = Array.from({ length: LANTERN_COUNT }, (_, index) => ({
    seed: (index + random() * 0.6) / LANTERN_COUNT,
    across: -0.42 + random() * 0.84,
    speed: 0.5 + random() * 0.35,
    phase: random() * Math.PI * 2,
    spin: (random() - 0.5) * 0.16,
    threshold: 0.18 + random() * 0.5
  }));
  const lightPool = Array.from({ length: LANTERN_COUNT }, () => new THREE.Vector4());
  const floatingLights: THREE.Vector4[] = [];

  const wisps: Wisp[] = Array.from({ length: WISP_COUNT }, (_, index) => ({
    base: new THREE.Vector3(),
    position: new THREE.Vector3(),
    alive: false,
    fade: 0,
    phase: random() * 100,
    amplitude: 1.2 + random() * 1.4,
    pace: 0.3 + random() * 0.3,
    tint: index % 4 === 0 ? WISP_WARM : WISP_COOL
  }));

  const birdTotal = FLOCKS.reduce((sum, flock) => sum + flock.birds, 0);
  const birdFlocks = new Float32Array(birdTotal * 4);
  const birdFlights = new Float32Array(birdTotal * 4);
  let bird = 0;
  for (const flock of FLOCKS) {
    for (let member = 0; member < flock.birds; member += 1, bird += 1) {
      birdFlocks.set([flock.seed, flock.radius, flock.travel, flock.height], bird * 4);
      birdFlights.set([random() * 6 - 3, random() * 4 - 2, random() * 0.6 + member * 0.05, flock.turn], bird * 4);
    }
  }
  const birdGeometry = instanced(createBirdShape(), birdTotal);
  birdGeometry.setAttribute("aFlock", new THREE.InstancedBufferAttribute(birdFlocks, 4));
  birdGeometry.setAttribute("aFlight", new THREE.InstancedBufferAttribute(birdFlights, 4));
  const birds = particleMesh(
    birdGeometry,
    shaderMaterial({
      uniforms: { uFocus: petalUniforms.uFocus, tRiver: petalUniforms.tRiver },
      vertexShader: BIRD_VERTEX,
      fragmentShader: BIRD_FRAGMENT,
      side: THREE.DoubleSide
    }),
    "birds",
    LAYER_NO_REFLECT
  );

  root.add(petals, birds, lanternMesh, motes, fireflies, glows);

  const eye = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const drift = new THREE.Vector4();
  /** The first frame starts mid-scene: petals already falling, wisps already out. */
  let primed = false;

  const updateCrowns = (dt: number, focus: THREE.Vector3): void => {
    if (slots.length === 0) return;
    crownTimer -= dt;
    if (crownTimer <= 0) {
      crownTimer = CROWN_REFRESH_SECONDS;
      const cx = (eye.x + focus.x) / 2;
      const cz = (eye.z + focus.z) / 2;
      crowns.forEach((crown, index) => {
        crownDistance[index] = (crown.x - cx) ** 2 + (crown.z - cz) ** 2;
      });
      crownOrder.sort((a, b) => crownDistance[a] - crownDistance[b]);
      wantedCrowns.length = 0;
      wantedCrowns.push(...crownOrder.slice(0, slots.length));
    }
    if (primed) {
      stepCrownSlots(slots, wantedCrowns, dt, CROWN_FADE_SECONDS);
    } else {
      slots.forEach((slot, index) => {
        slot.crown = wantedCrowns[index];
        slot.fade = 1;
      });
    }
    slots.forEach((slot, index) => {
      const crown = crowns[slot.crown];
      if (crown) petalUniforms.uCrowns.value[index].set(crown.x, crown.y, crown.z, crownFloors[slot.crown]);
      petalUniforms.uCrownFade.value[index] = crown ? slot.fade : 0;
    });
  };

  const updateLanterns = (timeSec: number, focus: THREE.Vector3, lampOn: number): boolean => {
    floatingLights.length = 0;
    let shown = false;
    lanterns.forEach((lantern, index) => {
      lanternDrift(lantern, timeSec, focus.z, drift);
      const strength = smoothstep(lantern.threshold, lantern.threshold + 0.15, lampOn) * drift.w;
      const scale = smoothstep(0, 0.35, strength);
      const flicker = 0.88 + 0.08 * Math.sin(timeSec * 7.3 + lantern.phase * 5) + 0.04 * Math.sin(timeSec * 13.1 + lantern.phase * 11);
      const bob = Math.sin(timeSec * 1.7 + lantern.phase) * 0.025;
      const glow = strength * flicker;
      lanternPlaces.setXYZW(index, drift.x, WATER_LEVEL - 0.03 + bob, drift.z, lantern.phase + timeSec * lantern.spin);
      lanternPoses.setXYZW(index, Math.sin(timeSec * 1.3 + lantern.phase) * 0.06, Math.cos(timeSec * 1.1 + lantern.phase * 1.3) * 0.06, scale, glow);
      glowCenters.setXYZW(index, drift.x, WATER_LEVEL + 0.3 + bob, drift.z, LANTERN_HALO * scale);
      glowColors.setXYZW(index, LANTERN_TINT.r * glow * 0.3, LANTERN_TINT.g * glow * 0.3, LANTERN_TINT.b * glow * 0.3, 0);
      if (strength < 0.01) return;
      shown = true;
      floatingLights.push(lightPool[index].set(drift.x, WATER_LEVEL + LANTERN_LIGHT_HEIGHT, drift.z, LANTERN_LIGHT * glow));
    });
    lanternPlaces.needsUpdate = true;
    lanternPoses.needsUpdate = true;
    return shown;
  };

  const respawnWisp = (wisp: Wisp, focus: THREE.Vector3): void => {
    const z = focus.z - 90 + random() * 150;
    const x = riverCenterWorld(z) + (random() * 2.6 - 1.3) * riverHalfWidth(z);
    wisp.base.set(x, Math.max(groundHeight(x, z), WATER_LEVEL) + 0.55 + random() * 1.25, z);
    wisp.alive = true;
    wisp.fade = 0;
  };

  const updateWisps = (dt: number, timeSec: number, focus: THREE.Vector3, visibility: number): boolean => {
    wisps.forEach((wisp, index) => {
      const slot = LANTERN_COUNT + index;
      if (visibility <= 0.01) {
        wisp.alive = false;
        glowCenters.setW(slot, 0);
        return;
      }
      const relative = wisp.base.z - focus.z;
      if (!wisp.alive || relative > 70 || relative < -100) respawnWisp(wisp, focus);
      wisp.fade = primed ? Math.min(1, wisp.fade + dt / 2.5) : 1;
      const t = timeSec * wisp.pace + wisp.phase;
      const dart = Math.max(0, Math.sin(t * 0.21)) ** 12 * 0.7;
      const { base, position } = wisp;
      position.set(
        base.x + Math.sin(t * 0.37) * wisp.amplitude + Math.sin(t * 1.3 + 1.7) * 0.35 + Math.sin(t * 0.9) * dart,
        base.y + Math.sin(t * 0.61 + 0.4) * 0.45 + Math.sin(t * 2.1) * 0.08,
        base.z + Math.cos(t * 0.29 + 0.8) * wisp.amplitude * 1.4 + Math.cos(t * 1.1) * 0.3 + Math.cos(t * 0.7) * dart
      );
      position.y = Math.max(position.y, Math.max(groundHeight(position.x, position.z), WATER_LEVEL) + 0.35);
      const breathe = 0.88 + 0.12 * Math.sin(timeSec * 1.9 + wisp.phase * 40) * Math.sin(timeSec * 0.7 + wisp.phase * 13);
      const intensity = wisp.fade * visibility * breathe * smoothstep(2.5, 8, position.distanceTo(eye)) * 0.22;
      glowCenters.setXYZW(slot, position.x, position.y, position.z, WISP_RADIUS);
      glowColors.setXYZW(slot, wisp.tint.r * intensity, wisp.tint.g * intensity, wisp.tint.b * intensity, 1);
    });
    return visibility > 0.01;
  };

  const update = (dt: number, timeSec: number, camera: THREE.PerspectiveCamera, focus: THREE.Vector3): void => {
    const step = Math.min(Math.max(dt, 0), 0.1);
    camera.getWorldPosition(eye);
    camera.getWorldDirection(forward);
    const night = GLOBALS.uNight.value;
    const lampOn = GLOBALS.uLampOn.value;
    petalUniforms.uAirCenter.value.copy(focus);
    petalUniforms.uFocus.value.copy(focus);
    moteUniforms.uMoteCenter.value.copy(eye).addScaledVector(forward, MOTE_BOX.x * 0.3);
    updateCrowns(step, focus);
    const lanternsShown = updateLanterns(timeSec, focus, lampOn);
    const wispsShown = updateWisps(step, timeSec, focus, smoothstep(0.35, 0.85, lampOn));
    glowCenters.needsUpdate = true;
    glowColors.needsUpdate = true;
    lanternMesh.visible = lanternsShown;
    glows.visible = lanternsShown || wispsShown;
    motes.visible = GLOBALS.uSunVis.value * (1 - night) > 0.01;
    birds.visible = night < 0.6;
    fireflies.visible = night > 0.35;
    primed = true;
  };

  const dispose = (): void => {
    root.removeFromParent();
    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    });
    lanternShape.dispose();
    riverLine.dispose();
  };

  return { root, floatingLights, update, dispose };
};
