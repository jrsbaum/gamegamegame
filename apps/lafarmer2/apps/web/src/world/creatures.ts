import * as THREE from "three";
import { SURFACES } from "./assets";
import { createRng, type Rng } from "./foliage";
import { groundHeight, valueNoise } from "./height";
import { surfaceMaterial, tintMaterial } from "./materials";

/*
 * Farm animals. Each one wanders inside its enclosure on its own (walk, graze, rest, watch the
 * farmer), with a procedural gait; the server only decides stage, variant and needs. The coat is
 * painted into vertex colours from the rest pose, so patches run continuously across body parts.
 */

/** World rectangle an animal stays inside. */
export type Pen = { x0: number; x1: number; z0: number; z1: number };
export type Mood = { needsCare: boolean; happy: boolean };

export type Creature = {
  readonly root: THREE.Group;
  /** Height above the feet where a status marker floats. */
  readonly markerHeight: number;
  /** The enclosure it lives in; animals that do not walk sit at their own spot inside it. */
  setPen: (pen: Pen) => void;
  setMood: (mood: Mood) => void;
  update: (dt: number, time: number, player: THREE.Vector3) => void;
  dispose: () => void;
};

type Rgb = readonly [number, number, number];
type Pattern = (point: THREE.Vector3, normal: THREE.Vector3, tag: string) => Rgb;

const TAU = Math.PI * 2;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

const linear = (hex: number): Rgb => {
  const color = new THREE.Color(hex);
  return [color.r, color.g, color.b];
};

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const smooth = (edge0: number, edge1: number, value: number): number => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

const approach = (value: number, goal: number, rate: number, dt: number): number => value + (goal - value) * (1 - Math.exp(-rate * dt));

const wrapAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Value noise in three dimensions, good enough for coat patches. */
const noise3 = (x: number, y: number, z: number): number =>
  (valueNoise(x + 17.1, y * 0.9 + z * 0.6) + valueNoise(z - 4.3, y + x * 0.5 + 9.2) + valueNoise(x * 0.7 - z * 0.7 + 3.3, y * 1.1 - 12.4)) / 3;

let coatMaterial: THREE.Material | undefined;
let glossMaterial: THREE.Material | undefined;
let soilMaterial: THREE.Material | undefined;
let strawMaterial: THREE.Material | undefined;

const coat = (): THREE.Material => (coatMaterial ??= tintMaterial(0xffffff, { roughness: 0.84, vertexColors: true }));
const gloss = (): THREE.Material => (glossMaterial ??= tintMaterial(0xffffff, { roughness: 0.3, vertexColors: true }));
const soil = (): THREE.Material => (soilMaterial ??= surfaceMaterial(SURFACES.soil, { color: 0xb49a86 }));
const straw = (): THREE.Material => (strawMaterial ??= surfaceMaterial(SURFACES.thatch, { color: new THREE.Color(1.45, 1.28, 0.95), uvScale: [5, 1] }));

const ellipsoid = (rx: number, ry: number, rz: number, x = 0, y = 0, z = 0, detail = 1): THREE.BufferGeometry =>
  new THREE.SphereGeometry(1, Math.round(22 * detail), Math.round(16 * detail)).scale(rx, ry, rz).translate(x, y, z);

/** Rounded segment from `a` to `b`. */
const limb = (a: THREE.Vector3, b: THREE.Vector3, radius: number): THREE.BufferGeometry => {
  const geometry = new THREE.CapsuleGeometry(radius, Math.max(0.001, a.distanceTo(b)), 4, 12);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y_AXIS, b.clone().sub(a).normalize()));
  return geometry.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
};

/** Tapered cylinder from `a` (radius r0) to `b` (radius r1). */
const taper = (a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, sides = 14): THREE.BufferGeometry => {
  const length = a.distanceTo(b);
  const geometry = new THREE.CylinderGeometry(r1, r0, length, sides, 3).translate(0, length / 2, 0);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y_AXIS, b.clone().sub(a).normalize()));
  return geometry.translate(a.x, a.y, a.z);
};

/** A squared-off ellipsoid, for bodies and heads that read as boxy rather than round. */
const boxy = (rx: number, ry: number, rz: number, x: number, y: number, z: number): THREE.BufferGeometry => {
  const geometry = new THREE.SphereGeometry(1, 36, 26);
  const position = geometry.getAttribute("position");
  const shape = (value: number): number => Math.sign(value) * Math.pow(Math.abs(value), 0.72);
  for (let i = 0; i < position.count; i += 1) {
    const px = position.getX(i);
    let sy = shape(position.getY(i));
    if (sy < 0) sy *= 1 + 0.12 * (1 - px * px);
    position.setXYZ(i, shape(px) * rx + x, sy * ry + y, shape(position.getZ(i)) * rz + z);
  }
  geometry.computeVertexNormals();
  return geometry;
};

const v3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

const joint = (parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Group => {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  parent.add(group);
  return group;
};

const solidMesh = (geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D): THREE.Mesh => {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
};

/** Collects an animal's meshes so its coat can be painted and its geometry freed in one place. */
class Body {
  private readonly meshes: Array<{ mesh: THREE.Mesh; tag: string }> = [];

  add(parent: THREE.Object3D, geometry: THREE.BufferGeometry, tag: string, material: THREE.Material = coat()): THREE.Mesh {
    const mesh = solidMesh(geometry, material, parent);
    this.meshes.push({ mesh, tag });
    return mesh;
  }

  /** Colours the vertex-coloured meshes from their rest-pose position in the animal's own space. */
  paint(root: THREE.Object3D, pattern: Pattern): void {
    root.updateMatrixWorld(true);
    const inverse = root.matrixWorld.clone().invert();
    const point = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const toRoot = new THREE.Matrix4();
    const normalMatrix = new THREE.Matrix3();
    for (const { mesh, tag } of this.meshes) {
      if (mesh.material !== coat() && mesh.material !== gloss()) continue;
      toRoot.multiplyMatrices(inverse, mesh.matrixWorld);
      normalMatrix.getNormalMatrix(toRoot);
      const positions = mesh.geometry.getAttribute("position");
      const normals = mesh.geometry.getAttribute("normal");
      const colors = new Float32Array(positions.count * 3);
      for (let i = 0; i < positions.count; i += 1) {
        point.fromBufferAttribute(positions, i).applyMatrix4(toRoot);
        normal.fromBufferAttribute(normals, i).applyMatrix3(normalMatrix).normalize();
        colors.set(pattern(point, normal, tag), i * 3);
      }
      mesh.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    }
  }

  dispose(): void {
    for (const { mesh } of this.meshes) mesh.geometry.dispose();
  }
}

/* ------------------------------------------------------------------ wandering */

type Behaviour = "rest" | "walk" | "graze" | "watch";

type Wander = {
  x: number;
  z: number;
  heading: number;
  speed: number;
  behaviour: Behaviour;
  timer: number;
  targetX: number;
  targetZ: number;
};

type WanderRules = { walkSpeed: number; turnRate: number; margin: number; grazes: boolean; watchRange: number };

const inset = (pen: Pen, margin: number): Pen => {
  const cx = (pen.x0 + pen.x1) / 2;
  const cz = (pen.z0 + pen.z1) / 2;
  return {
    x0: Math.min(cx, pen.x0 + margin),
    x1: Math.max(cx, pen.x1 - margin),
    z0: Math.min(cz, pen.z0 + margin),
    z1: Math.max(cz, pen.z1 - margin)
  };
};

const pickTarget = (state: Wander, pen: Pen, rules: WanderRules, rng: Rng): void => {
  const area = inset(pen, rules.margin);
  state.targetX = rng.range(area.x0, area.x1);
  state.targetZ = rng.range(area.z0, area.z1);
};

const startWander = (pen: Pen, rules: WanderRules, rng: Rng): Wander => {
  const state: Wander = { x: 0, z: 0, heading: rng.range(-Math.PI, Math.PI), speed: 0, behaviour: "rest", timer: rng.range(0.5, 3), targetX: 0, targetZ: 0 };
  pickTarget(state, pen, rules, rng);
  state.x = state.targetX;
  state.z = state.targetZ;
  return state;
};

/** Advances the wandering state; returns the yaw toward the player while watching (else 0). */
const wander = (state: Wander, dt: number, pen: Pen, rules: WanderRules, rng: Rng, player: THREE.Vector3, mood: Mood): number => {
  state.timer -= dt;
  const toPlayerX = player.x - state.x;
  const toPlayerZ = player.z - state.z;
  const playerNear = Math.hypot(toPlayerX, toPlayerZ) < rules.watchRange;
  if (playerNear && state.behaviour !== "walk" && state.behaviour !== "watch" && (mood.needsCare || rng.next() < dt * 0.4)) {
    state.behaviour = "watch";
    state.timer = rng.range(2.5, 5);
  }
  if (state.behaviour === "walk") {
    const dx = state.targetX - state.x;
    const dz = state.targetZ - state.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.35 || state.timer < 0) {
      state.behaviour = rules.grazes && rng.next() < 0.6 ? "graze" : "rest";
      state.timer = rng.range(3.5, 9);
    } else {
      const error = wrapAngle(Math.atan2(dx, dz) - state.heading);
      state.heading = wrapAngle(state.heading + Math.sign(error) * Math.min(Math.abs(error), rules.turnRate * dt));
      const goal = rules.walkSpeed * Math.max(0, Math.cos(error)) * Math.min(1, distance / 0.8 + 0.3);
      state.speed = approach(state.speed, goal, 3, dt);
    }
  } else {
    state.speed = approach(state.speed, 0, 4, dt);
    if (state.timer < 0 && !(state.behaviour === "watch" && playerNear && mood.needsCare)) {
      pickTarget(state, pen, rules, rng);
      state.behaviour = "walk";
      state.timer = 14;
    }
  }
  const area = inset(pen, rules.margin * 0.5);
  state.x = Math.min(area.x1, Math.max(area.x0, state.x + Math.sin(state.heading) * state.speed * dt));
  state.z = Math.min(area.z1, Math.max(area.z0, state.z + Math.cos(state.heading) * state.speed * dt));
  return state.behaviour === "watch" ? wrapAngle(Math.atan2(toPlayerX, toPlayerZ) - state.heading) : 0;
};

/* ------------------------------------------------------------------ cow */

const cowPattern = (variant: string, seed: number): Pattern => {
  const white = linear(0xe9e4da);
  const black = linear(0x151312);
  const red = linear(0x7a3a1d);
  const darkRed = linear(0x5a2812);
  const fawn = linear(0xb58352);
  const cream = linear(0xd9b98c);
  const chestnut = linear(0x5c2e17);
  const pink = linear(0xd8a096);
  const hoof = linear(0x2a2420);
  const horn = linear(0xd9ccb0);
  const hornTip = linear(0x3b3128);
  const eye = linear(0x0d0b0a);
  return (p, n, tag) => {
    if (tag === "hoof") return hoof;
    if (tag === "eye") return eye;
    if (tag === "horn") return mix(horn, hornTip, smooth(0.2, 0.3, Math.abs(p.x)));
    if (tag === "udder") return pink;
    if (tag === "muzzle") return variant === "spotted" ? linear(0x2b2522) : pink;
    const lowLeg = tag === "leg" && p.y < 0.42;
    if (variant === "brown") {
      const face = tag === "head" && n.z > -0.2 && p.y > 1.02;
      const belly = n.y < -0.55 && p.y < 0.75;
      return face || belly || lowLeg || tag === "tuft" ? white : mix(red, darkRed, noise3(p.x * 6, p.y * 6, p.z * 6) * 0.5);
    }
    if (variant === "spotted") {
      const spot = smooth(0.58, 0.63, noise3(p.x * 3.4 + seed, p.y * 3.2, p.z * 2.8));
      const base = tag === "tuft" ? chestnut : mix(fawn, cream, smooth(-0.3, -0.8, n.y) * 0.6);
      return lowLeg ? mix(base, white, 0.4) : mix(base, chestnut, spot * 0.9);
    }
    if (lowLeg || tag === "tuft") return white;
    return mix(white, black, smooth(0.5, 0.545, noise3(p.x * 2.1 + seed, p.y * 2.3, p.z * 1.6)));
  };
};

/** Holstein (default), Hereford (brown) or fawn with chestnut patches (spotted). */
export const createCow = (variant: string, stage: "baby" | "adult", seed: number): Creature => {
  const rng = createRng(seed);
  const body = new Body();
  const root = new THREE.Group();
  root.name = "cow";
  const scale = stage === "baby" ? 0.62 : 1;
  const frame = joint(root);
  frame.scale.setScalar(scale);
  const trunk = joint(frame);

  body.add(trunk, boxy(0.43, 0.45, 0.96, 0, 1, 0), "body");
  body.add(trunk, ellipsoid(0.3, 0.12, 0.25, 0, 1.36, -0.72), "body");

  const neck = joint(trunk, 0, 1.2, 0.74);
  body.add(neck, ellipsoid(0.25, 0.31, 0.38, 0, -0.02, 0.2), "body");
  const head = joint(neck, 0, 0.1, 0.5);
  body.add(head, boxy(0.18, 0.2, 0.3, 0, -0.02, 0.13), "head");
  body.add(head, ellipsoid(0.16, 0.12, 0.12, 0, -0.07, 0.4), "muzzle");
  for (const side of [1, -1]) {
    body.add(head, ellipsoid(0.027, 0.027, 0.027, side * 0.15, 0.04, 0.16), "eye", gloss());
    const ear = joint(head, side * 0.18, 0.08, -0.03);
    ear.rotation.z = side * -0.35;
    body.add(ear, ellipsoid(0.11, 0.035, 0.06, side * 0.06, 0, 0), "ear");
    if (stage === "adult") {
      const horn = joint(head, side * 0.12, 0.15, 0);
      horn.rotation.set(-0.35, 0, side * -1.05);
      body.add(horn, new THREE.ConeGeometry(0.03, 0.17, 8).translate(0, 0.085, 0), "horn");
    }
  }

  /** Lateral walk: left hind, left fore, right hind, right fore. */
  const legOrder: Record<string, number> = { "1,-1": 0, "1,1": 0.25, "-1,-1": 0.5, "-1,1": 0.75 };
  const legs: Array<{ upper: THREE.Group; lower: THREE.Group; offset: number }> = [];
  for (const side of [1, -1]) {
    for (const end of [1, -1]) {
      const upper = joint(trunk, side * 0.25, 0.8, end > 0 ? 0.62 : -0.66);
      body.add(upper, new THREE.CapsuleGeometry(end > 0 ? 0.095 : 0.11, 0.26, 4, 10).translate(0, -0.18, 0), "leg");
      const lower = joint(upper, 0, -0.38, 0);
      body.add(lower, new THREE.CapsuleGeometry(0.062, 0.26, 4, 10).translate(0, -0.19, 0), "leg");
      body.add(lower, new THREE.CylinderGeometry(0.068, 0.08, 0.08, 10).translate(0, -0.38, 0.01), "hoof");
      legs.push({ upper, lower, offset: legOrder[`${side},${end}`] });
    }
  }

  if (stage === "adult") {
    body.add(trunk, ellipsoid(0.17, 0.12, 0.2, 0, 0.6, -0.42), "udder");
    for (const [x, z] of [[0.06, -0.34], [-0.06, -0.34], [0.06, -0.5], [-0.06, -0.5]]) {
      body.add(trunk, new THREE.CylinderGeometry(0.016, 0.02, 0.08, 6).translate(x, 0.47, z), "udder");
    }
  }

  const tail = joint(trunk, 0, 1.3, -0.95);
  body.add(tail, taper(v3(0, 0, 0), v3(0, -0.55, 0), 0.034, 0.024), "body");
  const tailTip = joint(tail, 0, -0.55, 0);
  body.add(tailTip, taper(v3(0, 0, 0), v3(0, -0.28, 0), 0.024, 0.018), "body");
  body.add(tailTip, ellipsoid(0.05, 0.13, 0.05, 0, -0.36, 0), "tuft");

  body.paint(root, cowPattern(variant, seed % 97));

  const rules: WanderRules = { walkSpeed: stage === "baby" ? 1.1 : 0.85, turnRate: 1.2, margin: 1.6, grazes: true, watchRange: 6 };
  let pen: Pen | undefined;
  let state: Wander | undefined;
  let mood: Mood = { needsCare: false, happy: false };
  let gait = rng.next();
  let grazing = 0;
  let look = 0;
  const quirk = rng.range(0, 10);

  const update = (dt: number, time: number, player: THREE.Vector3): void => {
    if (!pen || !state) return;
    const watch = wander(state, dt, pen, rules, rng, player, mood);
    gait = (gait + (state.speed * dt) / (1.7 * scale)) % 1;
    const moving = Math.min(1, state.speed / 0.5);
    for (const leg of legs) {
      const angle = (gait + leg.offset) * TAU;
      leg.upper.rotation.x = -Math.sin(angle) * 0.36 * moving;
      leg.lower.rotation.x = Math.max(0, Math.cos(angle)) * 0.55 * moving;
    }
    grazing = approach(grazing, state.behaviour === "graze" ? 1 : 0, 1.6, dt);
    look = approach(look, THREE.MathUtils.clamp(watch, -0.9, 0.9), 3, dt);
    const watching = state.behaviour === "watch" ? 1 : 0;
    const idleLook = state.behaviour === "rest" ? Math.sin(time * 0.31 + quirk) * 0.35 : 0;
    neck.rotation.x = 0.12 - 0.12 * watching + grazing * 1.1 + Math.sin(gait * TAU * 2) * 0.035 * moving;
    neck.rotation.y = look * 0.7 + idleLook * (1 - grazing);
    head.rotation.x = 0.55 + grazing * 0.25 + Math.sin(time * 5.2) * 0.025 * grazing;
    head.rotation.y = look * 0.35;
    tail.rotation.x = 0.12 + 0.04 * Math.sin(time * 0.8 + quirk);
    tail.rotation.z = Math.sin(time * (mood.happy ? 5.5 : 1.3) + quirk) * (mood.happy ? 0.38 : 0.2);
    tailTip.rotation.z = Math.sin(time * 1.9 + quirk) * 0.25;
    const reachX = Math.sin(state.heading) * 0.9 * scale;
    const reachZ = Math.cos(state.heading) * 0.9 * scale;
    const front = groundHeight(state.x + reachX, state.z + reachZ);
    const back = groundHeight(state.x - reachX, state.z - reachZ);
    trunk.rotation.x = Math.atan2(back - front, 1.8 * scale);
    trunk.position.y = Math.abs(Math.sin(gait * TAU * 2)) * 0.02 * moving;
    root.position.set(state.x, groundHeight(state.x, state.z), state.z);
    root.rotation.y = state.heading;
  };

  return {
    root,
    markerHeight: 2 * scale,
    setPen: (next) => {
      pen = next;
      state ??= startWander(next, rules, rng);
    },
    setMood: (next) => {
      mood = next;
    },
    update,
    dispose: () => {
      root.removeFromParent();
      body.dispose();
    }
  };
};

/* ------------------------------------------------------------------ dinosaur */

const DINO_COLORS: Record<string, { back: Rgb; belly: Rgb; stripe: Rgb; crest: Rgb }> = {
  default: { back: linear(0x4d7a3a), belly: linear(0xc9c08a), stripe: linear(0x2e4d22), crest: linear(0xc4552a) },
  fern: { back: linear(0x2f6a5c), belly: linear(0xbfcf9c), stripe: linear(0x163a33), crest: linear(0xe7c24a) },
  amber: { back: linear(0xb06a25), belly: linear(0xeed9a8), stripe: linear(0x5b3212), crest: linear(0x3f6f94) }
};

const dinoPattern = (variant: string, seed: number): Pattern => {
  const colors = DINO_COLORS[variant] ?? DINO_COLORS.default;
  const eye = linear(0x0b0908);
  const shine = linear(0xffffff);
  const claw = linear(0x3a332b);
  return (p, n, tag) => {
    if (tag === "eye") return eye;
    if (tag === "shine") return shine;
    if (tag === "claw") return claw;
    if (tag === "crest") return colors.crest;
    if (tag === "scute") return mix(colors.crest, colors.stripe, 0.25);
    const belly = smooth(0.05, -0.65, n.y);
    const stripes = smooth(0.35, 0.75, Math.sin(p.z * 5.5 + Math.sin(p.x * 3 + seed) * 1.2 + seed));
    const back = mix(colors.back, colors.stripe, stripes * (1 - belly) * (variant === "default" ? 0.5 : 0.85));
    return mix(mix(back, colors.belly, belly), colors.stripe, (noise3(p.x * 5 + seed, p.y * 5, p.z * 5) - 0.5) * 0.25);
  };
};

type DinoLeg = { hip: THREE.Group; knee: THREE.Group; ankle: THREE.Group };

const HIP_HEIGHT = 1.22;
const BODY_TILT = 0.2;

/** Top of the tilted body ellipsoid at a point along its length, in torso space. */
const dorsalPoint = (along: number): THREE.Vector3 => {
  const y = 0.46 * Math.sqrt(Math.max(0, 1 - (along / 0.84) ** 2));
  return v3(0, y * Math.cos(BODY_TILT) + along * Math.sin(BODY_TILT) + 0.12, -y * Math.sin(BODY_TILT) + along * Math.cos(BODY_TILT) + 0.26);
};

/** A crested, two-legged plant eater; hatchlings are small with big heads. */
export const createDinosaur = (variant: string, stage: "hatchling" | "adult", seed: number): Creature => {
  const rng = createRng(seed);
  const body = new Body();
  const root = new THREE.Group();
  root.name = "dinosaur";
  const scale = stage === "hatchling" ? 0.46 : 1;
  const frame = joint(root);
  frame.scale.setScalar(scale);
  const pelvis = joint(frame, 0, HIP_HEIGHT, 0);
  const torso = joint(pelvis);

  body.add(torso, ellipsoid(0.4, 0.46, 0.84, 0, 0, 0, 1.4).rotateX(-BODY_TILT).translate(0, 0.12, 0.26), "body");
  body.add(torso, limb(v3(0, 0.38, 0.9), v3(0, 0.92, 1.26), 0.15), "body");
  const head = joint(torso, 0, 0.95, 1.3);
  head.scale.setScalar(stage === "hatchling" ? 1.35 : 1);
  body.add(head, ellipsoid(0.16, 0.16, 0.26, 0, 0.03, 0.12), "body");
  body.add(head, ellipsoid(0.12, 0.1, 0.18, 0, -0.04, 0.34), "body");
  for (const side of [1, -1]) {
    body.add(head, ellipsoid(0.036, 0.036, 0.036, side * 0.12, 0.08, 0.17), "eye", gloss());
    body.add(head, ellipsoid(0.011, 0.011, 0.011, side * 0.145, 0.095, 0.19), "shine", gloss());
  }
  const crest = new THREE.CatmullRomCurve3([v3(0, 0.12, 0.2), v3(0, 0.27, 0.04), v3(0, 0.34, -0.2), v3(0, 0.33, -0.42)]);
  body.add(head, new THREE.TubeGeometry(crest, 16, 0.045, 8, false), "crest");
  for (let i = 0; i < 5; i += 1) {
    const top = dorsalPoint(0.6 - i * 0.3);
    body.add(torso, new THREE.ConeGeometry(0.06, 0.15, 6).translate(top.x, top.y + 0.04, top.z), "scute");
  }

  for (const side of [1, -1]) {
    const shoulder = joint(torso, side * 0.3, 0.12, 0.86);
    shoulder.rotation.x = -0.5;
    body.add(shoulder, limb(v3(0, 0, 0), v3(0, -0.18, 0.02), 0.055), "body");
    const elbow = joint(shoulder, 0, -0.18, 0.02);
    elbow.rotation.x = -0.7;
    body.add(elbow, limb(v3(0, 0, 0), v3(0, -0.15, 0), 0.045), "body");
    body.add(elbow, ellipsoid(0.045, 0.035, 0.05, 0, -0.18, 0.01), "claw");
  }

  const legs: DinoLeg[] = [1, -1].map((side) => {
    const hip = joint(pelvis, side * 0.3, -0.02, 0);
    body.add(hip, limb(v3(0, 0.05, 0), v3(0, -0.42, 0.1), 0.165), "body");
    const knee = joint(hip, 0, -0.46, 0.1);
    body.add(knee, limb(v3(0, 0, 0), v3(0, -0.4, -0.16), 0.085), "body");
    const ankle = joint(knee, 0, -0.4, -0.16);
    body.add(ankle, limb(v3(0, 0, 0), v3(0, -0.28, 0.05), 0.06), "body");
    for (const toe of [-1, 0, 1]) {
      body.add(ankle, limb(v3(0, -0.3, 0.05), v3(toe * 0.07, -0.32, 0.22), 0.035), "body");
      body.add(ankle, new THREE.ConeGeometry(0.025, 0.07, 6).rotateX(Math.PI / 2).translate(toe * 0.075, -0.325, 0.27), "claw");
    }
    return { hip, knee, ankle };
  });

  const tail: THREE.Group[] = [];
  let tailParent: THREE.Object3D = torso;
  let tailStart = v3(0, 0.1, -0.45);
  const tailRadii = [0.3, 0.24, 0.18, 0.13, 0.09, 0.06, 0.035];
  tailRadii.forEach((radius, index) => {
    const segment = joint(tailParent, tailStart.x, tailStart.y, tailStart.z);
    segment.rotation.x = index === 0 ? -0.12 : 0.03;
    const length = 0.42 - index * 0.02;
    body.add(segment, taper(v3(0, 0, 0.04), v3(0, 0, -length - 0.04), radius, tailRadii[index + 1] ?? 0.012), "body");
    if (index < 5) body.add(segment, new THREE.ConeGeometry(0.05 * (1 - index * 0.15), 0.13, 6).translate(0, radius + 0.03, -length / 2), "scute");
    tail.push(segment);
    tailParent = segment;
    tailStart = v3(0, 0, -length);
  });

  body.paint(root, dinoPattern(variant, (seed % 13) * 0.7));

  const rules: WanderRules = { walkSpeed: stage === "hatchling" ? 1.5 : 1.2, turnRate: 1.6, margin: 2, grazes: false, watchRange: 7 };
  let pen: Pen | undefined;
  let state: Wander | undefined;
  let mood: Mood = { needsCare: false, happy: false };
  let gait = rng.next();
  let look = 0;
  let hop = 0;
  let nextHop = rng.range(2, 5);

  const update = (dt: number, time: number, player: THREE.Vector3): void => {
    if (!pen || !state) return;
    const watch = wander(state, dt, pen, rules, rng, player, mood);
    gait = (gait + (state.speed * dt) / (1.9 * scale)) % 1;
    const moving = Math.min(1, state.speed / 0.5);
    const sine = Math.sin(gait * TAU);
    const cosine = Math.cos(gait * TAU);
    let reach = 0;
    for (const [side, leg] of [[1, legs[0]], [-1, legs[1]]] as const) {
      const thigh = sine * side * 0.45 * moving;
      const bend = Math.max(0, cosine * side) * 0.7 * moving;
      leg.hip.rotation.x = -thigh;
      leg.knee.rotation.x = bend;
      leg.ankle.rotation.x = -bend * 0.6 + thigh * 0.3;
      reach = Math.max(reach, Math.cos(thigh) - bend * 0.08);
    }
    const idle = 1 - moving;
    const breath = Math.sin(time * 1.6 + seed) * 0.012 * idle;
    nextHop -= dt;
    if (mood.happy && nextHop < 0 && hop <= 0 && state.speed < 0.3) {
      hop = 1;
      nextHop = rng.range(2.5, 5);
    }
    const lift = hop > 0 ? Math.sin((1 - hop) * Math.PI) * 0.32 : 0;
    hop = Math.max(0, hop - dt * 2);
    pelvis.position.y = HIP_HEIGHT * reach + Math.abs(cosine) * 0.04 * moving + breath + lift;
    torso.rotation.y = sine * 0.06 * moving;
    torso.rotation.x = -0.02 + breath;
    look = approach(look, THREE.MathUtils.clamp(watch, -1, 1), 3, dt);
    const resting = state.behaviour === "rest" ? 1 : 0;
    head.rotation.y = look * 0.8 + Math.sin(time * 0.4 + seed) * 0.3 * idle * resting;
    head.rotation.x = Math.sin(gait * TAU * 2) * 0.05 * moving + (state.behaviour === "watch" ? -0.15 : 0.05) + (mood.needsCare ? Math.sin(time * 3) * 0.05 : 0);
    tail.forEach((segment, index) => {
      segment.rotation.y = Math.sin(time * (1.1 + moving) - index * 0.55 + seed) * (0.07 + 0.02 * index) * (0.6 + 0.4 * moving) - (index === 0 ? torso.rotation.y * 0.8 : 0);
    });
    root.position.set(state.x, groundHeight(state.x, state.z), state.z);
    root.rotation.y = state.heading;
  };

  return {
    root,
    markerHeight: stage === "hatchling" ? 1.5 : 2.6,
    setPen: (next) => {
      pen = next;
      state ??= startWander(next, rules, rng);
    },
    setMood: (next) => {
      mood = next;
    },
    update,
    dispose: () => {
      root.removeFromParent();
      body.dispose();
    }
  };
};

/* ------------------------------------------------------------------ egg and fossil */

/** Puts an animal that does not walk at its own seeded spot inside the enclosure. */
const settle = (root: THREE.Object3D, pen: Pen, rng: Rng): void => {
  const area = inset(pen, 1.8);
  const x = rng.range(area.x0, area.x1);
  const z = rng.range(area.z0, area.z1);
  root.position.set(x, groundHeight(x, z), z);
  root.rotation.y = rng.range(-Math.PI, Math.PI);
};

/** A speckled egg in a straw nest that wobbles now and then, as if about to hatch. */
export const createEgg = (variant: string, seed: number): Creature => {
  const rng = createRng(seed);
  const body = new Body();
  const root = new THREE.Group();
  root.name = "dinosaur-egg";
  body.add(root, new THREE.TorusGeometry(0.42, 0.14, 8, 22).rotateX(Math.PI / 2).scale(1, 0.7, 1).translate(0, 0.1, 0), "nest", straw());
  body.add(root, new THREE.CylinderGeometry(0.4, 0.44, 0.08, 18).translate(0, 0.04, 0), "nest", straw());
  const egg = joint(root, 0, 0.06, 0);
  const shell = new THREE.SphereGeometry(1, 28, 20);
  const position = shell.getAttribute("position");
  for (let i = 0; i < position.count; i += 1) {
    const y = position.getY(i);
    const narrow = y > 0 ? 1 - y * 0.18 : 1;
    position.setXYZ(i, position.getX(i) * 0.27 * narrow, (y + 1) * 0.36, position.getZ(i) * 0.27 * narrow);
  }
  shell.computeVertexNormals();
  body.add(egg, shell, "shell", gloss());
  const colors = DINO_COLORS[variant] ?? DINO_COLORS.default;
  const base = linear(0xeee3c8);
  const speckle = mix(colors.back, colors.stripe, 0.4);
  body.paint(root, (p) => mix(base, speckle, smooth(0.66, 0.7, noise3(p.x * 18 + seed, p.y * 16, p.z * 18)) * 0.85));
  let wobble = 0;
  let next = rng.range(2, 6);
  return {
    root,
    markerHeight: 1.1,
    setPen: (pen) => settle(root, pen, rng),
    setMood: () => undefined,
    update: (dt) => {
      next -= dt;
      if (next < 0) {
        wobble = 1;
        next = rng.range(3, 7);
      }
      wobble = Math.max(0, wobble - dt * 0.9);
      egg.rotation.z = Math.sin(wobble * 26) * 0.12 * wobble;
      egg.rotation.x = Math.sin(wobble * 19 + 1) * 0.06 * wobble;
    },
    dispose: () => {
      root.removeFromParent();
      body.dispose();
    }
  };
};

/** A skeleton breaking the surface of a dug mound: skull, spine and ribs. */
export const createFossil = (seed: number): Creature => {
  const rng = createRng(seed);
  const body = new Body();
  const root = new THREE.Group();
  root.name = "dinosaur-fossil";
  body.add(root, new THREE.SphereGeometry(1, 26, 10, 0, TAU, 0, Math.PI / 2).scale(1.15, 0.32, 0.85), "mound", soil());
  body.add(root, ellipsoid(0.3, 0.13, 0.15, 0.55, 0.22, 0), "bone");
  body.add(root, ellipsoid(0.17, 0.08, 0.1, 0.84, 0.18, 0), "bone");
  for (let i = 0; i < 8; i += 1) body.add(root, ellipsoid(0.06, 0.05, 0.05, 0.3 - i * 0.13, 0.27 - i * 0.012, 0), "bone");
  for (let i = 0; i < 5; i += 1) {
    body.add(root, new THREE.TorusGeometry(0.3 - i * 0.035, 0.028, 6, 14, Math.PI).rotateY(Math.PI / 2).translate(0.2 - i * 0.14, 0.05, 0), "bone");
  }
  const bone = linear(0xd9cdb0);
  const stain = linear(0x8c7a5a);
  body.paint(root, (p) => mix(bone, stain, noise3(p.x * 12 + seed, p.y * 12, p.z * 12) * 0.6));
  return {
    root,
    markerHeight: 1.1,
    setPen: (pen) => settle(root, pen, rng),
    setMood: () => undefined,
    update: () => undefined,
    dispose: () => {
      root.removeFromParent();
      body.dispose();
    }
  };
};
