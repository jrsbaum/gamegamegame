import type { Clothing, HairStyle } from "@lafarmer2/content";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { beam } from "./architecture";
import { SURFACES } from "./assets";
import { RUN_SPEED, WALK_SPEED } from "./controller";
import { surfaceMaterial, tintMaterial } from "./materials";

/*
 * The farmer: a short work jacket (noragi) closed by an obi, dark trousers, straw sandals and a
 * conical straw hat. Joints are plain groups posed every frame by a procedural gait; the pelvis
 * height comes from the leg angles, so the planted foot stays on the ground at any stride.
 */

export type FarmerLook = { clothing: Clothing; hair: HairStyle };

export type Farmer = {
  readonly root: THREE.Group;
  /**
   * Poses the body for `speed` world units per second; true on the frame a foot lands.
   * `gait.along` is +1 into the screen and -1 backward. `gait.strafe` is +1 to screen right.
   */
  animate: (dt: number, speed: number, gait?: { along: number; strafe: number }) => boolean;
  setLook: (look: FarmerLook) => void;
  dispose: () => void;
};

const TAU = Math.PI * 2;
const JACKETS: Record<Clothing, number> = { forest: 0x3e5f4c, coral: 0xb55a4c, river: 0x33586e };
const COLOR = {
  trousers: 0x3a3530,
  leggings: 0x4a4238,
  obi: 0x2b2420,
  collar: 0xe6dcc6,
  skin: 0xd9a47e,
  hair: 0x1f1611,
  tabi: 0x2e2a27,
  eye: 0x15100d
};

/** Hip joint to ankle joint, thigh then shin. */
const THIGH = 0.42;
const SHIN = 0.4;
/** Pelvis above the hip joints, and ankle joint above the sole. */
const HIP_DROP = 0.02;
const ANKLE_HEIGHT = 0.08;
const STANDING = HIP_DROP + THIGH + SHIN + ANKLE_HEIGHT;

/** Jacket silhouette as (radius, height above the spine joint), hem to collar. */
const JACKET: ReadonlyArray<readonly [number, number]> = [
  [0, -0.22], [0.175, -0.22], [0.19, -0.14], [0.168, -0.02], [0.172, 0.06], [0.195, 0.2], [0.2, 0.3], [0.175, 0.38], [0.1, 0.44], [0.05, 0.46], [0, 0.46]
];
const CHEST_DEPTH = 0.74;

const HAT: ReadonlyArray<readonly [number, number]> = [[0, 0.17], [0.03, 0.165], [0.12, 0.11], [0.22, 0.045], [0.29, 0], [0.3, -0.012]];

const materials = new Map<string, THREE.Material>();

const tint = (color: number, roughness = 0.85): THREE.Material => {
  const key = `${color}:${roughness}`;
  let material = materials.get(key);
  if (!material) {
    material = tintMaterial(color, { roughness });
    materials.set(key, material);
  }
  return material;
};

const straw = (): THREE.Material => {
  let material = materials.get("straw");
  if (!material) {
    material = surfaceMaterial(SURFACES.thatch, { color: new THREE.Color(1.5, 1.32, 1), uvScale: [7, 1.6], side: THREE.DoubleSide });
    materials.set("straw", material);
  }
  return material;
};

const jacketRadius = (y: number): number => {
  for (let i = 1; i < JACKET.length; i += 1) {
    const [r1, y1] = JACKET[i];
    const [r0, y0] = JACKET[i - 1];
    if (y <= y1 && y >= y0 && y1 > y0) return r0 + ((y - y0) / (y1 - y0)) * (r1 - r0);
  }
  return 0;
};

type Shapes = Record<
  | "pelvis" | "thigh" | "shin" | "foot" | "sole" | "jacket" | "obi" | "collar" | "upperArm" | "forearm" | "hand"
  | "neck" | "skull" | "nose" | "eye" | "ear" | "hairCap" | "ponytail" | "tie" | "hat" | "hatKnot",
  THREE.BufferGeometry
>;

let shapes: Shapes | undefined;

const collarStrip = (fromX: number, fromY: number, toX: number, toY: number): THREE.BufferGeometry => {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 8; i += 1) {
    const t = i / 8;
    const x = fromX + (toX - fromX) * t;
    const y = fromY + (toY - fromY) * t;
    const radius = jacketRadius(y);
    const z = Math.sqrt(Math.max(0, radius * radius - x * x)) * CHEST_DEPTH + 0.007;
    points.push(new THREE.Vector3(x, y, z));
  }
  return beam(points, 0.05, 0.014, new THREE.Vector3(0, 0, 1));
};

const buildShapes = (): Shapes => {
  const capsule = (radius: number, length: number, y: number): THREE.BufferGeometry =>
    new THREE.CapsuleGeometry(radius, length, 4, 12).translate(0, y, 0);
  const jacket = new THREE.LatheGeometry(JACKET.map(([r, y]) => new THREE.Vector2(r, y)), 28);
  jacket.scale(1, 1, CHEST_DEPTH);
  const obi = new THREE.CylinderGeometry(0.188, 0.188, 0.085, 28).scale(1, 1, 0.76).translate(0, -0.075, 0);
  const strips = [collarStrip(0.075, 0.43, -0.045, -0.03), collarStrip(-0.075, 0.43, 0.035, 0)];
  const collar = mergeGeometries(strips, false);
  strips.forEach((strip) => strip.dispose());
  const skull = new THREE.SphereGeometry(0.112, 24, 18).scale(0.94, 1.06, 1).translate(0, 0.075, 0);
  const hairCap = new THREE.SphereGeometry(0.12, 28, 12, 0, TAU, 0, Math.PI * 0.49).scale(0.94, 1.06, 1).rotateX(-0.57).translate(0, 0.075, 0);
  const hat = new THREE.LatheGeometry(HAT.map(([r, y]) => new THREE.Vector2(r, y)), 36);
  return {
    pelvis: new THREE.SphereGeometry(0.15, 16, 12).scale(1.08, 0.72, 0.82),
    thigh: capsule(0.078, 0.26, -THIGH / 2),
    shin: capsule(0.062, 0.28, -SHIN / 2),
    foot: new THREE.CapsuleGeometry(0.048, 0.13, 4, 10).rotateX(Math.PI / 2).scale(1, 0.8, 1).translate(0, -0.035, 0.05),
    sole: new THREE.BoxGeometry(0.11, 0.022, 0.27).translate(0, -ANKLE_HEIGHT + 0.011, 0.05),
    jacket,
    obi,
    collar,
    upperArm: capsule(0.06, 0.19, -0.14),
    forearm: capsule(0.05, 0.16, -0.12),
    hand: new THREE.SphereGeometry(0.046, 12, 10).scale(0.85, 1.15, 0.95).translate(0, -0.29, 0.01),
    neck: new THREE.CylinderGeometry(0.046, 0.05, 0.13, 12).translate(0, 0.5, 0.005),
    skull,
    nose: new THREE.SphereGeometry(0.018, 8, 6).scale(0.8, 1, 1.25).translate(0, 0.058, 0.111),
    eye: new THREE.SphereGeometry(0.013, 8, 6),
    ear: new THREE.SphereGeometry(0.026, 8, 6).scale(0.45, 1, 0.75),
    hairCap,
    ponytail: new THREE.CapsuleGeometry(0.042, 0.24, 4, 10).translate(0, -0.14, 0),
    tie: new THREE.CylinderGeometry(0.03, 0.03, 0.03, 10),
    hat,
    hatKnot: new THREE.SphereGeometry(0.022, 8, 6).translate(0, 0.175, 0)
  };
};

type Side = { hip: THREE.Group; knee: THREE.Group; ankle: THREE.Group; shoulder: THREE.Group; elbow: THREE.Group };

const group = (parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Group => {
  const joint = new THREE.Group();
  joint.position.set(x, y, z);
  parent.add(joint);
  return joint;
};

const part = (geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Mesh => {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
};

const smooth = (edge0: number, edge1: number, value: number): number => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

const approach = (value: number, goal: number, rate: number, dt: number): number => value + (goal - value) * (1 - Math.exp(-rate * dt));

export const createFarmer = (look: FarmerLook): Farmer => {
  shapes ??= buildShapes();
  const s = shapes;
  const root = new THREE.Group();
  root.name = "farmer";
  const pelvis = group(root, 0, STANDING);
  const trousers = tint(COLOR.trousers, 0.95);
  part(s.pelvis, trousers, pelvis);
  const spine = group(pelvis, 0, 0.08);
  const jacketMeshes: THREE.Mesh[] = [];
  const jacket = (): THREE.Material => tint(JACKETS[look.clothing], 0.9);
  jacketMeshes.push(part(s.jacket, jacket(), spine));
  part(s.obi, tint(COLOR.obi, 0.8), spine);
  part(s.collar, tint(COLOR.collar, 0.9), spine);
  const skin = tint(COLOR.skin, 0.62);
  part(s.neck, skin, spine);

  const sides: Side[] = [1, -1].map((side) => {
    const hip = group(pelvis, side * 0.095, -HIP_DROP);
    part(s.thigh, trousers, hip);
    const knee = group(hip, 0, -THIGH);
    part(s.shin, tint(COLOR.leggings, 0.95), knee);
    const ankle = group(knee, 0, -SHIN);
    part(s.foot, tint(COLOR.tabi, 0.9), ankle);
    part(s.sole, straw(), ankle);
    const shoulder = group(spine, side * 0.205, 0.36);
    shoulder.rotation.z = side * 0.09;
    jacketMeshes.push(part(s.upperArm, jacket(), shoulder));
    const elbow = group(shoulder, 0, -0.29);
    jacketMeshes.push(part(s.forearm, jacket(), elbow));
    part(s.hand, skin, elbow);
    return { hip, knee, ankle, shoulder, elbow };
  });

  const head = group(spine, 0, 0.56);
  part(s.skull, skin, head);
  part(s.nose, skin, head);
  const eyes = tint(COLOR.eye, 0.3);
  for (const side of [1, -1]) {
    part(s.eye, eyes, head, side * 0.04, 0.085, 0.1);
    part(s.ear, skin, head, side * 0.104, 0.07, -0.005);
  }
  const hairMaterial = tint(COLOR.hair, 0.75);
  part(s.hairCap, hairMaterial, head);
  const ponytail = group(head, 0, 0.03, -0.1);
  ponytail.rotation.x = 0.32;
  part(s.ponytail, hairMaterial, ponytail);
  part(s.tie, tint(COLOR.obi, 0.8), ponytail);
  const hat = group(head, 0, 0.1, 0.004);
  hat.rotation.x = -0.1;
  part(s.hat, straw(), hat);
  part(s.hatKnot, straw(), hat);

  const [left, right] = sides;
  let phase = 0;
  let moving = 0;
  let sprint = 0;
  let lean = 0;
  let clock = 0;

  const setLook = (next: FarmerLook): void => {
    look = next;
    for (const mesh of jacketMeshes) mesh.material = jacket();
    ponytail.visible = next.hair === "long";
  };
  setLook(look);

  const legHeight = (thigh: number, bend: number): number => THIGH * Math.cos(thigh) + SHIN * Math.cos(thigh - bend);

  const animate = (dt: number, speed: number, gait?: { along: number; strafe: number }): boolean => {
    clock += dt;
    const along = gait?.along ?? 1;
    const lateral = gait?.strafe ?? 0;
    moving = approach(moving, Math.min(1, speed / 1.1), 9, dt);
    sprint = approach(sprint, smooth(WALK_SPEED * 1.1, RUN_SPEED * 0.9, speed), 6, dt);
    lean = approach(lean, lateral * moving, 8, dt);
    const stride = 2.5 + 1.2 * sprint;
    const advance = ((speed * dt) / stride) * (along < -0.25 ? -1 : 1);
    const next = phase + advance;
    const landed = speed > 0.8 && moving > 0.5 && ((phase < 0.25 && next >= 0.25) || (phase < 0.75 && next >= 0.75) || next >= 1.25);
    phase = ((next % 1) + 1) % 1;

    const sine = Math.sin(phase * TAU);
    const cosine = Math.cos(phase * TAU);
    const legSwing = (0.58 + 0.3 * sprint) * moving * (0.62 + 0.38 * Math.abs(along));
    const kneeLift = (0.95 + 0.75 * sprint) * moving;
    const armSwing = (0.42 + 0.5 * sprint) * moving;
    let height = 0;
    for (const [side, joints] of [[1, left], [-1, right]] as const) {
      const forward = sine * side;
      const swinging = cosine * side;
      const thigh = forward * legSwing;
      const bend = 0.06 + Math.max(0, swinging) * kneeLift + Math.max(0, -swinging) * 0.1 * moving;
      joints.hip.rotation.x = -thigh;
      joints.knee.rotation.x = bend;
      joints.ankle.rotation.x = (thigh - bend) * 0.8 + Math.max(0, -forward) * Math.max(0, swinging) * 0.5 * moving;
      height = Math.max(height, legHeight(thigh, bend));
      joints.shoulder.rotation.x = forward * armSwing + 0.04 * (1 - moving);
      joints.elbow.rotation.x = -(0.14 + 0.22 * moving + 1.05 * sprint * moving + Math.max(0, -forward) * 0.35 * moving);
    }
    const breath = Math.sin(clock * 1.9) * (1 - moving);
    pelvis.position.y = HIP_DROP + height + ANKLE_HEIGHT + sprint * moving * 0.035 * Math.abs(cosine) + breath * 0.004;
    pelvis.rotation.y = -sine * 0.08 * moving;
    pelvis.rotation.z = cosine * 0.03 * moving + lean * 0.16;
    spine.rotation.x = (0.05 + 0.15 * sprint) * moving * Math.max(0.35, along) + breath * 0.012;
    spine.rotation.y = sine * (0.1 + 0.05 * sprint) * moving;
    spine.rotation.z = -pelvis.rotation.z * 0.8;
    const glance = Math.sin(clock * 0.37) * Math.sin(clock * 0.13 + 1.1);
    head.rotation.y = -spine.rotation.y * 0.8 - pelvis.rotation.y + glance * 0.5 * (1 - moving);
    head.rotation.x = -spine.rotation.x * 0.6 + Math.sin(clock * 0.21) * 0.05 * (1 - moving);
    return landed;
  };

  const dispose = (): void => {
    root.removeFromParent();
  };

  return { root, animate, setLook, dispose };
};
