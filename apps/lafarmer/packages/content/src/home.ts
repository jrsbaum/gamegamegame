export type HomeFurnitureType =
  | "sofa"
  | "radio"
  | "dining-table"
  | "fridge"
  | "stove"
  | "work-desk"
  | "office-chair"
  | "bed"
  | "wardrobe"
  | "bathtub"
  | "sink"
  | "plant"
  | "bookshelf";

export type HomeInteraction = "radio" | "work" | "rest";
export type HomeFurnitureDefinition = {
  type: HomeFurnitureType;
  label: string;
  width: number;
  height: number;
  initial: { x: number; y: number };
  interaction?: HomeInteraction;
};

export type HomeFurniture = { id: string; type: HomeFurnitureType; x: number; y: number };

export const HOME_WIDTH_TILES = 22;
export const HOME_HEIGHT_TILES = 14;
export const HOME_EXTERIOR_DOOR = { x: 30, y: 47 } as const;
export const HOME_INTERIOR_DOOR = { x: 10, y: 12 } as const;
export const HOME_ROOMS = [
  { id: "living-kitchen", label: "Sala e cozinha", x: 1, y: 1, width: 20, height: 6 },
  { id: "office", label: "Escritório", x: 1, y: 8, width: 6, height: 5 },
  { id: "bedroom", label: "Quarto", x: 8, y: 8, width: 6, height: 5 },
  { id: "bathroom", label: "Banheiro", x: 15, y: 8, width: 6, height: 5 }
] as const;

export const HOME_FURNITURE_CATALOG: readonly HomeFurnitureDefinition[] = [
  { type: "sofa", label: "Sofá", width: 2, height: 1, initial: { x: 2, y: 2 }, interaction: "rest" },
  { type: "radio", label: "Rádio", width: 1, height: 1, initial: { x: 5, y: 2 }, interaction: "radio" },
  { type: "dining-table", label: "Mesa de jantar", width: 2, height: 2, initial: { x: 11, y: 2 } },
  { type: "fridge", label: "Geladeira", width: 1, height: 2, initial: { x: 19, y: 2 } },
  { type: "stove", label: "Fogão", width: 1, height: 1, initial: { x: 17, y: 4 } },
  { type: "plant", label: "Planta", width: 1, height: 1, initial: { x: 2, y: 5 } },
  { type: "bookshelf", label: "Estante", width: 2, height: 1, initial: { x: 5, y: 5 } },
  { type: "work-desk", label: "Mesa de trabalho", width: 2, height: 1, initial: { x: 2, y: 9 }, interaction: "work" },
  { type: "office-chair", label: "Cadeira", width: 1, height: 1, initial: { x: 5, y: 10 } },
  { type: "bed", label: "Cama", width: 3, height: 2, initial: { x: 9, y: 9 }, interaction: "rest" },
  { type: "wardrobe", label: "Guarda-roupa", width: 1, height: 2, initial: { x: 12, y: 10 } },
  { type: "bathtub", label: "Banheira", width: 2, height: 1, initial: { x: 16, y: 9 } },
  { type: "sink", label: "Pia", width: 1, height: 1, initial: { x: 19, y: 11 } }
] as const;

export const DEFAULT_HOME_FURNITURE: readonly HomeFurniture[] = HOME_FURNITURE_CATALOG.map((definition) => ({
  id: definition.type,
  type: definition.type,
  ...definition.initial
}));

export function getHomeFurnitureDefinition(type: string): HomeFurnitureDefinition | undefined {
  return HOME_FURNITURE_CATALOG.find((definition) => definition.type === type);
}

export function isHomeWallTile(x: number, y: number): boolean {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return true;
  if (x <= 0 || x >= HOME_WIDTH_TILES - 1 || y <= 0 || y >= HOME_HEIGHT_TILES - 1) {
    return !(y === HOME_HEIGHT_TILES - 1 && x === HOME_INTERIOR_DOOR.x);
  }
  if (y === 7 && ![3, 10, 17].includes(x)) return true;
  if (x === 7 && y >= 8 && y <= 12 && y !== 10) return true;
  if (x === 14 && y >= 8 && y <= 12 && y !== 10) return true;
  return false;
}

export function isHomeFurniturePlacementValid(
  furniture: readonly HomeFurniture[],
  furnitureId: string,
  x: number,
  y: number
): boolean {
  const item = furniture.find((candidate) => candidate.id === furnitureId);
  const definition = item && getHomeFurnitureDefinition(item.type);
  if (!item || !definition || !Number.isInteger(x) || !Number.isInteger(y)) return false;
  if (x < 1 || y < 1 || x + definition.width > HOME_WIDTH_TILES - 1 || y + definition.height > HOME_HEIGHT_TILES - 1) return false;
  for (let tileY = y; tileY < y + definition.height; tileY += 1) {
    for (let tileX = x; tileX < x + definition.width; tileX += 1) {
      if (isHomeWallTile(tileX, tileY)) return false;
      const overlaps = furniture.some((other) => {
        if (other.id === furnitureId) return false;
        const otherDefinition = getHomeFurnitureDefinition(other.type);
        return Boolean(otherDefinition && tileX >= other.x && tileX < other.x + otherDefinition.width && tileY >= other.y && tileY < other.y + otherDefinition.height);
      });
      if (overlaps) return false;
    }
  }
  return true;
}

export function isHomeTileWalkable(x: number, y: number, furniture: readonly HomeFurniture[]): boolean {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 1 || y < 1 || x >= HOME_WIDTH_TILES - 1 || y >= HOME_HEIGHT_TILES - 1 || isHomeWallTile(x, y)) return false;
  return !furniture.some((item) => {
    const definition = getHomeFurnitureDefinition(item.type);
    return Boolean(definition && x >= item.x && x < item.x + definition.width && y >= item.y && y < item.y + definition.height);
  });
}

export function createDefaultHomeFurniture(): HomeFurniture[] {
  return DEFAULT_HOME_FURNITURE.map((item) => ({ ...item }));
}
