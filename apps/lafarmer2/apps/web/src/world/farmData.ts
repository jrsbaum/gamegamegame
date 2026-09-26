import { isClothing, isHairStyle, type Clothing, type HairStyle } from "@lafarmer2/content";
import { isStructureType, type StructureType } from "./structures";

/*
 * What the server sends about farms and players, read defensively: anything malformed is dropped
 * instead of reaching the scene.
 */

export type TilePoint = { x: number; y: number };

export type FarmItemData = {
  id: string;
  ownerId: string;
  contentId: string;
  structureId: string | null;
  x: number;
  y: number;
  stageId: string;
  ready: boolean;
  pendingQuantity: number;
  plantedAt: number;
  nextProductionAt: number | null;
  careState: string;
  behaviorState: string;
  variant: string;
};

export type StructureData = {
  id: string;
  ownerId: string;
  type: StructureType;
  footprint: Array<[number, number]>;
  regionId: string;
};

export type PlayerData = {
  id: string;
  name: string;
  farmName: string;
  regionId: string;
  x: number;
  y: number;
  clothing: Clothing;
  hair: HairStyle;
};

type Raw = Record<string, unknown>;

const record = (value: unknown): Raw | undefined => (value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : undefined);
const text = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);
const finite = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

const tilePoint = (value: unknown): TilePoint | undefined => {
  const point = record(value);
  const x = finite(point?.x);
  const y = finite(point?.y);
  return x === undefined || y === undefined ? undefined : { x: Math.round(x), y: Math.round(y) };
};

export const parseFarmItem = (value: unknown): FarmItemData | undefined => {
  const raw = record(value);
  const position = tilePoint(raw?.position);
  const id = text(raw?.id);
  const contentId = text(raw?.contentId);
  if (!raw || !position || !id || !contentId) return undefined;
  return {
    id,
    ownerId: text(raw.ownerId),
    contentId,
    structureId: typeof raw.structureId === "string" ? raw.structureId : null,
    x: position.x,
    y: position.y,
    stageId: text(raw.stageId),
    ready: raw.ready === true,
    pendingQuantity: Math.max(0, finite(raw.pendingQuantity) ?? 0),
    plantedAt: finite(raw.plantedAt) ?? Date.now(),
    nextProductionAt: finite(raw.nextProductionAt) ?? null,
    careState: text(raw.careState, "attended"),
    behaviorState: text(raw.behaviorState, "idle"),
    variant: text(raw.appearanceVariantId, "default")
  };
};

export const parseStructure = (value: unknown, fallbackOwner = ""): StructureData | undefined => {
  const raw = record(value);
  const id = text(raw?.id);
  const type = text(raw?.type);
  if (!raw || !id || !isStructureType(type) || !Array.isArray(raw.footprint)) return undefined;
  const footprint: Array<[number, number]> = [];
  for (const corner of raw.footprint) {
    if (!Array.isArray(corner)) return undefined;
    const x = finite(corner[0]);
    const y = finite(corner[1]);
    if (x === undefined || y === undefined) return undefined;
    footprint.push([Math.round(x), Math.round(y)]);
  }
  if (footprint.length < 3) return undefined;
  return { id, ownerId: text(raw.ownerId, fallbackOwner), type, footprint, regionId: text(raw.regionId) };
};

export const parsePlayer = (value: unknown): PlayerData | undefined => {
  const raw = record(value);
  const position = tilePoint(raw?.position);
  const id = text(raw?.id);
  if (!raw || !position || !id) return undefined;
  const appearance = record(raw.appearance);
  return {
    id,
    name: text(raw.name, "Vizinho"),
    farmName: text(raw.farmName),
    regionId: text(raw.currentRegionId) || text(raw.homeRegionId),
    x: position.x,
    y: position.y,
    clothing: isClothing(appearance?.clothing) ? appearance.clothing : "forest",
    hair: isHairStyle(appearance?.hair) ? appearance.hair : "short"
  };
};

/** Parses a list, keeping the entries that make sense. */
export const parseList = <T>(value: unknown, parse: (entry: unknown) => T | undefined): T[] => {
  if (!Array.isArray(value)) return [];
  const list: T[] = [];
  for (const entry of value) {
    const parsed = parse(entry);
    if (parsed) list.push(parsed);
  }
  return list;
};
