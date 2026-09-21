export type ContentCategory = "plant" | "fruit" | "animal" | "dinosaur";

export type GrowthStage = {
  id: string;
  visualKey: string;
  durationSeconds: number;
};

export type ContentDefinition = {
  id: string;
  displayName: string;
  category: ContentCategory;
  capabilities: readonly string[];
  stages: readonly GrowthStage[];
};

export type Clothing = "forest" | "coral" | "river";
export type HairStyle = "short" | "long";

export type PlayerAppearance = {
  clothing: Clothing;
  hair: HairStyle;
};

export const STARTING_COINS = 1_000;

/** The shared playable footprint. Positions are tile coordinates, not pixels. */
export const WORLD_WIDTH_TILES = 40;
export const WORLD_HEIGHT_TILES = 30;
export const WORLD_TILE_SIZE = 48;

export type WorldObstacleKind = "tree" | "rock" | "barn" | "market" | "house";
export type WorldObstacle = { kind: WorldObstacleKind; x: number; y: number; width: number; height: number };

export const WORLD_OBSTACLES: readonly WorldObstacle[] = [
  { kind: "tree", x: 8, y: 5, width: 1, height: 1 },
  { kind: "tree", x: 9, y: 5, width: 1, height: 1 },
  { kind: "tree", x: 10, y: 6, width: 1, height: 1 },
  { kind: "tree", x: 33, y: 4, width: 1, height: 1 },
  { kind: "tree", x: 34, y: 5, width: 1, height: 1 },
  { kind: "tree", x: 32, y: 6, width: 1, height: 1 },
  { kind: "tree", x: 5, y: 22, width: 1, height: 1 },
  { kind: "tree", x: 6, y: 23, width: 1, height: 1 },
  { kind: "tree", x: 35, y: 23, width: 1, height: 1 },
  { kind: "rock", x: 19, y: 7, width: 1, height: 1 },
  { kind: "rock", x: 20, y: 7, width: 1, height: 1 },
  { kind: "rock", x: 21, y: 24, width: 2, height: 1 },
  { kind: "barn", x: 2, y: 8, width: 4, height: 3 },
  { kind: "market", x: 30, y: 17, width: 4, height: 3 },
  { kind: "house", x: 13, y: 22, width: 3, height: 2 }
] as const;

export function riverColumnAt(y: number): number {
  return 24 + Math.round(Math.sin(y * 0.55) * 1.25);
}

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

export const CONTENT_CATALOG: readonly ContentDefinition[] = [
  {
    id: "tomato",
    displayName: "Tomate",
    category: "plant",
    capabilities: ["grow", "care", "harvest"],
    stages: [
      { id: "soil", visualKey: "tomato-soil", durationSeconds: 0 },
      { id: "sprout", visualKey: "tomato-sprout", durationSeconds: 15 },
      { id: "ready", visualKey: "tomato-ready", durationSeconds: 30 }
    ]
  },
  {
    id: "orange-tree",
    displayName: "Laranjeira",
    category: "fruit",
    capabilities: ["grow", "care", "produce", "harvest"],
    stages: [
      { id: "sapling", visualKey: "orange-sapling", durationSeconds: 0 },
      { id: "tree", visualKey: "orange-tree", durationSeconds: 1_800 },
      { id: "producing", visualKey: "orange-tree-producing", durationSeconds: 1_200 }
    ]
  },
  {
    id: "cow",
    displayName: "Vaca",
    category: "animal",
    capabilities: ["feed", "care", "wander", "produce"],
    stages: [
      { id: "baby", visualKey: "cow-baby", durationSeconds: 0 },
      { id: "adult", visualKey: "cow-adult", durationSeconds: 3_600 }
    ]
  },
  {
    id: "dinosaur",
    displayName: "Dinossauro",
    category: "dinosaur",
    capabilities: ["incubate", "feed", "care", "wander", "produce"],
    stages: [
      { id: "fossil", visualKey: "dinosaur-fossil", durationSeconds: 2_700 },
      { id: "egg", visualKey: "dinosaur-egg", durationSeconds: 5_400 },
      { id: "hatchling", visualKey: "dinosaur-hatchling", durationSeconds: 10_800 },
      { id: "adult", visualKey: "dinosaur-adult", durationSeconds: 0 }
    ]
  }
] as const;

export function getContentDefinition(id: string): ContentDefinition | undefined {
  return CONTENT_CATALOG.find((definition) => definition.id === id);
}

export function isClothing(value: unknown): value is Clothing {
  return value === "forest" || value === "coral" || value === "river";
}

export function isHairStyle(value: unknown): value is HairStyle {
  return value === "short" || value === "long";
}

export function createDefaultAppearance(): PlayerAppearance {
  return { clothing: "forest", hair: "short" };
}
