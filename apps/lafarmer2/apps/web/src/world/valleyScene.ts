import * as THREE from "three";
import { createAmbience, riverHalfWidth, type Ambience } from "./ambience";
import { assetProgress, assetsSettled, configureAssets } from "./assets";
import { createSoundscape, type Soundscape, type Surface } from "./audio";
import type { Circle } from "./controller";
import { createDayCycle, type DayCycle } from "./daycycle";
import { sampleGroundMask } from "./groundMask";
import { bridgeDeckHeight, riverCenterWorld } from "./height";
import { LANDMARK_CLEARINGS, createLandmarks, type Landmarks } from "./landmarks";
import { createAdaptiveResolution, createPipeline, createShadowRig, type Pipeline, type PipelineQuality } from "./pipeline";
import { GLOBALS, adoptGlobals, installShaderChunks, updateLampUniforms } from "./shared";
import { createSky } from "./sky";
import { createTerrain, type Terrain } from "./terrain";
import { createVegetation, type Vegetation } from "./vegetation";
import { createWater } from "./water";

/*
 * The whole valley behind one object: renderer, sky and day cycle, river, terrain, vegetation,
 * landmarks, drifting petals and lights, the post pipeline and the soundscape. The game view
 * owns the camera rig and the actors; it hands them in and calls `frame` once per animation frame.
 */

export type ValleyQuality = "high" | "low";

type Preset = {
  mirror: boolean;
  volumetric: boolean;
  ao: boolean;
  shadowMap: number;
  /** Frames between shadow refreshes while nothing forces one. */
  shadowInterval: number;
  vegetation: "high" | "low";
  maxPixelRatio: number;
  minScale: number;
};

const PRESETS: Record<ValleyQuality, Preset> = {
  high: { mirror: true, volumetric: true, ao: true, shadowMap: 4096, shadowInterval: 1, vegetation: "high", maxPixelRatio: 1.5, minScale: 0.72 },
  low: { mirror: false, volumetric: false, ao: false, shadowMap: 2048, shadowInterval: 2, vegetation: "low", maxPixelRatio: 1, minScale: 0.6 }
};

/** `?qualidade=baixa|alta` wins; otherwise phones and small CPUs get the light preset. */
export const detectQuality = (search = location.search): ValleyQuality => {
  const asked = new URLSearchParams(search).get("qualidade");
  if (asked === "baixa") return "low";
  if (asked === "alta") return "high";
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const cores = navigator.hardwareConcurrency ?? 4;
  return coarse || cores < 4 ? "low" : "high";
};

export type ValleySceneOptions = {
  /** Element the canvas fills. */
  host: HTMLElement;
  quality?: ValleyQuality;
  /** Fixed clock hour (0-24); undefined follows the day every player shares. */
  hour?: number;
  onProgress?: (fraction: number, label: string) => void;
};

export type ValleyFrame = {
  /** Seconds since the last frame, clamped. */
  dt: number;
  /** Unclamped seconds, for the adaptive resolution. */
  raw: number;
  /** The player's feet: grass parts around them, petals and sound follow them. */
  focus: THREE.Vector3;
  /** Player speed in world units per second. */
  speed: number;
};

export type ValleyScene = {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly day: DayCycle;
  readonly sound: Soundscape;
  readonly quality: ValleyQuality;
  /** The expensive post passes, switchable at runtime. */
  readonly passes: PipelineQuality;
  /** Trunks, lantern posts, railings and other round obstacles the walker slides around. */
  readonly colliders: ReadonlyArray<Circle>;
  /** Walls, roofs and rocks the camera arm stops short of. */
  readonly solid: (x: number, y: number, z: number) => boolean;
  /** Adds an actor and gives its materials the valley's fog and lamps. */
  add: (object: THREE.Object3D) => void;
  /** What a footstep at this point sounds like. */
  surfaceAt: (x: number, z: number) => Surface;
  /** 0 shows the frame, 1 is black (region changes). */
  setFade: (fade: number) => void;
  /** Call after the host changes size. */
  resize: () => void;
  frame: (frame: ValleyFrame) => void;
  dispose: () => void;
};

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** Lets the loading screen repaint between the heavy build steps, even in a background tab. */
const breathe = (): Promise<void> =>
  new Promise((resolve) => {
    const fallback = setTimeout(resolve, 60);
    requestAnimationFrame(() => {
      clearTimeout(fallback);
      setTimeout(resolve, 0);
    });
  });

const waitForAssets = async (report: (fraction: number) => void): Promise<void> => {
  let settled = false;
  void assetsSettled().then(() => {
    settled = true;
  });
  while (!settled) {
    report(assetProgress());
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  report(1);
};

export const surfaceAt = (x: number, z: number): Surface => {
  if (bridgeDeckHeight(x, z) !== undefined) return "wood";
  const mask = sampleGroundMask(x, z);
  return mask.path > 0.45 || mask.tilled > 0.5 ? "dirt" : "grass";
};

/** 1 on the river bank, fading to 0 about 25 units away. */
const nearWater = (x: number, z: number): number => 1 - smoothstep(2, 26, Math.abs(x - riverCenterWorld(z)) - riverHalfWidth(z));

export const createValleyScene = async (options: ValleySceneOptions): Promise<ValleyScene> => {
  const quality = options.quality ?? detectQuality();
  const preset = PRESETS[quality];
  const report = (fraction: number, label: string): void => options.onProgress?.(Math.min(1, Math.max(0, fraction)), label);
  installShaderChunks();

  report(0.02, "Acendendo o céu");
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance", stencil: false, depth: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const canvas = renderer.domElement;
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.touchAction = "none";
  options.host.append(canvas);
  configureAssets(renderer);

  const scene = new THREE.Scene();
  // Only switches the fog chunks on; the colour and density come from the shared atmosphere.
  scene.fog = new THREE.Fog(0xffffff, 1, 2);
  const camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.3, 6000);

  const sun = new THREE.DirectionalLight(0xffffff, 3.3);
  const hemi = new THREE.HemisphereLight(0x6b8cad, 0x332b1a, 0.85);
  const fill = new THREE.DirectionalLight(0x9e9994, 0.42);
  for (const light of [sun, hemi, fill]) light.layers.enableAll();
  scene.add(sun, sun.target, hemi, fill);

  const sky = createSky();
  scene.add(sky.root);
  scene.environment = sky.environment;
  const day = createDayCycle({ sun, hemi, fill, scene, lockedHour: options.hour });
  const water = createWater();
  scene.add(water.mesh);
  const pipeline: Pipeline = createPipeline({ renderer, scene, camera, sun, water: water.uniforms });
  pipeline.quality.mirror = preset.mirror;
  pipeline.quality.volumetric = preset.volumetric;
  pipeline.quality.ao = preset.ao;
  const shadows = createShadowRig({ renderer, sun, mapSize: preset.shadowMap });
  shadows.interval = preset.shadowInterval;
  const adaptive = createAdaptiveResolution(preset.minScale);
  await breathe();

  report(0.14, "Erguendo a ponte, as casas e o pagode");
  const landmarks: Landmarks = createLandmarks();
  scene.add(landmarks.root);
  await breathe();

  report(0.3, "Plantando cerejeiras, cedros e capim");
  const vegetation: Vegetation = createVegetation({ clearings: LANDMARK_CLEARINGS, quality: preset.vegetation });
  scene.add(vegetation.root);
  await breathe();

  report(0.5, "Moldando o vale e o rio");
  const terrain: Terrain = createTerrain({ petalSpots: vegetation.petalSpots });
  scene.add(terrain.root);
  await breathe();

  report(0.6, "Soltando pétalas e vaga-lumes");
  const ambience: Ambience = createAmbience({ blossomTrees: vegetation.blossomCrowns });
  scene.add(ambience.root);
  const sound = createSoundscape();
  const colliders: Circle[] = [...vegetation.colliders, ...landmarks.colliders];
  await breathe();

  await waitForAssets((fraction) => report(0.64 + fraction * 0.26, "Carregando texturas"));

  const resize = (): void => {
    const width = options.host.clientWidth || innerWidth;
    const height = options.host.clientHeight || innerHeight;
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
    pipeline.resize(width, height, Math.min(devicePixelRatio || 1, preset.maxPixelRatio) * adaptive.scale());
  };
  resize();

  report(0.92, "Preparando a luz");
  await breathe();
  pipeline.prewarm();
  report(1, "Pronto");

  let time = 0;
  let frames = 0;
  let gust = 0;

  const frame = ({ dt, raw, focus, speed }: ValleyFrame): void => {
    time += dt;
    frames += 1;
    gust = 0.42 + 0.3 * Math.sin(time * 0.043) * Math.sin(time * 0.017 + 1.3) + 0.08 * Math.sin(time * 0.31);
    GLOBALS.uTime.value = time;
    GLOBALS.uWind.value.z = 0.75 + 0.5 * gust;
    GLOBALS.uPlayer.value.copy(focus);
    day.update(dt);
    pipeline.params.exposure = day.params.exposure;
    pipeline.params.bloom = day.params.bloom;
    pipeline.params.vol = day.params.vol;
    pipeline.params.warm = day.params.warm;
    camera.updateMatrixWorld();
    shadows.update(camera, day.keyDir);
    if (frames % 24 === 1) sky.updateEnvironment(renderer);
    updateLampUniforms(camera.position);
    landmarks.update(time, dt);
    vegetation.update(time, camera);
    ambience.update(dt, time, camera, focus);
    water.setFloatingLights(ambience.floatingLights);
    sound.update(dt, { night: day.params.night, nearWater: nearWater(focus.x, focus.z), wind: gust, speed, surface: surfaceAt(focus.x, focus.z) });
    pipeline.render();
    if (adaptive.sample(raw)) resize();
  };

  const add = (object: THREE.Object3D): void => {
    adoptGlobals(object);
    scene.add(object);
  };

  const dispose = (): void => {
    sound.dispose();
    ambience.dispose();
    terrain.dispose();
    vegetation.dispose();
    landmarks.dispose();
    water.dispose();
    sky.dispose();
    pipeline.dispose();
    renderer.dispose();
    canvas.remove();
  };

  return {
    renderer,
    scene,
    camera,
    day,
    sound,
    quality,
    passes: pipeline.quality,
    colliders,
    solid: landmarks.solid,
    add,
    surfaceAt,
    setFade: (fade) => {
      pipeline.params.fade = Math.min(1, Math.max(0, fade));
    },
    resize,
    frame,
    dispose
  };
};
