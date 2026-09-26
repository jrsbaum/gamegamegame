import * as THREE from "three";
import { createRandom, fbm, ridged } from "./height";
import { GLOBALS } from "./shared";

/** Sky colour for a view ray: gradient, low-sun bloom, stars, moon, clouds and the sun disc. */
export const SKY_GLSL = /* glsl */ `
float skyStars(vec3 rd) {
  vec3 a = abs(rd);
  vec2 uv;
  float face;
  if (a.x > a.y && a.x > a.z) { uv = rd.zy / a.x; face = sign(rd.x); }
  else if (a.y > a.z) { uv = rd.xz / a.y; face = 2.0 * sign(rd.y); }
  else { uv = rd.xy / a.z; face = 3.0 * sign(rd.z); }
  float acc = 0.0;
  for (int k = 0; k < 2; k++) {
    float sc = k == 0 ? 90.0 : 210.0;
    vec2 g = uv * sc;
    vec2 id = floor(g);
    vec2 f = fract(g);
    float h = hash13(vec3(id, face + float(k) * 7.0));
    vec2 c = vec2(hash13(vec3(id, face + 3.1)), hash13(vec3(id, face + 5.7))) * 0.7 + 0.15;
    float d = length(f - c);
    float mag = pow(h, k == 0 ? 18.0 : 30.0);
    float tw = 0.65 + 0.35 * sin(uTime * (1.5 + h * 4.0) + h * 60.0);
    acc += mag * tw * smoothstep(0.09, 0.0, d) * (k == 0 ? 3.0 : 1.4);
  }
  return acc;
}

vec3 skyColor(vec3 rd, float withSun) {
  float s = max(dot(rd, uSunDir), 0.0);
  float h = rd.y;
  vec3 horizon = skyFogColor(normalize(vec3(rd.x, max(h, 0.0), rd.z)));
  float t = clamp(h, 0.0, 1.0);
  vec3 col = mix(horizon, uSkyHor, smoothstep(0.0, 0.22, t));
  col = mix(col, uSkyZen, smoothstep(0.18, 0.75, t));
  float band = exp(-max(h, 0.0) * 7.0);
  col += uSunCol * (pow(s, 5.0) * 0.10 * (0.4 + band) + pow(s, 28.0) * 0.22 + pow(s, 220.0) * 0.8);
  col += uHorizonGlow * band * 0.10 * (0.3 + 0.7 * pow(s, 1.5));
  if (uNight > 0.01 && h > 0.0) {
    float mw = exp(-pow(dot(rd, normalize(vec3(0.55, 0.35, 0.76))) * 3.2, 2.0));
    col += vec3(0.05, 0.06, 0.09) * mw * (0.4 + 0.6 * fbm3(rd.xz * 9.0 / (h + 0.3))) * uNight * 0.35;
    col += vec3(0.85, 0.9, 1.0) * skyStars(rd) * uNight * smoothstep(0.0, 0.25, h) * 0.9;
  }
  float mu = dot(rd, uMoonDir);
  if (uNight > 0.01) {
    col += vec3(0.5, 0.58, 0.72) * (pow(max(mu, 0.0), 60.0) * 0.06 + pow(max(mu, 0.0), 900.0) * 0.18) * uNight;
    float md = smoothstep(0.99985, 0.99991, mu);
    if (md > 0.0) {
      vec3 tng = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
      vec3 btg = cross(tng, uMoonDir);
      vec2 mp = vec2(dot(rd, tng), dot(rd, btg)) * 90.0;
      float mare = fbm3(mp * 1.3 + 4.0);
      col += vec3(1.9, 2.0, 2.15) * md * (0.72 + 0.28 * smoothstep(0.35, 0.7, mare)) * uNight;
    }
  }
  if (h > 0.0) {
    vec2 uv = rd.xz / (h + 0.06) * 0.9;
    uv += vec2(uTime * 0.0035, uTime * 0.0012);
    float n = fbm3(uv * 1.2) * 0.6 + fbm3(uv * 3.1 + 4.0) * 0.3 + vnoise(uv * 9.0) * 0.1;
    float streak = fbm3(vec2(uv.x * 0.6, uv.y * 2.4) + 9.0);
    float cov = n * 0.75 + streak * 0.35 - uNight * 0.1;
    float d = smoothstep(uCloudCover, 0.78, cov);
    d *= smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(0.35, 0.9, h) * 0.7);
    float thick = clamp(smoothstep(0.55, 0.95, n), 0.0, 1.0);
    vec3 lit = mix(uCloudLit, uCloudLit * vec3(1.38, 1.17, 1.03), pow(s, 6.0));
    vec3 cc = mix(lit, uCloudShade, thick * (0.55 + 0.35 * (1.0 - s)));
    cc += uSunCol * pow(s, 18.0) * (1.0 - thick) * 0.35;
    cc += vec3(0.12, 0.14, 0.2) * pow(max(mu, 0.0), 8.0) * uNight * (1.0 - thick) * 0.6;
    col = mix(col, cc * mix(0.55, 1.0, band), d * 0.85);
  }
  col += withSun * uSunVis * uSunCol * 9.0 * smoothstep(0.99962, 0.99978, s);
  return col;
}
`;

const createDome = (followCamera: boolean): THREE.Mesh => {
  const material = new THREE.ShaderMaterial({
    uniforms: { ...GLOBALS },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      ${SKY_GLSL}
      varying vec3 vDir;
      void main() {
        vec3 rd = normalize(vDir);
        if (uReflect > 0.5) rd.y = abs(rd.y);
        gl_FragColor = vec4(skyColor(rd, 1.0), 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false
  });
  material.userData.globals = true;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(4000, 64, 32), material);
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  dome.name = "sky";
  if (followCamera) {
    dome.onBeforeRender = (_renderer, _scene, camera) => {
      dome.position.copy(camera.position);
      dome.updateMatrixWorld();
    };
  }
  return dome;
};

type RidgeLayer = { radius: number; height: number; base: number; haze: number; seed: number; depth: number };

/** Far ranges in rings around the valley, fading into the haze with distance. */
const RIDGES: RidgeLayer[] = [
  { radius: 1150, height: 260, base: -10, haze: 0.32, seed: 1, depth: 280 },
  { radius: 1750, height: 400, base: -20, haze: 0.5, seed: 2, depth: 380 },
  { radius: 2550, height: 580, base: -40, haze: 0.66, seed: 3, depth: 500 },
  { radius: 3350, height: 780, base: -60, haze: 0.78, seed: 4, depth: 500 }
];

const RIDGE_VERTEX = /* glsl */ `
  varying vec3 vW;
  varying vec3 vN;
  void main() {
    vW = (modelMatrix * vec4(position, 1.0)).xyz;
    vN = normal;
    gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
  }`;

const RIDGE_FRAGMENT = /* glsl */ `
  #include <common>
  uniform float uHaze;
  uniform float uBase;
  uniform float uH;
  varying vec3 vW;
  varying vec3 vN;
  void main() {
    vec3 N = normalize(vN);
    vec3 rd = normalize(vW - cameraPosition);
    if (uReflect > 0.5) rd.y = -rd.y;
    float ndl = max(dot(N, uSunDir), 0.0);
    float rel = clamp((vW.y - uBase) / uH, 0.0, 1.0);
    vec3 base = mix(vec3(0.035, 0.05, 0.045), vec3(0.09, 0.085, 0.08), smoothstep(0.35, 0.8, rel + fbm3(vW.xz * 0.01) * 0.3));
    vec3 col = base * (vec3(0.30, 0.38, 0.46) * uAmbient * (0.55 + 0.45 * N.y)) + base * uSunCol * ndl * 0.55;
    col += uSunCol * pow(ndl, 3.0) * 0.02 * rel;
    vec3 fogc = skyFogColor(normalize(vec3(rd.x, max(rd.y, 0.0), rd.z)));
    float haze = uHaze + (1.0 - uHaze) * (1.0 - smoothstep(0.0, 0.55, rel)) * 0.65;
    haze = clamp(haze + (1.0 - rel) * 0.08, 0.0, 0.985);
    gl_FragColor = vec4(mix(col, fogc, haze), 1.0);
  }`;

/** The river leaves the valley to the north (-Z) and the south (+Z): the ranges dip there. */
const riverGap = (angle: number): number => {
  const north = Math.exp(-Math.pow(Math.atan2(Math.sin(angle - Math.PI), Math.cos(angle - Math.PI)) / 0.24, 2));
  const south = Math.exp(-Math.pow(Math.atan2(Math.sin(angle), Math.cos(angle)) / 0.3, 2));
  return 1 - 0.5 * Math.max(north, south);
};

const createRidges = (): THREE.Group => {
  const group = new THREE.Group();
  group.name = "ridges";
  const segments = 480;
  const rows = 10;
  for (const layer of RIDGES) {
    const random = createRandom(layer.seed * 77);
    const phase = random() * 100;
    const positions: number[] = [];
    const indices: number[] = [];
    for (let row = 0; row <= rows; row += 1) {
      const depth = (row / rows) * layer.depth;
      for (let segment = 0; segment <= segments; segment += 1) {
        const angle = (segment / segments) * Math.PI * 2;
        const radius = layer.radius + depth;
        const x = Math.sin(angle) * radius;
        const z = Math.cos(angle) * radius;
        const around = angle * 7 + phase;
        const e = depth / layer.depth;
        const crest = ridged(Math.cos(angle) * 2.2 + phase, Math.sin(angle) * 2.2 + e * 1.2, 6);
        const swell = fbm(around * 0.12 + phase, 3.3, 3);
        let y = layer.base + layer.height * (0.25 + 0.95 * crest * (0.55 + 0.45 * swell)) * riverGap(angle);
        y *= Math.sin(Math.min(1, e * 2.2 + 0.05) * Math.PI * 0.5);
        positions.push(x, y, z);
      }
    }
    for (let row = 0; row < rows; row += 1) {
      for (let segment = 0; segment < segments; segment += 1) {
        const a = row * (segments + 1) + segment;
        const b = a + 1;
        const c = a + segments + 1;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = new THREE.ShaderMaterial({
      uniforms: { ...GLOBALS, uHaze: { value: layer.haze }, uBase: { value: layer.base }, uH: { value: layer.height } },
      vertexShader: RIDGE_VERTEX,
      fragmentShader: RIDGE_FRAGMENT,
      fog: false
    });
    material.userData.globals = true;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = -5;
    group.add(mesh);
  }
  return group;
};

export type Sky = {
  /** Dome and distant ranges, added to the main scene. */
  root: THREE.Group;
  /** Re-renders the sky into the environment cube used for reflections. Cheap enough every ~24 frames. */
  updateEnvironment: (renderer: THREE.WebGLRenderer) => void;
  environment: THREE.Texture;
  dispose: () => void;
};

export const createSky = (): Sky => {
  const root = new THREE.Group();
  root.name = "sky-root";
  const dome = createDome(true);
  const ridges = createRidges();
  root.add(dome, ridges);

  const envScene = new THREE.Scene();
  envScene.add(createDome(false));
  const cubeTarget = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType, generateMipmaps: false });
  const cubeCamera = new THREE.CubeCamera(1, 12000, cubeTarget);
  envScene.add(cubeCamera);

  const updateEnvironment = (renderer: THREE.WebGLRenderer): void => {
    cubeCamera.update(renderer, envScene);
    cubeTarget.texture.needsPMREMUpdate = true;
  };

  const dispose = (): void => {
    const disposeTree = (node: THREE.Object3D): void => {
      node.traverse((child) => {
        const mesh = child as THREE.Mesh;
        mesh.geometry?.dispose();
        (mesh.material as THREE.Material | undefined)?.dispose();
      });
    };
    disposeTree(root);
    disposeTree(envScene);
    cubeTarget.dispose();
  };

  return { root, updateEnvironment, environment: cubeTarget.texture, dispose };
};
