import Phaser from 'phaser';
import { outfits, palette } from '@lafarmer/content-client';
import type { PlayerProfile, RealtimeClient } from './network';

const WORLD = { width: 2400, height: 1600 };
const color = (hex: string): number => Number(`0x${hex.slice(1)}`);

interface WorldData { profile: PlayerProfile; realtime: RealtimeClient; onCoins: (coins: number) => void; }

export class WorldScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Graphics;
  private nameTag!: Phaser.GameObjects.Text;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private worldData!: WorldData;
  private lastMoveSent = 0;

  constructor() { super('world'); }

  create(data?: unknown): void {
    const worldData = data as WorldData;
    this.worldData = worldData;
    this.drawGround(); this.drawRiver(); this.drawPathsAndParcels(); this.drawLandmarks(); this.createPlayer(worldData.profile);
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys('W,A,S,D') as Record<string, Phaser.Input.Keyboard.Key>;
    this.cameras.main.setBounds(0, 0, WORLD.width, WORLD.height);
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
    this.cameras.main.setZoom(Math.min(window.innerWidth / 920, window.innerHeight / 620, 1));
    worldData.realtime.onMessage((message) => {
      if (message.type === 'wallet.updated') {
        const payload = message.payload as { coins?: number } | undefined;
        if (typeof payload?.coins === 'number') worldData.onCoins(payload.coins);
      }
      if (message.type === 'hello' || message.type === 'move_ack') {
        const source = message.type === 'hello' ? message.snapshot as { player?: { position?: { x: number; y: number } } } : message as { player?: { position?: { x: number; y: number } } };
        const position = source.player?.position;
        if (position) this.applyServerPosition(position.x, position.y);
      }
    });
    this.applyServerPosition(5, 5);
  }

  update(time: number, delta: number): void {
    const left = this.cursors.left.isDown || this.keys.A?.isDown;
    const right = this.cursors.right.isDown || this.keys.D?.isDown;
    const up = this.cursors.up.isDown || this.keys.W?.isDown;
    const down = this.cursors.down.isDown || this.keys.S?.isDown;
    const dx = Number(right) - Number(left); const dy = Number(down) - Number(up);
    if (dx === 0 && dy === 0) return;
    const length = Math.hypot(dx, dy) || 1; const speed = 0.26 * delta;
    this.player.x = Phaser.Math.Clamp(this.player.x + (dx / length) * speed, 60, WORLD.width - 60);
    this.player.y = Phaser.Math.Clamp(this.player.y + (dy / length) * speed, 60, WORLD.height - 60);
    this.nameTag.setPosition(this.player.x, this.player.y - 62);
    if (time - this.lastMoveSent > 100) { this.lastMoveSent = time; this.worldData.realtime.move(dx > 0 ? 'right' : dx < 0 ? 'left' : dy > 0 ? 'down' : 'up'); }
  }

  private applyServerPosition(x: number, y: number): void {
    this.player.setPosition(620 + x * 18, 420 + y * 12);
    this.nameTag.setPosition(this.player.x, this.player.y - 62);
  }

  private drawGround(): void {
    const graphics = this.add.graphics();
    graphics.fillStyle(color(palette.grass), 1).fillRect(0, 0, WORLD.width, WORLD.height);
    for (let y = 0; y < WORLD.height; y += 80) for (let x = 0; x < WORLD.width; x += 80) {
      graphics.fillStyle(color((x / 80 + y / 80) % 2 === 0 ? '#a4cb86' : '#78ae6e'), 0.22).fillRect(x, y, 80, 80);
    }
    graphics.lineStyle(1, color(palette.forest), 0.1);
    for (let x = 0; x <= WORLD.width; x += 80) graphics.lineBetween(x, 0, x, WORLD.height);
    for (let y = 0; y <= WORLD.height; y += 80) graphics.lineBetween(0, y, WORLD.width, y);
  }

  private drawRiver(): void {
    const graphics = this.add.graphics();
    const center = (y: number) => 1340 + Math.sin(y / 240) * 100 + Math.sin(y / 83) * 22;
    const left: Array<[number, number]> = []; const right: Array<[number, number]> = [];
    for (let y = -100; y <= WORLD.height + 100; y += 24) { left.push([center(y) - 82, y]); right.push([center(y) + 82, y]); }
    graphics.fillStyle(color(palette.river), 1).beginPath().moveTo(left[0][0], left[0][1]);
    left.slice(1).forEach(([x, y]) => graphics.lineTo(x, y)); right.reverse().forEach(([x, y]) => graphics.lineTo(x, y)); graphics.closePath().fillPath();
    graphics.lineStyle(3, color(palette.riverLight), 0.45).beginPath();
    for (let y = -100; y <= WORLD.height + 100; y += 24) { const x = center(y); if (y === -100) graphics.moveTo(x, y); else graphics.lineTo(x, y); }
    graphics.strokePath();
    const bridgeY = 720; const bridgeX = center(bridgeY);
    graphics.fillStyle(color('#9b5b3d'), 1).fillRect(bridgeX - 102, bridgeY - 48, 204, 96);
    graphics.fillStyle(color('#d39a58'), 1).fillRect(bridgeX - 94, bridgeY - 38, 188, 76);
    for (let x = bridgeX - 78; x <= bridgeX + 78; x += 24) graphics.fillStyle(color('#74452f'), 0.48).fillRect(x, bridgeY - 38, 8, 76);
    this.label('ponte do vale', bridgeX, bridgeY - 72, 11, palette.soil);
  }

  private drawPathsAndParcels(): void {
    const graphics = this.add.graphics();
    const path = (points: Array<[number, number]>) => { graphics.beginPath().moveTo(points[0][0], points[0][1]); points.slice(1).forEach(([x, y]) => graphics.lineTo(x, y)); graphics.strokePath(); };
    const points: Array<[number, number]> = [[140, 510], [640, 510], [890, 720], [1270, 720], [1710, 505], [2240, 505]];
    graphics.lineStyle(46, color('#c69b62'), 0.9); path(points); graphics.lineStyle(32, color('#ead19a'), 1); path(points);
    graphics.lineStyle(4, color(palette.forest), 0.27);
    graphics.strokeRect(560, 270, 720, 900).strokeRect(560, -630, 720, 900).strokeRect(560, 1170, 720, 900).strokeRect(-160, 270, 720, 900).strokeRect(1280, 270, 720, 900);
  }

  private drawLandmarks(): void {
    this.drawField(650, 420, 290, 180); this.drawField(650, 760, 290, 180);
    this.drawTree(1160, 350, 1.05); this.drawTree(1060, 1080, 0.8); this.drawTree(1870, 350, 1.1); this.drawRock(1750, 920, 1.1);
    this.drawBarn(370, 710); this.drawMarket(1650, 680); this.drawCow(1320, 430, 1); this.drawDino(1850, 1020, 0.8);
    this.label('sua terra', 790, 385, 13, palette.forest); this.label('mercadinho', 1710, 640, 13, palette.forest); this.label('celeiro', 450, 675, 13, palette.forest);
  }

  private drawField(x: number, y: number, width: number, height: number): void {
    const graphics = this.add.graphics(); graphics.fillStyle(color(palette.soil), 1).fillRoundedRect(x, y, width, height, 15);
    graphics.lineStyle(3, color('#6d402c'), 0.38).strokeRoundedRect(x, y, width, height, 15);
    for (let row = 0; row < 3; row++) for (let column = 0; column < 7; column++) {
      const px = x + 25 + column * 36; const py = y + 32 + row * 52;
      graphics.fillStyle(color(row === 0 ? palette.amber : palette.coral), 1).fillEllipse(px, py, 10, 15);
      graphics.lineStyle(2, color('#427846'), 1).lineBetween(px, py + 6, px - 3, py + 16).lineBetween(px, py + 7, px + 5, py + 2);
    }
  }

  private drawTree(x: number, y: number, scale: number): void {
    const graphics = this.add.graphics(); graphics.fillStyle(color(palette.forest), 0.2).fillEllipse(x, y + 45 * scale, 70 * scale, 24 * scale);
    graphics.fillStyle(color('#76503b'), 1).fillRoundedRect(x - 8 * scale, y + 8 * scale, 16 * scale, 42 * scale, 5 * scale);
    graphics.fillStyle(color('#4d874e'), 1).fillEllipse(x - 20 * scale, y, 68 * scale, 68 * scale).fillStyle(color('#72a95d'), 1).fillEllipse(x + 17 * scale, y - 5 * scale, 68 * scale, 70 * scale).fillStyle(color('#87ba68'), 1).fillEllipse(x, y - 28 * scale, 76 * scale, 72 * scale);
    graphics.fillStyle(color(palette.amber), 1).fillCircle(x - 18 * scale, y - 12 * scale, 5 * scale).fillCircle(x + 15 * scale, y - 24 * scale, 5 * scale).fillCircle(x + 5 * scale, y + 10 * scale, 5 * scale);
  }

  private drawRock(x: number, y: number, scale: number): void {
    const graphics = this.add.graphics(); graphics.fillStyle(color('#738487'), 1).beginPath().moveTo(x - 25 * scale, y + 16 * scale).lineTo(x - 18 * scale, y - 5 * scale).lineTo(x - 2 * scale, y - 20 * scale).lineTo(x + 22 * scale, y - 12 * scale).lineTo(x + 27 * scale, y + 12 * scale).lineTo(x + 9 * scale, y + 21 * scale).closePath().fillPath();
    graphics.lineStyle(3, color(palette.forest), 0.2).strokePath();
  }

  private drawBarn(x: number, y: number): void {
    const graphics = this.add.graphics(); graphics.fillStyle(color(palette.forest), 0.2).fillEllipse(x + 75, y + 128, 210, 32);
    graphics.fillStyle(color(palette.coral), 1).fillRect(x, y + 38, 150, 86).fillStyle(color('#a7473f'), 1).beginPath().moveTo(x - 15, y + 42).lineTo(x + 75, y - 17).lineTo(x + 165, y + 42).closePath().fillPath();
    graphics.fillStyle(color(palette.amber), 1).fillRect(x + 52, y + 70, 46, 54).fillStyle(color('#6c4938'), 1).fillRect(x + 58, y + 76, 34, 48);
  }

  private drawMarket(x: number, y: number): void {
    const graphics = this.add.graphics(); graphics.fillStyle(color(palette.forest), 0.2).fillEllipse(x + 55, y + 93, 188, 32);
    graphics.fillStyle(color('#76503b'), 1).fillRect(x + 10, y + 27, 10, 65).fillRect(x + 100, y + 27, 10, 65).fillStyle(color(palette.coral), 1).beginPath().moveTo(x - 6, y + 36).lineTo(x + 115, y + 36).lineTo(x + 101, y - 6).lineTo(x + 7, y - 6).closePath().fillPath();
    graphics.fillStyle(color(palette.cream), 1).fillRect(x + 11, y + 7, 17, 29).fillRect(x + 44, y + 7, 17, 29).fillRect(x + 77, y + 7, 17, 29).fillStyle(color('#6d4935'), 1).fillRect(x + 18, y + 52, 80, 13);
    graphics.fillStyle(color(palette.amber), 1).fillCircle(x + 34, y + 47, 9).fillStyle(color('#d87544'), 1).fillCircle(x + 55, y + 47, 9).fillStyle(color('#8fbb56'), 1).fillCircle(x + 76, y + 47, 9);
  }

  private drawCow(x: number, y: number, scale: number): void {
    const graphics = this.add.graphics(); graphics.fillStyle(color(palette.forest), 0.2).fillEllipse(x, y + 34 * scale, 78 * scale, 20 * scale);
    graphics.fillStyle(color('#f5eee0'), 1).fillRoundedRect(x - 31 * scale, y - 17 * scale, 64 * scale, 40 * scale, 17 * scale).fillStyle(color(palette.soil), 1).fillEllipse(x - 10 * scale, y - 3 * scale, 16 * scale, 14 * scale).fillEllipse(x + 14 * scale, y + 7 * scale, 18 * scale, 16 * scale);
    graphics.fillStyle(color('#f5eee0'), 1).fillEllipse(x + 37 * scale, y - 13 * scale, 44 * scale, 40 * scale).fillStyle(color(palette.soil), 1).fillCircle(x + 44 * scale, y - 9 * scale, 4 * scale).fillCircle(x + 52 * scale, y - 9 * scale, 4 * scale).fillStyle(color('#e8a4a0'), 1).fillEllipse(x + 54 * scale, y - 3 * scale, 20 * scale, 12 * scale);
  }

  private drawDino(x: number, y: number, scale: number): void {
    const graphics = this.add.graphics(); graphics.fillStyle(color(palette.forest), 0.2).fillEllipse(x, y + 49 * scale, 130 * scale, 26 * scale).fillStyle(color('#5d9854'), 1).beginPath().moveTo(x - 55 * scale, y + 18 * scale).lineTo(x - 95 * scale, y - 8 * scale).lineTo(x - 49 * scale, y - 3 * scale).lineTo(x - 29 * scale, y - 36 * scale).lineTo(x + 17 * scale, y - 23 * scale).lineTo(x + 52 * scale, y - 21 * scale).lineTo(x + 58 * scale, y + 10 * scale).lineTo(x + 40 * scale, y + 28 * scale).lineTo(x - 45 * scale, y + 28 * scale).closePath().fillPath();
    graphics.lineStyle(3, color(palette.forest), 0.35).strokePath().fillStyle(color(palette.amber), 1).beginPath().moveTo(x - 4 * scale, y - 25 * scale).lineTo(x + 4 * scale, y - 43 * scale).lineTo(x + 13 * scale, y - 24 * scale).closePath().fillPath().fillStyle(color(palette.forest), 1).fillCircle(x + 43 * scale, y - 10 * scale, 4 * scale);
  }

  private createPlayer(profile: PlayerProfile): void {
    this.player = this.add.graphics().setDepth(100).setPosition(710, 480); this.drawPlayer(profile);
    this.nameTag = this.label(profile.name, this.player.x, this.player.y - 62, 12, palette.cream).setBackgroundColor(palette.forest);
  }

  private drawPlayer(profile: PlayerProfile): void {
    const graphics = this.player; const outfit = outfits.find((item) => item.id === profile.outfit)?.color ?? 0x315d4a;
    graphics.fillStyle(color(palette.forest), 0.22).fillEllipse(0, 30, 54, 20);
    if (profile.hair === 'long') graphics.fillStyle(color('#5a382e'), 1).fillRoundedRect(-25, -31, 50, 72, 20);
    graphics.fillStyle(outfit, 1).fillRoundedRect(-19, -2, 38, 45, 12).fillStyle(color('#a96e4f'), 1).fillCircle(0, -18, 22).fillStyle(color('#5a382e'), 1).fillRoundedRect(-22, -35, 44, 18, 12);
    if (profile.hair === 'long') graphics.fillStyle(color('#5a382e'), 1).fillRoundedRect(-25, -19, 9, 34, 6).fillRoundedRect(16, -19, 9, 34, 6);
    graphics.fillStyle(color(palette.forest), 1).fillCircle(-7, -17, 2.3).fillCircle(7, -17, 2.3).fillStyle(color(palette.soil), 1).fillRect(-13, 42, 9, 23).fillRect(4, 42, 9, 23).fillStyle(color('#31556a'), 1).fillRect(-16, 63, 15, 5).fillRect(4, 63, 15, 5);
  }

  private label(text: string, x: number, y: number, size: number, textColor: string): Phaser.GameObjects.Text {
    return this.add.text(x, y, text, { fontFamily: 'Trebuchet MS, Segoe UI, sans-serif', fontSize: `${size}px`, fontStyle: 'bold', color: textColor, backgroundColor: palette.cream, padding: { left: 9, right: 9, top: 5, bottom: 5 } }).setOrigin(0.5).setDepth(20).setAlpha(0.92);
  }
}

export function createGame(container: HTMLElement, data: WorldData): Phaser.Game {
  const config: Phaser.Types.Core.GameConfig = { type: Phaser.AUTO, parent: container, width: 960, height: 640, backgroundColor: palette.grass, render: { antialias: true, pixelArt: false }, scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH }, scene: [WorldScene], banner: false };
  const game = new Phaser.Game(config); game.scene.start('world', data); return game;
}
