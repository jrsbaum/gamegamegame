import {
  MARKET_TILE,
  WORLD_CONNECTIONS,
  getWorldRegion,
  isWorldTileWalkable,
  type Clothing,
  type HairStyle
} from "@lafarmer2/content";
import * as THREE from "three";
import type { RealtimeClient, WorldPresence } from "../network";
import { createFarmItemMesh, createFarmer, createStructureMesh, createTerrain, tileToWorld } from "./meshes";

const MOVE_INTERVAL = 220;
const RECONCILE_TILES = 1.35;

export type Direction = "up" | "down" | "left" | "right";

export type WorldCallbacks = {
  realtime: RealtimeClient;
  appearance: { clothing: Clothing; hair: HairStyle };
  name: string;
  inventory: Record<string, number>;
  onCoins: (coins: number) => void;
  onInventory: (inventory: Record<string, number>, qualities?: Record<string, Partial<Record<string, number>>>) => void;
  onProduction: (ready: number, total: number) => void;
  onPresence: (presence: WorldPresence[]) => void;
  onSnapshot: (snapshot: Record<string, unknown>) => void;
  onMarket: () => void;
  onConnectionPrompt: (message: string) => void;
  onMessage: (text: string) => void;
};

type FarmView = { id: string; contentId: string; ready: boolean; visualKey: string; mesh: THREE.Group; tileX: number; tileY: number };

export class WorldView {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(48, 1, 0.1, 200);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly root: HTMLElement;
  private readonly callbacks: WorldCallbacks;
  private readonly player: THREE.Group;
  private readonly keys = new Set<string>();
  private readonly pendingMoves = new Map<string, Direction>();
  private readonly remotes = new Map<string, THREE.Group>();
  private readonly farmItems = new Map<string, FarmView>();
  private readonly structures = new Map<string, THREE.Group>();
  private facing: Direction = "down";
  private tile = { x: 8, y: 8 };
  private display = new THREE.Vector3();
  private lastMoveAt = 0;
  private lastRegionEntryAt = 0;
  private lastPrompt = "";
  private currentRegionId = "";
  private knownPresence: WorldPresence[] = [];
  private touchDirection: Direction | undefined;
  private raf = 0;
  private disposed = false;
  private unbindRealtime: (() => void) | undefined;

  constructor(root: HTMLElement, callbacks: WorldCallbacks) {
    this.root = root;
    this.callbacks = callbacks;
    this.scene.background = new THREE.Color(0x8ec8d4);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.72));
    const sun = new THREE.DirectionalLight(0xfff1c9, 1.05);
    sun.position.set(18, 28, 10);
    this.scene.add(sun);
    this.scene.add(createTerrain());
    this.player = createFarmer(callbacks.appearance.clothing, callbacks.appearance.hair);
    this.scene.add(this.player);
    this.setTile(8, 8, true);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    root.append(this.renderer.domElement);
    this.handleResize();
    window.addEventListener("resize", this.handleResize);
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    this.bindTouch();
    this.unbindRealtime = callbacks.realtime.onMessage((message) => this.handleMessage(message));
    this.tick();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.handleResize);
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    this.unbindRealtime?.();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  setInventory(inventory: Record<string, number>): void {
    this.callbacks.inventory = inventory;
  }

  applyStructure(structure: { id: string; type: string; footprint: Array<[number, number]> }): void {
    this.renderStructure(structure);
  }

  applyAppearance(clothing: Clothing, hair: HairStyle): void {
    this.scene.remove(this.player);
    const next = createFarmer(clothing, hair);
    next.position.copy(this.player.position);
    this.player.clear();
    this.player.add(...next.children);
  }

  private handleResize = (): void => {
    const width = this.root.clientWidth || window.innerWidth;
    const height = this.root.clientHeight || window.innerHeight;
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat && ["e", "E"].includes(event.key)) return;
    this.keys.add(event.key.toLowerCase());
    if (event.key.toLowerCase() === "e") this.interact();
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.key.toLowerCase());
  };

  private bindTouch(): void {
    document.querySelectorAll<HTMLButtonElement>("[data-direction]").forEach((button) => {
      const direction = button.dataset.direction as Direction;
      const start = (event: Event) => { event.preventDefault(); this.touchDirection = direction; };
      const stop = () => { if (this.touchDirection === direction) this.touchDirection = undefined; };
      button.addEventListener("pointerdown", start, { passive: false });
      button.addEventListener("pointerup", stop);
      button.addEventListener("pointercancel", stop);
      button.addEventListener("pointerleave", stop);
    });
  }

  private tick = (): void => {
    if (this.disposed) return;
    const now = performance.now();
    const direction = this.heldDirection();
    if (direction && now - this.lastMoveAt >= MOVE_INTERVAL) {
      this.lastMoveAt = now;
      this.tryMove(direction, this.keys.has(" ") || this.keys.has("space"));
    }
    this.player.position.lerp(this.display, 0.18);
    const cameraTarget = this.player.position.clone();
    this.camera.position.lerp(new THREE.Vector3(cameraTarget.x - 6, 8.5, cameraTarget.z + 8), 0.08);
    this.camera.lookAt(cameraTarget.x, 0.8, cameraTarget.z);
    this.updateConnectionPrompt();
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.tick);
  };

  private heldDirection(): Direction | undefined {
    if (this.touchDirection) return this.touchDirection;
    if (this.keys.has("d") || this.keys.has("arrowright")) return "right";
    if (this.keys.has("a") || this.keys.has("arrowleft")) return "left";
    if (this.keys.has("s") || this.keys.has("arrowdown")) return "down";
    if (this.keys.has("w") || this.keys.has("arrowup")) return "up";
    return undefined;
  }

  private tryMove(direction: Direction, sprint: boolean): void {
    this.facing = direction;
    const next = this.stepFrom(this.tile, direction, sprint ? 2 : 1);
    if (!isWorldTileWalkable(next.x, next.y)) {
      this.callbacks.onMessage("Água ou um prédio bloqueia esse passo.");
      return;
    }
    this.setTile(next.x, next.y, false);
    const actionId = this.callbacks.realtime.move(direction, sprint);
    if (actionId) this.pendingMoves.set(actionId, direction);
  }

  private stepFrom(origin: { x: number; y: number }, direction: Direction, steps: number): { x: number; y: number } {
    const next = { ...origin };
    for (let step = 0; step < steps; step += 1) {
      const candidate = { ...next };
      if (direction === "right") candidate.x += 1;
      if (direction === "left") candidate.x -= 1;
      if (direction === "down") candidate.y += 1;
      if (direction === "up") candidate.y -= 1;
      if (!isWorldTileWalkable(candidate.x, candidate.y)) break;
      next.x = candidate.x;
      next.y = candidate.y;
    }
    return next;
  }

  private setTile(x: number, y: number, snap: boolean): void {
    this.tile = { x, y };
    this.display.copy(tileToWorld(x, y));
    this.display.y = 0;
    if (snap) this.player.position.copy(this.display);
  }

  private frontTile(): { x: number; y: number } {
    return this.stepFrom(this.tile, this.facing, 1);
  }

  private interact(): void {
    const connection = this.nearbyConnection();
    if (connection && this.lastRegionEntryAt + 1_000 < performance.now()) {
      const targetId = connection.fromRegionId === this.currentRegionId ? connection.toRegionId : connection.fromRegionId;
      this.lastRegionEntryAt = performance.now();
      this.callbacks.realtime.enterRegion(targetId);
      return;
    }
    const nearest = [...this.farmItems.values()].sort((a, b) => this.tileDistance(a.tileX, a.tileY) - this.tileDistance(b.tileX, b.tileY))[0];
    if (nearest && this.tileDistance(nearest.tileX, nearest.tileY) <= 2) {
      const action = nearest.contentId === "cow" || nearest.contentId === "dinosaur"
        ? (nearest.ready ? "farm.collect" : "farm.care")
        : (nearest.ready ? "farm.harvest" : "farm.care");
      this.callbacks.realtime.action(action, { itemId: nearest.id });
      return;
    }
    if (this.nearMarket()) {
      this.callbacks.onMarket();
      return;
    }
    const front = this.frontTile();
    const plantId = this.plantableContent();
    if (plantId) {
      this.callbacks.realtime.action("farm.plant", { contentId: plantId, x: front.x, y: front.y });
      this.callbacks.onMessage("Plantando no tile à frente.");
      return;
    }
    const adoptId = this.adoptableContent();
    if (adoptId) {
      this.callbacks.realtime.action("farm.adopt", { contentId: adoptId, x: this.tile.x, y: this.tile.y });
      this.callbacks.onMessage(adoptId === "cow" ? "Adotando a vaca no curral." : "Adotando o dinossauro no recinto.");
      return;
    }
    this.callbacks.onMessage("Nada para fazer aqui. Chegue a uma planta, criatura, porteira ou ao mercadinho.");
  }

  private plantableContent(): string | undefined {
    if ((this.callbacks.inventory["tomato-seed"] ?? 0) > 0) return "tomato";
    if ((this.callbacks.inventory["orange-seed"] ?? 0) > 0) return "orange-tree";
    return undefined;
  }

  private adoptableContent(): string | undefined {
    if ((this.callbacks.inventory.feed ?? 0) > 0) return "cow";
    if ((this.callbacks.inventory["dinosaur-egg"] ?? 0) > 0 || (this.callbacks.inventory["dinosaur-fossil"] ?? 0) > 0) return "dinosaur";
    return undefined;
  }

  private nearMarket(): boolean {
    const centerX = MARKET_TILE.x + MARKET_TILE.width / 2;
    const centerY = MARKET_TILE.y + MARKET_TILE.height / 2;
    return Math.abs(this.tile.x - centerX) <= 4 && Math.abs(this.tile.y - centerY) <= 4;
  }

  private tileDistance(x: number, y: number): number {
    return Math.abs(this.tile.x - x) + Math.abs(this.tile.y - y);
  }

  private nearbyConnection(): (typeof WORLD_CONNECTIONS)[number] | undefined {
    return WORLD_CONNECTIONS.find((connection) => {
      const outgoing = connection.fromRegionId === this.currentRegionId;
      if (!outgoing && connection.toRegionId !== this.currentRegionId) return false;
      const targetId = outgoing ? connection.toRegionId : connection.fromRegionId;
      if (!this.knownPresence.some((presence) => presence.homeRegionId === targetId)) return false;
      const point = outgoing ? connection.entry : connection.exit;
      return this.tileDistance(point.x, point.y) <= 3;
    });
  }

  private updateConnectionPrompt(): void {
    const connection = this.nearbyConnection();
    const targetId = connection ? (connection.fromRegionId === this.currentRegionId ? connection.toRegionId : connection.fromRegionId) : "";
    const target = targetId ? getWorldRegion(targetId) : undefined;
    const marketHint = this.nearMarket() ? "Mercadinho do vale · pressione E para negociar." : "";
    const message = target
      ? `${connection?.kind === "bridge" ? "Ponte" : connection?.kind === "gate" ? "Porteira" : "Passagem"} para ${target.name} · pressione E para visitar.`
      : marketHint;
    if (message !== this.lastPrompt) {
      this.lastPrompt = message;
      this.callbacks.onConnectionPrompt(message);
    }
  }

  private handleMessage(message: Record<string, unknown>): void {
    if (message.type === "wallet.updated") {
      const payload = message.payload as { coins?: number; inventory?: Record<string, number> } | undefined;
      if (typeof payload?.coins === "number") this.callbacks.onCoins(payload.coins);
      if (payload?.inventory) this.callbacks.onInventory(payload.inventory);
    }
    if (message.type === "farm.harvested") {
      const payload = message as { inventory?: Record<string, number>; item?: { id?: string } };
      if (payload.inventory) this.callbacks.onInventory(payload.inventory);
      if (payload.item?.id) this.removeFarmItem(payload.item.id);
    }
    if (message.type === "farm.collected") {
      const payload = message as { inventory?: Record<string, number>; item?: Record<string, unknown> };
      if (payload.inventory) this.callbacks.onInventory(payload.inventory);
      if (payload.item) this.renderFarmItem(payload.item);
    }
    if (message.type === "farm.updated") {
      const item = message.item as Record<string, unknown> | undefined;
      if (item) this.renderFarmItem(item);
    }
    if (message.type === "hello" || message.type === "snapshot") this.applySnapshot(message.snapshot as Record<string, unknown>);
    if (message.type === "world.presence") {
      const presence = message.presence as WorldPresence[] | undefined;
      if (presence) { this.knownPresence = presence; this.callbacks.onPresence(presence); }
    }
    if (message.type === "world.region.entered") {
      const player = message.player as Record<string, unknown> | undefined;
      if (player) {
        this.currentRegionId = String(player.currentRegionId ?? player.homeRegionId ?? this.currentRegionId);
        const position = player.position as { x?: number; y?: number } | undefined;
        if (typeof position?.x === "number" && typeof position.y === "number") this.setTile(position.x, position.y, true);
        this.callbacks.realtime.requestSnapshot();
      }
    }
    if (message.type === "player_joined" || message.type === "player_moved" || message.type === "player_region_changed") {
      const player = (message.player ?? message) as Record<string, unknown>;
      const id = String((message as { playerId?: string }).playerId ?? player.id ?? "");
      if (id) this.renderRemote(player, id);
    }
    if (message.type === "player_left" && typeof message.playerId === "string") this.removeRemote(message.playerId);
    if (message.type === "move_ack") {
      const position = (message.player as { position?: { x: number; y: number } } | undefined)?.position;
      if (position) this.reconcile(position.x, position.y, typeof message.actionId === "string" ? message.actionId : undefined);
    }
  }

  private applySnapshot(snapshot: Record<string, unknown>): void {
    this.farmItems.forEach((item) => item.mesh.removeFromParent());
    this.farmItems.clear();
    this.structures.forEach((mesh) => mesh.removeFromParent());
    this.structures.clear();
    this.remotes.forEach((mesh) => mesh.removeFromParent());
    this.remotes.clear();
    const player = snapshot.player as { coins?: number; inventory?: Record<string, number>; inventoryQualities?: Record<string, Partial<Record<string, number>>>; position?: { x?: number; y?: number }; currentRegionId?: string | null; homeRegionId?: string | null } | undefined;
    if (typeof player?.coins === "number") this.callbacks.onCoins(player.coins);
    if (player?.inventory) this.callbacks.onInventory(player.inventory, player.inventoryQualities);
    if (typeof player?.position?.x === "number" && typeof player.position.y === "number") this.setTile(player.position.x, player.position.y, true);
    this.currentRegionId = player?.currentRegionId ?? player?.homeRegionId ?? this.currentRegionId;
    const presence = snapshot.presence as WorldPresence[] | undefined;
    if (presence) { this.knownPresence = presence; this.callbacks.onPresence(presence); }
    this.callbacks.onSnapshot(snapshot);
    const offline = snapshot.offlineProgress as { coins?: number } | undefined;
    if (offline?.coins) this.callbacks.onMessage(`Recompensa offline: +${offline.coins} moedas.`);
    (snapshot.farmItems as Array<Record<string, unknown>> | undefined)?.forEach((item) => this.renderFarmItem(item));
    (snapshot.structures as Array<Record<string, unknown>> | undefined)?.forEach((structure) => this.renderStructure(structure));
    (snapshot.players as Array<Record<string, unknown>> | undefined)?.forEach((remote) => this.renderRemote(remote, String(remote.id ?? "")));
    this.notifyFarm();
  }

  private reconcile(x: number, y: number, actionId?: string): void {
    if (actionId) this.pendingMoves.delete(actionId);
    const drift = Math.abs(this.tile.x - x) + Math.abs(this.tile.y - y);
    if (drift > RECONCILE_TILES && this.pendingMoves.size === 0) this.setTile(x, y, false);
  }

  private renderFarmItem(item: Record<string, unknown>): void {
    const id = String(item.id ?? "");
    if (!id) return;
    this.removeFarmItem(id);
    const position = item.position as { x?: number; y?: number } | undefined;
    const tileX = Number(position?.x ?? 0);
    const tileY = Number(position?.y ?? 0);
    const contentId = String(item.contentId ?? "tomato");
    const visualKey = String(item.visualKey ?? contentId);
    const ready = Boolean(item.ready);
    const mesh = createFarmItemMesh(visualKey, contentId, ready, String(item.behaviorState ?? ""));
    mesh.position.copy(tileToWorld(tileX, tileY));
    this.scene.add(mesh);
    this.farmItems.set(id, { id, contentId, ready, visualKey, mesh, tileX, tileY });
    this.notifyFarm();
  }

  private renderStructure(raw: Record<string, unknown>): void {
    const id = String(raw.id ?? "");
    const footprint = raw.footprint as Array<[number, number]> | undefined;
    if (!id || !footprint?.length) return;
    this.structures.get(id)?.removeFromParent();
    const mesh = createStructureMesh(String(raw.type ?? "field"), footprint);
    this.scene.add(mesh);
    this.structures.set(id, mesh);
  }

  private renderRemote(raw: Record<string, unknown>, forcedId: string): void {
    const id = forcedId || String(raw.id ?? "");
    if (!id) return;
    const position = raw.position as { x?: number; y?: number } | undefined;
    const appearance = raw.appearance as { clothing?: Clothing; hair?: HairStyle } | undefined;
    if (typeof position?.x !== "number" || typeof position.y !== "number") return;
    this.removeRemote(id);
    const mesh = createFarmer(appearance?.clothing ?? "forest", appearance?.hair ?? "short");
    mesh.position.copy(tileToWorld(position.x, position.y));
    this.scene.add(mesh);
    this.remotes.set(id, mesh);
  }

  private removeFarmItem(id: string): void {
    const item = this.farmItems.get(id);
    if (!item) return;
    item.mesh.removeFromParent();
    this.farmItems.delete(id);
    this.notifyFarm();
  }

  private removeRemote(id: string): void {
    this.remotes.get(id)?.removeFromParent();
    this.remotes.delete(id);
  }

  private notifyFarm(): void {
    const ready = [...this.farmItems.values()].filter((item) => item.ready).length;
    this.callbacks.onProduction(ready, this.farmItems.size);
  }
}
