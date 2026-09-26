import * as THREE from "three";
import { GLOBALS } from "./shared";

type Triple = [number, number, number];

/**
 * One moment of the day. u is the day phase in [0, 1): 0 is sunrise, 0.747 sunset.
 * L: key light, hs/hg/hi: hemisphere sky/ground/intensity, fc/fw: cool/warm fog, fd: fog density,
 * hz: distance haze, zen/up: sky zenith and low sky, cl/cs: cloud lit/shade, gl: horizon glow,
 * amb: ambient tint for custom shaders, env: environment intensity, exp: exposure, vol: light shafts,
 * warm: warm grade, lamp: lantern glow, night: night amount.
 */
type DayKey = {
  u: number; L: Triple; hs: Triple; hg: Triple; hi: number; fc: Triple; fw: Triple; fd: number; hz: number; mist: number;
  zen: Triple; up: Triple; cl: Triple; cs: Triple; gl: Triple; amb: Triple; env: number; exp: number; bloom: number;
  vol: number; warm: number; lamp: number; night: number;
};

const KEYS: DayKey[] = [
  { u: 0, L: [1.1, 0.55, 0.4], hs: [0.3, 0.36, 0.5], hg: [0.1, 0.09, 0.08], hi: 0.62, fc: [0.3, 0.34, 0.45], fw: [0.95, 0.56, 0.44], fd: 0.0022, hz: 3e-4, mist: 2.3, zen: [0.05, 0.09, 0.19], up: [0.2, 0.24, 0.36], cl: [1.2, 0.74, 0.62], cs: [0.28, 0.26, 0.36], gl: [1, 0.5, 0.36], amb: [0.72, 0.76, 0.9], env: 0.42, exp: 1.3, bloom: 0.06, vol: 1, warm: 0.55, lamp: 0.35, night: 0.12 },
  { u: 0.07, L: [2.7, 2.15, 1.55], hs: [0.42, 0.54, 0.7], hg: [0.19, 0.17, 0.12], hi: 0.85, fc: [0.42, 0.5, 0.6], fw: [1.02, 0.8, 0.6], fd: 0.0017, hz: 2.4e-4, mist: 1.7, zen: [0.09, 0.18, 0.35], up: [0.32, 0.43, 0.57], cl: [1.5, 1.28, 1.05], cs: [0.42, 0.43, 0.52], gl: [0.95, 0.66, 0.46], amb: [1, 1.05, 1.15], env: 0.58, exp: 1.02, bloom: 0.05, vol: 0.9, warm: 0.45, lamp: 0, night: 0 },
  { u: 0.18, L: [3.7, 3.35, 2.8], hs: [0.47, 0.62, 0.82], hg: [0.23, 0.2, 0.14], hi: 0.95, fc: [0.5, 0.6, 0.72], fw: [0.95, 0.86, 0.72], fd: 0.0013, hz: 2e-4, mist: 0.8, zen: [0.08, 0.19, 0.42], up: [0.3, 0.46, 0.68], cl: [1.8, 1.75, 1.65], cs: [0.52, 0.55, 0.63], gl: [0.7, 0.62, 0.5], amb: [1.08, 1.16, 1.28], env: 0.62, exp: 0.86, bloom: 0.045, vol: 0.5, warm: 0.2, lamp: 0, night: 0 },
  { u: 0.32, L: [4.1, 3.85, 3.4], hs: [0.5, 0.65, 0.86], hg: [0.25, 0.22, 0.15], hi: 1, fc: [0.52, 0.62, 0.75], fw: [0.88, 0.84, 0.76], fd: 0.0012, hz: 2e-4, mist: 0.45, zen: [0.07, 0.19, 0.45], up: [0.29, 0.47, 0.72], cl: [1.95, 1.93, 1.88], cs: [0.56, 0.59, 0.67], gl: [0.6, 0.58, 0.52], amb: [1.12, 1.2, 1.32], env: 0.65, exp: 0.8, bloom: 0.045, vol: 0.35, warm: 0.12, lamp: 0, night: 0 },
  { u: 0.6, L: [3.8, 3.05, 2.2], hs: [0.46, 0.58, 0.74], hg: [0.23, 0.19, 0.12], hi: 0.92, fc: [0.42, 0.5, 0.58], fw: [1.05, 0.78, 0.52], fd: 0.0014, hz: 2.3e-4, mist: 0.9, zen: [0.08, 0.17, 0.33], up: [0.28, 0.4, 0.54], cl: [1.6, 1.28, 0.92], cs: [0.4, 0.4, 0.5], gl: [1, 0.64, 0.4], amb: [1.1, 1.14, 1.2], env: 0.6, exp: 0.95, bloom: 0.05, vol: 0.7, warm: 0.6, lamp: 0, night: 0 },
  { u: 0.7, L: [3.3, 2.44, 1.55], hs: [0.42, 0.55, 0.68], hg: [0.2, 0.17, 0.1], hi: 0.85, fc: [0.33, 0.43, 0.5], fw: [1.05, 0.66, 0.36], fd: 0.0014, hz: 2.4e-4, mist: 1, zen: [0.085, 0.16, 0.27], up: [0.26, 0.36, 0.45], cl: [1.3, 0.936, 0.598], cs: [0.34, 0.33, 0.42], gl: [1, 0.55, 0.3], amb: [1, 1, 1], env: 0.55, exp: 1.05, bloom: 0.055, vol: 0.85, warm: 1, lamp: 0.15, night: 0 },
  { u: 0.742, L: [1.75, 0.72, 0.3], hs: [0.34, 0.38, 0.54], hg: [0.16, 0.11, 0.08], hi: 0.7, fc: [0.3, 0.32, 0.44], fw: [0.92, 0.42, 0.22], fd: 0.0016, hz: 2.6e-4, mist: 0.95, zen: [0.05, 0.08, 0.19], up: [0.21, 0.23, 0.35], cl: [1.5, 0.62, 0.38], cs: [0.3, 0.21, 0.28], gl: [1.1, 0.42, 0.2], amb: [0.74, 0.7, 0.8], env: 0.45, exp: 1.22, bloom: 0.07, vol: 1, warm: 1, lamp: 0.45, night: 0 },
  { u: 0.785, L: [0, 0, 0], hs: [0.16, 0.22, 0.4], hg: [0.04, 0.04, 0.05], hi: 0.55, fc: [0.11, 0.14, 0.25], fw: [0.34, 0.2, 0.2], fd: 0.0016, hz: 2.5e-4, mist: 1.2, zen: [0.018, 0.03, 0.085], up: [0.06, 0.09, 0.19], cl: [0.38, 0.27, 0.32], cs: [0.09, 0.09, 0.15], gl: [0.5, 0.2, 0.12], amb: [0.34, 0.4, 0.58], env: 0.4, exp: 1.9, bloom: 0.08, vol: 0.15, warm: 0.3, lamp: 0.85, night: 0.45 },
  { u: 0.85, L: [0.3, 0.37, 0.55], hs: [0.075, 0.1, 0.19], hg: [0.018, 0.018, 0.025], hi: 0.5, fc: [0.038, 0.052, 0.088], fw: [0.065, 0.075, 0.11], fd: 0.0015, hz: 2.4e-4, mist: 1.15, zen: [0.004, 0.008, 0.02], up: [0.012, 0.02, 0.044], cl: [0.1, 0.11, 0.15], cs: [0.03, 0.034, 0.05], gl: [0.02, 0.03, 0.05], amb: [0.12, 0.15, 0.26], env: 0.3, exp: 3, bloom: 0.1, vol: 0.4, warm: 0, lamp: 1, night: 1 },
  { u: 0.945, L: [0.3, 0.37, 0.55], hs: [0.075, 0.1, 0.19], hg: [0.018, 0.018, 0.025], hi: 0.5, fc: [0.038, 0.052, 0.088], fw: [0.065, 0.075, 0.11], fd: 0.0016, hz: 2.4e-4, mist: 1.5, zen: [0.004, 0.008, 0.02], up: [0.012, 0.02, 0.044], cl: [0.1, 0.11, 0.15], cs: [0.03, 0.034, 0.05], gl: [0.02, 0.03, 0.05], amb: [0.12, 0.15, 0.26], env: 0.3, exp: 3, bloom: 0.1, vol: 0.4, warm: 0, lamp: 1, night: 1 },
  { u: 0.978, L: [0, 0, 0], hs: [0.15, 0.19, 0.34], hg: [0.04, 0.04, 0.05], hi: 0.55, fc: [0.13, 0.15, 0.25], fw: [0.42, 0.27, 0.28], fd: 0.002, hz: 2.8e-4, mist: 2, zen: [0.016, 0.028, 0.08], up: [0.06, 0.08, 0.17], cl: [0.42, 0.3, 0.34], cs: [0.1, 0.1, 0.16], gl: [0.55, 0.26, 0.2], amb: [0.34, 0.38, 0.55], env: 0.38, exp: 1.9, bloom: 0.08, vol: 0.3, warm: 0.3, lamp: 0.7, night: 0.5 }
];

const TRIPLES = ["L", "hs", "hg", "fc", "fw", "zen", "up", "cl", "cs", "gl", "amb"] as const;
const SCALARS = ["hi", "fd", "hz", "mist", "env", "exp", "bloom", "vol", "warm", "lamp", "night"] as const;

/** Real seconds for one full day. Every player sees the same hour. */
export const DAY_SECONDS = 20 * 60;
/** The valley is small next to the reference, so its haze is denser to keep the depth. */
const FOG_SCALE = 1.6;
const SUNRISE_U = -0.012;
const SUNSET_U = 0.747;
const PEAK_ELEVATION = THREE.MathUtils.degToRad(58);
/** The sun sets over the eastern ridges, in front of the camera at spawn. */
const SUNSET_AZIMUTH = Math.atan2(0.78, -0.62);
const SUN_SWEEP = THREE.MathUtils.degToRad(192);

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

const fract = (value: number): number => ((value % 1) + 1) % 1;

const fromAzimuth = (azimuth: number, elevation: number, out: THREE.Vector3): THREE.Vector3 =>
  out.set(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation));

export const sunDirectionAt = (u: number, out: THREE.Vector3): THREE.Vector3 => {
  let e = (u - SUNRISE_U) / (SUNSET_U - SUNRISE_U);
  if (u > 0.9) e = (u - 1 - SUNRISE_U) / (SUNSET_U - SUNRISE_U);
  const elevation = Math.asin(Math.sin(PEAK_ELEVATION) * Math.sin(Math.PI * e));
  return fromAzimuth(SUNSET_AZIMUTH - SUN_SWEEP + SUN_SWEEP * e, elevation, out);
};

export const moonDirectionAt = (u: number, out: THREE.Vector3): THREE.Vector3 => {
  const e = fract(u - 0.74) / 0.36;
  const elevation = THREE.MathUtils.degToRad(12 + 34 * Math.sin(Math.PI * Math.min(1, Math.max(0, e))));
  const azimuth = SUNSET_AZIMUTH - THREE.MathUtils.degToRad(134.6) + THREE.MathUtils.degToRad(70) * e;
  return fromAzimuth(azimuth, elevation, out);
};

/** Clock hour for a day phase: the day runs 05:45-18:30, the night 18:30-05:45. */
export const hourFromPhase = (u: number): number => {
  const phase = fract(u);
  if (phase < SUNSET_U) return 5.75 + (phase / SUNSET_U) * 12.75;
  return (18.5 + ((phase - SUNSET_U) / (1 - SUNSET_U)) * 11.25) % 24;
};

export const phaseFromHour = (hour: number): number => {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 5.75 && h < 18.5) return ((h - 5.75) / 12.75) * SUNSET_U;
  const night = h >= 18.5 ? h - 18.5 : h + 5.5;
  return SUNSET_U + (night / 11.25) * (1 - SUNSET_U);
};

export const hourLabel = (hour: number): string => {
  if (hour < 5) return "Madrugada";
  if (hour < 7) return "Amanhecer";
  if (hour < 11) return "Manhã";
  if (hour < 13) return "Meio-dia";
  if (hour < 17) return "Tarde";
  if (hour < 19) return "Pôr do sol";
  if (hour < 20) return "Anoitecer";
  return "Noite";
};

export type DayParams = { exposure: number; bloom: number; vol: number; warm: number; env: number; lamp: number; night: number };

export type DayCycle = {
  /** Current phase in [0, 1). */
  readonly phase: () => number;
  readonly params: DayParams;
  /** Where the sun is, even below the horizon. */
  readonly sunDir: THREE.Vector3;
  /** Direction of the shadow-casting light: the sun by day, the moon at night. */
  readonly keyDir: THREE.Vector3;
  /** "Tarde · 15:40" */
  readonly label: () => string;
  /** Multiplies the passing of time (the T key fast-forwards). */
  setSpeed: (speed: number) => void;
  /** Holds the clock at `hour` (0-24); undefined follows the shared real-time clock again. */
  setHour: (hour: number | undefined) => void;
  update: (dt: number) => void;
};

export type DayCycleOptions = {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  fill: THREE.DirectionalLight;
  scene: THREE.Scene;
  /** Fixed hour (0-24), e.g. from `?hora=17.5`. */
  lockedHour?: number;
};

const FILL_DIRECTION = new THREE.Vector3(-Math.sin(SUNSET_AZIMUTH), 0.45, -Math.cos(SUNSET_AZIMUTH)).normalize();
const DAY_TINT = new THREE.Vector3(1.697, 1.455, 1.129);
const NIGHT_TINT = new THREE.Vector3(1.35, 1.35, 1.35);

export const createDayCycle = ({ sun, hemi, fill, scene, lockedHour: initialHour }: DayCycleOptions): DayCycle => {
  let lockedHour = initialHour;
  const sample: Record<(typeof TRIPLES)[number], THREE.Vector3> = Object.fromEntries(TRIPLES.map((key) => [key, new THREE.Vector3()])) as Record<(typeof TRIPLES)[number], THREE.Vector3>;
  const scalars: Record<(typeof SCALARS)[number], number> = Object.fromEntries(SCALARS.map((key) => [key, 0])) as Record<(typeof SCALARS)[number], number>;
  const params: DayParams = { exposure: 1, bloom: 0.05, vol: 0.5, warm: 0.5, env: 0.5, lamp: 0, night: 0 };
  const sunDir = new THREE.Vector3();
  const moonDir = new THREE.Vector3();
  const keyDir = new THREE.Vector3(0, 1, 0);
  const tint = new THREE.Vector3();
  let offset = 0;
  let speed = 1;
  let phase = 0;

  const currentPhase = (): number => {
    if (lockedHour !== undefined) return fract(phaseFromHour(lockedHour) + offset);
    return fract(Date.now() / 1000 / DAY_SECONDS + offset);
  };

  const interpolate = (u: number): void => {
    let index = KEYS.length - 1;
    for (let candidate = 0; candidate < KEYS.length; candidate += 1) if (KEYS[candidate].u <= u) index = candidate;
    const current = KEYS[index];
    const next = KEYS[(index + 1) % KEYS.length];
    const span = fract(next.u - current.u) || 1;
    const t = smoothstep(0, 1, fract(u - current.u) / span);
    for (const key of TRIPLES) {
      const a = current[key];
      const b = next[key];
      sample[key].set(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
    }
    for (const key of SCALARS) scalars[key] = current[key] + (next[key] - current[key]) * t;
  };

  const update = (dt: number): void => {
    if (speed !== 1) offset += (dt * (speed - 1)) / DAY_SECONDS;
    phase = currentPhase();
    interpolate(phase);
    sunDirectionAt(phase, sunDir);
    moonDirectionAt(phase, moonDir);
    const sunUp = sunDir.y > -0.07;
    keyDir.copy(sunUp ? sunDir : moonDir);
    const light = sample.L.multiplyScalar(sunUp ? smoothstep(-0.05, 0.02, sunDir.y) : 1 - smoothstep(-0.16, -0.07, sunDir.y));
    const night = scalars.night;

    GLOBALS.uSunDir.value.copy(keyDir);
    GLOBALS.uKeyDir.value.copy(keyDir);
    GLOBALS.uMoonDir.value.copy(moonDir);
    tint.lerpVectors(DAY_TINT, NIGHT_TINT, night);
    GLOBALS.uSunCol.value.copy(light).multiply(tint);
    GLOBALS.uSunVis.value = smoothstep(-0.03, 0.01, sunDir.y);
    GLOBALS.uNight.value = night;
    GLOBALS.uFogCool.value.copy(sample.fc);
    GLOBALS.uFogWarm.value.copy(sample.fw);
    GLOBALS.uFogParams.value.x = scalars.fd * FOG_SCALE;
    GLOBALS.uFogParams.value.y = 0.035;
    GLOBALS.uFogParams.value.w = scalars.hz * FOG_SCALE;
    GLOBALS.uMist.value = scalars.mist;
    GLOBALS.uSkyZen.value.copy(sample.zen);
    GLOBALS.uSkyHor.value.copy(sample.up);
    GLOBALS.uCloudLit.value.copy(sample.cl);
    GLOBALS.uCloudShade.value.copy(sample.cs);
    GLOBALS.uHorizonGlow.value.copy(sample.gl);
    GLOBALS.uAmbient.value.copy(sample.amb);
    GLOBALS.uLampOn.value = scalars.lamp * smoothstep(0.2, 0.45, scalars.lamp);

    const peak = Math.max(light.x, light.y, light.z);
    if (peak > 0) sun.color.setRGB(light.x / peak, light.y / peak, light.z / peak);
    sun.intensity = peak;
    hemi.color.setRGB(sample.hs.x, sample.hs.y, sample.hs.z);
    hemi.groundColor.setRGB(sample.hg.x, sample.hg.y, sample.hg.z);
    hemi.intensity = scalars.hi;
    fill.color.setRGB(0.62, 0.6, 0.58);
    fill.intensity = 0.42 * Math.min(1.3, Math.max(0.15, scalars.hi / 0.85)) * (1 - 0.4 * night);
    fill.position.copy(FILL_DIRECTION).multiplyScalar(100);
    scene.environmentIntensity = scalars.env;

    params.exposure = scalars.exp;
    params.bloom = scalars.bloom;
    params.vol = scalars.vol;
    params.warm = scalars.warm;
    params.env = scalars.env;
    params.lamp = GLOBALS.uLampOn.value;
    params.night = night;
  };

  const label = (): string => {
    const hour = hourFromPhase(phase);
    const whole = Math.floor(hour);
    const minutes = Math.floor((hour - whole) * 60);
    return `${hourLabel(hour)} · ${String(whole).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  };

  update(0);
  return {
    phase: () => phase,
    params,
    sunDir,
    keyDir,
    label,
    setSpeed: (value) => { speed = value; },
    setHour: (hour) => {
      lockedHour = hour;
      offset = 0;
      update(0);
    },
    update
  };
};
