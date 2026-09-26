import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { SURFACES, surfaceMaps, type SurfaceSlug } from "./assets";
import { atlasCell, createRng, mapleClusterTexture, pineTuftTexture, sakuraClusterTexture, type Rng } from "./foliage";
import { groundHeight, valueNoise } from "./height";
import { TRANSLUCENCY, after, withGlobals } from "./shared";

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const SIDE = new THREE.Vector3(1, 0, 0);

export type TreeKind = "sakura" | "weeping" | "maple" | "pine";
type Foliage = "blossom" | "maple" | "pads";

/** Per-depth growth rules; index 0 is the trunk. */
type Species = {
  depth: number;
  length: number[];
  radius: number;
  radiusRatio: number[];
  children: number[];
  start: number[];
  angle: number[];
  gnarl: number[];
  up: number[];
  droop: number[];
  spread: number[];
  segment: number[];
  leafDepth: number;
  clusterStep: number;
  cards: [number, number];
  cardSize: [number, number];
  foliage: Foliage;
  pendulous?: boolean;
};

const SPECIES: Record<TreeKind, Species> = {
  sakura: {
    depth: 4, length: [3, 4.6, 2.9, 1.7, 0.85], radius: 0.4, radiusRatio: [0.52, 0.58, 0.6, 0.62], children: [4, 4, 4, 3],
    start: [0.62, 0.22, 0.2, 0.25], angle: [0.72, 0.62, 0.66, 0.7], gnarl: [0.1, 0.16, 0.2, 0.22, 0.25], up: [0.05, 0.035, 0.02, 0.03, 0.05],
    droop: [0, 0.12, 0.2, 0.18, 0.1], spread: [0, 0.55, 0.35, 0.2, 0.1], segment: [0.32, 0.4, 0.34, 0.26, 0.2],
    leafDepth: 3, clusterStep: 0.42, cards: [3, 4], cardSize: [0.6, 1], foliage: "blossom"
  },
  weeping: {
    depth: 4, length: [3.6, 3.6, 3, 4.2, 1.6], radius: 0.42, radiusRatio: [0.55, 0.55, 0.45, 0.5], children: [4, 4, 5, 2],
    start: [0.7, 0.3, 0.25, 0.3], angle: [0.45, 0.55, 0.9, 0.5], gnarl: [0.08, 0.14, 0.14, 0.06, 0.08], up: [0.06, 0.06, 0, 0, 0],
    droop: [0, 0.05, 0.55, 1.4, 1.2], spread: [0, 0.35, 0.3, 0, 0], segment: [0.34, 0.36, 0.3, 0.3, 0.25],
    leafDepth: 3, clusterStep: 0.3, cards: [2, 3], cardSize: [0.45, 0.7], foliage: "blossom", pendulous: true
  },
  maple: {
    depth: 4, length: [2.2, 2.8, 2, 1.3, 0.7], radius: 0.22, radiusRatio: [0.6, 0.6, 0.62, 0.62], children: [3, 4, 4, 3],
    start: [0.45, 0.25, 0.2, 0.25], angle: [0.55, 0.6, 0.7, 0.75], gnarl: [0.12, 0.16, 0.18, 0.2, 0.2], up: [0.08, 0.06, 0.04, 0.02, 0.02],
    droop: [0, 0.06, 0.1, 0.12, 0.1], spread: [0, 0.3, 0.3, 0.2, 0.1], segment: [0.3, 0.3, 0.26, 0.2, 0.18],
    leafDepth: 3, clusterStep: 0.36, cards: [3, 5], cardSize: [0.5, 0.85], foliage: "maple"
  },
  pine: {
    depth: 2, length: [7.5, 3.6, 1.6], radius: 0.32, radiusRatio: [0.42, 0.55], children: [7, 3],
    start: [0.35, 0.35], angle: [1.25, 0.7], gnarl: [0.1, 0.16, 0.2], up: [0.03, 0.05, 0.09],
    droop: [0, 0.08, 0], spread: [0, 0.2, 0.1], segment: [0.4, 0.34, 0.26],
    leafDepth: 2, clusterStep: 0, cards: [0, 0], cardSize: [0, 0], foliage: "pads"
  }
};

type Branch = { points: THREE.Vector3[]; radii: number[]; flex: number[]; depth: number; phase: number };
/** Where foliage attaches; `flex` grows toward the tips and drives the wind sway. */
type Sprig = { position: THREE.Vector3; flex: number };
type Skeleton = { branches: Branch[]; sprigs: Sprig[] };

const perpendicular = (direction: THREE.Vector3): THREE.Vector3 =>
  new THREE.Vector3().crossVectors(direction, Math.abs(direction.y) < 0.9 ? UP : SIDE).normalize();

const wobble = (seed: number, t: number, lane: number): number => (valueNoise(seed + t, lane) - 0.5) * 2;

const growSkeleton = (species: Species, base: THREE.Vector3, scale: number, lean: number, rng: Rng): Skeleton => {
  const branches: Branch[] = [];
  const sprigs: Sprig[] = [];
  const leanDirection = new THREE.Vector3(Math.cos(lean), 0, Math.sin(lean));

  const grow = (origin: THREE.Vector3, heading: THREE.Vector3, length: number, radius: number, depth: number, flexStart: number): void => {
    const steps = Math.max(3, Math.ceil(length / (species.segment[depth] * scale)));
    const points = [origin.clone()];
    const radii = [radius];
    const flex = [flexStart];
    const cursor = origin.clone();
    const direction = heading.clone();
    const tipRadius = depth === species.depth ? radius * 0.25 : radius * 0.5;
    const seed = rng.range(0, 100);
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      const gnarl = species.gnarl[depth];
      direction.x += wobble(seed, step * 0.35, 0.5) * gnarl;
      direction.y += wobble(seed, step * 0.35, 7.5) * gnarl * 0.6;
      direction.z += wobble(seed, step * 0.35, 13.5) * gnarl;
      direction.y += species.up[depth] - species.droop[depth] * t * (species.pendulous && depth >= 2 ? 1 : t);
      if (depth === 0) direction.addScaledVector(leanDirection, 0.035 * (1 - t));
      direction.normalize();
      if (species.pendulous && depth >= 3) {
        direction.y = Math.min(direction.y, -0.55 - t * 0.4);
        direction.normalize();
      }
      cursor.addScaledVector(direction, length / steps);
      points.push(cursor.clone());
      radii.push(THREE.MathUtils.lerp(radius, tipRadius, Math.pow(t, 0.9)));
      flex.push(flexStart + (length * t) / Math.max(0.05, radius * 40));
    }
    branches.push({ points, radii, flex, depth, phase: rng.range(0, TAU) });

    const sample = (along: number): { position: THREE.Vector3; flex: number; index: number } => {
      const at = along * steps;
      const index = Math.min(steps - 1, Math.floor(at));
      const fraction = at - index;
      return {
        position: points[index].clone().lerp(points[index + 1], fraction),
        flex: THREE.MathUtils.lerp(flex[index], flex[index + 1], fraction),
        index
      };
    };

    if (depth < species.depth) {
      const count = species.children[depth] + (rng.next() < 0.35 ? 1 : 0) - (rng.next() < 0.2 ? 1 : 0);
      const azimuthStart = rng.range(0, TAU);
      for (let child = 0; child < count; child += 1) {
        const along = THREE.MathUtils.lerp(species.start[depth], 1, (child + rng.range(0.1, 0.9)) / count);
        const joint = sample(along);
        const axis = new THREE.Vector3().subVectors(points[joint.index + 1], points[joint.index]).normalize();
        const bendAxis = perpendicular(axis).applyAxisAngle(axis, azimuthStart + child * 2.39996 + rng.range(-0.4, 0.4));
        const childHeading = axis.clone().applyAxisAngle(bendAxis, species.angle[depth] * rng.range(0.75, 1.2));
        const outward = new THREE.Vector3(joint.position.x - base.x, 0, joint.position.z - base.z);
        if (outward.lengthSq() > 1e-4) childHeading.addScaledVector(outward.normalize(), species.spread[depth + 1] ?? 0);
        childHeading.normalize();
        const childLength = species.length[depth + 1] * scale * rng.range(0.75, 1.2) * (1 - 0.3 * along * (depth > 0 ? 1 : 0));
        const childRadius = Math.max(0.006, THREE.MathUtils.lerp(radius, tipRadius, along) * species.radiusRatio[depth] * rng.range(0.85, 1.1));
        grow(joint.position, childHeading, childLength, childRadius, depth + 1, joint.flex);
      }
    }

    if (species.foliage === "pads") {
      if (depth === species.depth || (depth === species.depth - 1 && rng.next() < 0.4)) sprigs.push({ position: cursor.clone(), flex: flex[steps] });
      return;
    }
    if (depth < species.leafDepth) return;
    const spacing = species.clusterStep * scale;
    for (let distance = length * 0.25; distance <= length; distance += spacing * rng.range(0.7, 1.3)) {
      const { position, flex: sprigFlex } = sample(distance / length);
      sprigs.push({ position, flex: sprigFlex });
    }
    sprigs.push({ position: cursor.clone(), flex: flex[steps] });
  };

  const trunkHeading = UP.clone().addScaledVector(leanDirection, species.foliage === "pads" ? 0.3 : 0.12).normalize();
  grow(base.clone(), trunkHeading, species.length[0] * scale * rng.range(0.9, 1.15), species.radius * scale, 0, 0);
  return { branches, sprigs };
};

/** Parallel-transport tubes with a flared, buttressed trunk foot. `aWind` = (flex, phase). */
const barkGeometry = (branches: Branch[], base: THREE.Vector3, minRadius: number): THREE.BufferGeometry | undefined => {
  const kept = branches.filter((branch) => branch.depth === 0 || branch.radii[0] >= minRadius);
  if (!kept.length) return undefined;
  const sides = kept.map((branch) => {
    const radius = branch.radii[0];
    return radius > 0.2 ? 10 : radius > 0.09 ? 7 : radius > 0.035 ? 4 : 3;
  });
  let vertexCount = 0;
  let indexCount = 0;
  kept.forEach((branch, index) => {
    vertexCount += (sides[index] + 1) * branch.points.length;
    indexCount += sides[index] * (branch.points.length - 1) * 6;
  });
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const wind = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(indexCount);
  const tangent = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const binormal = new THREE.Vector3();
  const ahead = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const ring = new THREE.Vector3();
  let vertex = 0;
  let cursor = 0;
  kept.forEach((branch, branchIndex) => {
    const segments = sides[branchIndex];
    const count = branch.points.length;
    tangent.subVectors(branch.points[1], branch.points[0]).normalize();
    normal.copy(perpendicular(tangent));
    const repeats = Math.max(1, Math.round((TAU * branch.radii[0]) / 0.9));
    let travelled = 0;
    for (let point = 0; point < count; point += 1) {
      if (point > 0) {
        ahead.subVectors(branch.points[Math.min(count - 1, point + 1)], branch.points[point - 1]).normalize();
        axis.crossVectors(tangent, ahead);
        const sine = axis.length();
        if (sine > 1e-6) normal.applyAxisAngle(axis.normalize(), Math.asin(Math.min(1, sine)));
        tangent.copy(ahead);
        travelled += branch.points[point].distanceTo(branch.points[point - 1]);
      }
      binormal.crossVectors(tangent, normal).normalize();
      const centre = branch.points[point];
      const aboveBase = centre.y - base.y;
      for (let side = 0; side <= segments; side += 1) {
        const angle = (side / segments) * TAU;
        let radius = branch.radii[point];
        if (branch.depth === 0) {
          const flare = Math.exp(-Math.max(0, aboveBase) * 2.2);
          radius *= 1 + flare * (0.55 + 0.45 * Math.sin(angle * 5 + branchIndex)) * 0.9;
          radius *= 1 + 0.12 * (valueNoise(Math.cos(angle) * 2 + 7, travelled * 0.8 + Math.sin(angle) * 2) - 0.5);
        } else {
          radius *= 1 + 0.05 * Math.sin(angle * 3 + travelled * 2);
        }
        ring.copy(normal).multiplyScalar(Math.cos(angle)).addScaledVector(binormal, Math.sin(angle));
        positions[vertex * 3] = centre.x + ring.x * radius;
        positions[vertex * 3 + 1] = centre.y + ring.y * radius;
        positions[vertex * 3 + 2] = centre.z + ring.z * radius;
        normals[vertex * 3] = ring.x;
        normals[vertex * 3 + 1] = ring.y;
        normals[vertex * 3 + 2] = ring.z;
        uvs[vertex * 2] = (side / segments) * repeats;
        uvs[vertex * 2 + 1] = travelled / 1.1;
        wind[vertex * 2] = branch.flex[point];
        wind[vertex * 2 + 1] = branch.phase;
        vertex += 1;
      }
      if (point === count - 1) continue;
      const first = vertex - (segments + 1);
      for (let side = 0; side < segments; side += 1) {
        const a = first + side;
        const b = a + 1;
        const c = a + segments + 1;
        const d = c + 1;
        indices.set([a, b, c, b, d, c], cursor);
        cursor += 6;
      }
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute("aWind", new THREE.BufferAttribute(wind, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
};

type Card = {
  position: THREE.Vector3;
  normal: THREE.Vector3;
  rotation: number;
  size: number;
  cell: number;
  flex: number;
  phase: number;
  tint: [number, number, number];
  occlusion: number;
};

/**
 * Quads cut from a 2x2 atlas. Normals lean away from the crown centre so the canopy shades like
 * one soft volume; inner cards are darkened. `aWind` = (flex, phase, 1).
 */
const cardGeometry = (cards: Card[], centre: THREE.Vector3, radius: number): THREE.BufferGeometry => {
  const count = cards.length;
  const positions = new Float32Array(count * 12);
  const normals = new Float32Array(count * 12);
  const uvs = new Float32Array(count * 8);
  const wind = new Float32Array(count * 12);
  const colors = new Float32Array(count * 12);
  const indices = new Uint32Array(count * 6);
  const across = new THREE.Vector3();
  const upward = new THREE.Vector3();
  const outward = new THREE.Vector3();
  const bent = new THREE.Vector3();
  const corners: Array<[number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  cards.forEach((card, index) => {
    across.copy(perpendicular(card.normal)).applyAxisAngle(card.normal, card.rotation);
    upward.crossVectors(card.normal, across);
    outward.subVectors(card.position, centre);
    const distance = outward.length();
    outward.normalize();
    bent.copy(card.normal).multiplyScalar(0.3).addScaledVector(outward, 0.7).normalize();
    const shade = THREE.MathUtils.clamp(0.45 + 0.55 * (distance / radius), 0.35, 1) * card.occlusion;
    const [u0, v0] = atlasCell(card.cell, 2, 2);
    corners.forEach(([sx, sy], corner) => {
      const at = index * 4 + corner;
      positions[at * 3] = card.position.x + (across.x * sx + upward.x * sy) * card.size * 0.5;
      positions[at * 3 + 1] = card.position.y + (across.y * sx + upward.y * sy) * card.size * 0.5;
      positions[at * 3 + 2] = card.position.z + (across.z * sx + upward.z * sy) * card.size * 0.5;
      normals.set([bent.x, bent.y, bent.z], at * 3);
      uvs[at * 2] = u0 + (sx * 0.5 + 0.5) * 0.5;
      uvs[at * 2 + 1] = v0 + (sy * 0.5 + 0.5) * 0.5;
      wind.set([card.flex, card.phase, 1], at * 3);
      colors.set([card.tint[0] * shade, card.tint[1] * shade, card.tint[2] * shade], at * 3);
    });
    indices.set([index * 4, index * 4 + 1, index * 4 + 2, index * 4, index * 4 + 2, index * 4 + 3], index * 6);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute("aWind", new THREE.BufferAttribute(wind, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
};

export const glsl = (value: number): string => value.toFixed(3);

/** Keeps alpha-tested cards from thinning out in the distance as mip levels average their alpha away. */
export const ALPHA_COVERAGE = /* glsl */ `
#ifdef USE_MAP
{
  vec2 texel = vMapUv * vec2(textureSize(map, 0));
  vec2 ddx = dFdx(texel);
  vec2 ddy = dFdy(texel);
  float mip = max(0.0, 0.5 * log2(max(dot(ddx, ddx), dot(ddy, ddy))));
  diffuseColor.a *= 1.0 + mip * 0.25;
}
#endif`;

const barkMaterial = (slug: SurfaceSlug, key: string, tint: THREE.ColorRepresentation): THREE.MeshStandardMaterial => {
  const maps = surfaceMaps(slug);
  const material = new THREE.MeshStandardMaterial({ map: maps.map, normalMap: maps.normalMap, color: tint, roughness: 0.95, metalness: 0 });
  material.normalScale.set(1.4, 1.4);
  return withGlobals(material, `bark-${key}`, (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 aWind;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
  vec3 windBase = (modelMatrix * vec4(transformed, 1.0)).xyz;
  float windFlex = aWind.x;
  transformed += windSway(windBase, 0.018 * windFlex * windFlex + 0.004 * windFlex, aWind.y) * min(windFlex, 6.0) * 0.16;`
      );
  });
};

type LeafLook = { translucency: number; flutter: number; roughness: number; warm?: string; glow?: number };

export const leafMaterial = (map: THREE.Texture, key: string, look: LeafLook): THREE.MeshStandardMaterial => {
  const material = new THREE.MeshStandardMaterial({ map, vertexColors: true, alphaTest: 0.42, side: THREE.DoubleSide, roughness: look.roughness, metalness: 0 });
  material.shadowSide = THREE.DoubleSide;
  return withGlobals(material, `leaf-${key}`, (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 aWind;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
  vec3 windBase = (modelMatrix * vec4(transformed, 1.0)).xyz;
  float windFlex = aWind.x;
  vec3 sway = windSway(windBase, 0.018 * windFlex * windFlex + 0.004 * windFlex, aWind.y);
  vec3 flutter = vec3(
    sin(uTime * 5.3 + aWind.y * 7.0 + windBase.x),
    sin(uTime * 4.1 + aWind.y * 5.0),
    cos(uTime * 6.1 + aWind.y * 3.0 + windBase.z)
  ) * ${glsl(0.045 * look.flutter)} * windGust(windBase);
  transformed += sway * min(windFlex, 8.0) * 0.16 + flutter;`
      );
    let fragment = after(shader.fragmentShader, "map_fragment", ALPHA_COVERAGE);
    fragment = after(fragment, "normal_fragment_begin", "normal = normalize(vNormal);");
    fragment = after(
      fragment,
      "lights_fragment_begin",
      `{
  ${TRANSLUCENCY}
  reflectedLight.directDiffuse += sunC * diffuseColor.rgb * (sunBack * 2.4 + sunWrap * 0.35) * ${glsl(look.translucency)};
}`
    );
    if (look.warm || look.glow) {
      fragment = after(
        fragment,
        "lights_fragment_end",
        `reflectedLight.indirectDiffuse = reflectedLight.indirectDiffuse * ${look.warm ?? "1.0"} + diffuseColor.rgb * ${glsl(look.glow ?? 0)};`
      );
    }
    shader.fragmentShader = fragment;
  });
};

type TreeMaterials = Record<"sakuraBark" | "pineBark" | "blossom" | "maple" | "needle", THREE.MeshStandardMaterial>;
let materials: TreeMaterials | undefined;

const treeMaterials = (): TreeMaterials => {
  materials ??= {
    sakuraBark: barkMaterial(SURFACES.sakuraBark, "sakura", 0xd8d2d4),
    pineBark: barkMaterial(SURFACES.cedarBark, "pine", 0xc4bcb6),
    blossom: leafMaterial(sakuraClusterTexture(), "blossom", { translucency: 1.3, flutter: 1, roughness: 0.72, warm: "vec3(1.12, 0.96, 0.92)", glow: 0.12 }),
    maple: leafMaterial(mapleClusterTexture(), "maple", { translucency: 0.85, flutter: 1, roughness: 0.72 }),
    needle: leafMaterial(pineTuftTexture(), "needle", { translucency: 0.45, flutter: 0.5, roughness: 0.8 })
  };
  return materials;
};

export type TreePlacement = {
  kind: TreeKind;
  x: number;
  z: number;
  scale: number;
  /** Heading of the lean in radians around +Y (0 leans toward +X). */
  lean: number;
  /** 0..3, shifts the blossom shade. */
  variant: number;
};

export type PlantedTree = TreePlacement & { y: number; crown: THREE.Vector3; crownRadius: number; trunkRadius: number };

export type TreeBuild = { root: THREE.Group; trees: PlantedTree[]; triangles: number; dispose: () => void };

export type TreeBuildOptions = {
  /** Side of the square cells whose trees merge into one mesh per material. */
  chunk?: number;
  /** Twigs thinner than this are left to the foliage cards. */
  minTwigRadius?: number;
};

const BLOSSOM_TINTS: Array<[number, number, number]> = [[1, 0.92, 0.94], [1, 0.95, 0.97], [1, 0.92, 0.94], [1, 0.86, 0.9]];

const foliageCards = (species: Species, skeleton: Skeleton, placement: TreePlacement, rng: Rng, centre: THREE.Vector3): Card[] => {
  const cards: Card[] = [];
  const { scale } = placement;
  if (species.foliage === "pads") {
    for (const sprig of skeleton.sprigs) {
      const padRadius = rng.range(1, 1.7) * scale;
      const thickness = rng.range(0.35, 0.55) * scale;
      const padCentre = sprig.position.clone().add(new THREE.Vector3(0, thickness * 0.6, 0));
      const count = Math.round(46 * padRadius * padRadius);
      for (let index = 0; index < count; index += 1) {
        const angle = rng.range(0, TAU);
        const reach = Math.sqrt(rng.next()) * padRadius;
        const position = padCentre.clone().add(new THREE.Vector3(
          Math.cos(angle) * reach,
          rng.range(-0.5, 0.6) * thickness * (1 - (reach / padRadius) * 0.6),
          Math.sin(angle) * reach
        ));
        const normal = new THREE.Vector3(rng.range(-0.5, 0.5), 1, rng.range(-0.5, 0.5))
          .add(new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar((reach / padRadius) * 0.6))
          .normalize();
        const height = (position.y - padCentre.y) / thickness;
        cards.push({
          position,
          normal,
          rotation: rng.range(0, TAU),
          size: rng.range(0.55, 0.85) * scale,
          cell: rng.int(0, 3),
          flex: sprig.flex + 1.5,
          phase: rng.range(0, TAU),
          tint: [0.85 + 0.3 * height, 0.95 + 0.25 * height, 0.8 + 0.2 * height],
          occlusion: 0.75 + 0.25 * THREE.MathUtils.clamp(height + 0.5, 0, 1)
        });
      }
    }
    return cards;
  }
  const blossomTint = BLOSSOM_TINTS[placement.variant % BLOSSOM_TINTS.length];
  for (const sprig of skeleton.sprigs) {
    const count = rng.int(species.cards[0], species.cards[1]);
    for (let index = 0; index < count; index += 1) {
      const position = sprig.position.clone().add(new THREE.Vector3(rng.gauss(), rng.gauss() * 0.7, rng.gauss()).multiplyScalar(0.28 * scale));
      const outward = new THREE.Vector3().subVectors(position, centre).normalize();
      const normal = new THREE.Vector3(rng.range(-1, 1), rng.range(-0.3, 1), rng.range(-1, 1)).normalize()
        .addScaledVector(outward, 0.7)
        .addScaledVector(UP, 0.35)
        .normalize();
      const shade = rng.range(0.9, 1.05);
      const tint: [number, number, number] = species.foliage === "maple"
        ? [shade * 0.8, shade * 0.8 * rng.range(0.85, 1.05), shade * 0.8]
        : [blossomTint[0] * shade, blossomTint[1] * shade, blossomTint[2] * shade];
      cards.push({
        position,
        normal,
        rotation: rng.range(0, TAU),
        size: rng.range(species.cardSize[0], species.cardSize[1]) * scale,
        cell: rng.int(0, 3),
        flex: sprig.flex + 0.8,
        phase: rng.range(0, TAU),
        tint,
        occlusion: 1
      });
    }
  }
  return cards;
};

const seedFor = (placement: TreePlacement): number =>
  (Math.floor(placement.x * 73.13) * 92821) ^ (Math.floor(placement.z * 19.71) * 68917) ^ (placement.variant * 7919);

/** Grows every tree, merges them per material in square cells and returns what grew where. */
export const buildTrees = (placements: readonly TreePlacement[], options: TreeBuildOptions = {}): TreeBuild => {
  const chunk = options.chunk ?? 90;
  const minTwigRadius = options.minTwigRadius ?? 0.018;
  const palette = treeMaterials();
  const buckets = new Map<string, { material: THREE.MeshStandardMaterial; name: string; geometries: THREE.BufferGeometry[] }>();
  const add = (cell: string, name: string, material: THREE.MeshStandardMaterial, geometry: THREE.BufferGeometry): void => {
    const key = `${cell}|${name}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { material, name, geometries: [] };
      buckets.set(key, bucket);
    }
    bucket.geometries.push(geometry);
  };
  const trees: PlantedTree[] = [];
  for (const placement of placements) {
    const species = SPECIES[placement.kind];
    const rng = createRng(seedFor(placement));
    const y = groundHeight(placement.x, placement.z) - 0.15;
    const base = new THREE.Vector3(placement.x, y, placement.z);
    const skeleton = growSkeleton(species, base, placement.scale, placement.lean, rng);
    const cell = `${Math.floor(placement.x / chunk)}:${Math.floor(placement.z / chunk)}`;
    const bark = barkGeometry(skeleton.branches, base, minTwigRadius);
    const pine = species.foliage === "pads";
    if (bark) add(cell, pine ? "bark-pine" : "bark", pine ? palette.pineBark : palette.sakuraBark, bark);
    const centre = new THREE.Vector3();
    skeleton.sprigs.forEach((sprig) => centre.add(sprig.position));
    centre.multiplyScalar(1 / Math.max(1, skeleton.sprigs.length));
    let crownRadius = 0.1;
    skeleton.sprigs.forEach((sprig) => { crownRadius = Math.max(crownRadius, sprig.position.distanceTo(centre)); });
    const cards = foliageCards(species, skeleton, placement, rng, centre);
    if (cards.length) {
      const material = species.foliage === "pads" ? palette.needle : species.foliage === "maple" ? palette.maple : palette.blossom;
      add(cell, `foliage-${species.foliage}`, material, cardGeometry(cards, centre, crownRadius));
    }
    trees.push({ ...placement, y, crown: centre, crownRadius, trunkRadius: species.radius * placement.scale });
  }
  const root = new THREE.Group();
  root.name = "trees";
  let triangles = 0;
  const geometries: THREE.BufferGeometry[] = [];
  for (const bucket of buckets.values()) {
    const merged = bucket.geometries.length === 1 ? bucket.geometries[0] : mergeGeometries(bucket.geometries, false);
    if (!merged) continue;
    if (merged !== bucket.geometries[0]) bucket.geometries.forEach((geometry) => geometry.dispose());
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, bucket.material);
    mesh.name = bucket.name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    geometries.push(merged);
    triangles += (merged.index?.count ?? 0) / 3;
  }
  return {
    root,
    trees,
    triangles,
    dispose: () => geometries.forEach((geometry) => geometry.dispose())
  };
};
