import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { emptyCaracolOutfit, type CaracolPlayerView, type CaracolStateView } from '../shared/caracol';
import { caracolArtViewBox } from '../src/caracolArt/model';
import { BrazilMap, CaracolMapLegend, type GeoFeatureCollection } from '../src/CaracolMap';

// O mapa vive fora de CaracolGame.tsx para os tokens e o Blooper serem testáveis em node.

const GEO: GeoFeatureCollection = {
  features: [
    { properties: { name: 'São Paulo', sigla: 'SP' }, geometry: { type: 'Polygon', coordinates: [[[-53, -25], [-44, -25], [-44, -20], [-53, -20], [-53, -25]]] } },
    { properties: { name: 'Pernambuco', sigla: 'PE' }, geometry: { type: 'MultiPolygon', coordinates: [[[[-41, -9], [-35, -9], [-35, -7], [-41, -7], [-41, -9]]]] } },
  ],
};

function player(nickname: string, lat: number, lon: number, overrides: Partial<CaracolPlayerView> = {}): CaracolPlayerView {
  return {
    accountId: `id-${nickname}`,
    nickname,
    alive: true,
    city: { id: nickname, name: nickname, uf: 'XX', lat, lon },
    online: true,
    isYou: false,
    outfit: emptyCaracolOutfit(),
    effectItemIds: [],
    ...overrides,
  };
}

function mapState({ snail = { lat: -15.78, lon: -47.93 }, players }: { snail?: { lat: number | null; lon: number | null }; players?: CaracolPlayerView[] } = {}): CaracolStateView {
  return {
    world: {
      snail: {
        lat: snail.lat,
        lon: snail.lon,
        hidden: snail.lat === null,
        speedKmh: 0.05,
        speedLevel: 0,
        speedCost: 10,
        targetAccountId: 'id-Bia',
        targetNickname: 'Bia',
        distanceKm: null,
        etaMs: null,
        redirectCost: 8,
        outfit: { ...emptyCaracolOutfit(), cap: 'cap-flat' },
      },
      effects: [],
      serverNow: 0,
    },
    players: players ?? [
      player('Ana', -23.55, -46.63, { isYou: true }),
      player('Bia', -22.9, -43.2),
      player('Caio', -8.05, -34.9, { alive: false }),
      player('Duda', -3.1, -60.0),
    ],
    you: {
      accountId: 'id-Ana',
      nickname: 'Ana',
      alive: true,
      coins: 0,
      city: null,
      speedDiscountLevel: 0,
      discountCost: 10,
      roulette: { availableAt: null, lastItemId: null },
      effects: [],
    },
    shop: { catalog: [], player: { ownedItemIds: [], outfit: emptyCaracolOutfit() }, snail: { ownedItemIds: [], outfit: emptyCaracolOutfit() } },
    needsCity: false,
    pushPublicKey: null,
  };
}

function map(state = mapState(), geoJson: GeoFeatureCollection | null = GEO): string {
  return renderToStaticMarkup(createElement(BrazilMap, { state, geoJson }));
}

describe('mapa do Brasil', () => {
  it('desenha um path por estado do GeoJSON', () => {
    expect(map().match(/<path d="M[^"]*" class="state-shape">/g)).toHaveLength(2);
  });

  it('desenha o caracol e a rota até o alvo quando a posição é conhecida', () => {
    const markup = map();
    expect(markup).toContain('class="snail-token"');
    expect(markup).toContain('class="snail-route"');
  });

  it('esconde o caracol e a rota com Blooper (MAPA-04)', () => {
    const markup = map(mapState({ snail: { lat: null, lon: null } }));
    expect(markup).not.toContain('snail-token');
    expect(markup).not.toContain('snail-route');
  });

  it('esconde o caracol e a rota quando falta só a latitude ou só a longitude (MAPA-04)', () => {
    for (const snail of [{ lat: null, lon: -47.93 }, { lat: -15.78, lon: null }]) {
      const markup = map(mapState({ snail }));
      expect(markup, JSON.stringify(snail)).not.toContain('snail-token');
      expect(markup, JSON.stringify(snail)).not.toContain('snail-route');
    }
  });

  it('escreve o nick só de você, do alvo e de quem morreu', () => {
    const labels = Array.from(map().matchAll(/<text[^>]*>([^<]+)<\/text>/g), (match) => match[1]);
    expect(labels.sort()).toEqual(['Ana', 'Bia', 'Caio']);
  });
});

describe('retratos no mapa', () => {
  function token(markup: string, nickname: string): string {
    const tokens = markup.split('<g class="map-player').slice(1);
    const found = tokens.find((html) => html.includes(`<title>${nickname} · `));
    if (!found) throw new Error(`token de ${nickname} não encontrado`);
    return found;
  }

  it('dá a cada jogador o raio e o anel do seu tom (MAPA-01, MAPA-03)', () => {
    const markup = map();
    expect(token(markup, 'Ana')).toMatch(/<circle r="9" class="map-medallion-ring tone-you"/);
    expect(token(markup, 'Bia')).toMatch(/<circle r="9" class="map-medallion-ring tone-target"/);
    expect(token(markup, 'Caio')).toMatch(/<circle r="7" class="map-medallion-ring tone-dead"[^>]* stroke-dasharray="2 2"/);
    expect(token(markup, 'Caio')).toContain('<feColorMatrix type="saturate" values="0">');
    expect(token(markup, 'Duda')).toMatch(/<circle r="7" class="map-medallion-ring tone-default"/);
    for (const nickname of ['Ana', 'Bia', 'Caio', 'Duda']) {
      expect(token(markup, nickname)).toContain(`viewBox="${caracolArtViewBox('player', 'portrait')}"`);
    }
  });

  it('desenha o caracol de corpo inteiro com o outfit global, e some com a rota no Blooper (MAPA-02, MAPA-04)', () => {
    const markup = map();
    const snail = markup.slice(markup.indexOf('<g class="snail-token">'));
    expect(snail).toContain(`viewBox="${caracolArtViewBox('snail', 'full')}"`);
    expect(snail).toContain('data-layer="cap-flat"');
    const hidden = map(mapState({ snail: { lat: null, lon: null } }));
    expect(hidden).not.toContain(`viewBox="${caracolArtViewBox('snail', 'full')}"`);
    expect(hidden).not.toContain('snail-route');
  });

  it('desenha os tokens na ordem mortos, demais, alvo, você (MAPA-06)', () => {
    const players = [
      player('Ana', -23.55, -46.63, { isYou: true }),
      player('Duda', -3.1, -60.0),
      player('Bia', -22.9, -43.2),
      player('Caio', -8.05, -34.9, { alive: false }),
      player('Eva', -12.97, -38.5),
    ];
    const order = Array.from(map(mapState({ players })).matchAll(/<g class="map-player[^"]*">.*?<title>(\w+) · /g), (match) => match[1]);
    expect(order).toEqual(['Caio', 'Duda', 'Eva', 'Bia', 'Ana']);
  });

  it('marca mortos na legenda com o mesmo anel tracejado cinza do token (MAPA-05)', () => {
    const legend = renderToStaticMarkup(createElement(CaracolMapLegend, { snailOutfit: emptyCaracolOutfit() }));
    expect(legend).not.toContain('☠');
    const dead = legend.slice(0, legend.indexOf(' mortos</span>'));
    expect(dead.slice(dead.lastIndexOf('<span>'))).toMatch(/<svg class="legend-ring"[^>]*aria-hidden="true"><circle[^>]* class="map-medallion-ring tone-dead"[^>]* stroke-dasharray="2 2"/);
  });

  it('mostra o caracol vestido na legenda num medalhão de 24 px (ARTE-14)', () => {
    const legend = renderToStaticMarkup(createElement(CaracolMapLegend, { snailOutfit: { ...emptyCaracolOutfit(), cap: 'cap-flat' } }));
    const snail = legend.slice(legend.indexOf('<span class="legend-snail">'));
    expect(snail).toMatch(/^<span class="legend-snail"><span class="caracol-avatar" role="img" aria-label="caracol vestido" style="--medallion-size:24px">/);
    expect(snail).toContain(`viewBox="${caracolArtViewBox('snail', 'portrait')}"`);
    expect(snail).toContain('data-layer="cap-flat"');
  });
});
