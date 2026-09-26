import { randomUUID } from "node:crypto";
import {
  HOME_EXTERIOR_DOOR, HOME_INTERIOR_DOOR,
  createDefaultHomeFurniture, getHomeFurnitureDefinition, isHomeFurniturePlacementValid,
  isHomeTileWalkable, type HomeFurniture
} from "@lafarmer/content";
import type { Direction, HomeRecord, PlayerState } from "./domain.js";
import type { HomeRepository, PlayerRepository } from "./repositories.js";

export type HomePose = "working" | "resting" | null;
export type HomeOccupant = {
  playerId: string;
  name: string;
  appearance: PlayerState["appearance"];
  position: { x: number; y: number };
  pose: HomePose;
};
export type HomeView = {
  ownerId: string;
  ownerName: string;
  regionId: string;
  doorOpen: boolean;
  furniture: HomeFurniture[];
};
export type HomeSnapshot = { home: HomeView; occupants: HomeOccupant[] };
export type HomeInteractionResult =
  | { kind: "pose"; occupant: HomeOccupant }
  | { kind: "radio"; started: true; playId: string; durationMs: number }
  | { kind: "radio"; started: false };

type HomeSession = {
  ownerId: string;
  occupant: HomeOccupant;
  returnRegionId: string;
  returnPosition: { x: number; y: number };
  poseTargetId: string | null;
};

const RADIO_DURATION_MS = 3_000;
const ENTRY_RADIUS_TILES = 2;
const INTERACTION_RADIUS_TILES = 2;
const STEP: Record<Direction, { x: number; y: number }> = {
  up: { x: 0, y: -1 }, "up-right": { x: 1, y: -1 }, right: { x: 1, y: 0 }, "down-right": { x: 1, y: 1 },
  down: { x: 0, y: 1 }, "down-left": { x: -1, y: 1 }, left: { x: -1, y: 0 }, "up-left": { x: -1, y: -1 }
};

export class HomeError extends Error {
  constructor(public readonly code:
    | "player_not_found" | "home_not_found" | "region_not_found" | "not_at_home_door" | "home_closed"
    | "already_inside_home" | "not_inside_home" | "not_home_owner" | "invalid_home_position"
    | "invalid_home_furniture" | "invalid_home_interaction" | "not_near_home_object") { super(code); }
}

export class HomeService {
  private readonly sessions = new Map<string, HomeSession>();
  private readonly radioUntil = new Map<string, number>();
  private readonly radioTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly players: PlayerRepository,
    private readonly homes: HomeRepository,
    private readonly now: () => number = () => Date.now()
  ) {}

  isInside(playerId: string): boolean { return this.sessions.has(playerId); }
  homeOwnerFor(playerId: string): string | undefined { return this.sessions.get(playerId)?.ownerId; }

  async ensurePlayerHome(playerId: string): Promise<HomeRecord | undefined> {
    let player = await this.requirePlayer(playerId);
    const regionId = player.homeRegionId ?? player.plot?.regionId;
    if (!regionId) return undefined;
    if (!player.homeRegionId) {
      player = { ...player, homeRegionId: regionId };
      await this.players.update(player);
    }
    return this.ensureOwnerHome(player);
  }

  async homeForRegion(regionId: string): Promise<HomeView | undefined> {
    const players = await this.players.listAll();
    const owner = players.find((candidate) => candidate.homeRegionId === regionId);
    if (!owner) return undefined;
    const home = await this.ensureOwnerHome(owner);
    return this.toView(home, owner);
  }

  async enter(playerId: string, regionId: string): Promise<HomeSnapshot> {
    if (this.sessions.has(playerId)) throw new HomeError("already_inside_home");
    const player = await this.requirePlayer(playerId);
    const owner = (await this.players.listAll()).find((candidate) => candidate.homeRegionId === regionId);
    if (!owner?.homeRegionId) throw new HomeError("home_not_found");
    const currentRegionId = player.currentRegionId ?? player.homeRegionId;
    if (currentRegionId !== regionId) throw new HomeError("not_at_home_door");
    if (distance(player.position, HOME_EXTERIOR_DOOR) > ENTRY_RADIUS_TILES) throw new HomeError("not_at_home_door");
    const home = await this.ensureOwnerHome(owner);
    if (!home.doorOpen && player.id !== owner.id) throw new HomeError("home_closed");

    const returnRegionId = currentRegionId;
    const returnPosition = { ...player.position };
    const fallbackRegionId = player.homeRegionId ?? currentRegionId;
    if (!fallbackRegionId) throw new HomeError("region_not_found");
    await this.players.update({ ...player, currentRegionId: fallbackRegionId, position: { ...HOME_EXTERIOR_DOOR }, lastActiveAt: this.now() });
    const occupant: HomeOccupant = {
      playerId, name: player.name, appearance: player.appearance, position: { ...HOME_INTERIOR_DOOR }, pose: null
    };
    this.sessions.set(playerId, { ownerId: owner.id, occupant, returnRegionId, returnPosition, poseTargetId: null });
    return this.snapshotAsync(owner.id);
  }

  async exit(playerId: string): Promise<{ regionId: string; position: { x: number; y: number }; homeOwnerId: string }> {
    const session = this.sessions.get(playerId);
    if (!session) throw new HomeError("not_inside_home");
    if (distance(session.occupant.position, HOME_INTERIOR_DOOR) > ENTRY_RADIUS_TILES) throw new HomeError("not_at_home_door");
    const player = await this.requirePlayer(playerId);
    await this.players.update({ ...player, currentRegionId: session.returnRegionId, position: { ...session.returnPosition }, lastActiveAt: this.now() });
    this.sessions.delete(playerId);
    if (![...this.sessions.values()].some((candidate) => candidate.ownerId === session.ownerId)) {
      this.radioUntil.delete(session.ownerId);
      const timer = this.radioTimers.get(session.ownerId);
      if (timer) clearTimeout(timer);
      this.radioTimers.delete(session.ownerId);
    }
    return { regionId: session.returnRegionId, position: { ...session.returnPosition }, homeOwnerId: session.ownerId };
  }

  move(playerId: string, direction: Direction, sprint = false): HomeOccupant {
    const session = this.sessions.get(playerId);
    if (!session) throw new HomeError("not_inside_home");
    const delta = STEP[direction];
    if (!delta) throw new HomeError("invalid_home_position");
    const steps = sprint ? 2 : 1;
    for (let step = 0; step < steps; step += 1) {
      const x = session.occupant.position.x + delta.x;
      const y = session.occupant.position.y + delta.y;
      if (!isHomeTileWalkable(x, y, this.homeFurniture(session.ownerId))) break;
      session.occupant.position = { x, y };
    }
    if (session.poseTargetId && !this.isNearObject(session.ownerId, session.occupant.position, session.poseTargetId)) {
      session.occupant.pose = null;
      session.poseTargetId = null;
    }
    return cloneOccupant(session.occupant);
  }

  async setDoor(playerId: string, doorOpen: boolean): Promise<HomeView> {
    const player = await this.requirePlayer(playerId);
    const home = await this.homes.findByOwnerId(playerId);
    if (!home) throw new HomeError("home_not_found");
    const updated = { ...home, doorOpen, updatedAt: this.now() };
    await this.homes.update(updated);
    return this.toView(updated, player);
  }

  async moveFurniture(playerId: string, furnitureId: string, x: number, y: number): Promise<HomeSnapshot> {
    const session = this.sessions.get(playerId);
    if (!session) throw new HomeError("not_inside_home");
    if (playerId !== session.ownerId) throw new HomeError("not_home_owner");
    if (!Number.isInteger(x) || !Number.isInteger(y)) throw new HomeError("invalid_home_position");
    const home = await this.homes.findByOwnerId(session.ownerId);
    if (!home) throw new HomeError("home_not_found");
    if (!isHomeFurniturePlacementValid(home.furniture, furnitureId, x, y)) throw new HomeError("invalid_home_furniture");
    const furniture = home.furniture.map((item) => item.id === furnitureId ? { ...item, x, y } : item);
    await this.homes.update({ ...home, furniture, updatedAt: this.now() });
    return this.snapshotAsync(session.ownerId);
  }

  async interact(playerId: string, furnitureId: string): Promise<HomeInteractionResult> {
    const session = this.sessions.get(playerId);
    if (!session) throw new HomeError("not_inside_home");
    const home = await this.homes.findByOwnerId(session.ownerId);
    if (!home) throw new HomeError("home_not_found");
    const furniture = home.furniture.find((item) => item.id === furnitureId);
    const definition = furniture && getHomeFurnitureDefinition(furniture.type);
    if (!furniture || !definition?.interaction) throw new HomeError("invalid_home_interaction");
    if (!this.isNearObject(session.ownerId, session.occupant.position, furnitureId)) throw new HomeError("not_near_home_object");

    if (definition.interaction === "radio") {
      if ((this.radioUntil.get(session.ownerId) ?? 0) > this.now()) return { kind: "radio", started: false };
      const playId = randomUUID();
      this.radioUntil.set(session.ownerId, this.now() + RADIO_DURATION_MS);
      const oldTimer = this.radioTimers.get(session.ownerId);
      if (oldTimer) clearTimeout(oldTimer);
      const timer = setTimeout(() => { this.radioUntil.delete(session.ownerId); this.radioTimers.delete(session.ownerId); }, RADIO_DURATION_MS);
      timer.unref?.();
      this.radioTimers.set(session.ownerId, timer);
      return { kind: "radio", started: true, playId, durationMs: RADIO_DURATION_MS };
    }

    session.occupant.pose = definition.interaction === "work" ? "working" : "resting";
    session.poseTargetId = furniture.id;
    return { kind: "pose", occupant: cloneOccupant(session.occupant) };
  }

  async snapshotAsync(ownerId: string): Promise<HomeSnapshot> {
    const home = await this.homes.findByOwnerId(ownerId);
    if (!home) throw new HomeError("home_not_found");
    const owner = await this.players.findById(ownerId);
    if (!owner) throw new HomeError("player_not_found");
    return { home: this.toView(home, owner), occupants: this.occupants(ownerId) };
  }

  async disconnect(playerId: string): Promise<string | undefined> {
    const session = this.sessions.get(playerId);
    if (!session) return undefined;
    this.sessions.delete(playerId);
    if (![...this.sessions.values()].some((candidate) => candidate.ownerId === session.ownerId)) {
      this.radioUntil.delete(session.ownerId);
      const timer = this.radioTimers.get(session.ownerId);
      if (timer) clearTimeout(timer);
      this.radioTimers.delete(session.ownerId);
    }
    return session.ownerId;
  }

  async occupantsSnapshot(ownerId: string): Promise<HomeSnapshot> { return this.snapshotAsync(ownerId); }

  async close(): Promise<void> {
    for (const timer of this.radioTimers.values()) clearTimeout(timer);
    this.radioTimers.clear(); this.radioUntil.clear(); this.sessions.clear();
  }

  private async ensureOwnerHome(owner: PlayerState): Promise<HomeRecord> {
    if (!owner.homeRegionId) throw new HomeError("region_not_found");
    const home = await this.homes.ensure({ ownerId: owner.id, regionId: owner.homeRegionId, doorOpen: true, furniture: createDefaultHomeFurniture(), updatedAt: this.now() });
    this.cachedFurniture.set(owner.id, home.furniture.map((item) => ({ ...item })));
    return home;
  }

  private async requirePlayer(playerId: string): Promise<PlayerState> {
    const player = await this.players.findById(playerId);
    if (!player) throw new HomeError("player_not_found");
    return player;
  }

  private homeFurniture(ownerId: string): HomeFurniture[] {
    const session = [...this.sessions.values()].find((candidate) => candidate.ownerId === ownerId);
    return session ? this.cachedFurniture.get(ownerId) ?? [] : [];
  }

  private readonly cachedFurniture = new Map<string, HomeFurniture[]>();

  private toView(home: HomeRecord, owner: PlayerState): HomeView {
    this.cachedFurniture.set(owner.id, home.furniture.map((item) => ({ ...item })));
    return { ownerId: home.ownerId, ownerName: owner.name, regionId: home.regionId, doorOpen: home.doorOpen, furniture: home.furniture.map((item) => ({ ...item })) };
  }

  private occupants(ownerId: string): HomeOccupant[] {
    return [...this.sessions.values()].filter((session) => session.ownerId === ownerId).map((session) => cloneOccupant(session.occupant));
  }

  private isNearObject(ownerId: string, position: { x: number; y: number }, objectId: string): boolean {
    const furniture = this.cachedFurniture.get(ownerId)?.find((item) => item.id === objectId);
    const definition = furniture && getHomeFurnitureDefinition(furniture.type);
    if (!furniture || !definition) return false;
    return position.x >= furniture.x - INTERACTION_RADIUS_TILES
      && position.x <= furniture.x + definition.width - 1 + INTERACTION_RADIUS_TILES
      && position.y >= furniture.y - INTERACTION_RADIUS_TILES
      && position.y <= furniture.y + definition.height - 1 + INTERACTION_RADIUS_TILES;
  }
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number { return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }
function cloneOccupant(occupant: HomeOccupant): HomeOccupant { return { ...occupant, position: { ...occupant.position }, appearance: { ...occupant.appearance } }; }
