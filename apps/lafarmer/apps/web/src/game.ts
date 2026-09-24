import Phaser from 'phaser';
import { getHomeFurnitureDefinition, getWorldRegion, HOME_EXTERIOR_DOOR, HOME_HEIGHT_TILES, HOME_ROOMS, HOME_WIDTH_TILES, isHomeTileWalkable, isInsideFarmBoundary, isWorldTileWalkable, isWorldWaterTile, outfits, palette, WORLD_CONNECTIONS, WORLD_HEIGHT_TILES, WORLD_OBSTACLES, WORLD_TILE_SIZE, WORLD_WIDTH_TILES, type WorldObstacle } from '@lafarmer/content-client';
import type { Direction, HomeOccupant, HomeSnapshot, HomeView, PlayerProfile, RealtimeClient, WorldPresence } from './network';

const WORLD = { width: WORLD_WIDTH_TILES * WORLD_TILE_SIZE, height: WORLD_HEIGHT_TILES * WORLD_TILE_SIZE };
const MOVE_SEND_INTERVAL = 220;
const MOVE_SPEED = WORLD_TILE_SIZE * 1_000 / MOVE_SEND_INTERVAL;
const PLAYER_RADIUS = 13;
const RECONCILE_DISTANCE = 44;
const color = (hex: string): number => Number(`0x${hex.slice(1)}`);
type MovementVector = { x: number; y: number };
const DIRECTIONS: readonly Direction[] = ['right', 'down-right', 'down', 'down-left', 'left', 'up-left', 'up', 'up-right'];
const DIRECTION_VECTORS: Record<Direction, MovementVector> = {
  up: { x: 0, y: -1 }, 'up-right': { x: Math.SQRT1_2, y: -Math.SQRT1_2 }, right: { x: 1, y: 0 },
  'down-right': { x: Math.SQRT1_2, y: Math.SQRT1_2 }, down: { x: 0, y: 1 }, 'down-left': { x: -Math.SQRT1_2, y: Math.SQRT1_2 },
  left: { x: -1, y: 0 }, 'up-left': { x: -Math.SQRT1_2, y: -Math.SQRT1_2 },
};
function directionForVector(x: number, y: number): Direction {
  const angle = (Math.atan2(y, x) + Math.PI * 2) % (Math.PI * 2);
  return DIRECTIONS[Math.round(angle / (Math.PI / 4)) % DIRECTIONS.length];
}
function setObjectVisible(object: Phaser.GameObjects.GameObject, visible: boolean): void {
  (object as Phaser.GameObjects.GameObject & { setVisible: (value: boolean) => Phaser.GameObjects.GameObject }).setVisible(visible);
}

interface WorldData { profile: PlayerProfile; realtime: RealtimeClient; onCoins: (coins: number) => void; onInventory?: (inventory: Record<string, number>) => void; onProduction?: (ready: number, total: number) => void; onSnapshot?: (snapshot: Record<string, unknown>) => void; onPresence?: (presence: WorldPresence[]) => void; onMarket?: () => void; onConnectionPrompt?: (message: string) => void; }
type RemoteView = { body: Phaser.GameObjects.Graphics; tag: Phaser.GameObjects.Text };
type FarmView = { id: string; contentId: string; ready: boolean; body: Phaser.GameObjects.Graphics; tag: Phaser.GameObjects.Text; x: number; y: number };

export class WorldScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Graphics;
  private nameTag!: Phaser.GameObjects.Text;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private worldData!: WorldData;
  private touchInput: MovementVector = { x: 0, y: 0 };
  private touchPointerId: number | undefined;
  private currentRegionId = '';
  private knownPresence: WorldPresence[] = [];
  private lastConnectionPrompt = '';
  private lastRegionEntryAt = 0;
  private lastMoveSent = 0;
  private lastLocalPosition = { x: 0, y: 0 };
  private readonly pendingMoves = new Map<string, Direction>();
  private readonly remotePlayers = new Map<string, RemoteView>();
  private readonly farmItems = new Map<string, FarmView>();
  private readonly structures = new Map<string, Phaser.GameObjects.Graphics>();
  private readonly dynamicBlocked = new Set<string>();
  private localPlayerId = '';
  private insideHome = false;
  private homeView: HomeView | undefined;
  private homeOwner = false;
  private homeEditMode = false;
  private homeOccupants = new Map<string, HomeOccupant>();
  private readonly homePlayerViews = new Map<string, RemoteView>();
  private readonly homePoseState = new Map<string, HomeOccupant['pose']>();
  private readonly homePoseTweens = new Map<string, Phaser.Tweens.Tween>();
  private readonly homeFurnitureViews = new Map<string, { body: Phaser.GameObjects.Graphics; bounds: { x: number; y: number; width: number; height: number } }>();
  private homeFurnitureDrag: { id: string; offsetX: number; offsetY: number } | undefined;
  private homeWorldObjects: Phaser.GameObjects.GameObject[] = [];
  private homeAudio: AudioContext | undefined;
  private radioPlayingUntil = 0;
  private homeControl: Phaser.GameObjects.Text | undefined;

  constructor() { super('world'); }

  create(data?: unknown): void {
    this.worldData = data as WorldData;
    this.currentRegionId = this.worldData.profile.plotId;
    this.drawMap(); this.drawObstacles(); this.createPlayer(this.worldData.profile);
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,E,SPACE,R,O') as Record<string, Phaser.Input.Keyboard.Key>;
    this.cameras.main.setBounds(0, 0, WORLD.width, WORLD.height);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
    this.setResponsiveZoom();
    window.addEventListener('resize', () => this.setResponsiveZoom());
    this.bindTouchJoystick();
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.onHomePointerDown(pointer));
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => this.onHomePointerMove(pointer));
    this.input.on('pointerup', () => this.onHomePointerUp());
    window.addEventListener('pointerdown', () => { void this.unlockHomeAudio(); }, { passive: true });
    window.addEventListener('keydown', () => { void this.unlockHomeAudio(); }, { passive: true });
    this.bindRealtime(); this.applyServerPosition(5, 5); this.updateConnectionPrompt();
  }

  private bindTouchJoystick(): void {
    const joystick = document.querySelector<HTMLElement>('[data-touch-joystick]');
    const knob = joystick?.querySelector<HTMLElement>('[data-touch-joystick-knob]');
    if (!joystick || !knob) return;
    const reset = () => { this.touchInput = { x: 0, y: 0 }; knob.style.transform = 'translate(0px, 0px)'; };
    const update = (event: PointerEvent) => {
      const bounds = joystick.getBoundingClientRect();
      const maxTravel = Math.max(1, (Math.min(bounds.width, bounds.height) - knob.offsetWidth) / 2);
      const dx = event.clientX - (bounds.left + bounds.width / 2);
      const dy = event.clientY - (bounds.top + bounds.height / 2);
      const distance = Math.hypot(dx, dy);
      const travel = Math.min(distance, maxTravel);
      const scale = distance === 0 ? 0 : travel / distance;
      knob.style.transform = `translate(${dx * scale}px, ${dy * scale}px)`;
      const strength = travel / maxTravel;
      this.touchInput = strength < 0.18 ? { x: 0, y: 0 } : { x: dx / distance * strength, y: dy / distance * strength };
    };
    joystick.addEventListener('pointerdown', (event) => {
      if (this.touchPointerId !== undefined) return;
      event.preventDefault(); this.touchPointerId = event.pointerId; joystick.setPointerCapture(event.pointerId); update(event);
    });
    joystick.addEventListener('pointermove', (event) => { if (event.pointerId === this.touchPointerId) update(event); });
    const stop = (event: PointerEvent) => {
      if (event.pointerId !== this.touchPointerId) return;
      this.touchPointerId = undefined; reset();
    };
    joystick.addEventListener('pointerup', stop);
    joystick.addEventListener('pointercancel', stop);
    joystick.addEventListener('lostpointercapture', stop);
  }

  private applySnapshot(snapshot: Record<string, unknown>): void {
    this.remotePlayers.forEach((view) => { view.body.destroy(); view.tag.destroy(); });
    this.remotePlayers.clear();
    this.farmItems.forEach((view) => { view.body.destroy(); view.tag.destroy(); });
    this.farmItems.clear();
    this.structures.forEach((view) => view.destroy()); this.structures.clear(); this.dynamicBlocked.clear();
    const player = snapshot.player as { coins?: number; inventory?: Record<string, number>; position?: { x?: number; y?: number } } | undefined;
    const playerId = (snapshot.player as { id?: string } | undefined)?.id;
    if (playerId) this.localPlayerId = playerId;
    if (typeof player?.coins === 'number') this.worldData.onCoins(player.coins);
    if (player?.inventory) this.worldData.onInventory?.(player.inventory);
    if (typeof player?.position?.x === 'number' && typeof player.position.y === 'number') this.applyServerPosition(player.position.x, player.position.y);
    const playerRegion = snapshot.player as { currentRegionId?: string | null; homeRegionId?: string | null } | undefined;
    if (playerRegion?.currentRegionId || playerRegion?.homeRegionId) this.currentRegionId = playerRegion.currentRegionId ?? playerRegion.homeRegionId ?? this.currentRegionId;
    const presence = snapshot.presence as WorldPresence[] | undefined;
    if (presence) { this.knownPresence = presence; this.worldData.onPresence?.(presence); }
    this.worldData.onSnapshot?.(snapshot);
    const home = snapshot.home as HomeView | undefined;
    if (home && !this.insideHome) this.homeView = home;
    (snapshot.players as Array<Record<string, unknown>> | undefined)?.forEach((remote) => this.renderRemotePlayer(remote));
    (snapshot.farmItems as Array<Record<string, unknown>> | undefined)?.forEach((item) => this.renderFarmItem(item));
    (snapshot.structures as Array<Record<string, unknown>> | undefined)?.forEach((structure) => this.renderStructure(structure));
    this.notifyFarmStatus(); this.updateConnectionPrompt();
  }

  update(time: number, delta: number): void {
    const left = this.cursors.left.isDown || this.keys.A?.isDown;
    const right = this.cursors.right.isDown || this.keys.D?.isDown;
    const up = this.cursors.up.isDown || this.keys.W?.isDown;
    const down = this.cursors.down.isDown || this.keys.S?.isDown;
    const keyboardInput = { x: (right ? 1 : 0) - (left ? 1 : 0), y: (down ? 1 : 0) - (up ? 1 : 0) };
    const input = Math.hypot(this.touchInput.x, this.touchInput.y) > 0 ? this.touchInput : keyboardInput;
    const strength = Math.min(1, Math.hypot(input.x, input.y));
    if (strength > 0) this.moveDirection(directionForVector(input.x, input.y), strength, time, delta);
    if (Phaser.Input.Keyboard.JustDown(this.keys.E)) this.interact();
    if (this.insideHome && this.homeOwner && Phaser.Input.Keyboard.JustDown(this.keys.R)) { this.homeEditMode = !this.homeEditMode; this.drawHomeFurniture(this.homeView?.furniture ?? []); this.drawHomeControls(); }
    if (this.insideHome && this.homeOwner && Phaser.Input.Keyboard.JustDown(this.keys.O)) this.worldData.realtime.setHomeDoor(!this.homeView?.doorOpen);
    this.updateConnectionPrompt();
  }

  private moveDirection(direction: Direction, strength: number, time: number, delta: number): void {
    const sprint = Boolean(this.keys.SPACE?.isDown);
    const distance = MOVE_SPEED * (sprint ? 2 : 1) * strength * Math.min(delta, 100) / 1_000;
    const vector = DIRECTION_VECTORS[direction];
    const next = { x: this.player.x, y: this.player.y };
    next.x += vector.x * distance;
    next.y += vector.y * distance;
    if (this.insideHome ? this.canOccupyHome(next.x, next.y) : this.canOccupy(next.x, next.y)) { this.player.setPosition(next.x, next.y); this.updateNameTag(); }
    const sendInterval = MOVE_SEND_INTERVAL * (vector.x !== 0 && vector.y !== 0 ? Math.SQRT2 : 1) / strength;
    if (time - this.lastMoveSent >= sendInterval && (this.player.x !== this.lastLocalPosition.x || this.player.y !== this.lastLocalPosition.y)) {
      this.lastMoveSent = time; this.lastLocalPosition = { x: this.player.x, y: this.player.y };
      const actionId = this.worldData.realtime.move(direction, sprint);
      if (actionId) this.pendingMoves.set(actionId, direction);
    }
  }

  private bindRealtime(): void {
    this.worldData.realtime.onMessage((message) => {
      if (message.type === 'home.entered' || message.type === 'home.snapshot') {
        const snapshot = message.snapshot as HomeSnapshot | undefined;
        if (snapshot) this.enterHomeView(snapshot);
      }
      if (message.type === 'home.updated') {
        const snapshot = message.snapshot as HomeSnapshot | undefined;
        const home = message.home as HomeView | undefined;
        if (snapshot) this.updateHomeSnapshot(snapshot);
        else if (home && this.insideHome) { this.homeView = home; this.drawHomeControls(); }
      }
      if (message.type === 'home.door.updated') {
        const home = message.home as HomeView | undefined;
        if (home) { this.homeView = { ...(this.homeView ?? home), ...home }; this.updateConnectionPrompt(); this.drawHomeControls(); }
      }
      if (message.type === 'home.player.joined' || message.type === 'home.player.moved' || message.type === 'home.occupant.updated') {
        const occupant = message.occupant as HomeOccupant | undefined;
        if (occupant) { this.homeOccupants.set(occupant.playerId, occupant); this.renderHomeOccupants(); }
      }
      if (message.type === 'home.player.left' && typeof message.playerId === 'string') {
        this.homeOccupants.delete(message.playerId); this.removeHomePlayer(message.playerId); this.renderHomeOccupants();
      }
      if (message.type === 'home.radio.play') this.playHomeJingle();
      if (message.type === 'home.exited') this.exitHomeView(message);
      if (message.type === 'home.move_ack') {
        const occupant = message.occupant as HomeOccupant | undefined;
        if (occupant) { this.homeOccupants.set(occupant.playerId, occupant); this.renderHomeOccupants(); }
      }
      if (message.type === 'error' && typeof message.code === 'string') {
        const errors: Record<string, string> = { home_closed: 'A casa está fechada para visitas.', not_at_home_door: 'Chegue mais perto da porta.', invalid_home_furniture: 'Esse móvel não cabe nesse lugar.' };
        if (message.code === 'invalid_home_furniture') this.drawHomeFurniture(this.homeView?.furniture ?? []);
        if (errors[message.code]) this.worldData.onConnectionPrompt?.(errors[message.code]);
      }
      if (message.type === 'wallet.updated') { const payload = message.payload as { coins?: number; inventory?: Record<string, number> } | undefined; if (typeof payload?.coins === 'number') this.worldData.onCoins(payload.coins); if (payload?.inventory) this.worldData.onInventory?.(payload.inventory); }
      if (message.type === 'farm.harvested') { const payload = message as { inventory?: Record<string, number>; item?: { id?: string } }; if (payload.inventory) this.worldData.onInventory?.(payload.inventory); if (payload.item?.id) this.removeFarmItem(payload.item.id); }
      if (message.type === 'farm.collected') { const payload = message as { inventory?: Record<string, number>; item?: Record<string, unknown> }; if (payload.inventory) this.worldData.onInventory?.(payload.inventory); if (payload.item) this.renderFarmItem(payload.item); }
      if (message.type === 'farm.updated') { const item = message.item as Record<string, unknown> | undefined; if (item) this.renderFarmItem(item); }
      if (message.type === 'hello' || message.type === 'snapshot') this.applySnapshot(message.snapshot as Record<string, unknown>);
      if (message.type === 'world.presence') { const presence = message.presence as WorldPresence[] | undefined; if (presence) { this.knownPresence = presence; this.worldData.onPresence?.(presence); } }
      if (message.type === 'world.region.entered') { const player = message.player as Record<string, unknown> | undefined; if (player) { this.currentRegionId = String(player.currentRegionId ?? player.homeRegionId ?? this.currentRegionId); const position = player.position as { x?: number; y?: number } | undefined; if (typeof position?.x === 'number' && typeof position.y === 'number') this.applyServerPosition(position.x, position.y); this.worldData.realtime.requestSnapshot(); this.updateConnectionPrompt(); } }
      if (message.type === 'player_joined') { const player = message.player as Record<string, unknown>; this.patchPresence(player, true); this.renderRemotePlayer(player); }
      if (message.type === 'player_moved') { const payload = message as { playerId?: string; player?: Record<string, unknown> }; if (payload.playerId && payload.player) { this.patchPresence({ ...payload.player, id: payload.playerId }, true); this.renderRemotePlayer(payload.player, payload.playerId); } }
      if (message.type === 'player_region_changed') { const payload = message as { playerId?: string; player?: Record<string, unknown> }; if (payload.playerId && payload.player) { this.patchPresence({ ...payload.player, id: payload.playerId }, true); this.renderRemotePlayer(payload.player, payload.playerId); } }
      if (message.type === 'player_left' && typeof message.playerId === 'string') { this.removeRemotePlayer(message.playerId); this.knownPresence = this.knownPresence.map((presence) => presence.id === message.playerId ? { ...presence, online: false } : presence); this.worldData.onPresence?.(this.knownPresence); }
      if (message.type === 'move_ack') { const position = (message.player as { position?: { x: number; y: number } } | undefined)?.position; if (position) this.reconcileServerPosition(position.x, position.y, typeof message.actionId === 'string' ? message.actionId : undefined); }
    });
  }

  private applyServerPosition(x: number, y: number): void { const position = this.gridToWorld(x, y); this.player.setPosition(position.x, position.y); this.lastLocalPosition = { x: position.x, y: position.y }; this.updateNameTag(); }
  private reconcileServerPosition(x: number, y: number, actionId?: string): void { if (actionId) this.pendingMoves.delete(actionId); const serverPosition = this.gridToWorld(x, y); const drift = Phaser.Math.Distance.Between(this.player.x, this.player.y, serverPosition.x, serverPosition.y); if (drift > RECONCILE_DISTANCE && this.pendingMoves.size === 0) this.applyServerPosition(x, y); }
  private gridToWorld(x: number, y: number): { x: number; y: number } { return { x: (x + 0.5) * WORLD_TILE_SIZE, y: (y + 0.5) * WORLD_TILE_SIZE }; }
  private worldToTile(value: number): number { return Math.floor(value / WORLD_TILE_SIZE); }

  private canOccupy(x: number, y: number): boolean {
    if (x < PLAYER_RADIUS || y < PLAYER_RADIUS || x > WORLD.width - PLAYER_RADIUS || y > WORLD.height - PLAYER_RADIUS) return false;
    const left = this.worldToTile(x - PLAYER_RADIUS); const right = this.worldToTile(x + PLAYER_RADIUS); const top = this.worldToTile(y - PLAYER_RADIUS); const bottom = this.worldToTile(y + PLAYER_RADIUS);
    for (let tileY = top; tileY <= bottom; tileY += 1) for (let tileX = left; tileX <= right; tileX += 1) if (!isWorldTileWalkable(tileX, tileY) || this.dynamicBlocked.has(`${tileX}:${tileY}`)) return false;
    return true;
  }

  private interact(): void {
    if (this.insideHome) { this.interactHomeNearby(); return; }
    const homeDoor = this.homeDoorPosition();
    if (homeDoor && this.distance(homeDoor.x, homeDoor.y) < WORLD_TILE_SIZE * 2.1) {
      if (this.homeView?.doorOpen || this.homeView?.ownerId === this.localPlayerId) this.worldData.realtime.enterHome(this.currentRegionId);
      else this.worldData.onConnectionPrompt?.('A casa está fechada para visitas.');
      return;
    }
    const connection = this.nearbyConnection();
    if (connection && this.lastRegionEntryAt + 1_000 < performance.now()) {
      const targetId = connection.fromRegionId === this.currentRegionId ? connection.toRegionId : connection.fromRegionId;
      this.lastRegionEntryAt = performance.now(); this.worldData.realtime.enterRegion(targetId); return;
    }
    const nearest = [...this.farmItems.values()].sort((a, b) => this.distance(a.x, a.y) - this.distance(b.x, b.y))[0];
    if (nearest && this.distance(nearest.x, nearest.y) < 110) { const action = nearest.contentId === 'cow' || nearest.contentId === 'dinosaur' ? (nearest.ready ? 'farm.collect' : 'farm.care') : (nearest.ready ? 'farm.harvest' : 'farm.care'); this.worldData.realtime.action(action, { itemId: nearest.id }); return; }
    const market = this.gridToWorld(31, 18); if (Phaser.Math.Distance.Between(this.player.x, this.player.y, market.x, market.y) < 180) this.worldData.onMarket?.();
  }
  private distance(x: number, y: number): number { return Phaser.Math.Distance.Between(this.player.x, this.player.y, x, y); }

  private nearbyConnection(): (typeof WORLD_CONNECTIONS)[number] | undefined {
    return WORLD_CONNECTIONS.find((connection) => {
      const outgoing = connection.fromRegionId === this.currentRegionId;
      if (!outgoing && connection.toRegionId !== this.currentRegionId) return false;
      const targetId = outgoing ? connection.toRegionId : connection.fromRegionId;
      if (!this.knownPresence.some((presence) => presence.homeRegionId === targetId)) return false;
      const point = outgoing ? connection.entry : connection.exit;
      const world = this.gridToWorld(point.x, point.y);
      return this.distance(world.x, world.y) < WORLD_TILE_SIZE * 3;
    });
  }

  private updateConnectionPrompt(): void {
    if (this.insideHome) {
      const message = this.homeOwner ? 'WASD para andar · E interage · R organiza móveis · O abre/fecha a porta · saída ao sul' : 'WASD para andar · E interage · toque nos móveis · saída ao sul';
      if (message !== this.lastConnectionPrompt) { this.lastConnectionPrompt = message; this.worldData.onConnectionPrompt?.(message); }
      return;
    }
    const homeDoor = this.homeDoorPosition();
    if (homeDoor && this.distance(homeDoor.x, homeDoor.y) < WORLD_TILE_SIZE * 2.1) {
      const message = this.homeView?.doorOpen || this.homeView?.ownerId === this.localPlayerId ? 'Casa de ' + (this.homeView?.ownerName ?? 'vizinho') + ' · pressione E ou toque na porta para entrar.' : 'Casa fechada para visitas.';
      if (message !== this.lastConnectionPrompt) { this.lastConnectionPrompt = message; this.worldData.onConnectionPrompt?.(message); }
      return;
    }
    const connection = this.nearbyConnection();
    const targetId = connection ? (connection.fromRegionId === this.currentRegionId ? connection.toRegionId : connection.fromRegionId) : '';
    const target = targetId ? getWorldRegion(targetId) : undefined;
    const message = target ? `${connection?.kind === 'bridge' ? 'Ponte' : connection?.kind === 'gate' ? 'Porteira' : 'Passagem'} para ${target.name} · pressione E para visitar.` : '';
    if (message !== this.lastConnectionPrompt) { this.lastConnectionPrompt = message; this.worldData.onConnectionPrompt?.(message); }
  }

  private homeDoorPosition(): { x: number; y: number } | undefined {
    if (!this.homeView || this.homeView.regionId !== this.currentRegionId) return undefined;
    return this.gridToWorld(HOME_EXTERIOR_DOOR.x, HOME_EXTERIOR_DOOR.y);
  }

  private enterHomeView(snapshot: HomeSnapshot): void {
    if (!this.insideHome) {
      this.insideHome = true;
      this.homeWorldObjects = [...this.children.list];
      this.homeWorldObjects.forEach((object) => setObjectVisible(object, false));
      this.cameras.main.stopFollow();
      const width = HOME_WIDTH_TILES * WORLD_TILE_SIZE; const height = HOME_HEIGHT_TILES * WORLD_TILE_SIZE;
      this.cameras.main.setBounds(0, 0, width, height);
      this.cameras.main.setZoom(Math.min(window.innerWidth / width, window.innerHeight / height, 1));
      this.cameras.main.centerOn(width / 2, height / 2);
      this.drawHomeRoom();
    }
    this.updateHomeSnapshot(snapshot);
  }

  private updateHomeSnapshot(snapshot: HomeSnapshot): void {
    this.homeView = snapshot.home;
    this.homeOwner = snapshot.home.ownerId === this.localPlayerId;
    this.homeOccupants = new Map(snapshot.occupants.map((occupant) => [occupant.playerId, occupant]));
    const me = this.homeOccupants.get(this.localPlayerId);
    if (me) this.player.setPosition(this.homeGridToWorld(me.position.x, me.position.y).x, this.homeGridToWorld(me.position.x, me.position.y).y).setVisible(true);
    this.drawHomeFurniture(snapshot.home.furniture);
    this.renderHomeOccupants();
    this.drawHomeControls();
    this.updateNameTag();
  }

  private exitHomeView(raw: Record<string, unknown>): void {
    this.insideHome = false;
    this.homeFurnitureViews.forEach(({ body }) => body.destroy()); this.homeFurnitureViews.clear();
    this.homePlayerViews.forEach((view) => { view.body.destroy(); view.tag.destroy(); }); this.homePlayerViews.clear();
    const homeOnly = this.children.list.filter((object) => !this.homeWorldObjects.includes(object));
    homeOnly.forEach((object) => object.destroy());
    this.homeWorldObjects.forEach((object) => setObjectVisible(object, true)); this.homeWorldObjects = [];
    this.homeOccupants.clear(); this.cameras.main.setBounds(0, 0, WORLD.width, WORLD.height); this.setResponsiveZoom(); this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
    this.homePoseTweens.forEach((tween) => tween.stop()); this.homePoseTweens.clear(); this.homePoseState.clear();
    const position = raw.position as { x?: number; y?: number } | undefined;
    if (typeof position?.x === 'number' && typeof position.y === 'number') this.applyServerPosition(position.x, position.y);
    if (typeof raw.regionId === 'string') this.currentRegionId = raw.regionId;
    this.lastConnectionPrompt = ''; this.updateConnectionPrompt();
  }

  private drawHomeRoom(): void {
    const graphics = this.add.graphics().setDepth(0);
    graphics.fillStyle(color('#d8c9a5'), 1).fillRect(0, 0, HOME_WIDTH_TILES * WORLD_TILE_SIZE, HOME_HEIGHT_TILES * WORLD_TILE_SIZE);
    HOME_ROOMS.forEach((room, index) => {
      const floor = index === 0 ? '#e9dfc7' : index === 1 ? '#d8c9a5' : index === 2 ? '#dfc9a8' : '#c9d7ce';
      graphics.fillStyle(color(floor), 1).fillRoundedRect(room.x * WORLD_TILE_SIZE, room.y * WORLD_TILE_SIZE, room.width * WORLD_TILE_SIZE, room.height * WORLD_TILE_SIZE, 10);
      this.label(room.label, (room.x + room.width / 2) * WORLD_TILE_SIZE, room.y * WORLD_TILE_SIZE + 20, 13, palette.forest).setDepth(3);
    });
    graphics.fillStyle(color('#725a43'), 1).fillRect(0, 0, HOME_WIDTH_TILES * WORLD_TILE_SIZE, WORLD_TILE_SIZE);
    graphics.fillStyle(color('#725a43'), 1).fillRect(0, 0, WORLD_TILE_SIZE, HOME_HEIGHT_TILES * WORLD_TILE_SIZE).fillRect((HOME_WIDTH_TILES - 1) * WORLD_TILE_SIZE, 0, WORLD_TILE_SIZE, HOME_HEIGHT_TILES * WORLD_TILE_SIZE).fillRect(0, (HOME_HEIGHT_TILES - 1) * WORLD_TILE_SIZE, HOME_WIDTH_TILES * WORLD_TILE_SIZE, WORLD_TILE_SIZE);
    graphics.fillStyle(color('#725a43'), 1).fillRect(0, 7 * WORLD_TILE_SIZE - 5, 3 * WORLD_TILE_SIZE, 10).fillRect(4 * WORLD_TILE_SIZE, 7 * WORLD_TILE_SIZE - 5, 6 * WORLD_TILE_SIZE, 10).fillRect(11 * WORLD_TILE_SIZE, 7 * WORLD_TILE_SIZE - 5, 6 * WORLD_TILE_SIZE, 10).fillRect(18 * WORLD_TILE_SIZE, 7 * WORLD_TILE_SIZE - 5, 4 * WORLD_TILE_SIZE, 10);
    graphics.fillStyle(color('#725a43'), 1).fillRect(7 * WORLD_TILE_SIZE - 5, 8 * WORLD_TILE_SIZE, 10, 2 * WORLD_TILE_SIZE).fillRect(7 * WORLD_TILE_SIZE - 5, 11 * WORLD_TILE_SIZE, 10, 2 * WORLD_TILE_SIZE).fillRect(14 * WORLD_TILE_SIZE - 5, 8 * WORLD_TILE_SIZE, 10, 2 * WORLD_TILE_SIZE).fillRect(14 * WORLD_TILE_SIZE - 5, 11 * WORLD_TILE_SIZE, 10, 2 * WORLD_TILE_SIZE);
    graphics.lineStyle(4, color('#f4b743'), 1).lineBetween(10 * WORLD_TILE_SIZE, 13 * WORLD_TILE_SIZE, 11 * WORLD_TILE_SIZE, 13 * WORLD_TILE_SIZE);
    this.add.text(10.5 * WORLD_TILE_SIZE, 13.3 * WORLD_TILE_SIZE, 'SAÍDA', { fontFamily: 'Trebuchet MS', fontSize: '11px', fontStyle: 'bold', color: palette.forest }).setOrigin(.5).setDepth(4);
  }

  private drawHomeFurniture(items: HomeView['furniture']): void {
    this.homeFurnitureViews.forEach(({ body }) => body.destroy()); this.homeFurnitureViews.clear();
    items.forEach((item) => {
      const definition = getHomeFurnitureDefinition(item.type); if (!definition) return;
      const bounds = { x: item.x * WORLD_TILE_SIZE, y: item.y * WORLD_TILE_SIZE, width: definition.width * WORLD_TILE_SIZE, height: definition.height * WORLD_TILE_SIZE };
      const body = this.add.graphics().setDepth(8).setPosition(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      this.drawFurnitureIcon(body, item.type, bounds.width, bounds.height);
      if (this.homeEditMode && this.homeOwner) body.lineStyle(3, color(palette.amber), .9).strokeRoundedRect(-bounds.width / 2, -bounds.height / 2, bounds.width, bounds.height, 7);
      body.setInteractive(new Phaser.Geom.Rectangle(-bounds.width / 2, -bounds.height / 2, bounds.width, bounds.height), Phaser.Geom.Rectangle.Contains);
      this.homeFurnitureViews.set(item.id, { body, bounds });
    });
  }

  private drawFurnitureIcon(body: Phaser.GameObjects.Graphics, type: string, width: number, height: number): void {
    const colors: Record<string, string> = { sofa: '#72957d', radio: '#8f6042', 'dining-table': '#b47b48', fridge: '#f5eee0', stove: '#697e78', plant: '#72a95d', bookshelf: '#9b5b3d', 'work-desk': '#b47b48', 'office-chair': '#51675f', bed: '#69859a', wardrobe: '#9b6c48', bathtub: '#dce8df', sink: '#a5bcb2' };
    body.fillStyle(color('#173f35'), .16).fillEllipse(0, height * .36, width * .82, Math.max(8, height * .2));
    body.fillStyle(color(colors[type] ?? '#b47b48'), 1).fillRoundedRect(-width * .44, -height * .36, width * .88, height * .72, 8);
    if (type === 'radio') { body.fillStyle(color('#edc46b'), 1).fillCircle(-8, -4, 5).fillCircle(8, -4, 5).lineStyle(2, color('#f5eee0'), .8).lineBetween(-width * .24, height * .22, width * .24, height * .22); }
    else if (type === 'plant') { body.fillStyle(color('#4d874e'), 1).fillCircle(-6, -7, 9).fillCircle(8, -10, 9).fillStyle(color('#b47b48'), 1).fillRoundedRect(-9, 4, 18, 12, 3); }
    else if (type === 'bed' || type === 'sofa') { body.fillStyle(color('#f5eee0'), 1).fillRoundedRect(-width * .35, -height * .21, width * .7, height * .32, 6); }
    else if (type === 'work-desk' || type === 'dining-table') { body.fillStyle(color('#f5eee0'), 1).fillRoundedRect(-width * .18, -height * .21, width * .36, height * .18, 3); }
    else if (type === 'bookshelf') { body.lineStyle(3, color('#f2b84b'), 1).lineBetween(-width * .3, 0, width * .3, 0); }
    else if (type === 'fridge' || type === 'wardrobe') { body.lineStyle(2, color('#8f8f7d'), .8).lineBetween(0, -height * .25, 0, height * .25); }
    else body.fillStyle(color('#fffdf7'), .65).fillCircle(0, 0, Math.min(width, height) * .16);
  }

  private drawHomeControls(): void {
    if (!this.insideHome || !this.homeView) return;
    this.homeControl?.destroy();
    this.homeControl = this.add.text(20 * WORLD_TILE_SIZE, 1.1 * WORLD_TILE_SIZE, this.homeOwner ? `${this.homeEditMode ? '✓ Organizar móveis' : '✥ Organizar móveis'}\n${this.homeView.doorOpen ? 'Porta aberta · toque para fechar' : 'Porta fechada · toque para abrir'}` : 'Casa de ' + this.homeView.ownerName, { fontFamily: 'Trebuchet MS, Segoe UI, sans-serif', fontSize: '13px', fontStyle: 'bold', color: palette.forest, backgroundColor: '#fffdf7', padding: { left: 10, right: 10, top: 8, bottom: 8 }, align: 'center' }).setOrigin(1, 0).setDepth(25);
  }

  private renderHomeOccupants(): void {
    if (!this.insideHome) return;
    this.homeOccupants.forEach((occupant) => {
      const position = this.homeGridToWorld(occupant.position.x, occupant.position.y);
      const isLocal = occupant.playerId === this.localPlayerId;
      const body = isLocal ? this.player : this.homePlayerViews.get(occupant.playerId)?.body ?? this.add.graphics().setDepth(100);
      if (!isLocal) { body.clear(); this.drawPlayer(body, { nick: occupant.name, name: occupant.name, farmName: '', specialization: null, plotId: '', outfit: occupant.appearance.clothing, hair: occupant.appearance.hair }); body.setPosition(position.x, position.y); }
      if (isLocal) body.setPosition(position.x, position.y).setVisible(true);
      let view = this.homePlayerViews.get(occupant.playerId);
      if (!view && !isLocal) { const tag = this.label(occupant.name, position.x, position.y - 62, 10, palette.cream).setBackgroundColor(palette.forest); view = { body, tag }; this.homePlayerViews.set(occupant.playerId, view); }
      if (view) { view.tag.setPosition(position.x, position.y - 62); view.tag.setText(occupant.pose === 'working' ? `${occupant.name} · trabalhando` : occupant.pose === 'resting' ? `${occupant.name} · descansando` : occupant.name); }
      if (this.homePoseState.get(occupant.playerId) !== occupant.pose) {
        this.homePoseTweens.get(occupant.playerId)?.stop(); this.homePoseTweens.delete(occupant.playerId);
        this.homePoseState.set(occupant.playerId, occupant.pose);
        body.setScale(1).setAngle(0);
        if (occupant.pose === 'resting') this.homePoseTweens.set(occupant.playerId, this.tweens.add({ targets: body, scaleY: .9, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }));
        else if (occupant.pose === 'working') this.homePoseTweens.set(occupant.playerId, this.tweens.add({ targets: body, angle: { from: -2, to: 2 }, duration: 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }));
      }
    });
    if (this.localPlayerId) this.updateNameTag();
  }

  private removeHomePlayer(id: string): void { const view = this.homePlayerViews.get(id); this.homePoseTweens.get(id)?.stop(); this.homePoseTweens.delete(id); this.homePoseState.delete(id); if (!view) return; view.body.destroy(); view.tag.destroy(); this.homePlayerViews.delete(id); }
  private homeGridToWorld(x: number, y: number): { x: number; y: number } { return { x: (x + .5) * WORLD_TILE_SIZE, y: (y + .5) * WORLD_TILE_SIZE }; }
  private canOccupyHome(x: number, y: number): boolean {
    const radius = PLAYER_RADIUS;
    const left = Math.floor((x - radius) / WORLD_TILE_SIZE); const right = Math.floor((x + radius) / WORLD_TILE_SIZE);
    const top = Math.floor((y - radius) / WORLD_TILE_SIZE); const bottom = Math.floor((y + radius) / WORLD_TILE_SIZE);
    return isHomeTileWalkable(left, top, this.homeView?.furniture ?? []) && isHomeTileWalkable(right, top, this.homeView?.furniture ?? []) && isHomeTileWalkable(left, bottom, this.homeView?.furniture ?? []) && isHomeTileWalkable(right, bottom, this.homeView?.furniture ?? []);
  }

  private onHomePointerDown(pointer: Phaser.Input.Pointer): void {
    if (!this.insideHome) {
      const door = this.homeDoorPosition();
      if (door && Phaser.Math.Distance.Between(pointer.worldX, pointer.worldY, door.x, door.y) < WORLD_TILE_SIZE * 1.5) this.interact();
      return;
    }
    const point = { x: pointer.worldX, y: pointer.worldY };
    if (this.homeOwner && point.x > 16 * WORLD_TILE_SIZE && point.y < 3 * WORLD_TILE_SIZE) {
      if (point.y < 1.5 * WORLD_TILE_SIZE) { this.homeEditMode = !this.homeEditMode; this.drawHomeFurniture(this.homeView?.furniture ?? []); }
      else this.worldData.realtime.setHomeDoor(!this.homeView?.doorOpen);
      this.drawHomeControls(); return;
    }
    if (point.y > 12.3 * WORLD_TILE_SIZE && point.x > 8 * WORLD_TILE_SIZE && point.x < 13 * WORLD_TILE_SIZE) { this.worldData.realtime.exitHome(); return; }
    for (const [id, item] of this.homeFurnitureViews) {
      const { bounds, body } = item;
      if (point.x < bounds.x || point.x > bounds.x + bounds.width || point.y < bounds.y || point.y > bounds.y + bounds.height) continue;
      if (this.homeOwner && this.homeEditMode) this.homeFurnitureDrag = { id, offsetX: point.x - body.x, offsetY: point.y - body.y };
      else this.worldData.realtime.interactHome(id);
      return;
    }
  }

  private onHomePointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.homeFurnitureDrag) return;
    const item = this.homeFurnitureViews.get(this.homeFurnitureDrag.id); if (!item) return;
    item.body.setPosition(pointer.worldX - this.homeFurnitureDrag.offsetX, pointer.worldY - this.homeFurnitureDrag.offsetY);
  }

  private onHomePointerUp(): void {
    const drag = this.homeFurnitureDrag; this.homeFurnitureDrag = undefined;
    if (!drag || !this.homeView) return;
    const item = this.homeFurnitureViews.get(drag.id); if (!item) return;
    const x = Math.round(item.body.x / WORLD_TILE_SIZE - getHomeFurnitureDefinition(this.homeView.furniture.find((f) => f.id === drag.id)?.type ?? '')!.width / 2);
    const y = Math.round(item.body.y / WORLD_TILE_SIZE - getHomeFurnitureDefinition(this.homeView.furniture.find((f) => f.id === drag.id)?.type ?? '')!.height / 2);
    this.worldData.realtime.moveHomeFurniture(drag.id, x, y);
  }

  private interactHomeNearby(): void {
    if (this.player.y > 11.1 * WORLD_TILE_SIZE && Math.abs(this.player.x - 10.5 * WORLD_TILE_SIZE) < WORLD_TILE_SIZE * 1.5) { this.worldData.realtime.exitHome(); return; }
    const worldX = this.player.x; const worldY = this.player.y;
    const nearby = [...this.homeFurnitureViews.entries()].find(([, item]) => Phaser.Math.Distance.Between(worldX, worldY, item.body.x, item.body.y) < WORLD_TILE_SIZE * 2.2);
    if (nearby) this.worldData.realtime.interactHome(nearby[0]);
  }

  private updateHomeSnapshotFromOccupant(occupant: HomeOccupant): void { this.homeOccupants.set(occupant.playerId, occupant); this.renderHomeOccupants(); }

  private async unlockHomeAudio(): Promise<void> {
    try {
      this.homeAudio ??= new AudioContext();
      if (this.homeAudio.state === 'suspended') await this.homeAudio.resume();
    } catch { /* audio is optional; the house interactions remain available */ }
  }

  private playHomeJingle(): void {
    if (!this.homeAudio || this.homeAudio.state !== 'running' || performance.now() < this.radioPlayingUntil) return;
    const ctx = this.homeAudio; const start = ctx.currentTime + .02;
    const melody = [523, 659, 784, 659, 698, 523, 440, 349];
    melody.forEach((frequency, index) => {
      const oscillator = ctx.createOscillator(); const gain = ctx.createGain(); const at = start + index * .22;
      oscillator.type = index === 3 ? 'triangle' : 'square'; oscillator.frequency.setValueAtTime(frequency, at);
      gain.gain.setValueAtTime(.0001, at); gain.gain.exponentialRampToValueAtTime(.055, at + .015); gain.gain.exponentialRampToValueAtTime(.0001, at + .18);
      oscillator.connect(gain); gain.connect(ctx.destination); oscillator.start(at); oscillator.stop(at + .19);
    });
    const boing = ctx.createOscillator(); const boingGain = ctx.createGain(); const boingAt = start + 1.78;
    boing.type = 'triangle'; boing.frequency.setValueAtTime(240, boingAt); boing.frequency.exponentialRampToValueAtTime(95, boingAt + .28);
    boingGain.gain.setValueAtTime(.0001, boingAt); boingGain.gain.exponentialRampToValueAtTime(.065, boingAt + .02); boingGain.gain.exponentialRampToValueAtTime(.0001, boingAt + .3);
    boing.connect(boingGain); boingGain.connect(ctx.destination); boing.start(boingAt); boing.stop(boingAt + .31);
    this.radioPlayingUntil = performance.now() + 2_200;
  }

  private patchPresence(raw: Record<string, unknown>, online: boolean): void {
    const position = raw.position as { x?: number; y?: number } | undefined;
    const appearance = raw.appearance as { clothing?: PlayerProfile['outfit']; hair?: PlayerProfile['hair'] } | undefined;
    const id = String(raw.id ?? '');
    if (!id || typeof position?.x !== 'number' || typeof position.y !== 'number') return;
    const next: WorldPresence = { id, name: String(raw.name ?? 'vizinho'), farmName: String(raw.farmName ?? ''), homeRegionId: typeof raw.homeRegionId === 'string' ? raw.homeRegionId : null, currentRegionId: typeof raw.currentRegionId === 'string' ? raw.currentRegionId : null, appearance: { clothing: appearance?.clothing ?? 'forest', hair: appearance?.hair ?? 'short' }, position: { x: position.x, y: position.y }, online };
    this.knownPresence = [...this.knownPresence.filter((presence) => presence.id !== id), next]; this.worldData.onPresence?.(this.knownPresence);
  }

  private renderFarmItem(item: Record<string, unknown>): void {
    const id = String(item.id ?? ''); if (!id) return; this.removeFarmItem(id);
    const rawPosition = item.position as { x?: number; y?: number } | undefined; const position = this.gridToWorld(Number(rawPosition?.x ?? 0), Number(rawPosition?.y ?? 0));
    const body = this.add.graphics().setDepth(45).setPosition(position.x, position.y); const contentId = String(item.contentId ?? 'tomato'); const ready = Boolean(item.ready);
    if (contentId === 'cow') body.fillStyle(color('#f5eee0'), 1).fillRoundedRect(-24, -16, 48, 28, 12).fillStyle(color(palette.soil), 1).fillCircle(10, -6, 5).fillStyle(color(palette.forest), 1).fillCircle(22, -8, 3);
    else if (contentId === 'dinosaur') body.fillStyle(color('#5d9854'), 1).fillEllipse(0, 0, 50, 28).fillStyle(color(palette.amber), 1).fillCircle(16, -9, 4);
    else body.fillStyle(color(ready ? palette.amber : palette.forest), 1).fillEllipse(0, 0, ready ? 25 : 15, ready ? 25 : 15).fillStyle(color(palette.coral), 1).fillCircle(-6, -3, ready ? 5 : 3).fillCircle(6, 2, ready ? 5 : 3);
    const tag = this.label(ready ? 'pronto' : 'crescendo', position.x, position.y - 28, 9, palette.forest); this.farmItems.set(id, { id, contentId, ready, body, tag, x: position.x, y: position.y }); this.notifyFarmStatus();
  }
  private renderStructure(raw: Record<string, unknown>): void {
    const id = String(raw.id ?? ''); const footprint = raw.footprint as Array<[number, number]> | undefined; if (!id || !footprint?.length) return;
    const points = footprint.map(([x, y]) => this.gridToWorld(x, y)); const graphics = this.add.graphics().setDepth(28);
    const minX = Math.min(...footprint.map((point) => point[0])); const maxX = Math.max(...footprint.map((point) => point[0])); const minY = Math.min(...footprint.map((point) => point[1])); const maxY = Math.max(...footprint.map((point) => point[1]));
    for (let y = minY; y < maxY; y += 1) for (let x = minX; x < maxX; x += 1) this.dynamicBlocked.add(`${x}:${y}`);
    graphics.fillStyle(color(raw.type === 'dinosaur_enclosure' ? '#b47b48' : raw.type === 'orchard' ? '#72a95d' : '#d4ae69'), .72).beginPath().moveTo(points[0].x, points[0].y);
    points.slice(1).forEach((point) => graphics.lineTo(point.x, point.y)); graphics.closePath().fillPath().lineStyle(3, color(palette.forest), .45).strokePath();
    this.structures.set(id, graphics);
  }
  private removeFarmItem(id: string): void { const item = this.farmItems.get(id); if (!item) return; item.body.destroy(); item.tag.destroy(); this.farmItems.delete(id); this.notifyFarmStatus(); }
  private notifyFarmStatus(): void { const ready = [...this.farmItems.values()].filter((item) => item.ready).length; this.worldData.onProduction?.(ready, this.farmItems.size); }

  private setResponsiveZoom(): void { this.cameras.main.setZoom(Math.min(window.innerWidth / 920, window.innerHeight / 620, 1)); }

  private renderRemotePlayer(raw: Record<string, unknown>, forcedId?: string): void {
    const id = forcedId ?? String(raw.id ?? ''); const position = raw.position as { x?: number; y?: number } | undefined; if (!id || !position) return;
    const regionId = String(raw.currentRegionId ?? raw.homeRegionId ?? ''); if (regionId && regionId !== this.currentRegionId) { this.removeRemotePlayer(id); return; }
    this.removeRemotePlayer(id);
    const worldPosition = this.gridToWorld(Number(position.x ?? 0), Number(position.y ?? 0)); const body = this.add.graphics().setDepth(90).setPosition(worldPosition.x, worldPosition.y);
    const appearance = raw.appearance as { clothing?: PlayerProfile['outfit']; hair?: PlayerProfile['hair'] } | undefined;
    this.drawPlayer(body, { nick: String(raw.name ?? 'vizinho'), name: String(raw.name ?? 'vizinho'), farmName: '', specialization: null, plotId: '', outfit: appearance?.clothing ?? 'forest', hair: appearance?.hair ?? 'short' });
    const tag = this.label(String(raw.name ?? 'vizinho'), body.x, body.y - 62, 10, palette.cream).setBackgroundColor(palette.forest); this.remotePlayers.set(id, { body, tag });
  }
  private removeRemotePlayer(id: string): void { const view = this.remotePlayers.get(id); if (!view) return; view.body.destroy(); view.tag.destroy(); this.remotePlayers.delete(id); }

  private drawMap(): void {
    const graphics = this.add.graphics().setDepth(0);
    for (let y = 0; y < WORLD_HEIGHT_TILES; y += 1) for (let x = 0; x < WORLD_WIDTH_TILES; x += 1) {
      const px = x * WORLD_TILE_SIZE; const py = y * WORLD_TILE_SIZE; const inside = isInsideFarmBoundary(x + .5, y + .5); const water = inside && isWorldWaterTile(x, y); const path = inside && !water && (y === 28 || y === 29 || x === 40 || (y === 21 && x > 5 && x < 34)); const field = inside && !water && x >= 6 && x <= 15 && y >= 8 && y <= 13; const meadow = inside && x >= 27 && y >= 4 && y <= 13;
      const tileColor = !inside ? '#6e8b72' : water ? palette.river : path ? '#d4ae69' : field ? palette.soil : meadow ? '#a8cc7b' : ((x + y) % 2 ? '#a4c77e' : palette.grass);
      graphics.fillStyle(color(tileColor), 1).fillRect(px, py, WORLD_TILE_SIZE + 1, WORLD_TILE_SIZE + 1).lineStyle(1, color(water ? palette.riverLight : palette.forest), water ? 0.16 : 0.08).strokeRect(px, py, WORLD_TILE_SIZE, WORLD_TILE_SIZE);
      if (water) graphics.fillStyle(color(palette.riverLight), 0.24).fillRect(px + 8 + (y % 3) * 5, py + 18, 22, 3);
      if (field) graphics.lineStyle(2, color('#a97a4c'), 0.45).lineBetween(px + 9, py + 16, px + 38, py + 16);
    }
    for (let y = 14; y <= 15; y += 1) for (let x = 23; x <= 27; x += 1) graphics.fillStyle(color('#9b5b3d'), 1).fillRect(x * WORLD_TILE_SIZE, y * WORLD_TILE_SIZE, WORLD_TILE_SIZE + 1, WORLD_TILE_SIZE + 1);
    graphics.lineStyle(5, color(palette.forest), 0.2).strokeRect(1, 1, WORLD.width - 2, WORLD.height - 2);
    this.label('ponte do vale', this.gridToWorld(25, 14).x, this.gridToWorld(25, 14).y - 36, 10, palette.soil); this.label('seu campo', this.gridToWorld(8, 3).x, this.gridToWorld(8, 3).y - 28, 11, palette.forest);
  }

  private drawObstacles(): void { WORLD_OBSTACLES.forEach((obstacle) => obstacle.kind === 'tree' ? this.drawTree(obstacle) : obstacle.kind === 'rock' ? this.drawRock(obstacle) : this.drawBuilding(obstacle)); }
  private obstacleCenter(obstacle: WorldObstacle): { x: number; y: number } { return this.gridToWorld(obstacle.x + (obstacle.width - 1) / 2, obstacle.y + (obstacle.height - 1) / 2); }
  private drawTree(obstacle: WorldObstacle): void { const { x, y } = this.obstacleCenter(obstacle); const graphics = this.add.graphics().setDepth(40); graphics.fillStyle(color(palette.forest), 0.2).fillEllipse(x, y + 24, 56, 18).fillStyle(color('#76503b'), 1).fillRoundedRect(x - 7, y + 4, 14, 28, 5).fillStyle(color('#4d874e'), 1).fillEllipse(x - 15, y, 50, 52).fillStyle(color('#72a95d'), 1).fillEllipse(x + 14, y - 4, 52, 54).fillStyle(color('#87ba68'), 1).fillEllipse(x, y - 22, 56, 52).fillStyle(color(palette.amber), 1).fillCircle(x - 14, y - 10, 4).fillCircle(x + 12, y - 20, 4); }
  private drawRock(obstacle: WorldObstacle): void { const { x, y } = this.obstacleCenter(obstacle); const graphics = this.add.graphics().setDepth(40); graphics.fillStyle(color(palette.forest), 0.2).fillEllipse(x, y + 15, 48, 14).fillStyle(color('#738487'), 1).beginPath().moveTo(x - 24, y + 12).lineTo(x - 15, y - 12).lineTo(x + 2, y - 22).lineTo(x + 24, y - 8).lineTo(x + 18, y + 15).closePath().fillPath().lineStyle(3, color(palette.forest), 0.2).strokePath(); }
  private drawBuilding(obstacle: WorldObstacle): void { const { x, y } = this.obstacleCenter(obstacle); const width = obstacle.width * WORLD_TILE_SIZE - 10; const height = obstacle.height * WORLD_TILE_SIZE - 12; const graphics = this.add.graphics().setDepth(35); const isMarket = obstacle.kind === 'market'; const body = isMarket ? palette.amber : palette.coral; const roof = isMarket ? '#d86b5d' : '#a7473f'; graphics.fillStyle(color(palette.forest), 0.2).fillEllipse(x, y + height / 2 + 12, width + 24, 22).fillStyle(color(body), 1).fillRoundedRect(x - width / 2, y - height / 2 + 12, width, height - 12, 8).fillStyle(color(roof), 1).beginPath().moveTo(x - width / 2 - 8, y - height / 2 + 16).lineTo(x, y - height / 2 - 18).lineTo(x + width / 2 + 8, y - height / 2 + 16).closePath().fillPath().fillStyle(color('#6c4938'), 1).fillRect(x - 15, y + 4, 30, height / 2 - 4); this.label(isMarket ? 'mercadinho' : obstacle.kind === 'barn' ? 'celeiro' : 'casa', x, y - height / 2 - 31, 10, palette.forest); }

  private createPlayer(profile: PlayerProfile): void { this.player = this.add.graphics().setDepth(100); this.drawPlayer(this.player, profile); this.nameTag = this.label(profile.name, 0, 0, 12, palette.cream).setBackgroundColor(palette.forest); this.updateNameTag(); }
  private updateNameTag(): void {
    this.nameTag.setPosition(this.player.x, this.player.y - 62).setVisible(true);
    const pose = this.homeOccupants.get(this.localPlayerId)?.pose;
    this.nameTag.setText(pose === 'working' ? `${this.worldData.profile.name} · trabalhando` : pose === 'resting' ? `${this.worldData.profile.name} · descansando` : this.worldData.profile.name);
  }
  private drawPlayer(graphics: Phaser.GameObjects.Graphics, profile: PlayerProfile): void { const outfit = outfits.find((item) => item.id === profile.outfit)?.color ?? 0x315d4a; graphics.fillStyle(color(palette.forest), 0.22).fillEllipse(0, 30, 54, 20); if (profile.hair === 'long') graphics.fillStyle(color('#5a382e'), 1).fillRoundedRect(-25, -31, 50, 72, 20); graphics.fillStyle(outfit, 1).fillRoundedRect(-19, -2, 38, 45, 12).fillStyle(color('#a96e4f'), 1).fillCircle(0, -18, 22).fillStyle(color('#5a382e'), 1).fillRoundedRect(-22, -35, 44, 18, 12); if (profile.hair === 'long') graphics.fillStyle(color('#5a382e'), 1).fillRoundedRect(-25, -19, 9, 34, 6).fillRoundedRect(16, -19, 9, 34, 6); graphics.fillStyle(color(palette.forest), 1).fillCircle(-7, -17, 2.3).fillCircle(7, -17, 2.3).fillStyle(color(palette.soil), 1).fillRect(-13, 42, 9, 23).fillRect(4, 42, 9, 23).fillStyle(color('#31556a'), 1).fillRect(-16, 63, 15, 5).fillRect(4, 63, 15, 5); }
  private label(text: string, x: number, y: number, size: number, textColor: string): Phaser.GameObjects.Text { return this.add.text(x, y, text, { fontFamily: 'Trebuchet MS, Segoe UI, sans-serif', fontSize: `${size}px`, fontStyle: 'bold', color: textColor, backgroundColor: palette.cream, padding: { left: 9, right: 9, top: 5, bottom: 5 } }).setOrigin(0.5).setDepth(20).setAlpha(0.92); }
}

export function createGame(container: HTMLElement, data: WorldData): Phaser.Game { const config: Phaser.Types.Core.GameConfig = { type: Phaser.AUTO, parent: container, width: 960, height: 640, backgroundColor: palette.grass, render: { antialias: true, pixelArt: false }, scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH }, scene: [WorldScene], banner: false }; const game = new Phaser.Game(config); game.scene.start('world', data); return game; }
