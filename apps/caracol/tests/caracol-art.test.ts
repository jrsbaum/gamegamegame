import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CARACOL_COSMETIC_CATALOG, CARACOL_COSMETIC_SLOTS, emptyCaracolOutfit, type CaracolOutfit } from '../shared/caracol';
import {
  CARACOL_ART_ITEM_IDS,
  CARACOL_ART_PALETTE,
  CARACOL_INK_MIN_PX,
  caracolArtLayers,
  caracolArtViewBox,
  caracolPlayerTone,
  caracolShopItemTone,
  sameCaracolOutfit,
  type CaracolArtCrop,
} from '../src/caracolArt/model';

// O modelo da arte é dado puro: paleta, peças com desenho e recortes. Os valores
// esperados aqui são os das tabelas de plano/new-design/design.md, não os do código.

describe('paridade com o catálogo', () => {
  it('tem arte para exatamente as peças do catálogo (ARTE-05)', () => {
    const catalogIds = CARACOL_COSMETIC_CATALOG.map((item) => item.id).sort();
    expect([...CARACOL_ART_ITEM_IDS].sort()).toEqual(catalogIds);
  });
});

describe('recortes', () => {
  const table: Record<'player' | 'snail', Record<CaracolArtCrop, string>> = {
    player: {
      full: '18 14 172 372',
      portrait: '30 24 140 140',
      cap: '48 14 104 104',
      glasses: '56 42 88 88',
      shirt: '30 110 140 140',
      watch: '127 74 60 60',
      pants: '20 222 160 160',
    },
    snail: {
      full: '6 -6 236 236',
      portrait: '22 -6 150 150',
      cap: '48 36 94 94',
      glasses: '42 -26 106 106',
      shirt: '34 104 122 122',
      watch: '48 26 58 58',
      pants: '38 140 114 114',
    },
  };

  for (const wearer of ['player', 'snail'] as const) {
    for (const [crop, viewBox] of Object.entries(table[wearer]) as [CaracolArtCrop, string][]) {
      it(`${wearer} · ${crop} usa o retângulo da tabela do design (ARTE-07)`, () => {
        expect(caracolArtViewBox(wearer, crop)).toBe(viewBox);
      });
    }
  }
});

describe('paleta', () => {
  function rootTokens(): Record<string, string> {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    const root = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    return Object.fromEntries(Array.from(root.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g), (match) => [match[1], match[2]!.toLowerCase()]));
  }

  it('copia os hex dos tokens de :root (ARTE-12)', () => {
    const tokens = rootTokens();
    const pairs = [
      ['ink', 'night'],
      ['paper', 'paper'],
      ['acid', 'acid'],
      ['acidDark', 'acid-dark'],
      ['coral', 'coral'],
      ['sky', 'sky'],
      ['lavender', 'lavender'],
    ] as const;
    for (const [art, token] of pairs) {
      expect(tokens[token], `--${token}`).toMatch(/^#[0-9a-f]+$/);
      expect(CARACOL_ART_PALETTE[art].toLowerCase(), `${art} = --${token}`).toBe(tokens[token]);
    }
  });

  it('mantém a pele do jogador e as cores do caracol do avatar atual (ARTE-15)', () => {
    expect(CARACOL_ART_PALETTE.skin).toBe('#c78261');
    expect(CARACOL_ART_PALETTE.shell).toBe('#d86b51');
    expect(CARACOL_ART_PALETTE.snailBody).toBe('#efb37d');
  });
});

describe('camadas visíveis', () => {
  const fullOutfit: CaracolOutfit = {
    pants: 'pants-cargo',
    shirt: 'shirt-striped',
    watch: 'watch-gold',
    glasses: 'glasses-dark',
    cap: 'cap-bucket',
  };

  it('veste o jogador sem peças com camisa e calça padrão (ARTE-02)', () => {
    expect(caracolArtLayers('player', emptyCaracolOutfit())).toEqual(['legs', 'pants-default', 'arms', 'shirt-default', 'head', 'fringe', 'eyes', 'mouth']);
  });

  it('não desenha peça nenhuma no caracol sem peças (ARTE-02)', () => {
    expect(caracolArtLayers('snail', emptyCaracolOutfit())).toEqual(['body', 'stalks', 'head']);
  });

  it('empilha o jogador vestido na ordem do design, uma camada por slot', () => {
    expect(caracolArtLayers('player', fullOutfit)).toEqual(['legs', 'pants-cargo', 'arms', 'shirt-striped', 'watch-gold', 'head', 'mouth', 'glasses-dark', 'cap-bucket']);
  });

  it('empilha o caracol vestido na ordem do design, uma camada por slot', () => {
    expect(caracolArtLayers('snail', fullOutfit)).toEqual(['body', 'pants-cargo', 'shirt-striped', 'stalks', 'watch-gold', 'head', 'cap-bucket', 'glasses-dark']);
  });

  it('esconde a franja só quando há boné (ARTE-03)', () => {
    expect(caracolArtLayers('player', { ...emptyCaracolOutfit(), cap: 'cap-flat' })).not.toContain('fringe');
    expect(caracolArtLayers('player', { ...emptyCaracolOutfit(), cap: 'cap-flat' })).toContain('cap-flat');
    expect(caracolArtLayers('player', emptyCaracolOutfit())).toContain('fringe');
  });

  it('esconde os olhos só quando há óculos, que desenham os próprios (ARTE-04)', () => {
    expect(caracolArtLayers('player', { ...emptyCaracolOutfit(), glasses: 'glasses-round' })).not.toContain('eyes');
    expect(caracolArtLayers('player', { ...emptyCaracolOutfit(), glasses: 'glasses-round' })).toContain('glasses-round');
    expect(caracolArtLayers('player', emptyCaracolOutfit())).toContain('eyes');
  });

  it('trata id sem arte como slot vazio, sem lançar erro (ARTE-06)', () => {
    const unknown: CaracolOutfit = { pants: 'pants-skirt', shirt: 'shirt-hawaii', watch: 'watch-smart', glasses: 'glasses-3d', cap: 'cap-beanie' };
    expect(caracolArtLayers('player', unknown)).toEqual(['legs', 'pants-default', 'arms', 'shirt-default', 'head', 'fringe', 'eyes', 'mouth']);
    expect(caracolArtLayers('snail', unknown)).toEqual(['body', 'stalks', 'head']);
  });
});

describe('tons do medalhão', () => {
  it('segue a prioridade morta > alvo > você > padrão nas 8 combinações (LISTA-01, LISTA-02, LISTA-04)', () => {
    const cases = [
      [{ isYou: false, isTarget: false, alive: true }, 'default'],
      [{ isYou: true, isTarget: false, alive: true }, 'you'],
      [{ isYou: false, isTarget: true, alive: true }, 'target'],
      [{ isYou: true, isTarget: true, alive: true }, 'target'],
      [{ isYou: false, isTarget: false, alive: false }, 'dead'],
      [{ isYou: true, isTarget: false, alive: false }, 'dead'],
      [{ isYou: false, isTarget: true, alive: false }, 'dead'],
      [{ isYou: true, isTarget: true, alive: false }, 'dead'],
    ] as const;
    for (const [input, tone] of cases) {
      expect(caracolPlayerTone(input), JSON.stringify(input)).toBe(tone);
    }
  });

  it('marca a peça equipada como equipped, mesmo sem saldo (LOJA-02)', () => {
    expect(caracolShopItemTone({ owned: true, equipped: true, coins: 0, price: 100 })).toBe('equipped');
  });

  it('marca a peça não comprada acima do saldo como unaffordable (LOJA-03)', () => {
    expect(caracolShopItemTone({ owned: false, equipped: false, coins: 49, price: 50 })).toBe('unaffordable');
  });

  it('usa o tom padrão com saldo exato e para peça comprada fora de uso (LOJA-04)', () => {
    expect(caracolShopItemTone({ owned: false, equipped: false, coins: 50, price: 50 })).toBe('default');
    expect(caracolShopItemTone({ owned: true, equipped: false, coins: 0, price: 50 })).toBe('default');
  });
});

describe('comparação de outfit', () => {
  const outfit: CaracolOutfit = { pants: 'pants-jeans', shirt: null, watch: 'watch-gold', glasses: null, cap: 'cap-flat' };

  it('considera iguais dois objetos novos com os mesmos valores (ARTE-13)', () => {
    expect(sameCaracolOutfit(outfit, { ...outfit })).toBe(true);
  });

  it('considera diferentes quando qualquer um dos slots muda (ARTE-13)', () => {
    for (const slot of CARACOL_COSMETIC_SLOTS) {
      const other = { ...outfit, [slot]: outfit[slot] === null ? 'x' : null };
      expect(sameCaracolOutfit(outfit, other), slot).toBe(false);
    }
  });

  it('liga a tinta a partir de 56 px', () => {
    expect(CARACOL_INK_MIN_PX).toBe(56);
  });
});
