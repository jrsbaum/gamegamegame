export type OutfitId = 'forest' | 'coral' | 'river';
export type HairId = 'short' | 'long';

export interface OutfitDefinition {
  id: OutfitId;
  label: string;
  color: number;
  swatch: string;
}

export interface HairDefinition {
  id: HairId;
  label: string;
}

export interface ContentDefinition {
  id: string;
  label: string;
  kind: 'crop' | 'fruit' | 'animal' | 'dinosaur';
  stages: readonly string[];
}

export const outfits: readonly OutfitDefinition[] = [
  { id: 'forest', label: 'Verde mata', color: 0x315d4a, swatch: '#315d4a' },
  { id: 'coral', label: 'Coral', color: 0xd86b5d, swatch: '#d86b5d' },
  { id: 'river', label: 'Azul rio', color: 0x3f7890, swatch: '#3f7890' }
];

export const hairs: readonly HairDefinition[] = [
  { id: 'short', label: 'Curto' },
  { id: 'long', label: 'Grande' }
];

export const starterCatalog: readonly ContentDefinition[] = [
  { id: 'tomato', label: 'Tomate', kind: 'crop', stages: ['seed', 'sprout', 'ready'] },
  { id: 'orange-tree', label: 'Laranjeira', kind: 'fruit', stages: ['sapling', 'tree', 'producing'] },
  { id: 'cow', label: 'Vaca', kind: 'animal', stages: ['baby', 'adult'] },
  { id: 'dinosaur', label: 'Dinossauro', kind: 'dinosaur', stages: ['fossil', 'egg', 'adult'] }
];

export const palette = {
  forest: '#183b32',
  ink: '#16362e',
  moss: '#88af6d',
  grass: '#b9d18e',
  cream: '#f8f6ed',
  paper: '#fffdf7',
  river: '#4394a5',
  riverLight: '#9bd8ce',
  amber: '#f2b84b',
  coral: '#d86b5d',
  soil: '#76523e'
} as const;

export const WORLD_WIDTH_TILES = 40;
export const WORLD_HEIGHT_TILES = 30;
export const WORLD_TILE_SIZE = 48;

export type WorldObstacleKind = 'tree' | 'rock' | 'barn' | 'market' | 'house';
export type WorldObstacle = { kind: WorldObstacleKind; x: number; y: number; width: number; height: number };

export const WORLD_OBSTACLES: readonly WorldObstacle[] = [
  { kind: 'tree', x: 8, y: 5, width: 1, height: 1 }, { kind: 'tree', x: 9, y: 5, width: 1, height: 1 }, { kind: 'tree', x: 10, y: 6, width: 1, height: 1 },
  { kind: 'tree', x: 33, y: 4, width: 1, height: 1 }, { kind: 'tree', x: 34, y: 5, width: 1, height: 1 }, { kind: 'tree', x: 32, y: 6, width: 1, height: 1 },
  { kind: 'tree', x: 5, y: 22, width: 1, height: 1 }, { kind: 'tree', x: 6, y: 23, width: 1, height: 1 }, { kind: 'tree', x: 35, y: 23, width: 1, height: 1 },
  { kind: 'rock', x: 19, y: 7, width: 1, height: 1 }, { kind: 'rock', x: 20, y: 7, width: 1, height: 1 }, { kind: 'rock', x: 21, y: 24, width: 2, height: 1 },
  { kind: 'barn', x: 2, y: 8, width: 4, height: 3 }, { kind: 'market', x: 30, y: 17, width: 4, height: 3 }, { kind: 'house', x: 13, y: 22, width: 3, height: 2 }
] as const;

export function riverColumnAt(y: number): number { return 24 + Math.round(Math.sin(y * 0.55) * 1.25); }
export function isWorldWaterTile(x: number, y: number): boolean {
  if (y === 14 || y === 15) return false;
  const riverColumn = riverColumnAt(y);
  return x >= riverColumn && x <= riverColumn + 2;
}
export function isWorldTileWalkable(x: number, y: number): boolean {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= WORLD_WIDTH_TILES || y < 0 || y >= WORLD_HEIGHT_TILES) return false;
  if (isWorldWaterTile(x, y)) return false;
  return !WORLD_OBSTACLES.some((obstacle) => x >= obstacle.x && x < obstacle.x + obstacle.width && y >= obstacle.y && y < obstacle.y + obstacle.height);
}
