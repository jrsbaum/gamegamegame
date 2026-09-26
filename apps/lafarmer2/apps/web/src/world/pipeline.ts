import * as THREE from "three";
import { WATER_LEVEL } from "./height";
import { GLOBALS, LAYER_MAIN, LAYER_MIRROR, LAYER_NO_REFLECT, LAYER_WATER, PRELUDE } from "./shared";

/** Which of the expensive passes run. */
export type PipelineQuality = {
  /** Planar reflection of the valley in the river. */
  mirror: boolean;
  /** Light shafts ray-marched through the sun's shadow map. */
  volumetric: boolean;
  /** Screen-space ambient occlusion. */
  ao: boolean;
};

/** Per-frame look, usually driven by the day cycle. `fade` blends the frame to black. */
export type PipelineParams = { exposure: number; bloom: number; vol: number; warm: number; fade: number };

/** The water uniforms fed from the pipeline's targets every frame. */
export type WaterTargets = {
  tRefl: { value: THREE.Texture | null };
  tScene: { value: THREE.Texture | null };
  uTexMatrix: { value: THREE.Matrix4 };
  uRes: { value: THREE.Vector2 };
  uHasRefl: { value: number };
};

export type PipelineOptions = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  water?: WaterTargets;
};

export type Pipeline = {
  readonly params: PipelineParams;
  readonly quality: PipelineQuality;
  /** Internal resolution after scaling. */
  readonly size: () => { width: number; height: number };
  /** `width`/`height` in CSS pixels; `scale` multiplies them (device pixel ratio times the adaptive scale). */
  resize: (width: number, height: number, scale: number) => void;
  /** Compiles every material up front so the first frames do not hitch. */
  prewarm: () => void;
  render: () => void;
  dispose: () => void;
};

const QUAD_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const COPY_FRAGMENT = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uNF;
varying vec2 vUv;
void main() {
  float z = texture2D(tDepth, vUv).x * 2.0 - 1.0;
  float lin = (2.0 * uNF.x * uNF.y) / (uNF.y + uNF.x - z * (uNF.y - uNF.x));
  gl_FragColor = vec4(texture2D(tColor, vUv).rgb, lin);
}`;

/**
 * three r170 packs shadow depth into RGBA8 (no depth texture), so the march unpacks and
 * compares by hand.
 */
const VOLUMETRIC_FRAGMENT = /* glsl */ `
${PRELUDE}
#include <packing>
uniform sampler2D tDepth;
uniform sampler2D tShadow;
uniform mat4 uShadowMatrix;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform float uFrame;
varying vec2 vUv;

float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

void main() {
  float lin = texture2D(tDepth, vUv).a;
  vec4 vd = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 vdir = normalize(vd.xyz / vd.w);
  vec3 rd = normalize(mat3(uCamWorld) * vdir);
  float tMax = min(lin / max(-vdir.z, 1e-3), 220.0);
  const int N = 26;
  float j = ign(gl_FragCoord.xy + uFrame * 5.588238);
  float acc = 0.0;
  float trans = 1.0;
  float dt = tMax / float(N);
  for (int i = 0; i < N; i++) {
    float t = (float(i) + j) * dt;
    vec3 p = uCamPos + rd * t;
    vec4 sc = uShadowMatrix * vec4(p, 1.0);
    float lit = 1.0;
    if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0) {
      lit = step(sc.z - 0.0015, unpackRGBAToDepth(texture2D(tShadow, sc.xy)));
    }
    // denser air low in the valley, drifting mist banks
    float dens = 0.42 * exp(-max(p.y - uWaterLevel, 0.0) * 0.05)
      + 1.1 * smoothstep(0.38, 0.82, vnoise(p.xz * 0.03 + vec2(uTime * 0.04, uTime * 0.02))) * exp(-max(p.y - uWaterLevel, 0.0) * 0.14);
    acc += lit * dens * trans * dt;
    trans *= exp(-dens * dt * 0.004);
  }
  float mu = dot(rd, uSunDir);
  float g = 0.8;
  float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5) / 12.566;
  float iso = 0.035;
  gl_FragColor = vec4(uSunCol * acc * (hg * 0.8 + iso) * 0.0054, 1.0);
}`;

/** Separable blur that does not bleed across depth edges. */
const BLUR_FRAGMENT = /* glsl */ `
uniform sampler2D tSrc;
uniform sampler2D tDepth;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  float d0 = texture2D(tDepth, vUv).a;
  vec3 s = vec3(0.0);
  float ws = 0.0;
  for (int i = -4; i <= 4; i++) {
    vec2 uv = vUv + uDir * float(i);
    float d = texture2D(tDepth, uv).a;
    float w = exp(-float(i * i) * 0.12) * (1.0 / (1.0 + abs(d - d0) / max(d0, 1.0) * 8.0));
    s += texture2D(tSrc, uv).rgb * w;
    ws += w;
  }
  gl_FragColor = vec4(s / ws, 1.0);
}`;

const BLEND_FRAGMENT = /* glsl */ `
uniform sampler2D tA;
uniform sampler2D tB;
uniform float uK;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(mix(texture2D(tA, vUv).rgb, texture2D(tB, vUv).rgb, uK), 1.0);
}`;

const AO_FRAGMENT = /* glsl */ `
uniform sampler2D tDepth;
uniform mat4 uInvProj;
uniform mat4 uProj;
uniform vec2 uTexel;
varying vec2 vUv;

vec3 viewPos(vec2 uv) {
  float lin = texture2D(tDepth, uv).a;
  vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  vec3 d = v.xyz / v.w;
  return d * (lin / max(-d.z, 1e-4));
}

float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

void main() {
  vec3 P = viewPos(vUv);
  float dist = -P.z;
  if (dist > 160.0) { gl_FragColor = vec4(1.0); return; }
  vec3 pr = viewPos(vUv + vec2(uTexel.x, 0.0));
  vec3 pl = viewPos(vUv - vec2(uTexel.x, 0.0));
  vec3 pu = viewPos(vUv + vec2(0.0, uTexel.y));
  vec3 pd = viewPos(vUv - vec2(0.0, uTexel.y));
  vec3 dx = abs(pr.z - P.z) < abs(P.z - pl.z) ? pr - P : P - pl;
  vec3 dy = abs(pu.z - P.z) < abs(P.z - pd.z) ? pu - P : P - pd;
  vec3 N = normalize(cross(dx, dy));
  float R = clamp(0.35 + dist * 0.02, 0.35, 1.6);
  float rot = ign(gl_FragCoord.xy) * 6.2831;
  vec3 up = abs(N.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 T = normalize(cross(up, N));
  vec3 B = cross(N, T);
  float occ = 0.0;
  const int S = 8;
  for (int i = 0; i < S; i++) {
    float fi = float(i);
    float a = fi * 2.39996 + rot;
    float r = sqrt((fi + 0.5) / float(S));
    float h = 0.25 + 0.75 * fract(fi * 0.618 + rot);
    vec3 k = (T * cos(a) * r + B * sin(a) * r) * sqrt(1.0 - h * 0.5) + N * h * 0.9;
    vec3 sp = P + k * R * (0.35 + 0.65 * fract(fi * 0.37 + 0.13));
    vec4 cp = uProj * vec4(sp, 1.0);
    vec2 suv = cp.xy / cp.w * 0.5 + 0.5;
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;
    float sd = texture2D(tDepth, suv).a;
    float diff = -sp.z - sd;
    occ += step(0.03 + dist * 0.002, diff) * smoothstep(1.0, 0.0, (diff - R) / R);
  }
  gl_FragColor = vec4(vec3(1.0 - occ / float(S)), 1.0);
}`;

const BRIGHT_FRAGMENT = /* glsl */ `
uniform sampler2D tSrc;
uniform sampler2D tVol;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  c = c * 0.25 + texture2D(tVol, vUv).rgb;
  c = min(c, vec3(60.0));
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = max(l - 0.9, 0.0);
  k = k * k / (k + 1.2);
  gl_FragColor = vec4(c * (k / max(l, 1e-4)), 1.0);
}`;

const DOWN_FRAGMENT = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
  c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  gl_FragColor = vec4(c / 8.0, 1.0);
}`;

const UP_FRAGMENT = /* glsl */ `
uniform sampler2D tSrc;
uniform sampler2D tPrev;
uniform vec2 uTexel;
uniform float uW;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-1.0, 0.0)).rgb * 2.0;
  c += texture2D(tSrc, vUv + uTexel * vec2(1.0, 0.0)).rgb * 2.0;
  c += texture2D(tSrc, vUv + uTexel * vec2(0.0, -1.0)).rgb * 2.0;
  c += texture2D(tSrc, vUv + uTexel * vec2(0.0, 1.0)).rgb * 2.0;
  c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  gl_FragColor = vec4(texture2D(tPrev, vUv).rgb + c / 12.0 * uW, 1.0);
}`;

const COMPOSITE_FRAGMENT = /* glsl */ `
${PRELUDE}
uniform sampler2D tScene;
uniform sampler2D tVol;
uniform sampler2D tBloom;
uniform sampler2D tAO;
uniform sampler2D tDepthH;
uniform float uExposure;
uniform float uBloom;
uniform float uVolAmt;
uniform float uFade;
uniform float uFrame;
uniform float uAO;
uniform float uWarm;
uniform vec2 uRes;
uniform vec3 uSunScreen;
varying vec2 vUv;

vec3 aces(vec3 x) {
  const mat3 m1 = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 m2 = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  vec3 v = m1 * x;
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return clamp(m2 * (a / b), 0.0, 1.0);
}

vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }

void main() {
  vec2 uv = vUv;
  // slight chromatic fringe toward the frame edges
  vec2 cc = uv - 0.5;
  float r2 = dot(cc, cc);
  vec2 ca = cc * r2 * 0.0065;
  vec3 col;
  col.r = texture2D(tScene, uv - ca).r;
  col.g = texture2D(tScene, uv).g;
  col.b = texture2D(tScene, uv + ca).b;

  // AO darkens the lit scene before the shafts and bloom are added, fading out with distance
  float aoD = texture2D(tDepthH, uv).a;
  float ao = texture2D(tAO, uv).r;
  col *= mix(1.0, pow(ao, 1.4), uAO * (1.0 - smoothstep(60.0, 150.0, aoD)));
  col += texture2D(tVol, uv).rgb * uVolAmt;
  col += texture2D(tBloom, uv).rgb * uBloom;

  // warm veil around the sun when it is near the frame
  if (uSunScreen.z > 0.0) {
    vec2 d = (uv - uSunScreen.xy) * vec2(uRes.x / uRes.y, 1.0);
    col += uSunCol * 0.012 * exp(-length(d) * 3.2) * uSunVis;
  }
  col *= uExposure;

  // white balance: warm highlights toward golden hour, keep shadows cool
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, col * vec3(1.06, 1.0, 0.9), smoothstep(0.05, 0.8, lum) * uWarm);
  col = mix(col, col * vec3(0.9, 1.0, 1.07), 1.0 - smoothstep(0.0, 0.12, lum));
  // night vision: dim areas lose colour and drift blue (lamplight stays warm)
  col = mix(col, vec3(lum) * vec3(0.72, 0.88, 1.22), uNight * 0.55 * (1.0 - smoothstep(0.02, 0.35, lum)));

  vec3 m = aces(col);
  // painterly grade: teal in the shadows, amber in the highlights, firm S-curve
  float l = dot(m, vec3(0.299, 0.587, 0.114));
  m += vec3(0.006, 0.02, 0.026) * (1.0 - smoothstep(0.0, 0.4, l));
  m = mix(m, m * vec3(1.05, 0.99, 0.88), smoothstep(0.4, 1.0, l));
  m = mix(vec3(l), m, 1.14);
  m = clamp(m, 0.0, 1.0);
  m = mix(m, m * m * (3.0 - 2.0 * m), 0.38);
  float vig = 1.0 - smoothstep(0.35, 1.05, length(cc * vec2(1.05, 1.25)));
  m *= mix(0.68, 1.0, vig);
  m = toSRGB(clamp(m, 0.0, 1.0));

  // film grain + dither
  float gr = hash12(gl_FragCoord.xy + fract(uFrame * 0.618) * 311.0) - 0.5;
  m += gr * (0.028 * (1.0 - l * 0.6)) + (hash12(gl_FragCoord.yx * 1.3 + uFrame) - 0.5) / 255.0;
  m = mix(m, vec3(0.0), uFade);
  gl_FragColor = vec4(m, dot(m, vec3(0.299, 0.587, 0.114)));
}`;

/** FXAA (quality preset ~12) reading luma from alpha; a light unsharp mask elsewhere. */
const FXAA_FRAGMENT = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;

float L(vec2 p) { return texture2D(tSrc, p).a; }

void main() {
  vec2 uv = vUv;
  vec4 rgbM = texture2D(tSrc, uv);
  float lM = rgbM.a;
  float lN = L(uv + vec2(0.0, uTexel.y));
  float lS = L(uv - vec2(0.0, uTexel.y));
  float lE = L(uv + vec2(uTexel.x, 0.0));
  float lW = L(uv - vec2(uTexel.x, 0.0));
  float mx = max(max(max(lN, lS), max(lE, lW)), lM);
  float mn = min(min(min(lN, lS), min(lE, lW)), lM);
  float range = mx - mn;
  if (range < max(0.0312, mx * 0.125)) {
    vec3 nb = (texture2D(tSrc, uv + vec2(0.0, uTexel.y)).rgb + texture2D(tSrc, uv - vec2(0.0, uTexel.y)).rgb
      + texture2D(tSrc, uv + vec2(uTexel.x, 0.0)).rgb + texture2D(tSrc, uv - vec2(uTexel.x, 0.0)).rgb) * 0.25;
    gl_FragColor = vec4(clamp(rgbM.rgb + (rgbM.rgb - nb) * 0.35, 0.0, 1.0), 1.0);
    return;
  }
  float lNW = L(uv + vec2(-uTexel.x, uTexel.y));
  float lNE = L(uv + uTexel);
  float lSW = L(uv - uTexel);
  float lSE = L(uv + vec2(uTexel.x, -uTexel.y));
  float edgeH = abs(lNW + lNE - 2.0 * lN) + 2.0 * abs(lW + lE - 2.0 * lM) + abs(lSW + lSE - 2.0 * lS);
  float edgeV = abs(lNW + lSW - 2.0 * lW) + 2.0 * abs(lN + lS - 2.0 * lM) + abs(lNE + lSE - 2.0 * lE);
  bool horz = edgeH >= edgeV;
  float l1 = horz ? lS : lW;
  float l2 = horz ? lN : lE;
  float g1 = abs(l1 - lM);
  float g2 = abs(l2 - lM);
  bool is1 = g1 >= g2;
  float grad = 0.25 * max(g1, g2);
  float stepLen = horz ? uTexel.y : uTexel.x;
  float lLocal;
  if (is1) { stepLen = -stepLen; lLocal = 0.5 * (l1 + lM); } else { lLocal = 0.5 * (l2 + lM); }
  vec2 cuv = uv;
  if (horz) cuv.y += stepLen * 0.5; else cuv.x += stepLen * 0.5;
  vec2 off = horz ? vec2(uTexel.x, 0.0) : vec2(0.0, uTexel.y);
  vec2 u1 = cuv - off;
  vec2 u2 = cuv + off;
  float e1 = L(u1) - lLocal;
  float e2 = L(u2) - lLocal;
  bool r1 = abs(e1) >= grad;
  bool r2 = abs(e2) >= grad;
  for (int i = 0; i < 10; i++) {
    if (r1 && r2) break;
    float q = i < 3 ? 1.0 : (i < 6 ? 1.5 : (i < 8 ? 2.0 : 4.0));
    if (!r1) { u1 -= off * q; e1 = L(u1) - lLocal; r1 = abs(e1) >= grad; }
    if (!r2) { u2 += off * q; e2 = L(u2) - lLocal; r2 = abs(e2) >= grad; }
  }
  float d1 = horz ? uv.x - u1.x : uv.y - u1.y;
  float d2 = horz ? u2.x - uv.x : u2.y - uv.y;
  bool dir1 = d1 < d2;
  float dmin = min(d1, d2);
  float span = d1 + d2;
  float pix = -dmin / span + 0.5;
  bool smaller = lM < lLocal;
  bool correct = ((dir1 ? e1 : e2) < 0.0) != smaller;
  float fo = correct ? pix : 0.0;
  float la = (2.0 * (lN + lS + lE + lW) + lNW + lNE + lSW + lSE) / 12.0;
  float sub = clamp(abs(la - lM) / range, 0.0, 1.0);
  sub = (-2.0 * sub + 3.0) * sub * sub;
  sub = sub * sub * 0.75;
  fo = max(fo, sub);
  vec2 fuv = uv;
  if (horz) fuv.y += fo * stepLen; else fuv.x += fo * stepLen;
  gl_FragColor = vec4(texture2D(tSrc, fuv).rgb, 1.0);
}`;

type Uniforms = Record<string, THREE.IUniform>;

const pass = (fragmentShader: string, uniforms: Uniforms): THREE.ShaderMaterial =>
  new THREE.ShaderMaterial({ uniforms, vertexShader: QUAD_VERTEX, fragmentShader, depthTest: false, depthWrite: false });

const halfFloatTarget = (width: number, height: number, options: THREE.RenderTargetOptions = {}): THREE.WebGLRenderTarget =>
  new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    generateMipmaps: false,
    ...options
  });

const solidTexture = (value: number): THREE.DataTexture => {
  const texture = new THREE.DataTexture(new Uint8Array([value, value, value, 255]), 1, 1);
  texture.needsUpdate = true;
  return texture;
};

/**
 * Camera mirrored in the water plane. The oblique near plane clips everything below the
 * surface, so the banks do not leak into their own reflection.
 */
const createMirror = () => {
  const camera = new THREE.PerspectiveCamera();
  const texMatrix = new THREE.Matrix4();
  const plane = new THREE.Plane();
  const clip = new THREE.Vector4();
  const q = new THREE.Vector4();
  const rotation = new THREE.Matrix4();
  const eye = new THREE.Vector3();
  const look = new THREE.Vector3();
  const target = new THREE.Vector3();
  const normal = new THREE.Vector3(0, 1, 0);
  const point = new THREE.Vector3(0, WATER_LEVEL, 0);
  const reflectAcross = (source: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 =>
    out.copy(point).sub(source).reflect(normal).negate().add(point);

  const update = (source: THREE.PerspectiveCamera): void => {
    eye.setFromMatrixPosition(source.matrixWorld);
    rotation.extractRotation(source.matrixWorld);
    look.set(0, 0, -1).applyMatrix4(rotation).add(eye);
    reflectAcross(eye, camera.position);
    reflectAcross(look, target);
    camera.up.set(0, 1, 0).applyMatrix4(rotation).reflect(normal);
    camera.lookAt(target);
    camera.near = source.near;
    camera.far = source.far;
    camera.updateMatrixWorld();
    camera.projectionMatrix.copy(source.projectionMatrix);

    texMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    texMatrix.multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse);

    plane.setFromNormalAndCoplanarPoint(normal, point).applyMatrix4(camera.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const e = camera.projectionMatrix.elements;
    q.x = (Math.sign(clip.x) + e[8]) / e[0];
    q.y = (Math.sign(clip.y) + e[9]) / e[5];
    q.z = -1;
    q.w = (1 + e[10]) / e[14];
    clip.multiplyScalar(2 / clip.dot(q));
    e[2] = clip.x;
    e[6] = clip.y;
    e[10] = clip.z + 1 - 0.003;
    e[14] = clip.w;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  };

  return { camera, texMatrix, update };
};

/**
 * Deferred-looking forward pipeline: mirror, HDR scene with depth, half-res copy the water
 * refracts, water on top, light shafts, AO, bloom, graded composite and FXAA.
 */
export const createPipeline = ({ renderer, scene, camera, sun, water }: PipelineOptions): Pipeline => {
  renderer.shadowMap.autoUpdate = false;
  renderer.autoClear = true;
  const params: PipelineParams = { exposure: 1.05, bloom: 0.055, vol: 0.85, warm: 1, fade: 0 };
  const quality: PipelineQuality = { mirror: true, volumetric: true, ao: true };

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const black = solidTexture(0);
  const white = solidTexture(255);
  const mirror = createMirror();
  if (water) water.uTexMatrix.value = mirror.texMatrix;

  const copy = pass(COPY_FRAGMENT, { tColor: { value: null }, tDepth: { value: null }, uNF: { value: new THREE.Vector2() } });
  const volumetric = pass(VOLUMETRIC_FRAGMENT, {
    ...GLOBALS,
    tDepth: { value: null },
    tShadow: { value: null },
    uShadowMatrix: { value: new THREE.Matrix4() },
    uInvProj: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() },
    uCamPos: { value: new THREE.Vector3() },
    uFrame: { value: 0 }
  });
  const blur = pass(BLUR_FRAGMENT, { tSrc: { value: null }, tDepth: { value: null }, uDir: { value: new THREE.Vector2() } });
  const blend = pass(BLEND_FRAGMENT, { tA: { value: null }, tB: { value: null }, uK: { value: 1 } });
  const ambientOcclusion = pass(AO_FRAGMENT, {
    tDepth: { value: null },
    uInvProj: { value: new THREE.Matrix4() },
    uProj: { value: new THREE.Matrix4() },
    uTexel: { value: new THREE.Vector2() }
  });
  const bright = pass(BRIGHT_FRAGMENT, { tSrc: { value: null }, tVol: { value: null }, uTexel: { value: new THREE.Vector2() } });
  const down = pass(DOWN_FRAGMENT, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
  const up = pass(UP_FRAGMENT, { tSrc: { value: null }, tPrev: { value: null }, uTexel: { value: new THREE.Vector2() }, uW: { value: 0.85 } });
  const composite = pass(COMPOSITE_FRAGMENT, {
    ...GLOBALS,
    tScene: { value: null },
    tVol: { value: null },
    tBloom: { value: null },
    tAO: { value: null },
    tDepthH: { value: null },
    uAO: { value: 0.75 },
    uExposure: { value: 1 },
    uBloom: { value: 0.05 },
    uVolAmt: { value: 1 },
    uFade: { value: 0 },
    uWarm: { value: 1 },
    uRes: { value: new THREE.Vector2() },
    uSunScreen: { value: new THREE.Vector3() },
    uFrame: { value: 0 }
  });
  const fxaa = pass(FXAA_FRAGMENT, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
  const materials = [copy, volumetric, blur, blend, ambientOcclusion, bright, down, up, composite, fxaa];

  let width = 0;
  let height = 0;
  let rtScene: THREE.WebGLRenderTarget | undefined;
  let rtCopy: THREE.WebGLRenderTarget | undefined;
  let rtRefl: THREE.WebGLRenderTarget | undefined;
  let rtVol: THREE.WebGLRenderTarget | undefined;
  let rtVol2: THREE.WebGLRenderTarget | undefined;
  let rtHistA: THREE.WebGLRenderTarget | undefined;
  let rtHistB: THREE.WebGLRenderTarget | undefined;
  let rtAO: THREE.WebGLRenderTarget | undefined;
  let rtAO2: THREE.WebGLRenderTarget | undefined;
  let rtLDR: THREE.WebGLRenderTarget | undefined;
  let mips: THREE.WebGLRenderTarget[] = [];
  let ups: THREE.WebGLRenderTarget[] = [];
  let historyValid = false;
  let frame = 0;
  const previousForward = new THREE.Vector3();
  const previousPosition = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const position = new THREE.Vector3();
  const sunScreen = new THREE.Vector3();

  const disposeTargets = (): void => {
    [rtScene, rtCopy, rtRefl, rtVol, rtVol2, rtHistA, rtHistB, rtAO, rtAO2, rtLDR, ...mips, ...ups].forEach((target) => {
      if (!target) return;
      target.depthTexture?.dispose();
      target.dispose();
    });
    mips = [];
    ups = [];
  };

  const resize = (cssWidth: number, cssHeight: number, scale: number): void => {
    const nextWidth = Math.max(2, Math.round(cssWidth * scale));
    const nextHeight = Math.max(2, Math.round(cssHeight * scale));
    if (nextWidth === width && nextHeight === height) return;
    width = nextWidth;
    height = nextHeight;
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    disposeTargets();
    const depthTexture = new THREE.DepthTexture(width, height, THREE.UnsignedIntType);
    depthTexture.format = THREE.DepthFormat;
    rtScene = halfFloatTarget(width, height, { depthBuffer: true, depthTexture });
    const halfScale = Math.min(scale, 1.3) * 0.5;
    const halfWidth = Math.max(2, Math.round(cssWidth * halfScale));
    const halfHeight = Math.max(2, Math.round(cssHeight * halfScale));
    rtCopy = halfFloatTarget(halfWidth, halfHeight);
    rtRefl = halfFloatTarget(halfWidth, halfHeight, { depthBuffer: true });
    rtVol = halfFloatTarget(halfWidth, halfHeight);
    rtVol2 = halfFloatTarget(halfWidth, halfHeight);
    rtHistA = halfFloatTarget(halfWidth, halfHeight);
    rtHistB = halfFloatTarget(halfWidth, halfHeight);
    rtAO = halfFloatTarget(halfWidth, halfHeight);
    rtAO2 = halfFloatTarget(halfWidth, halfHeight);
    historyValid = false;
    rtLDR = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false
    });
    let mipWidth = halfWidth;
    let mipHeight = halfHeight;
    for (let level = 0; level < 6; level += 1) {
      mips.push(halfFloatTarget(mipWidth, mipHeight));
      ups.push(halfFloatTarget(mipWidth, mipHeight));
      mipWidth = Math.max(2, mipWidth >> 1);
      mipHeight = Math.max(2, mipHeight >> 1);
    }
    if (water) water.uRes.value.set(width, height);
  };

  const run = (material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void => {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(quadScene, quadCamera);
  };

  const viewLayers = (): void => {
    camera.layers.set(LAYER_MAIN);
    camera.layers.enable(LAYER_NO_REFLECT);
  };

  /** Blend weight of the new light-shaft frame: history smooths the jitter but smears fast turns. */
  const historyWeight = (): number => {
    camera.getWorldDirection(forward);
    position.setFromMatrixPosition(camera.matrixWorld);
    const turn = previousForward.lengthSq() > 0 ? previousForward.angleTo(forward) : 1;
    const moved = position.distanceTo(previousPosition);
    previousForward.copy(forward);
    previousPosition.copy(position);
    if (!historyValid) return 1;
    return Math.min(1, 0.3 + turn * 30 + moved * 0.08);
  };

  const render = (): void => {
    if (!rtScene || !rtCopy || !rtRefl || !rtVol || !rtVol2 || !rtHistA || !rtHistB || !rtAO || !rtAO2 || !rtLDR) return;
    frame += 1;
    renderer.autoClear = true;
    const shadowMap = sun.shadow.map;

    if (quality.mirror && shadowMap) {
      mirror.update(camera);
      mirror.camera.layers.set(LAYER_MAIN);
      mirror.camera.layers.enable(LAYER_MIRROR);
      const pendingShadows = renderer.shadowMap.needsUpdate;
      renderer.shadowMap.needsUpdate = false;
      GLOBALS.uReflect.value = 1;
      renderer.setRenderTarget(rtRefl);
      renderer.clear();
      renderer.render(scene, mirror.camera);
      GLOBALS.uReflect.value = 0;
      renderer.shadowMap.needsUpdate = pendingShadows;
    }

    viewLayers();
    renderer.setRenderTarget(rtScene);
    renderer.clear();
    renderer.render(scene, camera);

    copy.uniforms.tColor.value = rtScene.texture;
    copy.uniforms.tDepth.value = rtScene.depthTexture;
    copy.uniforms.uNF.value.set(camera.near, camera.far);
    run(copy, rtCopy);

    if (water) {
      water.tRefl.value = rtRefl.texture;
      water.tScene.value = rtCopy.texture;
      water.uHasRefl.value = quality.mirror && shadowMap ? 1 : 0;
    }
    camera.layers.set(LAYER_WATER);
    renderer.autoClear = false;
    renderer.setRenderTarget(rtScene);
    renderer.render(scene, camera);
    renderer.autoClear = true;
    viewLayers();

    let volumeTexture: THREE.Texture = black;
    const weight = historyWeight();
    const shadowTexture = sun.shadow.map?.texture;
    if (quality.volumetric && shadowTexture) {
      const u = volumetric.uniforms;
      u.tDepth.value = rtCopy.texture;
      u.tShadow.value = shadowTexture;
      u.uShadowMatrix.value.copy(sun.shadow.matrix);
      u.uInvProj.value.copy(camera.projectionMatrixInverse);
      u.uCamWorld.value.copy(camera.matrixWorld);
      u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
      u.uFrame.value = frame % 64;
      run(volumetric, rtVol);
      blur.uniforms.tDepth.value = rtCopy.texture;
      blur.uniforms.tSrc.value = rtVol.texture;
      blur.uniforms.uDir.value.set(1.5 / rtVol.width, 0);
      run(blur, rtVol2);
      blur.uniforms.tSrc.value = rtVol2.texture;
      blur.uniforms.uDir.value.set(0, 1.5 / rtVol.height);
      run(blur, rtVol);
      blend.uniforms.tA.value = rtHistA.texture;
      blend.uniforms.tB.value = rtVol.texture;
      blend.uniforms.uK.value = weight;
      run(blend, rtHistB);
      [rtHistA, rtHistB] = [rtHistB, rtHistA];
      historyValid = true;
      volumeTexture = rtHistA.texture;
    } else {
      historyValid = false;
    }

    let occlusionTexture: THREE.Texture = white;
    if (quality.ao) {
      const u = ambientOcclusion.uniforms;
      u.tDepth.value = rtCopy.texture;
      u.uInvProj.value.copy(camera.projectionMatrixInverse);
      u.uProj.value.copy(camera.projectionMatrix);
      u.uTexel.value.set(1 / rtCopy.width, 1 / rtCopy.height);
      run(ambientOcclusion, rtAO);
      blur.uniforms.tDepth.value = rtCopy.texture;
      blur.uniforms.tSrc.value = rtAO.texture;
      blur.uniforms.uDir.value.set(1.2 / rtAO.width, 0);
      run(blur, rtAO2);
      blur.uniforms.tSrc.value = rtAO2.texture;
      blur.uniforms.uDir.value.set(0, 1.2 / rtAO.height);
      run(blur, rtAO);
      occlusionTexture = rtAO.texture;
    }

    bright.uniforms.tSrc.value = rtScene.texture;
    bright.uniforms.tVol.value = volumeTexture;
    bright.uniforms.uTexel.value.set(1 / width, 1 / height);
    run(bright, mips[0]);
    for (let level = 1; level < mips.length; level += 1) {
      down.uniforms.tSrc.value = mips[level - 1].texture;
      down.uniforms.uTexel.value.set(1 / mips[level - 1].width, 1 / mips[level - 1].height);
      run(down, mips[level]);
    }
    let bloom = mips[mips.length - 1];
    for (let level = mips.length - 2; level >= 0; level -= 1) {
      up.uniforms.tSrc.value = bloom.texture;
      up.uniforms.tPrev.value = mips[level].texture;
      up.uniforms.uTexel.value.set(1 / bloom.width, 1 / bloom.height);
      run(up, ups[level]);
      bloom = ups[level];
    }

    const u = composite.uniforms;
    u.tScene.value = rtScene.texture;
    u.tVol.value = volumeTexture;
    u.tBloom.value = bloom.texture;
    u.tAO.value = occlusionTexture;
    u.tDepthH.value = rtCopy.texture;
    u.uExposure.value = params.exposure;
    u.uBloom.value = params.bloom;
    u.uVolAmt.value = params.vol;
    u.uWarm.value = params.warm;
    u.uFade.value = params.fade;
    u.uRes.value.set(width, height);
    u.uFrame.value = frame;
    sunScreen.copy(GLOBALS.uSunDir.value).multiplyScalar(1000).add(position).project(camera);
    const facing = forward.dot(GLOBALS.uSunDir.value);
    u.uSunScreen.value.set(sunScreen.x * 0.5 + 0.5, sunScreen.y * 0.5 + 0.5, facing > 0 ? facing : 0);
    run(composite, rtLDR);

    fxaa.uniforms.tSrc.value = rtLDR.texture;
    fxaa.uniforms.uTexel.value.set(1 / width, 1 / height);
    run(fxaa, null);
  };

  const prewarm = (): void => {
    if (!rtScene) return;
    const mask = camera.layers.mask;
    camera.layers.enableAll();
    renderer.setRenderTarget(rtScene);
    renderer.compile(scene, camera);
    renderer.setRenderTarget(null);
    camera.layers.mask = mask;
  };

  const dispose = (): void => {
    disposeTargets();
    materials.forEach((material) => material.dispose());
    quad.geometry.dispose();
    black.dispose();
    white.dispose();
  };

  return { params, quality, size: () => ({ width, height }), resize, prewarm, render, dispose };
};

export type ShadowRig = {
  /** Frames between refreshes of the shadow map when nothing else forces one. */
  interval: number;
  /** Centres the shadow map ahead of the camera and schedules a refresh when needed. */
  update: (camera: THREE.Camera, keyDir: THREE.Vector3) => void;
  /** Forces a refresh on the next update (a building appeared, quality changed). */
  invalidate: () => void;
};

export type ShadowRigOptions = {
  renderer: THREE.WebGLRenderer;
  sun: THREE.DirectionalLight;
  /** Half size of the shadow camera in world units. */
  extent?: number;
  /** How far ahead of the camera the shadowed area is centred. */
  ahead?: number;
  /** Grid the centre snaps to, so the map does not crawl every frame. */
  snap?: number;
  mapSize?: number;
};

const SUN_DISTANCE = 260;

export const createShadowRig = ({ renderer, sun, extent = 100, ahead = 40, snap = 4, mapSize = 4096 }: ShadowRigOptions): ShadowRig => {
  sun.castShadow = true;
  sun.shadow.mapSize.set(mapSize, mapSize);
  const shadowCamera = sun.shadow.camera;
  shadowCamera.left = -extent;
  shadowCamera.right = extent;
  shadowCamera.top = extent;
  shadowCamera.bottom = -extent;
  shadowCamera.near = 10;
  shadowCamera.far = 620;
  shadowCamera.updateProjectionMatrix();
  sun.shadow.bias = -4e-4;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 2;

  const center = new THREE.Vector3(Infinity, 0, 0);
  const candidate = new THREE.Vector3();
  const flatForward = new THREE.Vector3();
  const lastKey = new THREE.Vector3();
  let frames = 0;
  let forced = true;

  const rig: ShadowRig = {
    interval: 1,
    update: (camera, keyDir) => {
      camera.getWorldDirection(flatForward);
      flatForward.y = 0;
      if (flatForward.lengthSq() < 1e-6) flatForward.set(0, 0, -1);
      flatForward.normalize();
      candidate.setFromMatrixPosition(camera.matrixWorld).addScaledVector(flatForward, ahead);
      candidate.set(Math.round(candidate.x / snap) * snap, 0, Math.round(candidate.z / snap) * snap);
      frames += 1;
      const moved = candidate.distanceToSquared(center) > 1e-6;
      const turned = lastKey.lengthSq() === 0 || lastKey.angleTo(keyDir) > THREE.MathUtils.degToRad(0.35);
      if (!forced && !moved && !turned && frames < rig.interval) return;
      center.copy(candidate);
      lastKey.copy(keyDir);
      sun.target.position.copy(center);
      sun.position.copy(keyDir).multiplyScalar(SUN_DISTANCE).add(center);
      sun.target.updateMatrixWorld();
      sun.updateMatrixWorld();
      renderer.shadowMap.needsUpdate = true;
      frames = 0;
      forced = false;
    },
    invalidate: () => {
      forced = true;
    }
  };
  return rig;
};

export type AdaptiveResolution = {
  /** Current multiplier of the device pixel ratio, between `min` and 1. */
  readonly scale: () => number;
  /** Feed the raw frame time; returns true when the scale changed and the pipeline must resize. */
  sample: (frameSeconds: number) => boolean;
  lock: (scale: number) => void;
};

/** Drops the resolution when frames run slow and creeps back up when there is headroom. */
export const createAdaptiveResolution = (min = 0.72): AdaptiveResolution => {
  let scale = 1;
  let frames = 0;
  let accumulated = 0;
  let samples = 0;
  let coolUntil = 0;
  let locked = false;
  return {
    scale: () => scale,
    sample: (frameSeconds) => {
      frames += 1;
      if (locked || frames < 90 || document.hidden) return false;
      accumulated += frameSeconds;
      samples += 1;
      if (samples < 60) return false;
      const average = accumulated / samples;
      accumulated = 0;
      samples = 0;
      const now = performance.now();
      const previous = scale;
      if (average > 0.0235 && scale > min) {
        scale = Math.max(min, scale * (average > 0.045 ? 0.84 : 0.92));
        coolUntil = now + 8000;
      } else if (average < 0.0176 && scale < 1 && now > coolUntil) {
        scale = Math.min(1, scale + 0.05);
        coolUntil = now + 2500;
      }
      return scale !== previous;
    },
    lock: (value) => {
      scale = value;
      locked = true;
    }
  };
};
