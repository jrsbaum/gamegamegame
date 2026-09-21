export type ContentCategory = "plant" | "fruit" | "animal" | "dinosaur";
export type ContentKind = "crop" | "animal" | "dinosaur";
export type Quality = "common" | "good" | "perfect";
export type CareState = "awaiting-care" | "attended";
export type BehaviorState = "idle" | "wander" | "hungry" | "seekCare" | "eating" | "happy" | "produce";

export type GrowthStage = { id: string; visualKey: string; durationSeconds: number };
export type ContentInput = { itemId: string; quantity: number };
export type ContentOutput = { itemId: string; quantity: number; quality: Quality };

export type ContentDefinition = {
  id: string;
  version: number;
  displayName: string;
  category: ContentCategory;
  kind: ContentKind;
  capabilities: readonly string[];
  stages: readonly GrowthStage[];
  inputs: readonly ContentInput[];
  outputs: readonly ContentOutput[];
  cycleSeconds: number | null;
  purchaseCost: number;
  careProfile: { improvesQuality: boolean; needsCare: boolean };
  behaviorProfile: { initialState: BehaviorState; states: readonly BehaviorState[] };
  visualVariants: readonly string[];
};

export type Clothing = "forest" | "coral" | "river";
export type HairStyle = "short" | "long";
export type PlayerAppearance = { clothing: Clothing; hair: HairStyle };

export const STARTING_COINS = 1_000;
export const INVENTORY_CAPACITY = 50;
export const ONLINE_REWARD_MULTIPLIER = 10;
export const OFFLINE_COINS_PER_HOUR = 12;
export const ONLINE_COINS_PER_HOUR = OFFLINE_COINS_PER_HOUR * ONLINE_REWARD_MULTIPLIER;

export const ITEM_CATALOG = [
  { id: "tomato-seed", displayName: "Semente de tomate" },
  { id: "orange-seed", displayName: "Semente de laranja" },
  { id: "dinosaur-fossil", displayName: "Fóssil de dinossauro" },
  { id: "tomato", displayName: "Tomate" },
  { id: "orange", displayName: "Laranja" },
  { id: "milk", displayName: "Leite" },
  { id: "dinosaur-egg", displayName: "Ovo de dinossauro" },
  { id: "feed", displayName: "Ração" }
] as const;

const cropCare = { improvesQuality: true, needsCare: false } as const;
const creatureCare = { improvesQuality: true, needsCare: true } as const;

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
    id: "tomato", version: 1, displayName: "Tomate", category: "plant", kind: "crop",
    capabilities: ["grow", "care", "harvest"],
    inputs: [{ itemId: "tomato-seed", quantity: 1 }], outputs: [{ itemId: "tomato", quantity: 1, quality: "common" }],
    cycleSeconds: null, purchaseCost: 10, careProfile: cropCare,
    behaviorProfile: { initialState: "idle", states: ["idle", "happy"] }, visualVariants: ["default"],
    stages: [
      { id: "soil", visualKey: "tomato-soil", durationSeconds: 0 },
      { id: "sprout", visualKey: "tomato-sprout", durationSeconds: 600 },
      { id: "ready", visualKey: "tomato-ready", durationSeconds: 600 }
    ]
  },
  {
    id: "orange-tree", version: 1, displayName: "Laranjeira", category: "fruit", kind: "crop",
    capabilities: ["grow", "care", "produce", "harvest"],
    inputs: [{ itemId: "orange-seed", quantity: 1 }], outputs: [{ itemId: "orange", quantity: 1, quality: "common" }],
    cycleSeconds: 1_200, purchaseCost: 10, careProfile: cropCare,
    behaviorProfile: { initialState: "idle", states: ["idle", "happy"] }, visualVariants: ["default"],
    stages: [
      { id: "sapling", visualKey: "orange-sapling", durationSeconds: 0 },
      { id: "tree", visualKey: "orange-tree", durationSeconds: 1_800 },
      { id: "producing", visualKey: "orange-tree-producing", durationSeconds: 0 }
    ]
  },
  {
    id: "cow", version: 1, displayName: "Vaca", category: "animal", kind: "animal",
    capabilities: ["feed", "care", "wander", "produce", "move"],
    inputs: [{ itemId: "feed", quantity: 1 }], outputs: [{ itemId: "milk", quantity: 1, quality: "common" }],
    cycleSeconds: 3_600, purchaseCost: 100, careProfile: creatureCare,
    behaviorProfile: { initialState: "idle", states: ["idle", "wander", "hungry", "seekCare", "eating", "happy", "produce"] },
    visualVariants: ["default", "brown", "spotted"],
    stages: [
      { id: "baby", visualKey: "cow-baby", durationSeconds: 0 },
      { id: "adult", visualKey: "cow-adult", durationSeconds: 3_600 }
    ]
  },
  {
    id: "dinosaur", version: 1, displayName: "Dinossauro", category: "dinosaur", kind: "dinosaur",
    capabilities: ["incubate", "feed", "care", "wander", "produce", "move"],
    inputs: [{ itemId: "dinosaur-fossil", quantity: 1 }], outputs: [{ itemId: "dinosaur-egg", quantity: 1, quality: "common" }],
    cycleSeconds: 3_600, purchaseCost: 300, careProfile: creatureCare,
    behaviorProfile: { initialState: "idle", states: ["idle", "wander", "hungry", "seekCare", "eating", "happy", "produce"] },
    visualVariants: ["default", "fern", "amber"],
    stages: [
      { id: "fossil", visualKey: "dinosaur-fossil", durationSeconds: 0 },
      { id: "egg", visualKey: "dinosaur-egg", durationSeconds: 2_700 },
      { id: "hatchling", visualKey: "dinosaur-hatchling", durationSeconds: 5_400 },
      { id: "adult", visualKey: "dinosaur-adult", durationSeconds: 10_800 }
    ]
  }
] as const;

export function getContentDefinition(id: string): ContentDefinition | undefined {
  return CONTENT_CATALOG.find((definition) => definition.id === id);
}

export function isKnownItemId(id: string): boolean {
  return ITEM_CATALOG.some((item) => item.id === id);
}

export function validateContentCatalog(catalog: readonly ContentDefinition[] = CONTENT_CATALOG): void {
  const ids = new Set<string>();
  for (const definition of catalog) {
    if (!definition.id || ids.has(definition.id)) throw new Error(`duplicate_content_id:${definition.id}`);
    ids.add(definition.id);
    if (!Number.isInteger(definition.version) || definition.version < 1 || !Number.isInteger(definition.purchaseCost) || definition.purchaseCost < 0) throw new Error(`invalid_definition:${definition.id}`);
    if (!definition.stages.length || definition.stages[0].durationSeconds !== 0) throw new Error(`invalid_initial_stage:${definition.id}`);
    const stageIds = new Set<string>();
    for (const stage of definition.stages) {
      if (!stage.id || stageIds.has(stage.id) || !Number.isFinite(stage.durationSeconds) || stage.durationSeconds < 0) throw new Error(`invalid_stage:${definition.id}:${stage.id}`);
      stageIds.add(stage.id);
    }
    for (const input of definition.inputs) {
      if (!isKnownItemId(input.itemId) || !Number.isInteger(input.quantity) || input.quantity < 1) throw new Error(`invalid_input:${definition.id}`);
    }
    for (const output of definition.outputs) {
      if (!isKnownItemId(output.itemId) || !Number.isInteger(output.quantity) || output.quantity < 1) throw new Error(`invalid_output:${definition.id}`);
    }
    if (definition.capabilities.includes("produce") && !definition.outputs.length) throw new Error(`missing_output:${definition.id}`);
    if (definition.cycleSeconds !== null && (!Number.isFinite(definition.cycleSeconds) || definition.cycleSeconds <= 0)) throw new Error(`invalid_cycle:${definition.id}`);
    if (!definition.visualVariants.length) throw new Error(`missing_visual_variant:${definition.id}`);
  }
}

validateContentCatalog();

export function isClothing(value: unknown): value is Clothing {
  return value === "forest" || value === "coral" || value === "river";
}

export function isHairStyle(value: unknown): value is HairStyle {
  return value === "short" || value === "long";
}

export function createDefaultAppearance(): PlayerAppearance {
  return { clothing: "forest", hair: "short" };
}
