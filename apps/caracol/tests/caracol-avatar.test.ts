import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CARACOL_COSMETIC_CATALOG, emptyCaracolOutfit, type CaracolOutfit } from '../shared/caracol';
import { CaracolFigure, CaracolMapPlayer, CaracolMapSnail, CaracolMedallion, sameFigureProps } from '../src/CaracolAvatar';
import { CARACOL_ART_ITEM_IDS, caracolArtViewBox, type CaracolArtCrop, type CaracolMedallionTone } from '../src/caracolArt/model';
import { PLAYER_ART, type CaracolArtIds } from '../src/caracolArt/PlayerArt';
import { SNAIL_ART } from '../src/caracolArt/SnailArt';

// Os componentes de arte rodam em node com renderToStaticMarkup: sem jsdom e sem
// socket. As asserções olham camadas (`data-layer`), viewBox e ids, não a geometria.

const clipIds: string[] = [];
const ids: CaracolArtIds = {
  clip: (part) => {
    const id = `t-clip-${part}`;
    clipIds.push(id);
    return id;
  },
  ink: 't-ink',
};

function inSvg(node: ReactNode): string {
  return renderToStaticMarkup(createElement('svg', null, node));
}

function layersOf(markup: string): string[] {
  return Array.from(markup.matchAll(/data-layer="([^"]+)"/g), (match) => match[1]!);
}

describe('arte do jogador', () => {
  it('tem uma camada para cada parte do corpo e para cada peça do catálogo', () => {
    const body = ['legs', 'pants-default', 'arms', 'shirt-default', 'head', 'fringe', 'eyes', 'mouth'];
    expect(Object.keys(PLAYER_ART).sort()).toEqual([...body, ...CARACOL_ART_ITEM_IDS].sort());
  });

  for (const [key, draw] of Object.entries(PLAYER_ART)) {
    it(`desenha ${key} numa camada própria`, () => {
      expect(layersOf(inSvg(draw(ids)))).toEqual([key]);
    });
  }

  it('recorta as listras por manga e tronco com clipPath montados pelos ids da instância', () => {
    clipIds.length = 0;
    const markup = inSvg(PLAYER_ART['shirt-striped'](ids));
    const refs = new Set(Array.from(markup.matchAll(/clip-path="url\(#([^)]+)\)"/g), (match) => match[1]!));
    expect(refs.size).toBe(3);
    for (const ref of refs) {
      expect(clipIds).toContain(ref);
      expect(markup).toContain(`<clipPath id="${ref}">`);
    }
  });

  it('pinta a pele do jogador com #c78261 (ARTE-15)', () => {
    expect(inSvg(PLAYER_ART.head(ids))).toContain('fill="#c78261"');
  });
});

describe('arte do caracol', () => {
  it('tem uma camada para cada parte do corpo e para cada peça do catálogo', () => {
    expect(Object.keys(SNAIL_ART).sort()).toEqual(['body', 'stalks', 'head', ...CARACOL_ART_ITEM_IDS].sort());
  });

  for (const [key, draw] of Object.entries(SNAIL_ART)) {
    it(`desenha ${key} numa camada própria`, () => {
      expect(layersOf(inSvg(draw(ids)))).toEqual([key]);
    });
  }

  it('pinta a concha com #d86b51 e o corpo com #efb37d (ARTE-15)', () => {
    const body = inSvg(SNAIL_ART.body(ids));
    expect(body).toMatch(/<circle[^>]*fill="#d86b51"/);
    expect(body).toMatch(/<path[^>]*fill="#efb37d"/);
  });
});

describe('CaracolFigure', () => {
  const crops: CaracolArtCrop[] = ['full', 'portrait', 'pants', 'shirt', 'watch', 'glasses', 'cap'];

  function figure(props: Partial<Parameters<typeof CaracolFigure>[0]> = {}): string {
    return renderToStaticMarkup(createElement(CaracolFigure, { wearer: 'player', outfit: emptyCaracolOutfit(), crop: 'portrait', sizePx: 40, ...props }));
  }

  for (const wearer of ['player', 'snail'] as const) {
    for (const item of CARACOL_COSMETIC_CATALOG) {
      it(`${wearer} veste ${item.id} numa única camada do slot ${item.slot} (ARTE-01)`, () => {
        const layers = layersOf(figure({ wearer, outfit: { ...emptyCaracolOutfit(), [item.slot]: item.id } }));
        const sameSlot = CARACOL_COSMETIC_CATALOG.filter((other) => other.slot === item.slot).map((other) => other.id);
        expect(layers.filter((layer) => layer === item.id)).toHaveLength(1);
        expect(layers.filter((layer) => sameSlot.includes(layer))).toEqual([item.id]);
      });
    }

    for (const crop of crops) {
      it(`${wearer} · ${crop} renderiza o viewBox do recorte (ARTE-07)`, () => {
        expect(figure({ wearer, crop })).toContain(`viewBox="${caracolArtViewBox(wearer, crop)}"`);
      });
    }
  }

  it('só aplica a tinta a partir de 56 px (ARTE-09)', () => {
    expect(figure({ sizePx: 55 })).not.toContain('filter=');
    const inked = figure({ sizePx: 56 });
    const ref = /filter="url\(#([^)]+)\)"/.exec(inked)?.[1];
    expect(ref).toBeDefined();
    expect(inked).toContain(`<filter id="${ref}"`);
  });

  it('não repete id de clipPath nem de filtro entre duas figuras da mesma página (ARTE-10)', () => {
    const striped: CaracolOutfit = { ...emptyCaracolOutfit(), shirt: 'shirt-striped' };
    const one = createElement(CaracolFigure, { wearer: 'player', outfit: striped, crop: 'portrait', sizePx: 64 });
    const two = createElement(CaracolFigure, { wearer: 'player', outfit: striped, crop: 'portrait', sizePx: 64 });
    const markup = renderToStaticMarkup(createElement('div', null, one, two));
    const idList = Array.from(markup.matchAll(/ id="([^"]+)"/g), (match) => match[1]!);
    expect(idList).toHaveLength(8);
    expect(new Set(idList).size).toBe(idList.length);
  });

  it('veste o jogador sem peças com camisa céu e calça jeans', () => {
    const markup = figure({ outfit: emptyCaracolOutfit(), crop: 'full' });
    const layer = (key: string): string => markup.slice(markup.indexOf(`data-layer="${key}"`)).split('data-layer=')[1]!;
    expect(layer('shirt-default')).toContain('fill="#75d9e9"');
    expect(layer('pants-default')).toContain('fill="#4d628f"');
  });

  it('esconde o desenho dos leitores de tela', () => {
    expect(figure()).toMatch(/^<svg[^>]* aria-hidden="true"/);
  });

  it('não redesenha quando o outfit chega em objeto novo com os mesmos valores (ARTE-13)', () => {
    const outfit: CaracolOutfit = { ...emptyCaracolOutfit(), cap: 'cap-flat' };
    const props = { wearer: 'player' as const, outfit, crop: 'portrait' as const, sizePx: 40 };
    expect(sameFigureProps(props, { ...props, outfit: { ...outfit } })).toBe(true);
    expect(sameFigureProps(props, { ...props, crop: 'cap' })).toBe(false);
    expect((CaracolFigure as unknown as { compare: unknown }).compare).toBe(sameFigureProps);
  });
});

describe('CaracolMedallion', () => {
  function medallion(props: Partial<Parameters<typeof CaracolMedallion>[0]> = {}): string {
    return renderToStaticMarkup(createElement(CaracolMedallion, { wearer: 'player', outfit: emptyCaracolOutfit(), size: 40, label: 'Ana vestida', ...props }));
  }

  it('é uma imagem com o rótulo recebido, e o SVG interno fica escondido (ARTE-11)', () => {
    const markup = medallion({ label: 'Ana vestida' });
    expect(markup).toMatch(/^<span class="caracol-avatar" role="img" aria-label="Ana vestida"/);
    expect(markup).toMatch(/<svg[^>]* aria-hidden="true"/);
  });

  it('desenha dentro de .caracol-medallion com a classe do tom (ARTE-08)', () => {
    expect(medallion({ tone: 'you' })).toMatch(/<span class="caracol-medallion tone-you"><svg[^>]*class="caracol-figure"/);
    expect(medallion()).toContain('class="caracol-medallion tone-default"');
  });

  it('passa o tamanho pela variável --medallion-size, nunca por width inline', () => {
    const markup = medallion({ size: 40 });
    const style = /^<span[^>]* style="([^"]*)"/.exec(markup)?.[1];
    expect(style).toBe('--medallion-size:40px');
  });

  it('põe selo de check só no equipado e de caveira só no morto', () => {
    const tones: CaracolMedallionTone[] = ['default', 'you', 'target', 'dead', 'equipped', 'unaffordable'];
    for (const tone of tones) {
      const markup = medallion({ tone });
      expect(markup.includes('badge-check'), tone).toBe(tone === 'equipped');
      expect(markup.includes('badge-skull'), tone).toBe(tone === 'dead');
    }
  });

  it('usa o recorte de retrato quando não recebe recorte', () => {
    expect(medallion({ wearer: 'snail' })).toContain(`viewBox="${caracolArtViewBox('snail', 'portrait')}"`);
  });
});

describe('tokens do mapa', () => {
  const outfit: CaracolOutfit = { ...emptyCaracolOutfit(), cap: 'cap-bucket' };

  function token(radius: number, tone: 'default' | 'you' | 'target' | 'dead'): string {
    return inSvg(createElement(CaracolMapPlayer, { outfit, x: 120, y: 80, radius, tone }));
  }

  for (const [radius, tone] of [[9, 'you'], [9, 'target'], [7, 'default']] as const) {
    it(`recorta o retrato em círculo de raio ${radius} com o anel ${tone} (MAPA-01)`, () => {
      const markup = token(radius, tone);
      expect(markup).toContain('transform="translate(120 80)"');
      expect(markup).toMatch(new RegExp(`<clipPath id="[^"]+"><circle r="${radius}"></circle></clipPath>`));
      expect(markup).toContain(`<circle r="${radius}" class="map-medallion-ring tone-${tone}" fill="none" stroke-width="2.5"></circle>`);
      expect(markup).not.toContain('feColorMatrix');
      expect(markup).not.toContain('stroke-dasharray');
    });
  }

  it('usa o recorte de retrato, do tamanho do círculo e sem tinta', () => {
    const markup = token(9, 'default');
    expect(markup).toMatch(new RegExp(`<svg class="caracol-figure" viewBox="${caracolArtViewBox('player', 'portrait')}" x="-9" y="-9" width="18" height="18"`));
    expect(markup).not.toMatch(/filter="url\(#[^)]*ink/);
    expect(markup).not.toContain('feTurbulence');
    expect(layersOf(markup)).toContain('cap-bucket');
  });

  it('põe o retrato de quem morreu em cinza, dentro de um anel tracejado (MAPA-03)', () => {
    const markup = token(7, 'dead');
    const filterId = /<filter id="([^"]+)"><feColorMatrix type="saturate" values="0"><\/feColorMatrix><\/filter>/.exec(markup)?.[1];
    expect(filterId).toBeDefined();
    expect(markup).toContain(`<g filter="url(#${filterId})">`);
    expect(markup).toContain('<circle r="7" class="map-medallion-ring tone-dead" fill="none" stroke-width="2.5" stroke-dasharray="2 2"></circle>');
  });

  it('desenha o caracol de corpo inteiro, 40 × 40, com o pé sobre o ponto (MAPA-02)', () => {
    const markup = inSvg(createElement(CaracolMapSnail, { outfit, x: 300, y: 200 }));
    expect(markup).toContain(`<svg class="caracol-figure" viewBox="${caracolArtViewBox('snail', 'full')}" x="280" y="162" width="40" height="40"`);
    expect(layersOf(markup)).toContain('cap-bucket');
  });
});
