import {
  MARKET_TILE,
  PALETTE,
  WORLD_HEIGHT_TILES,
  WORLD_OBSTACLES,
  WORLD_TILE_SIZE,
  WORLD_WIDTH_TILES,
  isWorldWaterTile,
  type Clothing,
  type HairStyle
} from "@lafarmer2/content";
import * as THREE from "three";

export const TILE = WORLD_TILE_SIZE / 16;

export const tileToWorld = (x: number, y: number): THREE.Vector3 =>
  new THREE.Vector3((x - WORLD_WIDTH_TILES / 2) * TILE, 0, (y - WORLD_HEIGHT_TILES / 2) * TILE);

export const hexColor = (hex: string): number => Number(`0x${hex.slice(1)}`);

export const clothingColor = (clothing: Clothing): number =>
  clothing === "coral" ? hexColor(PALETTE.coral) : clothing === "river" ? hexColor(PALETTE.river) : hexColor(PALETTE.forest);

export const createFarmer = (clothing: Clothing, hair: HairStyle): THREE.Group => {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.55, 4, 8), new THREE.MeshLambertMaterial({ color: clothingColor(clothing) }));
  body.position.y = 0.7;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 10), new THREE.MeshLambertMaterial({ color: 0xf0d2b0 }));
  head.position.y = 1.25;
  const hairMesh = new THREE.Mesh(
    hair === "long" ? new THREE.SphereGeometry(0.26, 10, 10) : new THREE.SphereGeometry(0.2, 8, 8),
    new THREE.MeshLambertMaterial({ color: 0x2b1c12 })
  );
  hairMesh.position.y = hair === "long" ? 1.32 : 1.4;
  hairMesh.scale.y = hair === "long" ? 1.35 : 0.7;
  group.add(body, head, hairMesh);
  group.userData.kind = "farmer";
  return group;
};

export const createFarmItemMesh = (visualKey: string, contentId: string, ready: boolean, behaviorState?: string): THREE.Group => {
  const group = new THREE.Group();
  if (contentId === "cow" || visualKey.startsWith("cow")) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.45, 0.5), new THREE.MeshLambertMaterial({ color: 0xf5eee0 }));
    body.position.y = 0.35;
    const spots = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), new THREE.MeshLambertMaterial({ color: 0x3a2a16 }));
    spots.position.set(0.18, 0.42, 0.18);
    group.add(body, spots);
  } else if (contentId === "dinosaur" || visualKey.startsWith("dinosaur")) {
    const color = visualKey.includes("fossil") ? 0x8a7a5c : visualKey.includes("egg") ? 0xd8c48a : 0x5d9854;
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.8, 6), new THREE.MeshLambertMaterial({ color }));
    body.position.y = 0.4;
    group.add(body);
  } else if (visualKey.includes("soil") || visualKey.includes("sapling") && !visualKey.includes("tree")) {
    group.add(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.12, 8), new THREE.MeshLambertMaterial({ color: hexColor(PALETTE.soil) })));
    if (visualKey.includes("sapling")) {
      const sprout = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 6), new THREE.MeshLambertMaterial({ color: hexColor(PALETTE.moss) }));
      sprout.position.y = 0.25;
      group.add(sprout);
    }
  } else if (visualKey.includes("sprout")) {
    const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 0.1, 8), new THREE.MeshLambertMaterial({ color: hexColor(PALETTE.soil) }));
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.45, 6), new THREE.MeshLambertMaterial({ color: hexColor(PALETTE.moss) }));
    leaf.position.y = 0.28;
    group.add(soil, leaf);
  } else if (visualKey.includes("tree")) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.7, 6), new THREE.MeshLambertMaterial({ color: hexColor(PALETTE.soil) }));
    trunk.position.y = 0.35;
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(ready || visualKey.includes("producing") ? 0.55 : 0.4, 8, 8), new THREE.MeshLambertMaterial({ color: ready ? hexColor(PALETTE.amber) : hexColor(PALETTE.moss) }));
    canopy.position.y = 0.95;
    group.add(trunk, canopy);
  } else {
    const crop = new THREE.Mesh(new THREE.SphereGeometry(ready ? 0.28 : 0.16, 8, 8), new THREE.MeshLambertMaterial({ color: ready ? hexColor(PALETTE.coral) : hexColor(PALETTE.grass) }));
    crop.position.y = ready ? 0.32 : 0.18;
    group.add(crop);
  }
  if (behaviorState === "hungry") group.scale.setScalar(0.85);
  if (behaviorState === "happy" || behaviorState === "produce") group.scale.setScalar(1.08);
  return group;
};

export const createStructureMesh = (type: string, footprint: Array<[number, number]>): THREE.Group => {
  const xs = footprint.map((point) => point[0]);
  const ys = footprint.map((point) => point[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.max(1, maxX - minX);
  const depth = Math.max(1, maxY - minY);
  const color = type === "dinosaur_enclosure" ? 0xb47b48 : type === "orchard" ? 0x72a95d : type === "animal_pen" ? 0xc4a574 : 0xd4ae69;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width * TILE * 0.92, 0.35, depth * TILE * 0.92), new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.78 }));
  mesh.position.y = 0.12;
  const group = new THREE.Group();
  const center = tileToWorld((minX + maxX) / 2 - 0.5, (minY + maxY) / 2 - 0.5);
  group.position.copy(center);
  group.add(mesh);
  return group;
};

export const createTerrain = (): THREE.Group => {
  const root = new THREE.Group();
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD_WIDTH_TILES * TILE, WORLD_HEIGHT_TILES * TILE),
    new THREE.MeshLambertMaterial({ color: hexColor(PALETTE.grass) })
  );
  ground.rotation.x = -Math.PI / 2;
  root.add(ground);

  for (let y = 0; y < WORLD_HEIGHT_TILES; y += 1) {
    for (let x = 0; x < WORLD_WIDTH_TILES; x += 1) {
      if (!isWorldWaterTile(x, y)) continue;
      const water = new THREE.Mesh(new THREE.BoxGeometry(TILE, 0.12, TILE), new THREE.MeshLambertMaterial({ color: hexColor(PALETTE.river) }));
      const position = tileToWorld(x, y);
      water.position.set(position.x, 0.02, position.z);
      root.add(water);
    }
  }

  for (const obstacle of WORLD_OBSTACLES) {
    root.add(createObstacle(obstacle.kind, obstacle.x, obstacle.y, obstacle.width, obstacle.height));
  }
  return root;
};

const createObstacle = (kind: string, x: number, y: number, width: number, height: number): THREE.Group => {
  const group = new THREE.Group();
  const center = tileToWorld(x + width / 2 - 0.5, y + height / 2 - 0.5);
  group.position.copy(center);
  if (kind === "tree") {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.8, 6), new THREE.MeshLambertMaterial({ color: hexColor(PALETTE.soil) }));
    trunk.position.y = 0.4;
    const leaves = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.1, 7), new THREE.MeshLambertMaterial({ color: hexColor(PALETTE.forest) }));
    leaves.position.y = 1.15;
    group.add(trunk, leaves);
  } else if (kind === "rock") {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.35), new THREE.MeshLambertMaterial({ color: 0x6d7270 }));
    rock.position.y = 0.25;
    rock.scale.set(width, 1, height);
    group.add(rock);
  } else if (kind === "gate" || kind === "bridge") {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(width * TILE, 0.18, height * TILE), new THREE.MeshLambertMaterial({ color: 0x8a6238 }));
    plank.position.y = 0.08;
    group.add(plank);
  } else {
    const isMarket = kind === "market";
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(width * TILE * 0.9, 1.4, height * TILE * 0.9),
      new THREE.MeshLambertMaterial({ color: isMarket ? hexColor(PALETTE.amber) : hexColor(PALETTE.coral) })
    );
    body.position.y = 0.7;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(width, height) * TILE * 0.7, 0.7, 4), new THREE.MeshLambertMaterial({ color: isMarket ? 0xd86b5d : 0xa7473f }));
    roof.position.y = 1.7;
    roof.rotation.y = Math.PI / 4;
    group.add(body, roof);
    if (isMarket) group.userData.market = true;
  }
  group.userData.kind = kind;
  return group;
};

export const marketWorldPosition = (): THREE.Vector3 => tileToWorld(MARKET_TILE.x + MARKET_TILE.width / 2 - 0.5, MARKET_TILE.y + MARKET_TILE.height / 2 - 0.5);
