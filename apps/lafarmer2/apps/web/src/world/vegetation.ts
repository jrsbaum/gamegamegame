import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { FARM_BOUNDARY } from "@lafarmer2/content";
import { atlasCell, createRng, fernTexture, forestTreeTexture, meadowFlowerTexture, shrubTexture, type Rng } from "./foliage";
import { bladeMaterial, bladeTuft, createGrassField } from "./grass";
import { MASK_RECT, sampleGroundMask } from "./groundMask";
import {
  BRIDGE,
  TILE,
  WATER_LEVEL,
  farmSignedDistance,
  fbm,
  groundHeight,
  groundNormal,
  pathMask,
  riverCenterTile,
  riverCenterWorld,
  riverHalfWidthTiles,
  tileToWorldX,
  tileToWorldZ,
  waterField,
  worldToTile
} from "./height";
import { LAYER_NO_REFLECT, TRANSLUCENCY, after, withGlobals } from "./shared";
import type { PetalSpot } from "./terrain";
import { ALPHA_COVERAGE, buildTrees, glsl, type PlantedTree } from "./trees";
import {
  forestLayout,
  insideClearing,
  petalSpotsFor,
  treeLayout,
  type Clearing,
  type ForestSite,
  type LayoutQuality,
  type TreeSite
} from "./vegetationLayout";

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
/** Side of the square cells ground cover is batched and culled by. */
const CELL = 30;

type Culled = { object: THREE.Object3D; centre: THREE.Vector3; reach: number };

type Instance = {
  x: number;
  y: number;
  z: number;
  rotation: number;
  scale: number;
  /** Extra vertical scale. */
  stretch: number;
  tint: [number, number, number];
  /** Atlas cell for cards that pick one per instance. */
  kind: number;
};

const EXITS: ReadonlyArray<readonly [number, number]> = [[3.5, 28.5], [1, 29.5], [76.5, 29.5]];

/* ---------------------------------------------------------------- distant forest */

const crossedPlanes = (planes: number, uWidth: number): THREE.BufferGeometry => {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let plane = 0; plane < planes; plane += 1) {
    const angle = (plane / planes) * Math.PI;
    const dx = Math.cos(angle) * 0.5;
    const dz = Math.sin(angle) * 0.5;
    const first = plane * 4;
    positions.push(-dx, 0, -dz, dx, 0, dz, dx, 1, dz, -dx, 1, -dz);
    for (let corner = 0; corner < 4; corner += 1) normals.push(-Math.sin(angle), 0, Math.cos(angle));
    uvs.push(0, 0, uWidth, 0, uWidth, 1, 0, 1);
    indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
};

const VARIANT_UV = /* glsl */ `#include <uv_vertex>
#ifdef USE_MAP
  vMapUv.x += aVariant * 0.25;
#endif`;

/** Crossed cards shaded as one rounded canopy: the normal follows the card position, not its plane. */
const forestMaterial = (map: THREE.Texture): THREE.MeshStandardMaterial => {
  const material = new THREE.MeshStandardMaterial({ map, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.92, metalness: 0 });
  return withGlobals(material, "forest", (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aVariant;\nvarying float vCanopy;")
      .replace("#include <uv_vertex>", VARIANT_UV)
      .replace("#include <beginnormal_vertex>", "vec3 objectNormal = normalize(vec3(position.x * 1.8, 0.45 + position.y * 0.35, position.z * 1.8));")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
  vec3 forestRoot = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  transformed.xz += windSway(forestRoot, 0.02, aVariant * 3.0 + forestRoot.x * 0.1).xz * position.y * position.y * 1.5;
  vCanopy = position.y;`
      );
    let fragment = shader.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vCanopy;");
    fragment = after(fragment, "map_fragment", `${ALPHA_COVERAGE}\n  diffuseColor.rgb *= mix(0.5, 1.0, smoothstep(0.0, 0.8, vCanopy));`);
    fragment = after(fragment, "normal_fragment_begin", "normal = normalize(vNormal);");
    fragment = after(
      fragment,
      "lights_fragment_begin",
      `{
  ${TRANSLUCENCY}
  reflectedLight.directDiffuse += sunC * diffuseColor.rgb * sunBack * 0.8 * vCanopy;
}`
    );
    shader.fragmentShader = fragment;
  });
};

const forestDepthMaterial = (map: THREE.Texture): THREE.MeshDepthMaterial => {
  const material = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.45, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aVariant;")
      .replace("#include <uv_vertex>", VARIANT_UV);
  };
  material.customProgramCacheKey = () => "forest-depth";
  return material;
};

type Part = { root: THREE.Group; culled: Culled[]; dispose: () => void };

const createForest = (sites: ReadonlyArray<ForestSite>): Part => {
  const root = new THREE.Group();
  root.name = "forest";
  if (!sites.length) return { root, culled: [], dispose: () => undefined };
  const map = forestTreeTexture();
  const material = forestMaterial(map);
  const depth = forestDepthMaterial(map);
  const base = crossedPlanes(3, 0.25);
  const chunks = new Map<string, ForestSite[]>();
  for (const site of sites) {
    const key = `${Math.floor(site.x / 300)}:${Math.floor(site.z / 300)}`;
    const group = chunks.get(key);
    if (group) group.push(site);
    else chunks.set(key, [site]);
  }
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  const geometries: THREE.BufferGeometry[] = [];
  for (const group of chunks.values()) {
    const geometry = base.clone();
    const variants = new Float32Array(group.length);
    const mesh = new THREE.InstancedMesh(geometry, material, group.length);
    group.forEach((site, index) => {
      const r = site.seed;
      const height = site.broadleaf ? 8 * site.scale + r * 4 : 11 * site.scale + r * 7;
      const width = site.broadleaf ? height * (0.85 + r * 0.3) : height * (0.3 + r * 0.14);
      position.set(site.x, site.y - 0.4, site.z);
      rotation.setFromAxisAngle(UP, r * TAU);
      scale.set(width, height, width);
      mesh.setMatrixAt(index, matrix.compose(position, rotation, scale));
      variants[index] = site.broadleaf ? (site.blossom ? 3 : 2) : r < 0.5 ? 0 : 1;
      const tone = 0.7 + 0.45 * ((r * 7.13) % 1);
      mesh.setColorAt(index, color.setRGB(tone * 0.95, tone, tone * 0.88));
    });
    geometry.setAttribute("aVariant", new THREE.InstancedBufferAttribute(variants, 1));
    mesh.customDepthMaterial = depth;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    mesh.name = "forest";
    root.add(mesh);
    geometries.push(geometry);
  }
  return {
    root,
    culled: [],
    dispose: () => {
      geometries.forEach((geometry) => geometry.dispose());
      base.dispose();
      material.dispose();
      depth.dispose();
      map.dispose();
    }
  };
};

/* ---------------------------------------------------------------- instanced ground cover */

const cellOf = (x: number, z: number): string => `${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`;

/** One InstancedMesh per cell; `kinds` adds a per-instance atlas cell attribute (`aKind`). */
const instancedCells = (
  name: string,
  instances: ReadonlyArray<Instance>,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  cullDistance: number,
  options: { kinds?: boolean; layer?: number; castShadow?: boolean } = {}
): Part => {
  const root = new THREE.Group();
  root.name = name;
  const cells = new Map<string, Instance[]>();
  for (const instance of instances) {
    const key = cellOf(instance.x, instance.z);
    const group = cells.get(key);
    if (group) group.push(instance);
    else cells.set(key, [instance]);
  }
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  const culled: Culled[] = [];
  const owned: THREE.BufferGeometry[] = [];
  for (const group of cells.values()) {
    const cellGeometry = options.kinds ? geometry.clone() : geometry;
    if (cellGeometry !== geometry) owned.push(cellGeometry);
    const mesh = new THREE.InstancedMesh(cellGeometry, material, group.length);
    const kinds = new Float32Array(group.length);
    const centre = new THREE.Vector3();
    group.forEach((instance, index) => {
      position.set(instance.x, instance.y, instance.z);
      rotation.setFromAxisAngle(UP, instance.rotation);
      scale.set(instance.scale, instance.scale * instance.stretch, instance.scale);
      mesh.setMatrixAt(index, matrix.compose(position, rotation, scale));
      mesh.setColorAt(index, color.setRGB(instance.tint[0], instance.tint[1], instance.tint[2]));
      kinds[index] = instance.kind;
      centre.add(position);
    });
    if (options.kinds) cellGeometry.setAttribute("aKind", new THREE.InstancedBufferAttribute(kinds, 1));
    centre.multiplyScalar(1 / group.length);
    mesh.computeBoundingSphere();
    if (mesh.boundingSphere) mesh.boundingSphere.radius += 2;
    mesh.name = name;
    mesh.receiveShadow = true;
    mesh.castShadow = options.castShadow ?? false;
    mesh.layers.set(options.layer ?? LAYER_NO_REFLECT);
    root.add(mesh);
    culled.push({ object: mesh, centre, reach: cullDistance + CELL * 0.75 });
  }
  return {
    root,
    culled,
    dispose: () => {
      owned.forEach((item) => item.dispose());
      geometry.dispose();
      if (material instanceof THREE.Material) material.dispose();
    }
  };
};

const onBridge = (x: number, z: number, margin: number): boolean =>
  x > BRIDGE.x0 - margin && x < BRIDGE.x1 + margin && z > BRIDGE.z0 - margin && z < BRIDGE.z1 + margin;

/** Reed beds on the wet margin of the river, some standing in the shallows. */
const scatterReeds = (target: number, clearings: ReadonlyArray<Clearing>): Instance[] => {
  const rng = createRng(3131);
  const instances: Instance[] = [];
  for (let attempt = 0; attempt < target * 6 && instances.length < target; attempt += 1) {
    const z = rng.range(MASK_RECT.z0, MASK_RECT.z0 + MASK_RECT.depth);
    const ty = worldToTile(0, z).y;
    const x = riverCenterWorld(z) + rng.sign() * (riverHalfWidthTiles(ty) * TILE + rng.range(-1.6, 1.4));
    const tile = worldToTile(x, z);
    const field = waterField(tile.x, tile.y);
    if (field < 0.06 || field > 0.62) continue;
    const y = groundHeight(x, z);
    if (y > WATER_LEVEL + 0.7 || onBridge(x, z, 3) || pathMask(tile.x, tile.y) > 0.1) continue;
    if (fbm(x * 0.07, z * 0.07, 2) < 0.42 || insideClearing(x, z, clearings, 1)) continue;
    const tone = rng.range(0.85, 1.15);
    instances.push({
      x,
      y: Math.max(y, WATER_LEVEL - 0.35),
      z,
      rotation: rng.range(0, TAU),
      scale: rng.range(0.8, 1.3),
      stretch: 1,
      tint: [tone, tone, tone * 0.95],
      kind: 0
    });
  }
  return instances;
};

/* ---------------------------------------------------------------- meadow flowers */

const crossedCards = (size: number): THREE.BufferGeometry => {
  const cards = [0, Math.PI / 2].map((angle) => {
    const card = new THREE.PlaneGeometry(size, size);
    card.translate(0, size / 2, 0);
    card.rotateY(angle);
    return card;
  });
  const merged = mergeGeometries(cards, false);
  cards.forEach((card) => card.dispose());
  if (!merged) throw new Error("flower cards failed to merge");
  return merged;
};

/** Alpha-tested cards that sway from the root, fade out with distance and avoid bare ground. */
const cardMaterial = (
  key: string,
  map: THREE.Texture,
  options: { cells: number; fade: [number, number]; sway: number; brightness: number; translucency: number }
): THREE.MeshLambertMaterial => {
  const material = new THREE.MeshLambertMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, color: new THREE.Color(options.brightness, options.brightness, options.brightness) });
  return withGlobals(material, `cards-${key}`, (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aKind;")
      .replace("#include <uv_vertex>", `#include <uv_vertex>
#ifdef USE_MAP
  vMapUv.x = (vMapUv.x + aKind) / ${glsl(options.cells)};
#endif`)
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
  vec3 cardRoot = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float keep = (1.0 - smoothstep(${glsl(options.fade[0])}, ${glsl(options.fade[1])}, distance(cardRoot, cameraPosition)))
    * (1.0 - smoothstep(0.25, 0.7, groundMaskAt(cardRoot.xz).b));
  float lift = clamp(position.y * 2.0 + length(position.xz) * 0.8, 0.0, 1.5);
  vec3 sway = windSway(cardRoot, ${glsl(options.sway)}, cardRoot.x * 3.0) * lift * lift;
  transformed = (transformed + inverse(mat3(instanceMatrix)) * sway) * keep;`
      );
    let fragment = after(shader.fragmentShader, "map_fragment", ALPHA_COVERAGE);
    fragment = after(fragment, "normal_fragment_begin", "normal = normalize(vNormal);");
    fragment = after(
      fragment,
      "lights_fragment_begin",
      `{
  ${TRANSLUCENCY}
  reflectedLight.directDiffuse += sunC * diffuseColor.rgb * (sunBack * 1.4 + 0.15) * ${glsl(options.translucency)};
}`
    );
    shader.fragmentShader = fragment;
  });
};

const scatterFlowers = (target: number, clearings: ReadonlyArray<Clearing>): Instance[] => {
  const rng = createRng(5151);
  const instances: Instance[] = [];
  for (let attempt = 0; attempt < target * 12 && instances.length < target; attempt += 1) {
    const x = rng.range(MASK_RECT.x0, MASK_RECT.x0 + MASK_RECT.width);
    const z = rng.range(MASK_RECT.z0, MASK_RECT.z0 + MASK_RECT.depth);
    const tile = worldToTile(x, z);
    if (farmSignedDistance(tile.x, tile.y) > 1.5) continue;
    const patch = fbm(x * 0.08 + 9, z * 0.08, 2);
    if (patch < 0.5) continue;
    const y = groundHeight(x, z);
    if (y < WATER_LEVEL + 0.25 || sampleGroundMask(x, z).bare > 0.2 || insideClearing(x, z, clearings, 0.5)) continue;
    instances.push({
      x,
      y: y - 0.02,
      z,
      rotation: rng.range(0, TAU),
      scale: rng.range(0.7, 1.3),
      stretch: 1,
      tint: [1, 1, 1],
      kind: patch > 0.62 ? 2 : rng.next() < 0.5 ? 0 : 1
    });
  }
  return instances;
};

/* ---------------------------------------------------------------- ferns */

/** Six arching fronds around a crown; `aKind` picks the frond drawing. */
const fernRosette = (rng: Rng): THREE.BufferGeometry => {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const fronds = 6;
  for (let frond = 0; frond < fronds; frond += 1) {
    const angle = (frond / fronds) * TAU + rng.range(-0.25, 0.25);
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const length = rng.range(0.75, 1.05);
    const halfWidth = length * 0.24;
    const [u0, , cellWidth] = atlasCell(frond % 2, 2, 1);
    const first = positions.length / 3;
    for (let row = 0; row <= 2; row += 1) {
      const t = row / 2;
      const reach = t * length * 0.9;
      const height = Math.sin(t * Math.PI * 0.75) * 0.55 * length;
      const cx = dx * reach;
      const cz = dz * reach;
      positions.push(cx - dz * halfWidth, height, cz + dx * halfWidth, cx + dz * halfWidth, height, cz - dx * halfWidth);
      const lean = 1 - t;
      normals.push(dx * 0.4 * lean, 1, dz * 0.4 * lean, dx * 0.4 * lean, 1, dz * 0.4 * lean);
      uvs.push(u0, t, u0 + cellWidth, t);
      if (row < 2) {
        const a = first + row * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
};

/** Ferns crowd the foot of the trees and the shaded forest floor just outside the farm. */
const scatterFerns = (trees: ReadonlyArray<TreeSite>, clearings: ReadonlyArray<Clearing>, density: number): Instance[] => {
  const rng = createRng(6161);
  const instances: Instance[] = [];
  const accept = (x: number, z: number, scale: number): void => {
    const y = groundHeight(x, z);
    if (y < WATER_LEVEL + 0.2 || groundNormal(x, z, 0.8).y < 0.7) return;
    if (sampleGroundMask(x, z).bare > 0.3 || insideClearing(x, z, clearings, 0.5)) return;
    const tone = rng.range(0.85, 1.1);
    instances.push({ x, y: y - 0.05, z, rotation: rng.range(0, TAU), scale, stretch: rng.range(0.85, 1.15), tint: [tone, tone, tone * 0.95], kind: 0 });
  };
  for (const tree of trees) {
    const obstacle = tree.role === "obstacle";
    const count = Math.round((obstacle ? rng.int(2, 3) : rng.int(3, 7)) * density);
    for (let index = 0; index < count; index += 1) {
      const angle = rng.range(0, TAU);
      const reach = obstacle ? rng.range(0.6, 1.2) : rng.range(1.5, 5);
      accept(tree.x + Math.cos(angle) * reach, tree.z + Math.sin(angle) * reach, rng.range(0.9, 1.7));
    }
  }
  const floorTarget = Math.round(900 * density);
  for (let attempt = 0; attempt < floorTarget * 6 && instances.length < floorTarget; attempt += 1) {
    const x = rng.range(MASK_RECT.x0, MASK_RECT.x0 + MASK_RECT.width);
    const z = rng.range(MASK_RECT.z0, MASK_RECT.z0 + MASK_RECT.depth);
    const tile = worldToTile(x, z);
    const outside = farmSignedDistance(tile.x, tile.y);
    if (outside < 0.4 || outside > 6 || fbm(x * 0.06 - 3, z * 0.06, 2) < 0.48) continue;
    accept(x, z, rng.range(0.9, 1.9));
  }
  return instances;
};

/* ---------------------------------------------------------------- shrubs */

type Bush = { x: number; z: number; radius: number; flowering: boolean };

/** Azalea and box bushes hedging the farm boundary from the outside. */
const scatterShrubs = (clearings: ReadonlyArray<Clearing>, density: number): Bush[] => {
  const rng = createRng(7171);
  const bushes: Bush[] = [];
  FARM_BOUNDARY.forEach(([ax, ay], index) => {
    const [bx, by] = FARM_BOUNDARY[(index + 1) % FARM_BOUNDARY.length];
    const length = Math.hypot(bx - ax, by - ay);
    const nx = (by - ay) / length;
    const ny = -(bx - ax) / length;
    for (let along = rng.range(0.5, 2); along < length; along += rng.range(1.6, 3.2) / density) {
      const px = ax + ((bx - ax) * along) / length;
      const py = ay + ((by - ay) * along) / length;
      const offset = rng.range(0.25, 1.4);
      let tx = px + nx * offset;
      let ty = py + ny * offset;
      if (farmSignedDistance(tx, ty) < 0) {
        tx = px - nx * offset;
        ty = py - ny * offset;
      }
      if (farmSignedDistance(tx, ty) < 0.15 || Math.abs(tx - riverCenterTile(ty)) < 3.5) continue;
      if (EXITS.some(([ex, ey]) => Math.hypot(tx - ex, ty - ey) < 3.5)) continue;
      if (fbm(tx * 0.3, ty * 0.3, 2) < 0.38) continue;
      const x = tileToWorldX(tx);
      const z = tileToWorldZ(ty);
      if (insideClearing(x, z, clearings, 1.5)) continue;
      bushes.push({ x, z, radius: rng.range(0.7, 1.3), flowering: rng.next() < 0.55 });
    }
  });
  return bushes;
};

/** Leaf cards on a squashed hemisphere per bush, merged per 90-unit cell. */
const bushGeometry = (bushes: ReadonlyArray<Bush>, rng: Rng): THREE.BufferGeometry => {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const direction = new THREE.Vector3();
  const across = new THREE.Vector3();
  const upward = new THREE.Vector3();
  const centre = new THREE.Vector3();
  const card = new THREE.Vector3();
  for (const bush of bushes) {
    const height = bush.radius * rng.range(0.6, 0.85);
    centre.set(bush.x, groundHeight(bush.x, bush.z) + height * 0.5, bush.z);
    const count = Math.round(70 * bush.radius * bush.radius);
    for (let index = 0; index < count; index += 1) {
      const y = rng.range(-1, 1);
      const angle = rng.range(0, TAU);
      const ring = Math.sqrt(1 - y * y);
      direction.set(Math.cos(angle) * ring, y < -0.3 ? -y * 0.3 : y, Math.sin(angle) * ring).normalize();
      card.set(direction.x * bush.radius, direction.y * height, direction.z * bush.radius).multiplyScalar(rng.range(0.75, 1)).add(centre);
      across.crossVectors(direction, Math.abs(direction.y) < 0.9 ? UP : new THREE.Vector3(1, 0, 0)).normalize().applyAxisAngle(direction, rng.range(0, TAU));
      upward.crossVectors(direction, across);
      const half = rng.range(0.45, 0.7) * 0.5;
      const [u0, v0, du, dv] = atlasCell(bush.flowering ? rng.int(2, 3) : rng.int(0, 1), 2, 2);
      const shade = 0.55 + 0.45 * THREE.MathUtils.clamp(direction.y * 0.5 + 0.5, 0, 1);
      const first = positions.length / 3;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        positions.push(card.x + (across.x * sx + upward.x * sy) * half, card.y + (across.y * sx + upward.y * sy) * half, card.z + (across.z * sx + upward.z * sy) * half);
        normals.push(direction.x, direction.y, direction.z);
        uvs.push(u0 + (sx * 0.5 + 0.5) * du, v0 + (sy * 0.5 + 0.5) * dv);
        colors.push(shade, shade, shade);
      }
      indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
};

const shrubMaterial = (map: THREE.Texture): THREE.MeshStandardMaterial => {
  const material = new THREE.MeshStandardMaterial({ map, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.62, metalness: 0, vertexColors: true });
  material.shadowSide = THREE.DoubleSide;
  return withGlobals(material, "shrub", (shader) => {
    let fragment = after(shader.fragmentShader, "map_fragment", ALPHA_COVERAGE);
    fragment = after(fragment, "normal_fragment_begin", "normal = normalize(vNormal);");
    fragment = after(
      fragment,
      "lights_fragment_begin",
      `{
  ${TRANSLUCENCY}
  reflectedLight.directDiffuse += sunC * diffuseColor.rgb * (sunBack * 1.2 + sunWrap * 0.2) * 0.6;
}`
    );
    shader.fragmentShader = fragment;
  });
};

const createShrubs = (bushes: ReadonlyArray<Bush>): Part => {
  const root = new THREE.Group();
  root.name = "shrubs";
  if (!bushes.length) return { root, culled: [], dispose: () => undefined };
  const map = shrubTexture();
  const material = shrubMaterial(map);
  const rng = createRng(8181);
  const cells = new Map<string, Bush[]>();
  for (const bush of bushes) {
    const key = `${Math.floor(bush.x / 90)}:${Math.floor(bush.z / 90)}`;
    const group = cells.get(key);
    if (group) group.push(bush);
    else cells.set(key, [bush]);
  }
  const geometries: THREE.BufferGeometry[] = [];
  for (const group of cells.values()) {
    const geometry = bushGeometry(group, rng);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "shrubs";
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    geometries.push(geometry);
  }
  return {
    root,
    culled: [],
    dispose: () => {
      geometries.forEach((geometry) => geometry.dispose());
      material.dispose();
      map.dispose();
    }
  };
};

/* ---------------------------------------------------------------- the whole valley */

export type VegetationOptions = {
  clearings?: ReadonlyArray<Clearing>;
  /** "low" halves the trees, thins the grass and drops the finest twigs. */
  quality?: LayoutQuality | string;
};

export type TrunkCollider = { x: number; z: number; radius: number };

export type Vegetation = {
  root: THREE.Group;
  sites: TreeSite[];
  trees: PlantedTree[];
  /** Crown centres of the flowering cherries, where falling petals come from. */
  blossomCrowns: THREE.Vector3[];
  colliders: TrunkCollider[];
  petalSpots: PetalSpot[];
  update: (time: number, camera: THREE.Camera) => void;
  dispose: () => void;
};

/**
 * Trees, the billboard forest, grass, reeds, flowers, ferns and shrubs of the valley.
 * Call `update` every frame so distant ground cover cells stop drawing.
 */
export const createVegetation = (options: VegetationOptions = {}): Vegetation => {
  const clearings = options.clearings ?? [];
  const quality: LayoutQuality = options.quality === "low" ? "low" : "high";
  const low = quality === "low";
  const sites = treeLayout(clearings, quality);
  const root = new THREE.Group();
  root.name = "vegetation";

  const trees = buildTrees(sites, { minTwigRadius: low ? 0.03 : 0.018 });
  root.add(trees.root);

  const grass = createGrassField({ trees: sites, clearings, density: low ? 2.5 : 7 });
  root.add(grass.root);

  const rng = createRng(9191);
  const parts: Part[] = [
    createForest(forestLayout(sites, clearings, low ? 5000 : 12000)),
    instancedCells(
      "reeds",
      scatterReeds(low ? 900 : 2400, clearings),
      bladeTuft(12, rng, 2.4, 0.8),
      bladeMaterial("reed", { base: new THREE.Color(0.06, 0.07, 0.03), tip: new THREE.Color(0.42, 0.4, 0.16), fade: [60, 90], respectMask: false, translucency: 0.8 }),
      90
    ),
    instancedCells(
      "flowers",
      scatterFlowers(low ? 2000 : 6000, clearings),
      crossedCards(0.34),
      cardMaterial("flowers", meadowFlowerTexture(), { cells: 3, fade: [35, 55], sway: 0.25, brightness: 1.25, translucency: 0.6 }),
      55,
      { kinds: true }
    ),
    instancedCells(
      "ferns",
      scatterFerns(sites, clearings, low ? 0.5 : 1),
      fernRosette(rng),
      cardMaterial("ferns", fernTexture(), { cells: 1, fade: [55, 80], sway: 0.18, brightness: 1.15, translucency: 1 }),
      80
    ),
    createShrubs(scatterShrubs(clearings, low ? 0.6 : 1))
  ];
  parts.forEach((part) => root.add(part.root));
  const culled = parts.flatMap((part) => part.culled);

  const blossomCrowns = trees.trees.filter((tree) => tree.kind === "sakura" || tree.kind === "weeping").map((tree) => tree.crown.clone());
  const colliders = sites.map((site) => ({ x: site.x, z: site.z, radius: site.collider * site.scale }));
  const cameraPosition = new THREE.Vector3();

  const update = (_time: number, camera: THREE.Camera): void => {
    camera.getWorldPosition(cameraPosition);
    for (const item of culled) item.object.visible = item.centre.distanceTo(cameraPosition) < item.reach;
    grass.update(camera);
  };

  const dispose = (): void => {
    trees.dispose();
    grass.dispose();
    parts.forEach((part) => part.dispose());
  };

  return { root, sites, trees: trees.trees, blossomCrowns, colliders, petalSpots: petalSpotsFor(sites), update, dispose };
};

export { petalSpotsFor, treeLayout, type Clearing, type TreeSite } from "./vegetationLayout";
