import { WORLD_HEIGHT_TILES, WORLD_WIDTH_TILES, isInsideFarmBoundary } from "@lafarmer2/content";

export const TILE = 3;
export const WATER_LEVEL = 0.34;

const riverCenter = (y: number): number => 41 + Math.sin(y * 0.32) * 2.2 + 1;

export const sampleHeight = (x: number, y: number): number => {
  const hill = Math.sin(x * 0.21) * 1.15 + Math.cos(y * 0.17) * 0.9 + Math.sin((x * 0.47 + y) * 0.11) * 0.55;
  const inside = isInsideFarmBoundary(x, y);
  const rim = inside ? 0 : 3.4 + Math.sin(x * 0.5 + y * 0.2) * 0.8;
  const bridge = y >= 27.5 && y <= 31.5;
  const dist = Math.abs(x - riverCenter(y));
  const channel = bridge ? 0 : Math.max(0, 1 - dist / 2.6);
  const bed = channel * channel * 2.15;
  return 0.7 + hill * (inside ? 1 : 0.4) + rim - bed;
};

export const tileToWorld = (x: number, y: number): { x: number; y: number; z: number } => ({
  x: (x - WORLD_WIDTH_TILES / 2) * TILE,
  y: sampleHeight(x, y),
  z: (y - WORLD_HEIGHT_TILES / 2) * TILE
});

export const worldToTile = (x: number, z: number): { x: number; y: number } => ({
  x: x / TILE + WORLD_WIDTH_TILES / 2,
  y: z / TILE + WORLD_HEIGHT_TILES / 2
});
