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

export const CONTENT_CATALOG: readonly ContentDefinition[] = [
  {
    id: "tomato",
    displayName: "Tomate",
    category: "plant",
    capabilities: ["grow", "care", "harvest"],
    stages: [
      { id: "soil", visualKey: "tomato-soil", durationSeconds: 0 },
      { id: "sprout", visualKey: "tomato-sprout", durationSeconds: 600 },
      { id: "ready", visualKey: "tomato-ready", durationSeconds: 600 }
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
