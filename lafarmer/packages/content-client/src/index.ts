export type OutfitId = 'forest' | 'coral' | 'river';
export type HairId = 'short' | 'long';

export {
  FARM_BOUNDARY,
  INITIAL_REGION_IDS,
  ORIGIN_SHOP_OFFERS,
  WORLD_CONNECTIONS,
  WORLD_HEIGHT_TILES,
  WORLD_OBSTACLES,
  WORLD_REGIONS,
  WORLD_TILE_SIZE,
  WORLD_WIDTH_TILES,
  getWorldConnection,
  getWorldRegion,
  isInsideFarmBoundary,
  isWorldTileWalkable,
  isWorldWaterTile,
  riverColumnAt
} from '@lafarmer/content';
export type { OriginShopOffer, WorldConnection, WorldConnectionKind, WorldObstacle, WorldObstacleKind, WorldRegion } from '@lafarmer/content';

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
