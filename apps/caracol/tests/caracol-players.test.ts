import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { emptyCaracolOutfit, type CaracolPlayerView } from '../shared/caracol';
import { CaracolPlayersCard } from '../src/CaracolPlayers';

// O cartão "No mapa" vive fora de CaracolGame.tsx para ser renderizado em node.

function player(nickname: string, overrides: Partial<CaracolPlayerView> = {}): CaracolPlayerView {
  return {
    accountId: `id-${nickname}`,
    nickname,
    alive: true,
    city: { id: '3550308', name: 'São Paulo', uf: 'SP', lat: -23.55, lon: -46.63 },
    online: true,
    isYou: false,
    outfit: emptyCaracolOutfit(),
    effectItemIds: [],
    ...overrides,
  };
}

function card(players: CaracolPlayerView[], targetAccountId: string | null = null): string {
  return renderToStaticMarkup(createElement(CaracolPlayersCard, { players, targetAccountId }));
}

function row(markup: string, nickname: string): string {
  const rows = markup.split('<div class="caracol-player-row').slice(1);
  const found = rows.find((html) => html.includes(`<strong>${nickname}`));
  if (!found) throw new Error(`linha de ${nickname} não encontrada`);
  return found;
}

function rowClasses(markup: string, nickname: string): string[] {
  return row(markup, nickname).slice(0, row(markup, nickname).indexOf('"')).split(/\s+/).filter(Boolean);
}

const players = [
  player('Ana', { isYou: true }),
  player('Bia'),
  player('Caio', { alive: false }),
  player('Duda'),
];

describe('cartão de jogadores', () => {
  it('conta as pessoas no título, no singular e no plural', () => {
    expect(card([player('Ana', { isYou: true })])).toContain('<h2>1 pessoa</h2>');
    expect(card([player('Ana', { isYou: true })]).match(/class="caracol-avatar"/g)).toHaveLength(1);
    expect(card(players)).toContain('<h2>4 pessoas</h2>');
  });

  it('marca a sua linha, a do alvo e a de quem morreu', () => {
    const markup = card(players, 'id-Bia');
    expect(rowClasses(markup, 'Ana')).toEqual(['is-you']);
    expect(rowClasses(markup, 'Bia')).toEqual(['is-target']);
    expect(rowClasses(markup, 'Caio')).toEqual(['is-dead']);
    expect(rowClasses(markup, 'Duda')).toEqual([]);
  });

  it('mostra o selo alvo só na linha do alvo e o selo morta só na de quem morreu', () => {
    const markup = card(players, 'id-Bia');
    expect(row(markup, 'Bia')).toContain('<b class="target-badge">alvo</b>');
    expect(row(markup, 'Caio')).toContain('<b class="dead-badge">morta</b>');
    for (const nickname of ['Ana', 'Caio', 'Duda']) expect(row(markup, nickname)).not.toContain('target-badge');
    for (const nickname of ['Ana', 'Bia', 'Duda']) expect(row(markup, nickname)).not.toContain('dead-badge');
  });
});

describe('tons na lista', () => {
  function tone(markup: string, nickname: string): string | undefined {
    return /class="caracol-medallion tone-([\w-]+)"/.exec(row(markup, nickname))?.[1];
  }

  it('dá o tom you à sua linha e target à do alvo (LISTA-01, LISTA-02)', () => {
    const markup = card(players, 'id-Bia');
    expect(tone(markup, 'Ana')).toBe('you');
    expect(tone(markup, 'Bia')).toBe('target');
    expect(tone(markup, 'Duda')).toBe('default');
  });

  it('mostra quem morreu pelo retrato em cinza, sem o glifo de caveira (LISTA-03)', () => {
    const markup = card(players, 'id-Bia');
    expect(tone(markup, 'Caio')).toBe('dead');
    expect(row(markup, 'Caio')).toContain('role="img" aria-label="Caio morta"');
    expect(markup).not.toContain('☠');
  });

  it('segue morta > alvo > você quando a linha acumula estados (LISTA-04)', () => {
    expect(tone(card(players, 'id-Ana'), 'Ana')).toBe('target');
    expect(tone(card(players, 'id-Caio'), 'Caio')).toBe('dead');
  });

  it('põe o medalhão como filho direto da linha, fora do div de texto', () => {
    const markup = card(players, 'id-Bia');
    for (const nickname of ['Ana', 'Bia', 'Caio', 'Duda']) {
      expect(row(markup, nickname), nickname).toMatch(/^[^>]*><span class="caracol-avatar"/);
    }
  });
});
