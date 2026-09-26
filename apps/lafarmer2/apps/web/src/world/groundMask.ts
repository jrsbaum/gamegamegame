import * as THREE from "three";
import { WORLD_OBSTACLES } from "@lafarmer2/content";
import { BRIDGE, farmSignedDistance, pathMask, riverCenterTile, riverHalfWidthTiles, tileToWorldX, tileToWorldZ, waterField, worldToTile } from "./height";
import { GLOBALS } from "./shared";

/** World rectangle covered by the mask, the same region as the cached heights. */
export const MASK_RECT = { x0: -170, z0: -140, width: 340, depth: 280 };
const TEXELS_PER_UNIT = 2;
const COLUMNS = MASK_RECT.width * TEXELS_PER_UNIT;
const ROWS = MASK_RECT.depth * TEXELS_PER_UNIT;

/*
 * Ground state shared by the terrain and the grass, sampled on the GPU with `groundMaskAt(xz)`
 * from the shader prelude. R: dirt path, G: tilled soil, B: bare ground where grass must not grow
 * (paths, water, building and rock footprints, tilled soil). A is always 255.
 */

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** Signed distance in tiles to a tile-aligned footprint (negative inside). */
const footprintDistance = (tx: number, ty: number, x: number, y: number, width: number, height: number): number => {
  const cx = x - 0.5 + width / 2;
  const cy = y - 0.5 + height / 2;
  const dx = Math.abs(tx - cx) - width / 2;
  const dy = Math.abs(ty - cy) - height / 2;
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0);
};

const BUILDINGS = WORLD_OBSTACLES.filter((obstacle) => obstacle.kind === "barn" || obstacle.kind === "market" || obstacle.kind === "house" || obstacle.kind === "gate");
const ROCKS = WORLD_OBSTACLES.filter((obstacle) => obstacle.kind === "rock");

const data = new Uint8Array(COLUMNS * ROWS * 4);
const staticBare = new Uint8Array(COLUMNS * ROWS);
const tilledByKey = new Map<string, Array<[number, number]>>();

const texelWorld = (column: number, row: number): [number, number] => [
  MASK_RECT.x0 + (column + 0.5) / TEXELS_PER_UNIT,
  MASK_RECT.z0 + (row + 0.5) / TEXELS_PER_UNIT
];

const bakeStatic = (): void => {
  for (let row = 0; row < ROWS; row += 1) {
    for (let column = 0; column < COLUMNS; column += 1) {
      const [wx, wz] = texelWorld(column, row);
      const { x: tx, y: ty } = worldToTile(wx, wz);
      let path = 0;
      let bare = 0;
      if (farmSignedDistance(tx, ty) < 2) {
        path = pathMask(tx, ty);
        bare = path;
        for (const building of BUILDINGS) {
          const distance = footprintDistance(tx, ty, building.x, building.y, building.width, building.height);
          if (distance < 1.3) bare = Math.max(bare, 1 - smoothstep(0.25, 1.3, distance));
        }
        for (const rock of ROCKS) {
          const distance = footprintDistance(tx, ty, rock.x, rock.y, rock.width, rock.height);
          if (distance < 0.4) bare = Math.max(bare, 1 - smoothstep(-0.1, 0.4, distance));
        }
      }
      if (Math.abs(tx - riverCenterTile(ty)) - riverHalfWidthTiles(ty) < 1.5) {
        bare = Math.max(bare, smoothstep(0.16, 0.42, waterField(tx, ty)));
      }
      if (wx > BRIDGE.x0 && wx < BRIDGE.x1 && wz > BRIDGE.z0 && wz < BRIDGE.z1) bare = 1;
      const index = row * COLUMNS + column;
      staticBare[index] = Math.round(bare * 255);
      data[index * 4] = Math.round(path * 255);
      data[index * 4 + 1] = 0;
      data[index * 4 + 2] = staticBare[index];
      data[index * 4 + 3] = 255;
    }
  }
};

let texture: THREE.DataTexture | undefined;

/** The mask texture, baked on first use and bound to every material through GLOBALS. */
export const groundMaskTexture = (): THREE.DataTexture => {
  if (texture) return texture;
  bakeStatic();
  texture = new THREE.DataTexture(data, COLUMNS, ROWS, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  GLOBALS.uGroundMask.value = texture;
  GLOBALS.uGroundMaskRect.value.set(MASK_RECT.x0, MASK_RECT.z0, 1 / MASK_RECT.width, 1 / MASK_RECT.depth);
  return texture;
};

const texelRange = (worldMin: number, worldMax: number, origin: number, limit: number): [number, number] => [
  Math.max(0, Math.floor((worldMin - origin) * TEXELS_PER_UNIT)),
  Math.min(limit - 1, Math.ceil((worldMax - origin) * TEXELS_PER_UNIT))
];

/** A round patch in world units where grass must not grow, such as the mulch under a tree. */
export type BareSpot = { x: number; z: number; radius: number };
const spotsByKey = new Map<string, BareSpot[]>();

type WorldRect = { x0: number; x1: number; z0: number; z1: number };

const tileRect = (x: number, y: number): WorldRect => ({ x0: tileToWorldX(x - 0.5), x1: tileToWorldX(x + 0.5), z0: tileToWorldZ(y - 0.5), z1: tileToWorldZ(y + 0.5) });

const spotRect = (spot: BareSpot): WorldRect => ({ x0: spot.x - spot.radius, x1: spot.x + spot.radius, z0: spot.z - spot.radius, z1: spot.z + spot.radius });

/** Recomputes the tilled and bare channels inside `rects` from every key still registered. */
const refresh = (rects: readonly WorldRect[]): void => {
  const covered = new Set<string>();
  for (const list of tilledByKey.values()) for (const [x, y] of list) covered.add(`${x},${y}`);
  const spots = [...spotsByKey.values()].flat();
  for (const rect of rects) {
    const [c0, c1] = texelRange(rect.x0, rect.x1, MASK_RECT.x0, COLUMNS);
    const [r0, r1] = texelRange(rect.z0, rect.z1, MASK_RECT.z0, ROWS);
    const nearby = spots.filter((spot) => spot.x + spot.radius > rect.x0 - 1 && spot.x - spot.radius < rect.x1 + 1 && spot.z + spot.radius > rect.z0 - 1 && spot.z - spot.radius < rect.z1 + 1);
    for (let row = r0; row <= r1; row += 1) {
      for (let column = c0; column <= c1; column += 1) {
        const [wx, wz] = texelWorld(column, row);
        const { x: tx, y: ty } = worldToTile(wx, wz);
        const tilled = covered.has(`${Math.round(tx)},${Math.round(ty)}`) ? 255 : 0;
        let spotted = 0;
        for (const spot of nearby) spotted = Math.max(spotted, 1 - smoothstep(spot.radius - 0.35, spot.radius, Math.hypot(wx - spot.x, wz - spot.z)));
        const index = row * COLUMNS + column;
        data[index * 4 + 1] = tilled;
        data[index * 4 + 2] = Math.max(staticBare[index], tilled, Math.round(spotted * 255));
      }
    }
  }
  if (texture) texture.needsUpdate = true;
};

/** Marks tiles as tilled soil for one structure (or crop bed) identified by `key`. */
export const setTilledTiles = (key: string, tiles: ReadonlyArray<[number, number]>): void => {
  const previous = tilledByKey.get(key) ?? [];
  tilledByKey.set(key, tiles.map(([x, y]) => [x, y]));
  groundMaskTexture();
  refresh([...previous, ...tiles].map(([x, y]) => tileRect(x, y)));
};

export const clearTilledTiles = (key: string): void => {
  const previous = tilledByKey.get(key);
  if (!previous) return;
  tilledByKey.delete(key);
  refresh(previous.map(([x, y]) => tileRect(x, y)));
};

/** Keeps grass out of round spots for the owner identified by `key`, leaving the terrain as it is. */
export const setBareSpots = (key: string, spots: readonly BareSpot[]): void => {
  const previous = spotsByKey.get(key) ?? [];
  spotsByKey.set(key, spots.map((spot) => ({ ...spot })));
  groundMaskTexture();
  refresh([...previous, ...spots].map(spotRect));
};

export const clearBareSpots = (key: string): void => {
  const previous = spotsByKey.get(key);
  if (!previous) return;
  spotsByKey.delete(key);
  refresh(previous.map(spotRect));
};

export type MaskSample = { path: number; tilled: number; bare: number };

/** CPU lookup of the mask (nearest texel) for placing vegetation and props. */
export const sampleGroundMask = (wx: number, wz: number): MaskSample => {
  groundMaskTexture();
  const column = Math.floor((wx - MASK_RECT.x0) * TEXELS_PER_UNIT);
  const row = Math.floor((wz - MASK_RECT.z0) * TEXELS_PER_UNIT);
  if (column < 0 || row < 0 || column >= COLUMNS || row >= ROWS) return { path: 0, tilled: 0, bare: 0 };
  const index = (row * COLUMNS + column) * 4;
  return { path: data[index] / 255, tilled: data[index + 1] / 255, bare: data[index + 2] / 255 };
};
