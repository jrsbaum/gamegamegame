import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { SURFACES, surfaceMaps } from "./assets";
import { createRandom } from "./height";
import { surfaceMaterial, tintMaterial, worldUV } from "./materials";
import { after, withGlobals } from "./shared";

/*
 * Kit for the valley's Japanese buildings: pieces are added per material, already placed,
 * and merged into one mesh per material and landmark. Roofs follow the curved hip and
 * irimoya profiles of temple carpentry; walls are timber frames with plaster, planks and paper.
 */

export type ArchKey =
  | "timber" | "planks" | "lacquer" | "black" | "plaster" | "mud" | "stone" | "granite" | "rock"
  | "thatch" | "tiles" | "bronze" | "gold" | "paper" | "glow" | "noren" | "rope" | "shide" | "bamboo" | "chochin" | "fruit";

export type Tint = readonly [number, number, number];
const WHITE: Tint = [1, 1, 1];
const KEEP = new Set(["position", "normal", "uv", "color", "aRib"]);

export type Placement = { x?: number; y?: number; z?: number; rx?: number; ry?: number; rz?: number; s?: number | readonly [number, number, number] };

export const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Scales, rotates (X, Z, then Y) and moves a geometry in place. */
export const place = <T extends THREE.BufferGeometry>(geometry: T, t: Placement = {}): T => {
  const s = t.s ?? 1;
  if (typeof s === "number") {
    if (s !== 1) geometry.scale(s, s, s);
  } else geometry.scale(s[0], s[1], s[2]);
  if (t.rx) geometry.rotateX(t.rx);
  if (t.rz) geometry.rotateZ(t.rz);
  if (t.ry) geometry.rotateY(t.ry);
  geometry.translate(t.x ?? 0, t.y ?? 0, t.z ?? 0);
  return geometry;
};

export const box = (width: number, height: number, depth: number, t?: Placement): THREE.BufferGeometry => place(new THREE.BoxGeometry(width, height, depth), t);

export const cylinder = (top: number, bottom: number, height: number, segments: number, t?: Placement): THREE.BufferGeometry =>
  place(new THREE.CylinderGeometry(top, bottom, height, segments), t);

export const lathe = (profile: ReadonlyArray<readonly [number, number]>, segments: number, t?: Placement): THREE.BufferGeometry =>
  place(new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), segments), t);

/** Rectangular beam along a polyline; `width` is across and level, `height` is across and up. */
export const beam = (points: ReadonlyArray<THREE.Vector3>, width: number, height: number, up = new THREE.Vector3(0, 1, 0)): THREE.BufferGeometry => {
  const positions: number[] = [];
  const index: number[] = [];
  const count = points.length;
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();
  const lift = new THREE.Vector3();
  for (let i = 0; i < count; i += 1) {
    tangent.subVectors(points[Math.min(count - 1, i + 1)], points[Math.max(0, i - 1)]).normalize();
    side.crossVectors(tangent, up).normalize();
    lift.crossVectors(side, tangent).normalize();
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = points[i];
      positions.push(
        p.x + side.x * (a * width) / 2 + lift.x * (b * height) / 2,
        p.y + side.y * (a * width) / 2 + lift.y * (b * height) / 2,
        p.z + side.z * (a * width) / 2 + lift.z * (b * height) / 2
      );
    }
  }
  for (let i = 0; i < count - 1; i += 1) {
    for (let k = 0; k < 4; k += 1) {
      const a = i * 4 + k;
      const b = i * 4 + ((k + 1) % 4);
      index.push(a, a + 4, b, b, a + 4, b + 4);
    }
  }
  const last = (count - 1) * 4;
  index.push(0, 1, 2, 0, 2, 3, last, last + 2, last + 1, last, last + 3, last + 2);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  const flat = geometry.toNonIndexed();
  flat.computeVertexNormals();
  return flat;
};

/** Collects placed pieces per material and merges them into one mesh per material. */
export class Parts {
  private readonly groups = new Map<ArchKey, THREE.BufferGeometry[]>();
  private readonly random: () => number;

  constructor(seed = 9) {
    this.random = createRandom(seed);
  }

  /** `density` projects UVs at that many texture repeats per unit, in the piece's current space. */
  add(key: ArchKey, geometry: THREE.BufferGeometry, tint: Tint = WHITE, density = 0): void {
    const piece = geometry.index ? geometry.toNonIndexed() : geometry;
    if (!piece.getAttribute("normal")) piece.computeVertexNormals();
    if (density) worldUV(piece, density);
    const count = piece.getAttribute("position").count;
    if (!piece.getAttribute("uv")) piece.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    const jitter = 0.92 + this.random() * 0.16;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      colors[i * 3] = tint[0] * jitter;
      colors[i * 3 + 1] = tint[1] * jitter;
      colors[i * 3 + 2] = tint[2] * jitter;
    }
    piece.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    for (const name of Object.keys(piece.attributes)) if (!KEEP.has(name)) piece.deleteAttribute(name);
    const list = this.groups.get(key) ?? [];
    list.push(piece);
    this.groups.set(key, list);
  }

  /** Merges everything into `parent`; returns the meshes it created. */
  build(materials: ArchMaterials, parent: THREE.Object3D, name: string): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    for (const [key, list] of this.groups) {
      if (list.some((piece) => piece.getAttribute("aRib"))) {
        for (const piece of list) {
          if (!piece.getAttribute("aRib")) piece.setAttribute("aRib", new THREE.BufferAttribute(new Float32Array(piece.getAttribute("position").count * 3), 3));
        }
      }
      const merged = mergeGeometries(list, false);
      list.forEach((piece) => piece.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const mesh = new THREE.Mesh(merged, materials[key]);
      mesh.name = `${name}-${key}`;
      mesh.castShadow = key !== "glow" && key !== "shide";
      mesh.receiveShadow = true;
      parent.add(mesh);
      meshes.push(mesh);
    }
    this.groups.clear();
    return meshes;
  }
}

/** A local frame (building, wall) that places pieces before handing them to the Parts. */
export class Frame {
  constructor(readonly parts: Parts, readonly matrix = new THREE.Matrix4()) {}

  child(t: Placement): Frame {
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(t.x ?? 0, t.y ?? 0, t.z ?? 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(t.rx ?? 0, t.ry ?? 0, t.rz ?? 0, "YXZ")),
      new THREE.Vector3(1, 1, 1)
    );
    return new Frame(this.parts, this.matrix.clone().multiply(local));
  }

  /** UVs are projected in this frame, so textures follow the building's own axes. */
  add(key: ArchKey, geometry: THREE.BufferGeometry, tint: Tint = WHITE, density = 0): void {
    const piece = geometry.index ? geometry.toNonIndexed() : geometry;
    if (!piece.getAttribute("normal")) piece.computeVertexNormals();
    if (density) worldUV(piece, density);
    piece.applyMatrix4(this.matrix);
    this.parts.add(key, piece, tint);
  }

  point(x: number, y: number, z: number): THREE.Vector3 {
    return new THREE.Vector3(x, y, z).applyMatrix4(this.matrix);
  }
}

/* ------------------------------------------------------------------ materials */

export type ArchMaterials = Record<ArchKey, THREE.Material>;

const linear = (r: number, g: number, b: number): THREE.Color => new THREE.Color().setRGB(r, g, b);

/** Plain colour with the normal map of a surface set, for pale plaster the albedo map would tint. */
const detailed = (slug: (typeof SURFACES)[keyof typeof SURFACES], color: THREE.Color, roughness: number, key: string): THREE.MeshStandardMaterial => {
  const material = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, vertexColors: true, normalMap: surfaceMaps(slug).normalMap });
  material.normalScale.set(0.8, 0.8);
  return withGlobals(material, key);
};

/** Hongawara: round cover tiles over pan tiles, courses every 0.32 units down the slope. */
const tileMaterial = (): THREE.MeshStandardMaterial => {
  const maps = surfaceMaps(SURFACES.roofTiles);
  const material = new THREE.MeshStandardMaterial({
    color: linear(0.34, 0.36, 0.4),
    map: maps.map,
    normalMap: maps.normalMap,
    roughness: 0.5,
    metalness: 0.08,
    vertexColors: true
  });
  material.normalScale.set(0.35, 0.35);
  return withGlobals(material, "arch-tiles", (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 aRib;\nvarying vec3 vRib;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRib = aRib;");
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vRib;\nfloat gTileAO = 1.0;");
    shader.fragmentShader = after(shader.fragmentShader, "map_fragment", /* glsl */ `
      {
        float ph = vRib.x / 0.3;
        float f = fract(ph);
        float round = smoothstep(0.0, 0.08, f) * (1.0 - smoothstep(0.34, 0.42, f));
        float lip = smoothstep(0.9, 1.0, fract(vRib.y / 0.32));
        float fade = (1.0 - smoothstep(0.35, 0.7, fwidth(ph))) * vRib.z;
        gTileAO = mix(1.0, (0.62 + 0.38 * round) * (1.0 - lip * 0.35), fade);
        diffuseColor.rgb *= gTileAO;
        #ifdef USE_FOG
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.18, 0.1), smoothstep(0.62, 0.85, vnoise(vFogWP.xz * 0.9 + 3.0)) * 0.3 * vRib.z);
        #endif
      }`);
    shader.fragmentShader = after(shader.fragmentShader, "normal_fragment_maps", /* glsl */ `
      #ifdef USE_FOG
      {
        float ph = vRib.x / 0.3;
        float f = fract(ph);
        float fade = (1.0 - smoothstep(0.35, 0.7, fwidth(ph))) * vRib.z;
        float slope = f < 0.38 ? cos((f / 0.38) * 3.14159) : -0.35 * cos(((f - 0.38) / 0.62) * 3.14159);
        vec3 tx = dFdx(vFogWP);
        vec3 ty = dFdy(vFogWP);
        vec2 gr = vec2(dFdx(vRib.x), dFdy(vRib.x));
        vec3 acrossWorld = tx * gr.x + ty * gr.y;
        if (dot(acrossWorld, acrossWorld) > 1e-12) {
          vec3 across = normalize((viewMatrix * vec4(normalize(acrossWorld), 0.0)).xyz);
          normal = normalize(normal + across * slope * 0.55 * fade);
        }
      }
      #endif`);
    shader.fragmentShader = after(shader.fragmentShader, "aomap_fragment", "reflectedLight.indirectDiffuse *= gTileAO;");
  });
};

let shared: ArchMaterials | undefined;

/** One set for every landmark; materials are shared, never disposed per landmark. */
export const archMaterials = (): ArchMaterials => {
  if (shared) return shared;
  shared = {
    timber: surfaceMaterial(SURFACES.cedarPlanks, { color: linear(0.13, 0.12, 0.13), roughness: 1, vertexColors: true }),
    planks: surfaceMaterial(SURFACES.hinoki, { color: linear(0.62, 0.55, 0.48), vertexColors: true }),
    lacquer: surfaceMaterial(SURFACES.cedarPlanks, { color: linear(1.05, 0.2, 0.42), roughness: 0.62, vertexColors: true }),
    black: tintMaterial(linear(0.03, 0.026, 0.024), { roughness: 0.45, vertexColors: true }),
    plaster: detailed(SURFACES.plaster, linear(0.74, 0.71, 0.64), 0.92, "arch-plaster"),
    mud: surfaceMaterial(SURFACES.plaster, { color: linear(1.15, 1.42, 2), vertexColors: true }),
    stone: surfaceMaterial(SURFACES.stoneWall, { color: linear(0.82, 0.8, 0.76), vertexColors: true }),
    granite: surfaceMaterial(SURFACES.rock, { color: linear(1.25, 1.22, 1.15), vertexColors: true }),
    rock: surfaceMaterial(SURFACES.mossyRock, { vertexColors: true }),
    thatch: surfaceMaterial(SURFACES.thatch, { color: linear(1.6, 1.4, 1.15), vertexColors: true }),
    tiles: tileMaterial(),
    bronze: tintMaterial(linear(0.2, 0.25, 0.17), { metalness: 0.75, roughness: 0.42, vertexColors: true }),
    gold: tintMaterial(linear(0.72, 0.42, 0.12), { metalness: 0.9, roughness: 0.3, vertexColors: true }),
    paper: tintMaterial(linear(0.84, 0.78, 0.64), { roughness: 0.9, side: THREE.DoubleSide, nightGlow: linear(1, 0.62, 0.3), glowStrength: 1.4, vertexColors: true }),
    glow: tintMaterial(linear(0.92, 0.8, 0.6), { roughness: 0.9, nightGlow: linear(1, 0.55, 0.22), glowStrength: 4.5, vertexColors: true }),
    noren: tintMaterial(linear(0.018, 0.03, 0.09), { roughness: 0.95, side: THREE.DoubleSide, vertexColors: true }),
    rope: tintMaterial(linear(0.42, 0.33, 0.18), { roughness: 1, vertexColors: true }),
    shide: tintMaterial(linear(0.9, 0.88, 0.84), { roughness: 0.9, side: THREE.DoubleSide, vertexColors: true }),
    bamboo: surfaceMaterial(SURFACES.bamboo, { vertexColors: true }),
    chochin: tintMaterial(linear(0.55, 0.08, 0.04), { roughness: 0.85, side: THREE.DoubleSide, nightGlow: linear(1, 0.3, 0.1), glowStrength: 3.2, vertexColors: true }),
    fruit: tintMaterial(linear(1, 1, 1), { roughness: 0.45, vertexColors: true })
  };
  return shared;
};

/* ------------------------------------------------------------------ roofs */

export type RoofSpec = {
  /** Walls the roof covers, eaves excluded. */
  width: number;
  depth: number;
  /** Ridge above the eave line. */
  height: number;
  eave: number;
  /** Upturn of the eaves, strongest at the corners (sori). */
  lift?: number;
  irimoya?: boolean;
  /** Share of the half width taken by the gable of an irimoya roof. */
  gableRatio?: number;
  /** Slope profile: 1 straight, above 1 concave. */
  curve?: number;
  /** Eave thickness; thatch is thick. */
  thickness?: number;
  /** Grid spacing of the surface. */
  res?: number;
  cover: "tiles" | "thatch";
  fascia: ArchKey;
  rafters?: boolean;
};

export type RoofResult = { cornerTips: THREE.Vector3[]; peak: number };

type RoofPoint = { x: number; y: number; z: number; rib: number; down: number };

const roofSurface = (spec: RoofSpec): ((u: number, v: number) => RoofPoint) => {
  const hx = spec.width / 2 + spec.eave;
  const hz = spec.depth / 2 + spec.eave;
  const gable = spec.irimoya ? (spec.width / 2) * (spec.gableRatio ?? 0.55) : 0;
  const ridge = spec.irimoya ? gable : Math.max(0, (spec.width - spec.depth) / 2);
  const hipTop = spec.height * 0.52;
  const curve = spec.curve ?? 1.42;
  const lift = spec.lift ?? 0.55;
  return (u, v) => {
    const x = -hx + 2 * hx * u;
    const z = -hz + 2 * hz * v;
    const across = Math.abs(z) / hz;
    const along = Math.max(0, Math.abs(x) - ridge) / (hx - ridge);
    const main = spec.height * Math.pow(1 - across, curve);
    let y = spec.irimoya
      ? Math.abs(x) <= gable ? main : Math.min(main, hipTop * Math.pow(1 - along, curve))
      : spec.height * Math.pow(1 - Math.max(across, along), curve);
    const edge = Math.max(across, along);
    const corner = Math.min(across, along);
    y += lift * smoothstep(0.6, 1, edge) * (0.3 + 1.1 * smoothstep(0.5, 1, corner));
    const flare = 1 + 0.07 * smoothstep(0.7, 1, corner);
    const onMain = across >= along || Boolean(spec.irimoya && Math.abs(x) <= gable);
    return { x: x * flare, y, z: z * flare, rib: onMain ? x : z, down: onMain ? across * hz : along * (hx - ridge) };
  };
};

const roofThickness = (spec: RoofSpec): number => spec.thickness ?? Math.max(0.18, spec.eave * 0.16);

/** The underside sinks this much more toward the middle, so deep eaves read as thick. */
const roofSag = (spec: RoofSpec): number => (spec.cover === "thatch" ? 0.25 : 0.6);

/** Top and underside of the roof above its eave line at (x, z) of the roof frame; undefined outside its plan. */
export const roofProfile = (spec: RoofSpec): ((x: number, z: number) => { top: number; under: number } | undefined) => {
  const surface = roofSurface(spec);
  const hx = spec.width / 2 + spec.eave;
  const hz = spec.depth / 2 + spec.eave;
  const thickness = roofThickness(spec);
  const sag = roofSag(spec);
  return (x, z) => {
    if (Math.abs(x) > hx || Math.abs(z) > hz) return undefined;
    const top = surface(0.5 + x / (2 * hx), 0.5 + z / (2 * hz)).y;
    const inward = 1 - Math.max(Math.abs(x) / hx, Math.abs(z) / hz);
    return { top, under: top - thickness - inward * sag };
  };
};

/** How far above the eave line the underside meets the front wall: set the eave line that far below the wall top. */
export const roofSeat = (spec: RoofSpec): number => roofProfile(spec)(0, spec.depth / 2)!.under;

const grid = (columns: number, rows: number, vertex: (u: number, v: number) => [number, number, number], flip: boolean): THREE.BufferGeometry => {
  const positions: number[] = [];
  const index: number[] = [];
  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) positions.push(...vertex(column / columns, row / rows));
  }
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = row * (columns + 1) + column;
      const b = a + 1;
      const c = a + columns + 1;
      const d = c + 1;
      if (flip) index.push(a, b, c, b, d, c);
      else index.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
};

/** Curved hip or irimoya roof whose eave line sits at the frame origin. */
export const roof = (frame: Frame, spec: RoofSpec): RoofResult => {
  const surface = roofSurface(spec);
  const res = spec.res ?? 0.3;
  const hx = spec.width / 2 + spec.eave;
  const hz = spec.depth / 2 + spec.eave;
  const columns = Math.max(8, Math.ceil((2 * hx) / res));
  const rows = Math.max(8, Math.ceil((2 * hz) / res));
  const thickness = roofThickness(spec);
  const sag = roofSag(spec);
  const thatch = spec.cover === "thatch";
  const scale = THREE.MathUtils.clamp(Math.min(spec.width, spec.depth) / 8, 0.25, 1);

  const top = grid(columns, rows, (u, v) => {
    const p = surface(u, v);
    return [p.x, p.y, p.z];
  }, false);
  const flatTop = top.toNonIndexed();
  const count = flatTop.getAttribute("position").count;
  const ribs = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const source = top.index!;
  for (let i = 0; i < count; i += 1) {
    const vertex = source.getX(i);
    const u = (vertex % (columns + 1)) / columns;
    const v = Math.floor(vertex / (columns + 1)) / rows;
    const p = surface(u, v);
    ribs[i * 3] = p.rib;
    ribs[i * 3 + 1] = p.down;
    ribs[i * 3 + 2] = thatch ? 0 : 1;
    uvs[i * 2] = p.rib * (thatch ? 0.42 : 0.55);
    uvs[i * 2 + 1] = p.down * (thatch ? 0.42 : 0.55);
  }
  if (!thatch) flatTop.setAttribute("aRib", new THREE.BufferAttribute(ribs, 3));
  flatTop.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  top.dispose();
  frame.add(spec.cover, flatTop, thatch ? [0.95, 0.9, 0.85] : WHITE);

  const under = grid(columns, rows, (u, v) => {
    const p = surface(u, v);
    const inward = Math.max(0, 1 - Math.max(Math.abs(p.x) / hx, Math.abs(p.z) / hz));
    return [p.x, p.y - thickness - inward * sag, p.z];
  }, true);
  frame.add(thatch ? "thatch" : "timber", under, thatch ? [0.55, 0.5, 0.45] : [0.7, 0.62, 0.55], 0.5);

  const loop: RoofPoint[] = [];
  const steps = 60;
  for (let i = 0; i < steps; i += 1) loop.push(surface(i / steps, 0));
  for (let i = 0; i < steps; i += 1) loop.push(surface(1, i / steps));
  for (let i = 0; i < steps; i += 1) loop.push(surface(1 - i / steps, 1));
  for (let i = 0; i < steps; i += 1) loop.push(surface(0, 1 - i / steps));
  const band: number[] = [];
  const bandUv: number[] = [];
  let run = 0;
  for (let i = 0; i < loop.length; i += 1) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const quad = [
      [a.x, a.y + 0.02, a.z, run, 0], [b.x, b.y + 0.02, b.z, run + length, 0], [a.x, a.y - thickness - 0.02, a.z, run, thickness],
      [b.x, b.y + 0.02, b.z, run + length, 0], [b.x, b.y - thickness - 0.02, b.z, run + length, thickness], [a.x, a.y - thickness - 0.02, a.z, run, thickness]
    ];
    for (const [x, y, z, s, t] of quad) {
      band.push(x, y, z);
      bandUv.push(s * 0.5, t * 0.5);
    }
    run += length;
  }
  const fascia = new THREE.BufferGeometry();
  fascia.setAttribute("position", new THREE.Float32BufferAttribute(band, 3));
  fascia.setAttribute("uv", new THREE.Float32BufferAttribute(bandUv, 2));
  fascia.computeVertexNormals();
  frame.add(spec.fascia, fascia, spec.fascia === "thatch" ? [0.62, 0.55, 0.46] : WHITE);

  const gable = spec.irimoya ? (spec.width / 2) * (spec.gableRatio ?? 0.55) : 0;
  const ridge = spec.irimoya ? gable : Math.max(0, (spec.width - spec.depth) / 2);
  const ridgeLength = spec.irimoya ? 2 * gable + 0.6 : 2 * ridge + 0.4;
  const crest = spec.height + 0.05;
  if (thatch) {
    if (ridgeLength > 0.5) {
      frame.add("timber", box(ridgeLength + 0.3, 0.42, 0.95, { y: crest + 0.08 }), [0.8, 0.72, 0.62], 0.5);
      frame.add("thatch", box(ridgeLength + 0.2, 0.3, 1.5, { y: crest - 0.1 }), [0.7, 0.62, 0.52], 0.5);
      const sticks = Math.max(2, Math.round(ridgeLength / 1.3));
      for (let i = 0; i <= sticks; i += 1) {
        const x = -ridgeLength / 2 + (i / sticks) * ridgeLength;
        for (const side of [-1, 1]) frame.add("timber", box(0.09, 1.1, 0.09, { x, y: crest + 0.42, z: side * 0.28, rx: side * 0.62 }), [0.85, 0.78, 0.66], 0.8);
      }
    } else frame.add("thatch", box(0.9, 0.5, 0.9, { y: crest }), [0.7, 0.62, 0.52], 0.5);
  } else if (ridgeLength > 0.5) {
    frame.add("tiles", box(ridgeLength, 0.42 * scale, 0.5 * scale, { y: crest + 0.12 * scale }), [0.8, 0.8, 0.85]);
    frame.add("tiles", box(ridgeLength + 0.2 * scale, 0.12 * scale, 0.62 * scale, { y: crest + 0.36 * scale }), [0.7, 0.7, 0.75]);
    for (const side of [-1, 1]) {
      frame.add("tiles", place(new THREE.CylinderGeometry(0.38, 0.28, 0.95, 6, 1), { s: [scale, scale, 0.45 * scale], x: side * (ridgeLength / 2), y: crest + 0.55 * scale, rz: side * 0.25 }), [0.75, 0.75, 0.8]);
      frame.add("tiles", box(0.18 * scale, 0.5 * scale, 0.2 * scale, { x: side * (ridgeLength / 2 + 0.2 * scale), y: crest + 0.95 * scale, rz: -side * 0.5 }), [0.7, 0.7, 0.72]);
    }
  } else frame.add("tiles", box(0.7 * scale, 0.35 * scale, 0.7 * scale, { y: spec.height + 0.15 * scale }), [0.8, 0.8, 0.85]);

  if (!thatch) {
    const hipTop = spec.height * 0.52;
    const curve = spec.curve ?? 1.42;
    const creaseV = spec.irimoya ? 1 - Math.pow(hipTop / spec.height, 1 / curve) : 0;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const u0 = 0.5 + sx * ((spec.irimoya ? gable + 0.02 : ridge) / (2 * hx));
        const v0 = 0.5 + sz * (creaseV * 0.5);
        const points: THREE.Vector3[] = [];
        for (let i = 0; i <= 12; i += 1) {
          const t = i / 12;
          const p = surface(lerp(u0, sx > 0 ? 1 : 0, t), lerp(v0, sz > 0 ? 1 : 0, t));
          points.push(new THREE.Vector3(p.x, p.y + 0.14 * scale, p.z));
        }
        frame.add("tiles", beam(points, 0.34 * scale, 0.3 * scale), [0.78, 0.78, 0.82]);
        const tip = points[points.length - 1];
        frame.add("tiles", box(0.22 * scale, 0.45 * scale, 0.22 * scale, { x: tip.x, y: tip.y + 0.2 * scale, z: tip.z, rz: -sx * 0.4, rx: sz * 0.4 }), [0.7, 0.7, 0.75]);
      }
    }
  }

  if (spec.irimoya) {
    const hipTop = spec.height * 0.52;
    const curve = spec.curve ?? 1.42;
    const reach = (1 - Math.pow(hipTop / spec.height, 1 / curve)) * hz;
    const heightAt = (z: number): number => spec.height * Math.pow(Math.max(0, 1 - Math.abs(z) / hz), curve);
    for (const side of [-1, 1]) {
      const x = side * gable;
      const face: number[] = [];
      const segments = 16;
      for (let i = 0; i < segments; i += 1) {
        const z0 = -reach + (2 * reach * i) / segments;
        const z1 = -reach + (2 * reach * (i + 1)) / segments;
        const quad = side > 0
          ? [[x, hipTop - 0.1, z0], [x, hipTop - 0.1, z1], [x, heightAt(z0) - 0.05, z0], [x, hipTop - 0.1, z1], [x, heightAt(z1) - 0.05, z1], [x, heightAt(z0) - 0.05, z0]]
          : [[x, hipTop - 0.1, z0], [x, heightAt(z0) - 0.05, z0], [x, hipTop - 0.1, z1], [x, hipTop - 0.1, z1], [x, heightAt(z0) - 0.05, z0], [x, heightAt(z1) - 0.05, z1]];
        for (const vertex of quad) face.push(...vertex);
      }
      const wall = new THREE.BufferGeometry();
      wall.setAttribute("position", new THREE.Float32BufferAttribute(face, 3));
      wall.computeVertexNormals();
      frame.add(thatch ? "timber" : "plaster", wall, thatch ? [0.6, 0.5, 0.42] : [0.92, 0.9, 0.84], 0.5);
      const slats = Math.max(3, Math.round(reach / 0.45));
      for (let i = -slats; i <= slats; i += 1) {
        const z = (i / (slats + 0.5)) * reach;
        const height = heightAt(z) - hipTop;
        if (height > 0.2) frame.add("timber", box(0.06, height, 0.06, { x: x + side * 0.03, y: hipTop + height / 2 - 0.05, z }), [0.55, 0.45, 0.38]);
      }
      for (const end of [-1, 1]) {
        const points: THREE.Vector3[] = [];
        for (let i = 0; i <= 12; i += 1) {
          const t = i / 12;
          const z = end * t * (reach + 0.5);
          points.push(new THREE.Vector3(x + side * 0.18, heightAt(z) + 0.12 + 0.12 * Math.sin(t * Math.PI), z));
        }
        frame.add(thatch ? "timber" : "black", beam(points, 0.12, 0.42), thatch ? [0.7, 0.6, 0.5] : WHITE, 0.5);
      }
      if (!thatch) frame.add("gold", box(0.1, 0.5, 0.36, { x: x + side * 0.26, y: spec.height - 0.1 }));
    }
  }

  if (spec.rafters) {
    const rafters: THREE.BufferGeometry[] = [];
    const run = (u0: number, v0: number, u1: number, v1: number, count: number, inward: THREE.Vector3): void => {
      const du = (inward.x * spec.eave * 0.95) / (2 * hx);
      const dv = (inward.z * spec.eave * 0.95) / (2 * hz);
      for (let i = 1; i < count; i += 1) {
        const u = lerp(u0, u1, i / count);
        const v = lerp(v0, v1, i / count);
        const points: THREE.Vector3[] = [];
        for (let k = 0; k <= 4; k += 1) {
          const p = surface(u + (du * k) / 4, v + (dv * k) / 4);
          const inset = 1 - Math.max(Math.abs(p.x) / hx, Math.abs(p.z) / hz);
          points.push(new THREE.Vector3(p.x, p.y - thickness - Math.max(0, inset) * sag - 0.07 * scale, p.z));
        }
        rafters.push(beam(points, 0.1 * scale, 0.12 * scale));
      }
    };
    const alongX = Math.round((2 * hx) / 0.34);
    const alongZ = Math.round((2 * hz) / 0.34);
    run(0, 0, 1, 0, alongX, new THREE.Vector3(0, 0, 1));
    run(0, 1, 1, 1, alongX, new THREE.Vector3(0, 0, -1));
    run(0, 0, 0, 1, alongZ, new THREE.Vector3(1, 0, 0));
    run(1, 0, 1, 1, alongZ, new THREE.Vector3(-1, 0, 0));
    const merged = mergeGeometries(rafters, false);
    rafters.forEach((geometry) => geometry.dispose());
    if (merged) frame.add("timber", merged, [0.8, 0.68, 0.55], 0.6);
  }

  const cornerTips = [surface(0, 0), surface(1, 0), surface(0, 1), surface(1, 1)].map((p) => frame.point(p.x, p.y - thickness, p.z));
  return { cornerTips, peak: spec.height + (spec.lift ?? 0.55) };
};

/* ------------------------------------------------------------------ walls */

export type Bay = "wall" | "window" | "door" | "shoji" | "open" | "lattice";

export type WallSpec = {
  /** Along the wall's own +X, centred on the frame origin; the outside faces +Z. */
  length: number;
  height: number;
  bays: ReadonlyArray<Bay>;
  fill: "plaster" | "mud" | "planks";
  /** Height of the plank skirt (koshiita) under plaster. */
  skirt?: number;
};

const POST = 0.22;

/** Timber-framed wall standing on the frame origin (floor level). */
export const wall = (frame: Frame, spec: WallSpec): void => {
  const bays = spec.bays.length;
  const bay = spec.length / bays;
  const h = spec.height;
  const skirt = spec.skirt ?? 0.85;
  const fillTint: Tint = spec.fill === "mud" ? [1, 0.97, 0.92] : spec.fill === "plaster" ? [1, 1, 1] : [0.72, 0.62, 0.5];
  for (let i = 0; i <= bays; i += 1) {
    const x = -spec.length / 2 + i * bay;
    frame.add("timber", box(POST, h, POST, { x, y: h / 2 }), [0.75, 0.66, 0.58], 0.9);
  }
  frame.add("timber", box(spec.length + POST, 0.2, 0.26, { y: 0.1 }), [0.6, 0.52, 0.45], 0.9);
  frame.add("timber", box(spec.length + 0.5, 0.3, 0.3, { y: h - 0.15 }), [0.7, 0.6, 0.5], 0.9);
  if (h > 3.2) frame.add("timber", box(spec.length + POST, 0.14, 0.24, { y: 2.35 }), [0.66, 0.56, 0.48], 0.9);
  const panel = (y0: number, y1: number, cx: number, width: number): void => {
    if (y1 - y0 < 0.02) return;
    frame.add(spec.fill, box(width, y1 - y0, 0.12, { x: cx, y: (y0 + y1) / 2 }), fillTint, 0.45);
  };
  const lattice = (cx: number, width: number, y0: number, y1: number, spacing: number, rows: number): void => {
    frame.add("paper", box(width, y1 - y0, 0.03, { x: cx, y: (y0 + y1) / 2 }), [1, 0.97, 0.9]);
    const bars = Math.max(2, Math.round(width / spacing));
    for (let k = 0; k <= bars; k += 1) frame.add("timber", box(0.035, y1 - y0, 0.05, { x: cx - width / 2 + (k / bars) * width, y: (y0 + y1) / 2, z: 0.03 }), [0.62, 0.52, 0.44]);
    for (let k = 0; k <= rows; k += 1) frame.add("timber", box(width, 0.035, 0.05, { x: cx, y: y0 + (k / rows) * (y1 - y0), z: 0.03 }), [0.62, 0.52, 0.44]);
  };
  spec.bays.forEach((kind, index) => {
    const cx = -spec.length / 2 + (index + 0.5) * bay;
    const inner = bay - POST;
    const beamLow = h > 3.2 ? 2.28 : h - 0.3;
    if (kind === "open") return;
    if (kind === "wall") {
      if (spec.fill !== "planks" && skirt > 0) {
        frame.add("planks", box(inner, skirt, 0.14, { x: cx, y: 0.2 + skirt / 2 }), [0.62, 0.52, 0.42], 0.8);
        panel(0.2 + skirt, h - 0.3, cx, inner);
      } else panel(0.2, h - 0.3, cx, inner);
      return;
    }
    if (kind === "window") {
      frame.add("planks", box(inner, 0.75, 0.14, { x: cx, y: 0.2 + 0.375 }), [0.62, 0.52, 0.42], 0.8);
      lattice(cx, inner - 0.2, 0.95, 1.85, 0.16, 1);
      frame.add("timber", box(inner, 0.08, 0.2, { x: cx, y: 0.95 }), [0.6, 0.5, 0.42]);
      frame.add("timber", box(inner, 0.08, 0.2, { x: cx, y: 1.85 }), [0.6, 0.5, 0.42]);
      panel(1.89, h - 0.3, cx, inner);
      return;
    }
    if (kind === "lattice") {
      frame.add("paper", box(inner, beamLow - 0.3, 0.03, { x: cx, y: 0.2 + (beamLow - 0.3) / 2, z: -0.04 }), [0.95, 0.9, 0.82]);
      const slats = Math.round(inner / 0.11);
      for (let k = 0; k <= slats; k += 1) frame.add("timber", box(0.05, beamLow - 0.2, 0.06, { x: cx - inner / 2 + (k / slats) * inner, y: 0.2 + (beamLow - 0.2) / 2 }), [0.55, 0.46, 0.4]);
      panel(beamLow, h - 0.3, cx, inner);
      return;
    }
    const doorTop = Math.min(2.1, h - 0.4);
    if (kind === "door") {
      for (const side of [-1, 1]) {
        frame.add("planks", box(inner / 2 - 0.02, doorTop - 0.2, 0.08, { x: cx + side * (inner / 4), y: 0.2 + (doorTop - 0.2) / 2, z: side * 0.02 }), [0.5, 0.42, 0.35], 0.8);
        for (const y of [0.55, 1.2, doorTop - 0.3]) frame.add("timber", box(inner / 2 - 0.08, 0.06, 0.1, { x: cx + side * (inner / 4), y, z: side * 0.02 + 0.04 }), [0.5, 0.42, 0.36]);
      }
    } else lattice(cx, inner, 0.2, doorTop, 0.3, 4);
    frame.add("timber", box(inner, 0.12, 0.2, { x: cx, y: doorTop + 0.06 }), [0.6, 0.5, 0.42]);
    panel(doorTop + 0.12, h - 0.3, cx, inner);
  });
};

/** A rectangular building shell: four walls on a floor plane, each listed from its own left. */
export const shell = (
  frame: Frame,
  width: number,
  depth: number,
  height: number,
  fill: WallSpec["fill"],
  sides: { front: Bay[]; back: Bay[]; left: Bay[]; right: Bay[] },
  skirt?: number
): void => {
  wall(frame.child({ z: depth / 2 }), { length: width, height, bays: sides.front, fill, skirt });
  wall(frame.child({ z: -depth / 2, ry: Math.PI }), { length: width, height, bays: sides.back, fill, skirt });
  wall(frame.child({ x: -width / 2, ry: -Math.PI / 2 }), { length: depth, height, bays: sides.left, fill, skirt });
  wall(frame.child({ x: width / 2, ry: Math.PI / 2 }), { length: depth, height, bays: sides.right, fill, skirt });
};

/* ------------------------------------------------------------------ small pieces */

/** Stacked bracket set (tokyō) under an eave. */
export const brackets = (frame: Frame, x: number, y: number, z: number, key: ArchKey, tint: Tint, s = 1): void => {
  const piece = (px: number, py: number, pz: number, w: number, h: number, d: number): void =>
    frame.add(key, box(w * s, h * s, d * s, { x: x + px * s, y: y + py * s, z: z + pz * s }), tint, 1.2);
  piece(0, 0.14, 0, 0.5, 0.28, 0.5);
  piece(0, 0.4, 0, 1.5, 0.22, 0.24);
  piece(0, 0.4, 0, 0.24, 0.22, 1.5);
  for (const offset of [-0.6, 0, 0.6]) {
    piece(offset, 0.6, 0, 0.26, 0.18, 0.28);
    piece(0, 0.6, offset, 0.28, 0.18, 0.26);
  }
  piece(0, 0.8, 0, 2.2, 0.22, 0.26);
  piece(0, 0.8, 0, 0.26, 0.22, 2);
};

/** Stone lantern (kasuga dōrō) on the frame origin; returns where its light sits. */
export const stoneLantern = (frame: Frame, s = 1): THREE.Vector3 => {
  const hex = (top: number, bottom: number, height: number, y: number): void =>
    frame.add("granite", cylinder(top * s, bottom * s, height * s, 6, { y: y * s }), WHITE, 1.4);
  hex(0.42, 0.5, 0.22, 0.11);
  hex(0.3, 0.38, 0.14, 0.29);
  frame.add("granite", cylinder(0.13 * s, 0.15 * s, 1 * s, 10, { y: 0.86 * s }), WHITE, 1.4);
  hex(0.24, 0.12, 0.18, 1.42);
  hex(0.38, 0.3, 0.14, 1.56);
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    frame.add("granite", box(0.07 * s, 0.42 * s, 0.07 * s, { x: Math.cos(angle) * 0.23 * s, y: 1.84 * s, z: Math.sin(angle) * 0.23 * s }), WHITE, 1.4);
  }
  frame.add("glow", cylinder(0.17 * s, 0.17 * s, 0.34 * s, 6, { y: 1.84 * s }));
  const cap = new THREE.CylinderGeometry(0.1 * s, 0.62 * s, 0.3 * s, 6, 1);
  const position = cap.getAttribute("position");
  for (let i = 0; i < position.count; i += 1) {
    if (position.getY(i) >= 0) continue;
    const angle = Math.atan2(position.getZ(i), position.getX(i));
    position.setY(i, position.getY(i) + Math.abs(Math.cos(angle * 3)) * 0.1 * s);
  }
  cap.computeVertexNormals();
  frame.add("granite", place(cap, { y: 2.2 * s }), WHITE, 1.4);
  frame.add("granite", lathe([[0, 0], [0.08, 0], [0.12, 0.06], [0.11, 0.14], [0.05, 0.22], [0, 0.28]].map(([x, y]) => [x * s, y * s] as const), 10, { y: 2.35 * s }), WHITE, 1.4);
  return frame.point(0, 1.84 * s, 0);
};

/** Shrine gate on the frame origin, spanning its X axis. `s` = 1 is 5.3 units tall. */
export const torii = (frame: Frame, s = 1, key: ArchKey = "lacquer"): void => {
  const span = 4.6 * s;
  const height = 5.3 * s;
  for (const side of [-1, 1]) {
    frame.add(key, place(new THREE.CylinderGeometry(0.24 * s, 0.3 * s, height, 14), { rz: side * 0.035, x: (side * span) / 2, y: height / 2 }), WHITE, 1.2);
    frame.add("black", cylinder(0.34 * s, 0.36 * s, 0.55 * s, 14, { x: (side * span) / 2 - side * 0.01, y: 0.27 * s }));
  }
  frame.add(key, box(span + 1.3 * s, 0.34 * s, 0.22 * s, { y: height * 0.74 }), WHITE, 1.2);
  const reach = span / 2 + 1.45 * s;
  const lintel = (stretch: number, rise: number): THREE.Vector3[] =>
    Array.from({ length: 21 }, (_, i) => {
      const x = (-1 + i / 10) * reach * stretch;
      return new THREE.Vector3(x, height + rise + Math.pow(Math.abs(x / reach), 2.4) * 0.42 * s, 0);
    });
  const across = new THREE.Vector3(0, 0, 1);
  frame.add(key, beam(lintel(1, 0.2 * s), 0.36 * s, 0.3 * s, across), WHITE, 1.2);
  // Deeper than the lintel under it so their faces never share a plane.
  frame.add("black", beam(lintel(1.04, 0.52 * s), 0.5 * s, 0.44 * s, across));
  frame.add(key, box(0.24 * s, height * 0.24, 0.2 * s, { y: height * 0.87 }), WHITE, 1.2);
};

/** Sacred rope with paper streamers between posts already standing at `points` (their tops). */
export const shimenawa = (frame: Frame, points: ReadonlyArray<THREE.Vector3>): void => {
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const middle = a.clone().lerp(b, 0.5);
    middle.y -= 0.22;
    const curve = new THREE.CatmullRomCurve3([a, a.clone().lerp(middle, 0.5).add(new THREE.Vector3(0, -0.08, 0)), middle, middle.clone().lerp(b, 0.5).add(new THREE.Vector3(0, -0.08, 0)), b]);
    frame.add("rope", new THREE.TubeGeometry(curve, 16, 0.035, 6, false));
    const along = new THREE.Vector3().subVectors(b, a).normalize();
    const streamer: number[] = [];
    for (let k = 0; k < 4; k += 1) {
      const y = middle.y - k * 0.1;
      const offset = k % 2 ? 0.05 : -0.05;
      const p0 = middle.clone().addScaledVector(along, offset - 0.04);
      const p1 = middle.clone().addScaledVector(along, offset + 0.04);
      streamer.push(p0.x, y, p0.z, p1.x, y, p1.z, p1.x, y - 0.1, p1.z, p0.x, y, p0.z, p1.x, y - 0.1, p1.z, p0.x, y - 0.1, p0.z);
    }
    const paper = new THREE.BufferGeometry();
    paper.setAttribute("position", new THREE.Float32BufferAttribute(streamer, 3));
    paper.computeVertexNormals();
    frame.add("shide", paper);
  }
};

/** Paper lantern (chōchin) hanging with its top at the frame origin. */
export const chochin = (frame: Frame, s = 1): THREE.Vector3 => {
  frame.add("black", cylinder(0.16 * s, 0.16 * s, 0.08 * s, 12, { y: -0.04 * s }));
  frame.add("chochin", lathe([[0.16, -0.08], [0.26, -0.2], [0.3, -0.4], [0.26, -0.6], [0.16, -0.72]].map(([x, y]) => [x * s, y * s] as const), 14));
  frame.add("black", cylinder(0.16 * s, 0.16 * s, 0.08 * s, 12, { y: -0.76 * s }));
  return frame.point(0, -0.4 * s, 0);
};

/** Irregular boulder sunk into the ground at the frame origin. */
export const boulder = (frame: Frame, radius: number, squash: number, seed: number): void => {
  const random = createRandom(seed);
  const geometry = new THREE.IcosahedronGeometry(radius, 3);
  const position = geometry.getAttribute("position");
  const phase = random() * 10;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const n = Math.sin(x * 2.1 + phase) * Math.cos(z * 1.7 - phase) * 0.12 + Math.sin(y * 3.3 + x * 1.3 + phase * 2) * 0.06;
    const flat = y < 0 ? 0.55 : 1;
    position.setXYZ(i, x * (1 + n), y * squash * flat * (1 + n), z * (1 + n * 0.8));
  }
  geometry.computeVertexNormals();
  frame.add("rock", geometry, [0.95, 0.95, 0.92], 0.45);
};
