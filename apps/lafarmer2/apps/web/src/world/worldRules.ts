import {
  MARKET_TILE,
  WORLD_CONNECTIONS,
  getContentDefinition,
  getWorldRegion,
  isWorldTileWalkable
} from "@lafarmer2/content";
import { insideTiles, type TileRect } from "./structures";
import type { Direction } from "./movement";
import type { TilePoint } from "./farmData";

/*
 * What the player can do from where they stand, and which tiles the body may enter.
 * The server stays in charge; this only chooses the same action the server would accept.
 */

const REACH = 2;
const PLANT_REACH = 8;
const MARKET_REACH = 4;
const ADOPT_MARGIN = 2;

const CAPACITY: Record<string, number> = { animal_pen: 4, dinosaur_enclosure: 3 };

const ERROR_TEXT: Record<string, string> = {
  invalid_position: "Esse chão não serve para isso.",
  invalid_content: "Isso não pode ser feito agora.",
  invalid_animal: "Esse animal não pode ser adotado aqui.",
  insufficient_inputs: "Falta o insumo no estoque.",
  specialization_locked: "Isso não é da especialização da fazenda.",
  structure_required: "Falta o curral ou o recinto.",
  structure_full: "Não cabe mais ninguém aí.",
  inventory_full: "O estoque está cheio.",
  not_ready: "Ainda não está pronto.",
  insufficient_coins: "Faltam moedas.",
  not_at_connection: "Chegue mais perto da passagem.",
  not_neighbor: "Essa região não é vizinha.",
  region_not_found: "Ninguém mora nessa região.",
  farm_item_not_found: "Não encontrei essa produção.",
  invalid_structure: "Não dá para construir aqui.",
  invalid_action: "O passo não foi aceito.",
  invalid_direction: "Direção inválida.",
  player_not_found: "Não encontrei o jogador.",
  invalid_quantity: "Quantidade inválida.",
  invalid_price: "Preço inválido.",
  invalid_quality: "Essa qualidade não está no estoque.",
  listing_not_found: "Esse anúncio já saiu.",
  cannot_buy_own_listing: "Você não compra o próprio anúncio."
};

export const errorText = (code: string): string => ERROR_TEXT[code] ?? "Não deu para fazer isso agora.";

export const chebyshev = (a: TilePoint, b: TilePoint): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

export const stepTile = (tile: TilePoint, direction: Direction): TilePoint => {
  if (direction === "right") return { x: tile.x + 1, y: tile.y };
  if (direction === "left") return { x: tile.x - 1, y: tile.y };
  if (direction === "down") return { x: tile.x, y: tile.y + 1 };
  return { x: tile.x, y: tile.y - 1 };
};

export type RuleStructure = { id: string; ownerId: string; type: string; tiles: TileRect; regionId: string };

export type RuleItem = {
  id: string;
  ownerId: string;
  contentId: string;
  structureId: string | null;
  x: number;
  y: number;
  ready: boolean;
  pendingQuantity: number;
  careState: string;
};

export type RulePresence = { homeRegionId: string | null };

export type VisitAction = { kind: "visit"; regionId: string; label: string; hud: string; tile: TilePoint };
export type WorkAction = { kind: "work"; itemId: string; action: "farm.harvest" | "farm.collect" | "farm.care"; label: string; hud: string; tile: TilePoint };
export type MarketAction = { kind: "market"; label: string; hud: string; tile: TilePoint };
export type PlantAction = { kind: "plant"; contentId: string; label: string; hud: string; tile: TilePoint };
export type AdoptAction = { kind: "adopt"; contentId: "cow" | "dinosaur"; label: string; hud: string; tile: TilePoint };
export type PlayerAction = VisitAction | WorkAction | MarketAction | PlantAction | AdoptAction;

export type ActionContext = {
  tile: TilePoint;
  facing: Direction;
  regionId: string;
  playerId: string;
  inventory: Record<string, number>;
  presence: readonly RulePresence[];
  structures: readonly RuleStructure[];
  items: readonly RuleItem[];
};

const withPrompt = (label: string): { label: string; hud: string } => ({ label, hud: `${label} · pressione E` });

/** Own buildings are always solid. A neighbour's building is solid unless the body is already inside it. */
export const tileBlocked = (tileX: number, tileY: number, standing: TilePoint, regionId: string, playerId: string, structures: readonly RuleStructure[]): boolean => {
  if (!isWorldTileWalkable(tileX, tileY)) return true;
  for (const structure of structures) {
    if (structure.regionId && structure.regionId !== regionId) continue;
    if (!insideTiles(structure.tiles, tileX, tileY)) continue;
    if (!structure.ownerId || structure.ownerId === playerId) return true;
    if (insideTiles(structure.tiles, standing.x, standing.y)) continue;
    return true;
  }
  return false;
};

const occupied = (items: readonly RuleItem[], tile: TilePoint): boolean => items.some((item) => item.x === tile.x && item.y === tile.y);

const workAction = (item: RuleItem): WorkAction["action"] | undefined => {
  const creature = item.contentId === "cow" || item.contentId === "dinosaur";
  if (creature) {
    if (item.ready || item.pendingQuantity > 0) return "farm.collect";
    if (item.careState === "awaiting-care") return "farm.care";
    return undefined;
  }
  if (item.ready) return "farm.harvest";
  if (item.careState === "awaiting-care") return "farm.care";
  return undefined;
};

const displayName = (contentId: string): string => getContentDefinition(contentId)?.displayName ?? "produção";

const nearestWork = (context: ActionContext): WorkAction | undefined => {
  let best: { item: RuleItem; action: WorkAction["action"]; distance: number } | undefined;
  for (const item of context.items) {
    if (item.ownerId !== context.playerId) continue;
    const action = workAction(item);
    if (!action) continue;
    const distance = chebyshev(context.tile, item);
    if (distance > REACH) continue;
    if (!best || distance < best.distance) best = { item, action, distance };
  }
  if (!best) return undefined;
  const verb = best.action === "farm.care" ? "Cuidar de" : "Colher";
  const text = withPrompt(`${verb} ${displayName(best.item.contentId)}`);
  return { kind: "work", itemId: best.item.id, action: best.action, tile: { x: best.item.x, y: best.item.y }, ...text };
};

const visit = (context: ActionContext): VisitAction | undefined => {
  for (const connection of WORLD_CONNECTIONS) {
    const outgoing = connection.fromRegionId === context.regionId;
    if (!outgoing && connection.toRegionId !== context.regionId) continue;
    const regionId = outgoing ? connection.toRegionId : connection.fromRegionId;
    if (!context.presence.some((presence) => presence.homeRegionId === regionId)) continue;
    const tile = outgoing ? connection.entry : connection.exit;
    if (chebyshev(context.tile, tile) > 3) continue;
    const region = getWorldRegion(regionId);
    const passage = connection.kind === "bridge" ? "Ponte" : connection.kind === "gate" ? "Porteira" : "Passagem";
    const text = withPrompt(`${passage} para ${region?.name ?? "a região vizinha"}`);
    return { kind: "visit", regionId, tile: { x: tile.x, y: tile.y }, ...text };
  }
  return undefined;
};

const market = (context: ActionContext): MarketAction | undefined => {
  const tile = { x: MARKET_TILE.x + MARKET_TILE.width / 2, y: MARKET_TILE.y + MARKET_TILE.height / 2 };
  if (chebyshev(context.tile, tile) > MARKET_REACH) return undefined;
  const text = withPrompt("Mercadinho do vale");
  return { kind: "market", tile, ...text };
};

const PLANTABLE = [
  { contentId: "tomato", seed: "tomato-seed", structure: "field" },
  { contentId: "orange-tree", seed: "orange-seed", structure: "orchard" }
] as const;

const insetTiles = (tiles: TileRect): TileRect => {
  const inner = { x0: tiles.x0 + 1, y0: tiles.y0 + 1, x1: tiles.x1 - 1, y1: tiles.y1 - 1 };
  return inner.x1 > inner.x0 && inner.y1 > inner.y0 ? inner : tiles;
};

const nearestPlant = (context: ActionContext): PlantAction | undefined => {
  let best: { contentId: string; tile: TilePoint; distance: number } | undefined;
  const ownedSeeds = PLANTABLE.filter((crop) => (context.inventory[crop.seed] ?? 0) > 0);
  for (const crop of ownedSeeds) {
    for (const structure of context.structures) {
      if (structure.ownerId !== context.playerId || structure.type !== crop.structure) continue;
      if (structure.regionId && structure.regionId !== context.regionId) continue;
      const area = insetTiles(structure.tiles);
      for (let y = area.y0; y < area.y1; y += 1) {
        for (let x = area.x0; x < area.x1; x += 1) {
          const tile = { x, y };
          if (chebyshev(context.tile, tile) > PLANT_REACH) continue;
          if (!isWorldTileWalkable(x, y) || occupied(context.items, tile)) continue;
          const distance = chebyshev(context.tile, tile);
          if (!best || distance < best.distance) best = { contentId: crop.contentId, tile, distance };
        }
      }
    }
  }
  const tile = best?.tile ?? stepTile(context.tile, context.facing);
  const contentId = best?.contentId ?? ownedSeeds[0]?.contentId;
  if (!contentId) return undefined;
  if (!best && (chebyshev(context.tile, tile) > PLANT_REACH || !isWorldTileWalkable(tile.x, tile.y) || occupied(context.items, tile))) return undefined;
  const text = withPrompt(`Plantar ${displayName(contentId)}`);
  return { kind: "plant", contentId, tile, ...text };
};

const nearFootprint = (tiles: TileRect, tile: TilePoint): boolean =>
  tile.x >= tiles.x0 - ADOPT_MARGIN && tile.x < tiles.x1 + ADOPT_MARGIN && tile.y >= tiles.y0 - ADOPT_MARGIN && tile.y < tiles.y1 + ADOPT_MARGIN;

const housed = (items: readonly RuleItem[], structureId: string): number => items.filter((item) => item.structureId === structureId).length;

const nearestAdopt = (context: ActionContext): AdoptAction | undefined => {
  const options: Array<{ contentId: "cow" | "dinosaur"; type: string; hasInput: boolean }> = [
    { contentId: "cow", type: "animal_pen", hasInput: (context.inventory.feed ?? 0) > 0 },
    {
      contentId: "dinosaur",
      type: "dinosaur_enclosure",
      hasInput: (context.inventory["dinosaur-egg"] ?? 0) > 0 || (context.inventory["dinosaur-fossil"] ?? 0) > 0
    }
  ];
  let best: { contentId: "cow" | "dinosaur"; tile: TilePoint; distance: number } | undefined;
  for (const option of options) {
    if (!option.hasInput) continue;
    const capacity = CAPACITY[option.type] ?? 0;
    for (const structure of context.structures) {
      if (structure.ownerId !== context.playerId || structure.type !== option.type) continue;
      if (structure.regionId && structure.regionId !== context.regionId) continue;
      if (housed(context.items, structure.id) >= capacity) continue;
      if (!nearFootprint(structure.tiles, context.tile)) continue;
      const tile = { x: Math.floor((structure.tiles.x0 + structure.tiles.x1) / 2), y: Math.floor((structure.tiles.y0 + structure.tiles.y1) / 2) };
      const distance = chebyshev(context.tile, tile);
      if (!best || distance < best.distance) best = { contentId: option.contentId, tile, distance };
    }
  }
  if (!best) return undefined;
  const text = withPrompt(`Adotar ${displayName(best.contentId)}`);
  return { kind: "adopt", contentId: best.contentId, tile: best.tile, ...text };
};

/** Connection, then own production, the market, planting, and adoption. */
export const pickAction = (context: ActionContext): PlayerAction | undefined =>
  visit(context) ?? nearestWork(context) ?? market(context) ?? nearestPlant(context) ?? nearestAdopt(context);
