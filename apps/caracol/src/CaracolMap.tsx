import type { JSX } from 'react';
import type { CaracolOutfit, CaracolPlayerView, CaracolStateView } from '../shared/caracol';
import { CaracolMapPlayer, CaracolMapSnail, CaracolMedallion } from './CaracolAvatar';
import { caracolPlayerTone, type CaracolPlayerTone } from './caracolArt/model';

// O mapa do Brasil e a legenda ficam fora de CaracolGame.tsx, que abre o socket
// no import, para os tokens e o Blooper poderem ser testados em node.

export interface GeoFeature {
  properties?: { name?: string; sigla?: string };
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
}

export interface GeoFeatureCollection {
  features: GeoFeature[];
}

const MAP_BOUNDS = { minLon: -74, maxLon: -34, minLat: -34, maxLat: 6 };

export function BrazilMap({ state, geoJson }: { state: CaracolStateView; geoJson: GeoFeatureCollection | null }): JSX.Element {
  const width = 760;
  const height = 570;
  const target = state.world.snail.targetAccountId ? state.players.find((player) => player.accountId === state.world.snail.targetAccountId) : null;
  // Com Blooper o servidor nem manda a posição: sem token e sem rota.
  const { lat: snailLat, lon: snailLon } = state.world.snail;
  const snailPoint = snailLat === null || snailLon === null ? null : project(snailLat, snailLon, width, height);
  const targetPoint = target && snailPoint ? project(target.city.lat, target.city.lon, width, height) : null;
  return <div className="caracol-map-frame" role="img" aria-label="Mapa do Brasil com o caracol, jogadores online, jogadores offline e mortos"><svg className="caracol-map" viewBox={`0 0 ${width} ${height}`} aria-hidden="true"><rect width={width} height={height} className="map-paper" />{geoJson?.features.map((feature) => <path key={feature.properties?.sigla ?? feature.properties?.name} d={featurePath(feature, width, height)} className="state-shape"><title>{feature.properties?.name ?? feature.properties?.sigla}</title></path>)}{snailPoint && targetPoint && <line x1={snailPoint.x} y1={snailPoint.y} x2={targetPoint.x} y2={targetPoint.y} className="snail-route" />}{mapTokens(state).map(({ player, isTarget, tone }) => { const point = project(player.city.lat, player.city.lon, width, height); return <g key={player.accountId} className={`map-player ${player.isYou ? 'map-player-you' : ''} ${isTarget ? 'map-player-target' : ''} ${player.alive ? '' : 'map-player-dead'}`}><CaracolMapPlayer outfit={player.outfit} x={point.x} y={point.y} radius={player.isYou || isTarget ? 9 : 7} tone={tone} /><title>{player.alive ? `${player.nickname} · ${player.city.name} · ${player.city.uf}` : `${player.nickname} · morta em ${player.city.name} · ${player.city.uf}`}</title>{(player.isYou || isTarget || !player.alive) && <text x={point.x + 11} y={point.y - 11}>{player.nickname}</text>}</g>; })}{snailPoint && <g className="snail-token"><CaracolMapSnail outfit={state.world.snail.outfit} x={snailPoint.x} y={snailPoint.y} /><title>Caracol vestido</title></g>}</svg>{state.world.snail.hidden && <div className="map-ink" aria-hidden="true">tinta do Blooper · caracol escondido</div>}{!geoJson && <div className="map-loading">Desenhando o Brasil…</div>}</div>;
}

export function CaracolMapLegend({ snailOutfit }: { snailOutfit: CaracolOutfit }): JSX.Element {
  return <div className="caracol-map-legend"><span><i className="legend-dot legend-you" /> você</span><span><i className="legend-dot legend-target" /> alvo atual</span><span><i className="legend-dot legend-other" /> jogadores</span><span><svg className="legend-ring" viewBox="-6 -6 12 12" aria-hidden="true"><circle r={4.5} className="map-medallion-ring tone-dead" fill="none" strokeWidth={2} strokeDasharray="2 2" /></svg> mortos</span><span className="legend-snail"><CaracolMedallion wearer="snail" outfit={snailOutfit} size={24} label="caracol vestido" /> caracol</span></div>;
}

// Mortos embaixo, depois os demais, o alvo, e você por cima: no Sudeste os tokens
// se encostam, e você e o alvo nunca podem ficar cobertos.
const TOKEN_LAYER: Record<CaracolPlayerTone, number> = { dead: 0, default: 1, target: 2, you: 3 };

function mapTokens(state: CaracolStateView): { player: CaracolPlayerView; isTarget: boolean; tone: CaracolPlayerTone }[] {
  return state.players
    .map((player) => {
      const isTarget = player.accountId === state.world.snail.targetAccountId;
      return { player, isTarget, tone: caracolPlayerTone({ isYou: player.isYou, isTarget, alive: player.alive }) };
    })
    .sort((a, b) => TOKEN_LAYER[a.tone] - TOKEN_LAYER[b.tone]);
}

function project(lat: number, lon: number, width: number, height: number): { x: number; y: number } {
  return { x: ((lon - MAP_BOUNDS.minLon) / (MAP_BOUNDS.maxLon - MAP_BOUNDS.minLon)) * width, y: ((MAP_BOUNDS.maxLat - lat) / (MAP_BOUNDS.maxLat - MAP_BOUNDS.minLat)) * height };
}

function featurePath(feature: GeoFeature, width: number, height: number): string {
  const polygons = feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates as number[][][][] : [feature.geometry.coordinates as number[][][]];
  return polygons.map((polygon) => polygon.map((ring) => ring.map((coordinate, index) => { const lon = coordinate[0] ?? 0; const lat = coordinate[1] ?? 0; const point = project(lat, lon, width, height); return `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`; }).join(' ') + ' Z').join(' ')).join(' ');
}
