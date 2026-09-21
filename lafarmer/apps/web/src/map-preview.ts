import Phaser from 'phaser';
import { palette } from '@lafarmer/content-client';
import type { WorldOverviewRegion, WorldPresence } from './network';

const MAP_WIDTH = 1120;
const MAP_HEIGHT = 950;

type MapPreviewData = {
  regions: WorldOverviewRegion[];
  selectedId: string;
  interactive: boolean;
  onSelect: (regionId: string) => void;
  presence?: WorldPresence[];
};

type RegionView = {
  region: WorldOverviewRegion;
  polygon: Phaser.GameObjects.Polygon;
  label: Phaser.GameObjects.Text;
};

type MapPoint = { x: number; y: number };

const hex = (value: string): number => Number(`0x${value.slice(1)}`);

const regionFill = (region: WorldOverviewRegion): { fill: number; alpha: number; stroke: number; strokeAlpha: number } => {
  if (region.status === 'occupied') return { fill: hex('#4d8765'), alpha: .66, stroke: hex('#285d48'), strokeAlpha: .92 };
  if (region.status === 'frontier') return { fill: hex('#d4a95a'), alpha: .72, stroke: hex('#8b6436'), strokeAlpha: .92 };
  return { fill: hex('#8b9c94'), alpha: .3, stroke: hex('#6c8178'), strokeAlpha: .42 };
};

const regionCenter = (region: WorldOverviewRegion): MapPoint => {
  const totals = region.polygon.reduce((result, [x, y]) => ({ x: result.x + x, y: result.y + y }), { x: 0, y: 0 });
  return { x: totals.x / region.polygon.length, y: totals.y / region.polygon.length };
};

class MapPreviewScene extends Phaser.Scene {
  private mapData!: MapPreviewData;
  private readonly views = new Map<string, RegionView>();
  private readonly presenceMarkers = new Map<string, Phaser.GameObjects.Container>();

  constructor() { super('map-preview'); }

  create(data: MapPreviewData): void {
    this.mapData = data;
    this.drawOcean();
    this.drawLandmass();
    this.drawTerrainDetails();
    this.drawRoutes();
    this.drawRegions();
    this.drawCartography();
    this.drawPresence(this.mapData.presence ?? []);
  }

  private drawOcean(): void {
    const ocean = this.add.graphics().setDepth(0);
    ocean.fillStyle(hex('#9bc9c7'), 1).fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
    ocean.fillStyle(hex('#c9e3da'), .25);
    for (let row = 0; row < 16; row += 1) {
      for (let column = 0; column < 13; column += 1) {
        const x = 28 + column * 88 + (row % 2 ? 26 : 0);
        const y = 76 + row * 62;
        ocean.lineStyle(2, hex('#e8f1df'), .26).beginPath().moveTo(x, y).lineTo(x + 21, y - 4).lineTo(x + 40, y).strokePath();
      }
    }
  }

  private drawLandmass(): void {
    const land = this.add.graphics().setDepth(1);
    const shore = [
      [44, 154], [172, 46], [380, 60], [580, 25], [805, 56], [1034, 180],
      [1012, 344], [1070, 538], [1000, 758], [824, 886], [610, 864],
      [388, 926], [145, 844], [36, 648], [72, 436]
    ];
    const drawPolygon = (points: number[][]): void => {
      land.beginPath().moveTo(points[0][0], points[0][1]);
      points.slice(1).forEach(([x, y]) => land.lineTo(x, y));
      land.closePath();
    };
    drawPolygon(shore.map(([x, y]) => [x + 10, y + 14]));
    land.fillStyle(hex('#426f5b'), .22).fillPath();
    drawPolygon(shore);
    land.fillStyle(hex('#d5e1b9'), 1).fillPath().lineStyle(8, hex('#446c56'), .75).strokePath();
    land.lineStyle(2, hex('#eff2d8'), .6).strokePath();
  }

  private drawTerrainDetails(): void {
    const terrain = this.add.graphics().setDepth(2);
    const mountain = (x: number, y: number, scale: number): void => {
      terrain.fillStyle(hex('#829a8a'), .65).beginPath().moveTo(x - 34 * scale, y + 27 * scale).lineTo(x, y - 30 * scale).lineTo(x + 42 * scale, y + 27 * scale).closePath().fillPath();
      terrain.fillStyle(hex('#e8edda'), .76).beginPath().moveTo(x - 11 * scale, y - 10 * scale).lineTo(x, y - 30 * scale).lineTo(x + 14 * scale, y - 9 * scale).lineTo(x + 4 * scale, y - 3 * scale).closePath().fillPath();
    };
    const tree = (x: number, y: number, scale: number): void => {
      terrain.fillStyle(hex('#557d5c'), .7).fillEllipse(x, y, 34 * scale, 27 * scale).fillEllipse(x + 18 * scale, y + 8 * scale, 26 * scale, 25 * scale);
      terrain.fillStyle(hex('#765b42'), .65).fillRect(x - 3 * scale, y + 12 * scale, 6 * scale, 19 * scale);
    };
    mountain(236, 146, 1.1); mountain(292, 174, .72); mountain(836, 140, .9); mountain(890, 168, .62);
    tree(170, 620, 1); tree(208, 645, .7); tree(926, 594, .9); tree(962, 626, .65); tree(756, 782, .72);
    terrain.fillStyle(hex('#8e765b'), .22).fillEllipse(690, 490, 180, 70).fillEllipse(386, 714, 148, 54);
    this.drawRiver(terrain);
  }

  private drawRiver(graphics: Phaser.GameObjects.Graphics): void {
    const river = [[570, 8], [548, 105], [574, 196], [550, 284], [586, 366], [548, 458], [575, 548], [548, 648], [594, 742], [572, 850], [610, 942]];
    graphics.lineStyle(28, hex('#5ba7ad'), .62).beginPath().moveTo(river[0][0], river[0][1]);
    river.slice(1).forEach(([x, y]) => graphics.lineTo(x, y));
    graphics.strokePath();
    graphics.lineStyle(5, hex('#d5f0dc'), .62).beginPath().moveTo(river[0][0] - 4, river[0][1]);
    river.slice(1).forEach(([x, y]) => graphics.lineTo(x - 4, y));
    graphics.strokePath();
  }

  private drawRoutes(): void {
    const routes = this.add.graphics().setDepth(3);
    const routePairs: [string, string][] = [
      ['region-center', 'region-north'], ['region-center', 'region-south'], ['region-center', 'region-east'], ['region-center', 'region-west'],
      ['region-north', 'region-north-east'], ['region-north', 'region-north-west'], ['region-east', 'region-south-east'], ['region-west', 'region-south-west']
    ];
    const regions = new Map(this.mapData.regions.map((region) => [region.id, region]));
    routePairs.forEach(([fromId, toId]) => {
      const from = regions.get(fromId); const to = regions.get(toId); if (!from || !to) return;
      const start = regionCenter(from); const end = regionCenter(to); const distance = Phaser.Math.Distance.Between(start.x, start.y, end.x, end.y); const steps = Math.max(4, Math.floor(distance / 22));
      for (let index = 0; index < steps; index += 2) {
        const first = index / steps; const second = Math.min((index + 1) / steps, 1);
        routes.lineStyle(5, hex('#f2e3b6'), .9).lineBetween(Phaser.Math.Linear(start.x, end.x, first), Phaser.Math.Linear(start.y, end.y, first), Phaser.Math.Linear(start.x, end.x, second), Phaser.Math.Linear(start.y, end.y, second));
      }
    });
  }

  private drawRegions(): void {
    this.mapData.regions.forEach((region) => {
      const points = region.polygon.map(([x, y]) => ({ x, y }));
      const colors = regionFill(region);
      const polygon = this.add.polygon(0, 0, points, colors.fill, colors.alpha).setOrigin(0).setDepth(4);
      polygon.setStrokeStyle(4, colors.stroke, colors.strokeAlpha);
      const center = regionCenter(region);
      const label = this.add.text(center.x, center.y, region.name, {
        color: region.status === 'locked' ? '#49665c' : '#244f40',
        fontFamily: 'Trebuchet MS, Segoe UI, sans-serif',
        fontSize: region.status === 'locked' ? '14px' : '16px',
        fontStyle: 'bold',
        align: 'center',
        stroke: '#e8edda',
        strokeThickness: 4
      }).setOrigin(.5).setDepth(7).setAlpha(region.status === 'locked' ? .58 : .92);
      const view = { region, polygon, label };
      this.views.set(region.id, view);
      if (!this.mapData.interactive || region.status !== 'frontier') return;
      polygon.setInteractive(new Phaser.Geom.Polygon(points), Phaser.Geom.Polygon.Contains);
      polygon.on('pointerover', () => this.setHighlight(region.id, true));
      polygon.on('pointerout', () => this.setHighlight(region.id, false));
      polygon.on('pointerdown', () => this.mapData.onSelect(region.id));
    });
    if (this.mapData.selectedId) this.setHighlight(this.mapData.selectedId, true);
  }

  private setHighlight(regionId: string, highlighted: boolean): void {
    const view = this.views.get(regionId); if (!view || view.region.status !== 'frontier') return;
    const selected = this.mapData.selectedId === regionId;
    view.polygon.setFillStyle(hex(selected || highlighted ? '#f2b84b' : '#d4a95a'), selected || highlighted ? .94 : .72);
    view.polygon.setStrokeStyle(selected || highlighted ? 7 : 4, hex(selected || highlighted ? '#173f35' : '#8b6436'), .96);
    view.label.setScale(selected || highlighted ? 1.08 : 1);
  }

  private drawCartography(): void {
    const overlay = this.add.graphics().setDepth(10);
    overlay.lineStyle(3, hex('#f0e6bf'), .75).strokeCircle(82, 82, 30).lineBetween(82, 42, 82, 122).lineBetween(42, 82, 122, 82);
    this.add.text(82, 34, 'N', { color: '#244f40', fontFamily: 'Georgia, serif', fontSize: '18px', fontStyle: 'bold' }).setOrigin(.5).setDepth(11);
    this.add.text(MAP_WIDTH - 30, MAP_HEIGHT - 27, 'CARTA DO VALE  ·  fronteira 01', { color: '#315f4b', fontFamily: 'Trebuchet MS, Segoe UI, sans-serif', fontSize: '12px', fontStyle: 'bold' }).setOrigin(1, .5).setDepth(11).setAlpha(.8);
    this.add.text(34, MAP_HEIGHT - 28, 'um mundo contínuo', { color: '#315f4b', fontFamily: 'Georgia, serif', fontSize: '16px', fontStyle: 'italic' }).setDepth(11).setAlpha(.85);
  }

  public updatePresence(presence: WorldPresence[]): void {
    this.mapData.presence = presence;
    this.presenceMarkers.forEach((marker) => marker.destroy());
    this.presenceMarkers.clear();
    this.drawPresence(presence);
  }

  private drawPresence(presence: WorldPresence[]): void {
    const grouped = new Map<string, WorldPresence[]>();
    presence.forEach((person) => {
      const regionId = person.currentRegionId ?? person.homeRegionId;
      if (!regionId || !this.mapData.regions.some((region) => region.id === regionId)) return;
      const people = grouped.get(regionId) ?? [];
      people.push(person); grouped.set(regionId, people);
    });
    grouped.forEach((people, regionId) => {
      const region = this.mapData.regions.find((candidate) => candidate.id === regionId); if (!region) return;
      const center = regionCenter(region);
      people.forEach((person, index) => {
        const offset = (index - (people.length - 1) / 2) * 25;
        const marker = this.add.container(center.x + offset, center.y + 34).setDepth(14).setAlpha(person.online ? .98 : .45);
        const avatar = this.add.graphics();
        const clothing = person.appearance.clothing === 'coral' ? hex('#d86b5d') : person.appearance.clothing === 'river' ? hex('#4e8290') : hex('#315d4a');
        avatar.fillStyle(hex('#244f40'), .2).fillEllipse(0, 24, 28, 9).fillStyle(clothing, 1).fillRoundedRect(-11, -1, 22, 27, 7).fillStyle(hex('#a96e4f'), 1).fillCircle(0, -12, 13).fillStyle(hex('#5a382e'), 1).fillRoundedRect(-13, -23, 26, 10, 7);
        if (person.appearance.hair === 'long') avatar.fillRoundedRect(-14, -13, 5, 20, 3).fillRoundedRect(9, -13, 5, 20, 3);
        const label = this.add.text(0, 32, person.name, { color: '#244f40', fontFamily: 'Trebuchet MS, Segoe UI, sans-serif', fontSize: '11px', fontStyle: 'bold', stroke: '#e8edda', strokeThickness: 3 }).setOrigin(.5);
        marker.add([avatar, label]); this.presenceMarkers.set(person.id, marker);
      });
    });
  }
}

export function createMapPreview(container: HTMLElement, data: MapPreviewData): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: container,
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    backgroundColor: palette.riverLight,
    render: { antialias: true, pixelArt: false },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [MapPreviewScene],
    banner: false
  });
  game.scene.start('map-preview', data);
  return game;
}

export function updateMapPreviewPresence(game: Phaser.Game, presence: WorldPresence[]): void {
  const scene = game.scene.getScene('map-preview') as MapPreviewScene | undefined;
  scene?.updatePresence(presence);
}
