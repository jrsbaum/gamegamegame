import Phaser from 'phaser';
import { getWorldRegion, isInsideFarmBoundary, isWorldTileWalkable, isWorldWaterTile, outfits, palette, WORLD_CONNECTIONS, WORLD_HEIGHT_TILES, WORLD_OBSTACLES, WORLD_TILE_SIZE, WORLD_WIDTH_TILES, type WorldObstacle } from '@lafarmer/content-client';
import type { PlayerProfile, RealtimeClient, WorldPresence } from './network';

const WORLD = { width: WORLD_WIDTH_TILES * WORLD_TILE_SIZE, height: WORLD_HEIGHT_TILES * WORLD_TILE_SIZE };
const MOVE_SEND_INTERVAL = 250;
const MOVE_SPEED = WORLD_TILE_SIZE * 1_000 / MOVE_SEND_INTERVAL;
const PLAYER_RADIUS = 13;
const RECONCILE_DISTANCE = 44;
const color = (hex: string): number => Number(`0x${hex.slice(1)}`);

interface WorldData { profile: PlayerProfile; realtime: RealtimeClient; onCoins: (coins: number) => void; onInventory?: (inventory: Record<string, number>) => void; onProduction?: (ready: number, total: number) => void; onSnapshot?: (snapshot: Record<string, unknown>) => void; onPresence?: (presence: WorldPresence[]) => void; onMarket?: () => void; onConnectionPrompt?: (message: string) => void; }
type RemoteView = { body: Phaser.GameObjects.Graphics; tag: Phaser.GameObjects.Text };
type FarmView = { id: string; contentId: string; ready: boolean; body: Phaser.GameObjects.Graphics; tag: Phaser.GameObjects.Text; x: number; y: number };

export class WorldScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Graphics;
  private nameTag!: Phaser.GameObjects.Text;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private worldData!: WorldData;
  private touchDirection: 'up' | 'down' | 'left' | 'right' | undefined;
  private currentRegionId = '';
  private knownPresence: WorldPresence[] = [];
  private lastConnectionPrompt = '';
  private lastRegionEntryAt = 0;
  private lastMoveSent = 0;
  private lastLocalPosition = { x: 0, y: 0 };
  private readonly pendingMoves = new Map<string, 'up' | 'down' | 'left' | 'right'>();
  private readonly remotePlayers = new Map<string, RemoteView>();
  private readonly farmItems = new Map<string, FarmView>();
  private readonly structures = new Map<string, Phaser.GameObjects.Graphics>();
  private readonly dynamicBlocked = new Set<string>();

  constructor() { super('world'); }

  create(data?: unknown): void {
    this.worldData = data as WorldData;
    this.currentRegionId = this.worldData.profile.plotId;
    this.drawMap(); this.drawObstacles(); this.createPlayer(this.worldData.profile);
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,E,SPACE') as Record<string, Phaser.Input.Keyboard.Key>;
    this.cameras.main.setBounds(0, 0, WORLD.width, WORLD.height);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
    this.setResponsiveZoom();
    window.addEventListener('resize', () => this.setResponsiveZoom());
    document.querySelectorAll<HTMLButtonElement>('[data-direction]').forEach((button) => {
      const direction = button.dataset.direction as 'up' | 'down' | 'left' | 'right';
      const start = (event: Event) => { event.preventDefault(); this.touchDirection = direction; };
      const stop = () => { if (this.touchDirection === direction) this.touchDirection = undefined; };
      button.addEventListener('pointerdown', start, { passive: false });
      button.addEventListener('pointerup', stop);
      button.addEventListener('pointercancel', stop);
      button.addEventListener('pointerleave', stop);
    });
    this.bindRealtime(); this.applyServerPosition(5, 5); this.updateConnectionPrompt();
  }

  private applySnapshot(snapshot: Record<string, unknown>): void {
    this.remotePlayers.forEach((view) => { view.body.destroy(); view.tag.destroy(); });
    this.remotePlayers.clear();
    this.farmItems.forEach((view) => { view.body.destroy(); view.tag.destroy(); });
    this.farmItems.clear();
    this.structures.forEach((view) => view.destroy()); this.structures.clear(); this.dynamicBlocked.clear();
    const player = snapshot.player as { coins?: number; inventory?: Record<string, number>; position?: { x?: number; y?: number } } | undefined;
    if (typeof player?.coins === 'number') this.worldData.onCoins(player.coins);
    if (player?.inventory) this.worldData.onInventory?.(player.inventory);
    if (typeof player?.position?.x === 'number' && typeof player.position.y === 'number') this.applyServerPosition(player.position.x, player.position.y);
    const playerRegion = snapshot.player as { currentRegionId?: string | null; homeRegionId?: string | null } | undefined;
    if (playerRegion?.currentRegionId || playerRegion?.homeRegionId) this.currentRegionId = playerRegion.currentRegionId ?? playerRegion.homeRegionId ?? this.currentRegionId;
    const presence = snapshot.presence as WorldPresence[] | undefined;
    if (presence) { this.knownPresence = presence; this.worldData.onPresence?.(presence); }
    this.worldData.onSnapshot?.(snapshot);
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
    const direction = this.touchDirection ?? (right ? 'right' : left ? 'left' : down ? 'down' : up ? 'up' : undefined);
    if (direction) this.moveDirection(direction, time, delta);
    if (Phaser.Input.Keyboard.JustDown(this.keys.E)) this.interact();
    this.updateConnectionPrompt();
  }

  private moveDirection(direction: 'up' | 'down' | 'left' | 'right', time: number, delta: number): void {
    const sprint = Boolean(this.keys.SPACE?.isDown);
    const distance = MOVE_SPEED * (sprint ? 2 : 1) * Math.min(delta, 100) / 1_000;
    const next = { x: this.player.x, y: this.player.y };
    if (direction === 'right') next.x += distance;
    if (direction === 'left') next.x -= distance;
    if (direction === 'down') next.y += distance;
    if (direction === 'up') next.y -= distance;
    if (this.canOccupy(next.x, next.y)) { this.player.setPosition(next.x, next.y); this.updateNameTag(); }
    if (time - this.lastMoveSent >= MOVE_SEND_INTERVAL && (this.player.x !== this.lastLocalPosition.x || this.player.y !== this.lastLocalPosition.y)) {
      this.lastMoveSent = time; this.lastLocalPosition = { x: this.player.x, y: this.player.y };
      const actionId = this.worldData.realtime.move(direction, sprint);
      if (actionId) this.pendingMoves.set(actionId, direction);
    }
  }

  private bindRealtime(): void {
    this.worldData.realtime.onMessage((message) => {
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
    const connection = this.nearbyConnection();
    const targetId = connection ? (connection.fromRegionId === this.currentRegionId ? connection.toRegionId : connection.fromRegionId) : '';
    const target = targetId ? getWorldRegion(targetId) : undefined;
    const message = target ? `${connection?.kind === 'bridge' ? 'Ponte' : connection?.kind === 'gate' ? 'Porteira' : 'Passagem'} para ${target.name} · pressione E para visitar.` : '';
    if (message !== this.lastConnectionPrompt) { this.lastConnectionPrompt = message; this.worldData.onConnectionPrompt?.(message); }
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
  private updateNameTag(): void { this.nameTag.setPosition(this.player.x, this.player.y - 62); }
  private drawPlayer(graphics: Phaser.GameObjects.Graphics, profile: PlayerProfile): void { const outfit = outfits.find((item) => item.id === profile.outfit)?.color ?? 0x315d4a; graphics.fillStyle(color(palette.forest), 0.22).fillEllipse(0, 30, 54, 20); if (profile.hair === 'long') graphics.fillStyle(color('#5a382e'), 1).fillRoundedRect(-25, -31, 50, 72, 20); graphics.fillStyle(outfit, 1).fillRoundedRect(-19, -2, 38, 45, 12).fillStyle(color('#a96e4f'), 1).fillCircle(0, -18, 22).fillStyle(color('#5a382e'), 1).fillRoundedRect(-22, -35, 44, 18, 12); if (profile.hair === 'long') graphics.fillStyle(color('#5a382e'), 1).fillRoundedRect(-25, -19, 9, 34, 6).fillRoundedRect(16, -19, 9, 34, 6); graphics.fillStyle(color(palette.forest), 1).fillCircle(-7, -17, 2.3).fillCircle(7, -17, 2.3).fillStyle(color(palette.soil), 1).fillRect(-13, 42, 9, 23).fillRect(4, 42, 9, 23).fillStyle(color('#31556a'), 1).fillRect(-16, 63, 15, 5).fillRect(4, 63, 15, 5); }
  private label(text: string, x: number, y: number, size: number, textColor: string): Phaser.GameObjects.Text { return this.add.text(x, y, text, { fontFamily: 'Trebuchet MS, Segoe UI, sans-serif', fontSize: `${size}px`, fontStyle: 'bold', color: textColor, backgroundColor: palette.cream, padding: { left: 9, right: 9, top: 5, bottom: 5 } }).setOrigin(0.5).setDepth(20).setAlpha(0.92); }
}

export function createGame(container: HTMLElement, data: WorldData): Phaser.Game { const config: Phaser.Types.Core.GameConfig = { type: Phaser.AUTO, parent: container, width: 960, height: 640, backgroundColor: palette.grass, render: { antialias: true, pixelArt: false }, scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH }, scene: [WorldScene], banner: false }; const game = new Phaser.Game(config); game.scene.start('world', data); return game; }
