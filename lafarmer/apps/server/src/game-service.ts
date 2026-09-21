import { randomUUID } from "node:crypto";
import { getContentDefinition, isWorldTileWalkable, WORLD_HEIGHT_TILES, WORLD_WIDTH_TILES } from "@lafarmer/content";
import type { Direction, FarmItem, FarmItemView, MarketListing, MoveCommand, MoveResult, PlayerState, WorldSnapshot } from "./domain.js";
import type { FarmRepository, MarketRepository, PlayerRepository } from "./repositories.js";

const WORLD_BOUNDS = { minX: 0, maxX: WORLD_WIDTH_TILES - 1, minY: 0, maxY: WORLD_HEIGHT_TILES - 1 } as const;
const OFFLINE_CAP_SECONDS = 24 * 60 * 60;
export const OFFLINE_COINS_PER_MINUTE = 1;
export const ONLINE_COINS_PER_TICK = 10;
const ONLINE_TICK_MS = 60_000;
const PLANT_COST = 10;
const MAX_MARKET_QUANTITY = 10_000;
const MAX_MARKET_UNIT_PRICE = 1_000_000_000;

export type GameRepositories = { players: PlayerRepository; farm: FarmRepository; market: MarketRepository };

export class GameError extends Error {
  constructor(public readonly code: "player_not_found" | "invalid_action" | "invalid_direction" | "invalid_content" | "invalid_position" | "not_ready" | "insufficient_coins" | "farm_item_not_found" | "listing_not_found" | "invalid_quantity" | "invalid_price" | "cannot_buy_own_listing" | "invalid_animal") { super(code); }
}

export class GameService {
  private readonly actionReceipts = new Map<string, MoveResult>();
  private readonly activePlayers = new Map<string, PlayerState>();
  private readonly pendingPersist = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(private readonly repositories: GameRepositories, private readonly now: () => number = () => Date.now()) {}

  async snapshot(playerId: string): Promise<WorldSnapshot> {
    const player = await this.resume(playerId);
    const [persistedPlayers, farmItems, listings] = await Promise.all([this.repositories.players.listAll(), this.repositories.farm.listAll(), this.repositories.market.listActive()]);
    const players = persistedPlayers.map((candidate) => this.activePlayers.get(candidate.id) ?? candidate);
    return { bounds: WORLD_BOUNDS, player, players: players.filter((candidate) => candidate.id !== playerId), farmItems: farmItems.map((item) => this.toView(item)), listings };
  }

  async resume(playerId: string): Promise<PlayerState> {
    await this.flushPending(playerId);
    const updated = await this.repositories.players.accrueOffline(playerId, this.now(), OFFLINE_CAP_SECONDS, OFFLINE_COINS_PER_MINUTE);
    if (!updated) throw new GameError("player_not_found");
    this.activePlayers.set(updated.id, updated);
    return updated;
  }

  async onlineTick(playerId: string): Promise<PlayerState> {
    const updated = await this.repositories.players.creditCoins(playerId, ONLINE_COINS_PER_TICK, this.now());
    if (!updated) throw new GameError("player_not_found");
    this.activePlayers.set(updated.id, updated);
    return updated;
  }

  async move(playerId: string, command: MoveCommand): Promise<MoveResult> {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(command.actionId)) throw new GameError("invalid_action");
    if (!isDirection(command.direction)) throw new GameError("invalid_direction");
    const receiptKey = `${playerId}:${command.actionId}`;
    const previous = this.actionReceipts.get(receiptKey);
    if (previous) return previous;
    const player = await this.requirePlayer(playerId);
    const position = { x: Math.round(player.position.x), y: Math.round(player.position.y) };
    if (command.direction === "up") position.y -= 1;
    if (command.direction === "down") position.y += 1;
    if (command.direction === "left") position.x -= 1;
    if (command.direction === "right") position.x += 1;
    const nextPosition = isWorldTileWalkable(position.x, position.y) ? position : player.position;
    const updated: PlayerState = { ...player, lastActiveAt: this.now(), position: nextPosition };
    await this.savePlayer(updated, false);
    const result: MoveResult = { actionId: command.actionId, accepted: true, player: updated };
    this.actionReceipts.set(receiptKey, result);
    return result;
  }

  async plant(playerId: string, input: { contentId: string; x?: number; y?: number }): Promise<FarmItemView> {
    const definition = getContentDefinition(input.contentId);
    if (!definition || !["plant", "fruit"].includes(definition.category)) throw new GameError("invalid_content");
    const player = await this.requirePlayer(playerId);
    const x = input.x ?? player.position.x;
    const y = input.y ?? player.position.y;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < WORLD_BOUNDS.minX || x > WORLD_BOUNDS.maxX || y < WORLD_BOUNDS.minY || y > WORLD_BOUNDS.maxY || Math.abs(x - player.position.x) > 8 || Math.abs(y - player.position.y) > 8 || !isWorldTileWalkable(Math.round(x), Math.round(y))) throw new GameError("invalid_position");
    if (player.coins < PLANT_COST) throw new GameError("insufficient_coins");
    const item: FarmItem = { id: randomUUID(), ownerId: playerId, contentId: definition.id, plantedAt: this.now(), lastCareAt: null, position: { x, y } };
    await this.repositories.farm.insert(item);
    await this.savePlayer({ ...player, coins: player.coins - PLANT_COST, lastActiveAt: this.now() });
    return this.toView(item);
  }

  async adopt(playerId: string, input: { contentId: string; x?: number; y?: number }): Promise<FarmItemView> {
    const definition = getContentDefinition(input.contentId);
    if (!definition || !["animal", "dinosaur"].includes(definition.category)) throw new GameError("invalid_animal");
    const player = await this.requirePlayer(playerId);
    const x = input.x ?? player.position.x; const y = input.y ?? player.position.y;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < WORLD_BOUNDS.minX || x > WORLD_BOUNDS.maxX || y < WORLD_BOUNDS.minY || y > WORLD_BOUNDS.maxY || Math.abs(x - player.position.x) > 8 || Math.abs(y - player.position.y) > 8 || !isWorldTileWalkable(Math.round(x), Math.round(y))) throw new GameError("invalid_position");
    const cost = definition.category === "dinosaur" ? 300 : 100;
    if (player.coins < cost) throw new GameError("insufficient_coins");
    const item: FarmItem = { id: randomUUID(), ownerId: playerId, contentId: definition.id, plantedAt: this.now(), lastCareAt: null, position: { x, y } };
    await this.repositories.farm.insert(item);
    await this.savePlayer({ ...player, coins: player.coins - cost, lastActiveAt: this.now() });
    return this.toView(item);
  }

  async care(playerId: string, itemId: string): Promise<FarmItemView> {
    const item = await this.findOwnedItem(playerId, itemId);
    const updated = { ...item, lastCareAt: this.now() };
    await this.repositories.farm.update(updated);
    return this.toView(updated);
  }

  async harvest(playerId: string, itemId: string): Promise<{ item: FarmItemView; coins: number; inventory: Record<string, number> }> {
    const item = await this.findOwnedItem(playerId, itemId);
    const view = this.toView(item);
    if (!view.ready) throw new GameError("not_ready");
    const player = await this.requirePlayer(playerId);
    const inventory = { ...player.inventory, [item.contentId]: (player.inventory[item.contentId] ?? 0) + 1 };
    await this.repositories.farm.delete(item.id);
    await this.savePlayer({ ...player, inventory, lastActiveAt: this.now() });
    return { item: view, coins: player.coins, inventory };
  }

  async collect(playerId: string, itemId: string): Promise<{ item: FarmItemView; inventory: Record<string, number> }> {
    const item = await this.findOwnedItem(playerId, itemId);
    const definition = getContentDefinition(item.contentId);
    if (!definition || !["animal", "dinosaur"].includes(definition.category)) throw new GameError("invalid_animal");
    const view = this.toView(item);
    if (!view.ready) throw new GameError("not_ready");
    const player = await this.requirePlayer(playerId);
    const produceId = item.contentId === "cow" ? "milk" : "dinosaur-egg";
    const inventory = { ...player.inventory, [produceId]: (player.inventory[produceId] ?? 0) + 1 };
    const updated = { ...item, lastCareAt: this.now() };
    await this.repositories.farm.update(updated);
    await this.savePlayer({ ...player, inventory, lastActiveAt: this.now() });
    return { item: this.toView(updated), inventory };
  }

  async createListing(playerId: string, input: { contentId: string; quantity: number; unitPrice: number }): Promise<MarketListing> {
    const definition = getContentDefinition(input.contentId);
    if (!definition) throw new GameError("invalid_content");
    if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > MAX_MARKET_QUANTITY) throw new GameError("invalid_quantity");
    if (!Number.isInteger(input.unitPrice) || input.unitPrice < 1 || input.unitPrice > MAX_MARKET_UNIT_PRICE) throw new GameError("invalid_price");
    const player = await this.requirePlayer(playerId);
    if ((player.inventory[input.contentId] ?? 0) < input.quantity) throw new GameError("invalid_quantity");
    const listing: MarketListing = { id: randomUUID(), sellerId: playerId, sellerName: player.name, contentId: input.contentId, quantity: input.quantity, unitPrice: input.unitPrice, createdAt: this.now() };
    let result;
    try { result = await this.repositories.market.createListing(listing); } catch (error) { throw asGameError(error); }
    this.activePlayers.set(result.player.id, result.player);
    return result.listing;
  }

  async buyListing(playerId: string, listingId: string, idempotencyKey = listingId): Promise<{ listing: MarketListing; coins: number; inventory: Record<string, number>; replayed: boolean }> {
    if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(idempotencyKey)) throw new GameError("invalid_action");
    let result;
    try { result = await this.repositories.market.purchaseListing(listingId, playerId, idempotencyKey); } catch (error) { throw asGameError(error); }
    this.activePlayers.set(result.buyer.id, result.buyer);
    this.activePlayers.set(result.seller.id, result.seller);
    return { listing: result.listing, coins: result.buyer.coins, inventory: result.buyer.inventory, replayed: result.replayed };
  }

  private async findOwnedItem(playerId: string, itemId: string): Promise<FarmItem> {
    const item = (await this.repositories.farm.listByOwnerId(playerId)).find((candidate) => candidate.id === itemId);
    if (!item) throw new GameError("farm_item_not_found");
    return item;
  }

  private async requirePlayer(playerId: string): Promise<PlayerState> {
    const active = this.activePlayers.get(playerId);
    if (active) return active;
    const player = await this.repositories.players.findById(playerId);
    if (!player) throw new GameError("player_not_found");
    const position = isWorldTileWalkable(Math.round(player.position.x), Math.round(player.position.y))
      ? { x: Math.round(player.position.x), y: Math.round(player.position.y) }
      : { x: 5, y: 5 };
    const normalized = position.x === player.position.x && position.y === player.position.y ? player : { ...player, position };
    this.activePlayers.set(playerId, normalized);
    if (normalized !== player) await this.repositories.players.update(normalized);
    return normalized;
  }

  private async savePlayer(player: PlayerState, immediate = true): Promise<void> {
    this.activePlayers.set(player.id, player);
    if (!immediate) {
      if (this.pendingPersist.has(player.id)) return;
      const timer = setTimeout(() => {
        this.pendingPersist.delete(player.id);
        const current = this.activePlayers.get(player.id);
        if (current) void this.repositories.players.update(current);
      }, 350);
      this.pendingPersist.set(player.id, timer);
      return;
    }
    const pending = this.pendingPersist.get(player.id);
    if (pending) { clearTimeout(pending); this.pendingPersist.delete(player.id); }
    await this.repositories.players.update(player);
  }

  private async flushPending(playerId: string): Promise<void> {
    const pending = this.pendingPersist.get(playerId);
    if (!pending) return;
    clearTimeout(pending);
    this.pendingPersist.delete(playerId);
    const current = this.activePlayers.get(playerId);
    if (current) await this.repositories.players.update(current);
  }

  private toView(item: FarmItem): FarmItemView {
    const definition = getContentDefinition(item.contentId);
    if (!definition) throw new GameError("invalid_content");
    const definitionIsAnimal = definition.category === "animal" || definition.category === "dinosaur";
    const cooldownSeconds = definitionIsAnimal && item.lastCareAt ? 300 : 0;
    const elapsed = Math.max(0, (this.now() - (definitionIsAnimal && item.lastCareAt ? item.plantedAt : item.plantedAt)) / 1_000);
    let remaining = elapsed;
    let stage = definition.stages[0];
    for (const candidate of definition.stages.slice(1)) {
      remaining -= candidate.durationSeconds;
      if (remaining >= 0) stage = candidate;
      else break;
    }
    const ready = stage === definition.stages.at(-1) && (!cooldownSeconds || (this.now() - item.lastCareAt!) / 1_000 >= cooldownSeconds);
    return { ...item, stageId: stage.id, visualKey: stage.visualKey, ready };
  }
}

export const ONLINE_TICK_INTERVAL_MS = ONLINE_TICK_MS;

function isDirection(value: string): value is Direction { return value === "up" || value === "down" || value === "left" || value === "right"; }
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }

function asGameError(error: unknown): Error {
  const code = error instanceof Error ? error.message : "";
  const codes: GameError["code"][] = ["player_not_found", "invalid_quantity", "listing_not_found", "cannot_buy_own_listing", "insufficient_coins"];
  return codes.includes(code as GameError["code"]) ? new GameError(code as GameError["code"]) : error instanceof Error ? error : new Error("market_failed");
}
