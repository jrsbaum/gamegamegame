import { createElement, isValidElement, useState, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  CARACOL_COSMETIC_CATALOG,
  emptyCaracolOutfit,
  type CaracolCosmeticWearer,
  type CaracolStateView,
} from '../shared/caracol';
import { caracolArtViewBox } from '../src/caracolArt/model';
import {
  CaracolShopDrawer,
  shopCardHandlers,
  shopPreview,
  shopPreviewReducer,
  type ShopPreviewAction,
  type ShopPreviewState,
} from '../src/CaracolShop';

// A loja vive fora de CaracolGame.tsx, que abre o socket no import. Os testes
// renderizam a gaveta em node com um estado de exemplo.

function sampleState(overrides: { coins?: number } = {}): CaracolStateView {
  return {
    world: {
      snail: {
        lat: -15.7795,
        lon: -47.9297,
        hidden: false,
        speedKmh: 0.05,
        speedLevel: 0,
        speedCost: 10,
        targetAccountId: null,
        targetNickname: null,
        distanceKm: null,
        etaMs: null,
        redirectCost: 8,
        outfit: { ...emptyCaracolOutfit(), cap: 'cap-trucker' },
      },
      effects: [],
      serverNow: 1_000_000,
    },
    players: [],
    you: {
      accountId: 'a1',
      nickname: 'Ana',
      alive: true,
      coins: overrides.coins ?? 40,
      city: null,
      speedDiscountLevel: 0,
      discountCost: 10,
      roulette: { availableAt: null, lastItemId: null },
      effects: [],
    },
    shop: {
      catalog: [...CARACOL_COSMETIC_CATALOG],
      player: { ownedItemIds: ['pants-jeans', 'pants-cargo', 'glasses-dark'], outfit: { ...emptyCaracolOutfit(), pants: 'pants-jeans', glasses: 'glasses-dark' } },
      snail: { ownedItemIds: ['cap-trucker'], outfit: { ...emptyCaracolOutfit(), cap: 'cap-trucker' } },
    },
    needsCity: false,
    pushPublicKey: null,
  };
}

function drawer(tab: CaracolCosmeticWearer, state = sampleState()): string {
  const noop = (): void => undefined;
  return renderToStaticMarkup(createElement(CaracolShopDrawer, { state, open: true, tab, onTabChange: noop, onClose: noop, onPurchase: noop, onEquip: noop }));
}

type ElementProps = { children?: ReactNode; className?: string; role?: string } & Record<string, unknown>;
type Handler = () => void;

/** Os elementos de HTML que a própria gaveta monta, sem entrar nos componentes filhos. */
function hostElements(node: ReactNode, found: ReactElement<ElementProps>[] = []): ReactElement<ElementProps>[] {
  if (Array.isArray(node)) {
    for (const child of node) hostElements(child as ReactNode, found);
  } else if (isValidElement<ElementProps>(node) && typeof node.type === 'string') {
    found.push(node);
    hostElements(node.props.children, found);
  }
  return found;
}

function hasText(element: ReactElement<ElementProps>, tag: string, text: string): boolean {
  return hostElements(element.props.children).some((child) => child.type === tag && child.props.children === text);
}

interface ShopUi {
  card: (name: string) => Record<'onMouseEnter' | 'onMouseLeave' | 'onFocus' | 'onBlur', Handler>;
  tryButton: (name: string) => { onClick: Handler };
  tab: (label: 'Você' | 'Caracol') => { onClick: Handler };
}

function shopUi(tree: ReactElement<ElementProps>): ShopUi {
  const all = hostElements(tree);
  const article = (name: string): ReactElement<ElementProps> => {
    const found = all.find((element) => element.type === 'article' && hasText(element, 'strong', name));
    if (!found) throw new Error(`card ${name} não encontrado`);
    return found;
  };
  return {
    card: (name) => article(name).props as never,
    tryButton: (name) => hostElements(article(name).props.children).find((element) => element.props.className === 'caracol-shop-try')!.props as never,
    tab: (label) => all.find((element) => element.props.role === 'tab' && hasText(element, 'span', label))!.props as never,
  };
}

/**
 * Renderiza a gaveta e aciona os handlers que ela mesma monta. A gaveta roda
 * dentro do Harness, então o dispatch de um handler chamado aqui é uma
 * atualização durante o render: o React refaz o render antes de gerar o HTML.
 * É o mesmo mecanismo que a gaveta usa para zerar a prova na troca de aba.
 */
function drawerAfter(script: (ui: ShopUi) => void, { onPurchase = (): void => undefined, onEquip = (): void => undefined }: { onPurchase?: (itemId: string) => void; onEquip?: (slot: string, itemId: string | null) => void } = {}): string {
  const state = sampleState();
  function Harness(): ReactElement {
    const [tab, setTab] = useState<CaracolCosmeticWearer>('player');
    const [played, setPlayed] = useState(false);
    const tree = CaracolShopDrawer({ state, open: true, tab, onTabChange: setTab, onClose: () => undefined, onPurchase, onEquip }) as ReactElement<ElementProps>;
    if (!played) {
      setPlayed(true);
      script(shopUi(tree));
    }
    return tree;
  }
  return renderToStaticMarkup(createElement(Harness));
}

function card(markup: string, name: string): string {
  const cards = markup.split('<article ').slice(1);
  const found = cards.find((html) => html.includes(`<strong>${name}</strong>`));
  if (!found) throw new Error(`card ${name} não encontrado`);
  return found.slice(0, found.indexOf('</article>'));
}

function layersOf(markup: string): string[] {
  return Array.from(markup.matchAll(/data-layer="([^"]+)"/g), (match) => match[1]!);
}

function section(markup: string, from: string, to: string): string {
  const start = markup.indexOf(from);
  const end = markup.indexOf(to, start);
  if (start < 0 || end < 0) throw new Error(`trecho ${from} não encontrado`);
  return markup.slice(start, end);
}

function medallionTone(markup: string): string | undefined {
  return /class="caracol-medallion tone-([\w-]+)"/.exec(markup)?.[1];
}

describe('gaveta da loja', () => {
  it('troca título e descrição com a aba (LOJA-05)', () => {
    const player = drawer('player');
    expect(player).toContain('<h2>Seu guarda-roupa</h2>');
    expect(player).toContain('Peças compradas ficam para sempre na sua conta.');
    const snail = drawer('snail');
    expect(snail).toContain('<h2>O guarda-roupa do caracol</h2>');
    expect(snail).toContain('Este visual é global. Todo mundo vê a mesma roupa no mapa.');
  });

  it('mostra Equipado desabilitado na peça equipada', () => {
    expect(card(drawer('player'), 'Jeans')).toMatch(/<button class="shop-item-button is-equipped" type="button" disabled="">Equipado<\/button>/);
  });

  it('oferece Usar na peça comprada que não está em uso', () => {
    const cargo = card(drawer('player'), 'Cargo');
    expect(cargo).toMatch(/<button class="shop-item-button" type="button">Usar<\/button>/);
  });

  it('oferece Comprar com o preço, desabilitado quando o saldo não alcança', () => {
    const state = sampleState({ coins: 40 });
    const markup = drawer('player', state);
    expect(card(markup, 'Básica')).toMatch(/<button class="shop-item-button shop-item-buy" type="button">Comprar <span>25<\/span><\/button>/);
    expect(card(markup, 'Listrada')).toMatch(/<button class="shop-item-button shop-item-buy" type="button" disabled="">Comprar <span>50<\/span><\/button>/);
  });
});

describe('cards da loja', () => {
  for (const tab of ['player', 'snail'] as const) {
    it(`${tab}: mostra cada peça no recorte do próprio slot (LOJA-01, LOJA-05)`, () => {
      const markup = drawer(tab);
      for (const item of CARACOL_COSMETIC_CATALOG) {
        expect(card(markup, item.name), item.id).toContain(`viewBox="${caracolArtViewBox(tab, item.slot)}"`);
      }
    });
  }

  it('veste a peça do card por cima do que já está equipado nos outros slots (LOJA-01)', () => {
    const markup = drawer('player');
    const flat = layersOf(card(markup, 'Aba reta'));
    expect(flat).toContain('cap-flat');
    expect(flat).toContain('pants-jeans');
    expect(flat).toContain('glasses-dark');
    const cargo = layersOf(card(markup, 'Cargo'));
    expect(cargo).toContain('pants-cargo');
    expect(cargo).not.toContain('pants-jeans');
    expect(cargo).toContain('glasses-dark');
  });

  it('marca a peça equipada com o tom equipped e o selo de check (LOJA-02)', () => {
    const jeans = card(drawer('player', sampleState({ coins: 0 })), 'Jeans');
    expect(medallionTone(jeans)).toBe('equipped');
    expect(jeans).toContain('badge-check');
  });

  it('marca a peça não comprada acima do saldo como unaffordable (LOJA-03)', () => {
    expect(medallionTone(card(drawer('player', sampleState({ coins: 40 })), 'Listrada'))).toBe('unaffordable');
  });

  it('usa o tom padrão nos demais casos (LOJA-04)', () => {
    const markup = drawer('player', sampleState({ coins: 40 }));
    expect(medallionTone(card(markup, 'Básica'))).toBe('default');
    expect(medallionTone(card(markup, 'Cargo'))).toBe('default');
    expect(card(markup, 'Cargo')).not.toContain('badge-check');
  });

  it('decide o saldo pelo preço que o servidor mandou, já com Moeda ou Raio', () => {
    const state = sampleState({ coins: 40 });
    state.shop.catalog = state.shop.catalog.map((item) => item.id === 'shirt-striped' ? { ...item, price: 25 } : item);
    expect(medallionTone(card(drawer('player', state), 'Listrada'))).toBe('default');
  });
});

describe('prévia e abas da loja', () => {
  it('mostra o personagem da aba de corpo inteiro e em retrato, com o outfit equipado (LOJA-06)', () => {
    const player = section(drawer('player'), 'caracol-shop-preview', 'caracol-shop-body');
    expect(player).toContain(`viewBox="${caracolArtViewBox('player', 'full')}"`);
    expect(player).toMatch(new RegExp(`class="caracol-avatar"[^>]*aria-label="Seu personagem vestido".*viewBox="${caracolArtViewBox('player', 'portrait')}"`));
    expect(layersOf(player).filter((layer) => layer === 'pants-jeans')).toHaveLength(2);
    expect(layersOf(player).filter((layer) => layer === 'glasses-dark')).toHaveLength(2);

    const snail = section(drawer('snail'), 'caracol-shop-preview', 'caracol-shop-body');
    expect(snail).toContain(`viewBox="${caracolArtViewBox('snail', 'full')}"`);
    expect(snail).toContain(`viewBox="${caracolArtViewBox('snail', 'portrait')}"`);
    expect(layersOf(snail).filter((layer) => layer === 'cap-trucker')).toHaveLength(2);
  });

  it('mostra nas abas o retrato de 32 px de cada personagem, seja qual for a aba ativa (LOJA-07)', () => {
    for (const active of ['player', 'snail'] as const) {
      const tabs = section(drawer(active), 'caracol-shop-tabs', 'caracol-shop-preview').split('<button ').slice(1);
      const you = tabs.find((html) => html.includes('<span>Você</span>'))!;
      const snail = tabs.find((html) => html.includes('<span>Caracol</span>'))!;
      expect(you).toContain('--medallion-size:32px');
      expect(you).toContain(`viewBox="${caracolArtViewBox('player', 'portrait')}"`);
      expect(layersOf(you)).toContain('pants-jeans');
      expect(snail).toContain('--medallion-size:32px');
      expect(snail).toContain(`viewBox="${caracolArtViewBox('snail', 'portrait')}"`);
      expect(layersOf(snail)).toContain('cap-trucker');
    }
  });
});

describe('provador', () => {
  const equipped = sampleState().shop.player.outfit;
  const cargo = CARACOL_COSMETIC_CATALOG.find((item) => item.id === 'pants-cargo')!;
  const jeans = CARACOL_COSMETIC_CATALOG.find((item) => item.id === 'pants-jeans')!;
  const empty: ShopPreviewState = { trying: null, pinned: false };
  const run = (actions: ShopPreviewAction[], from = empty): ShopPreviewState => actions.reduce(shopPreviewReducer, from);

  it('veste a peça em prova no slot dela e diz Provando (LOJA-08)', () => {
    const state = run([{ type: 'try', itemId: 'pants-cargo' }]);
    expect(state.trying).toBe('pants-cargo');
    expect(shopPreview(equipped, cargo)).toEqual({ outfit: { ...equipped, pants: 'pants-cargo' }, label: 'Provando' });
  });

  it('diz Provando mesmo quando a peça em prova já é a equipada', () => {
    expect(shopPreview(equipped, jeans)).toEqual({ outfit: equipped, label: 'Provando' });
  });

  it('volta ao visual equipado quando o ponteiro ou o foco sai (LOJA-09)', () => {
    expect(run([{ type: 'try', itemId: 'pants-cargo' }, { type: 'leave' }]).trying).toBeNull();
    expect(shopPreview(equipped, null)).toEqual({ outfit: equipped, label: 'Visual atual' });
  });

  it('descarta a prova ao trocar de aba, fixada ou não (LOJA-10)', () => {
    expect(run([{ type: 'try', itemId: 'pants-cargo' }, { type: 'tab' }])).toEqual(empty);
    expect(run([{ type: 'toggle', itemId: 'pants-cargo' }, { type: 'tab' }])).toEqual(empty);
  });

  it('prova pelo botão do medalhão e desfaz ao acionar de novo (LOJA-12)', () => {
    const on = run([{ type: 'toggle', itemId: 'pants-cargo' }]);
    expect(on).toEqual({ trying: 'pants-cargo', pinned: true });
    expect(run([{ type: 'toggle', itemId: 'pants-cargo' }], on)).toEqual(empty);
  });

  it('acionar o botão depois do hover prova a peça em vez de desfazer (LOJA-12)', () => {
    // No toque, o navegador emula mouseenter e foco antes do clique: o gesto chega como try + toggle.
    expect(run([{ type: 'try', itemId: 'pants-cargo' }, { type: 'toggle', itemId: 'pants-cargo' }])).toEqual({ trying: 'pants-cargo', pinned: true });
    expect(run([{ type: 'try', itemId: 'pants-cargo' }, { type: 'toggle', itemId: 'pants-cargo' }, { type: 'toggle', itemId: 'pants-cargo' }])).toEqual(empty);
  });

  it('mantém a prova fixada pelo botão quando o ponteiro passa por outros cards', () => {
    const pinned = run([{ type: 'toggle', itemId: 'pants-cargo' }]);
    expect(run([{ type: 'leave' }, { type: 'try', itemId: 'cap-flat' }, { type: 'leave' }], pinned)).toEqual(pinned);
  });

  it('monta handlers que só despacham para o provador (LOJA-11)', () => {
    const dispatch = vi.fn();
    const handlers = shopCardHandlers(dispatch, 'pants-cargo');
    handlers.onMouseEnter();
    handlers.onFocus();
    handlers.onClick();
    handlers.onBlur();
    handlers.onMouseLeave();
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: 'try', itemId: 'pants-cargo' },
      { type: 'try', itemId: 'pants-cargo' },
      { type: 'toggle', itemId: 'pants-cargo' },
      { type: 'leave' },
      { type: 'leave' },
    ]);
    expect(run(dispatch.mock.calls.map(([action]) => action as ShopPreviewAction))).toEqual({ trying: 'pants-cargo', pinned: true });
  });

  it('põe em cada card um botão Provar solto quando a gaveta abre, e mostra o visual atual (LOJA-12)', () => {
    const markup = drawer('player');
    for (const item of CARACOL_COSMETIC_CATALOG) {
      expect(card(markup, item.name), item.id).toContain(`<button type="button" class="caracol-shop-try" aria-pressed="false" aria-label="Provar ${item.name}">`);
    }
    expect(section(markup, 'caracol-shop-preview', 'caracol-shop-body')).toContain('<span class="micro-label">Visual atual</span>');
  });
});

describe('provador na gaveta', () => {
  const preview = (markup: string): string => section(markup, 'caracol-shop-preview', 'caracol-shop-body');

  it('prova a peça quando o ponteiro entra no card, sem apertar o botão (LOJA-08, LOJA-12)', () => {
    const markup = drawerAfter((ui) => ui.card('Cargo').onMouseEnter());
    expect(preview(markup)).toContain('<span class="micro-label">Provando</span>');
    expect(layersOf(preview(markup)).filter((layer) => layer === 'pants-cargo')).toHaveLength(2);
    expect(layersOf(preview(markup))).not.toContain('pants-jeans');
    expect(card(markup, 'Cargo')).toContain('aria-pressed="false" aria-label="Provar Cargo"');
  });

  it('prova a peça quando o foco entra num botão do card (LOJA-08)', () => {
    const markup = drawerAfter((ui) => ui.card('Cargo').onFocus());
    expect(preview(markup)).toContain('<span class="micro-label">Provando</span>');
    expect(layersOf(preview(markup))).toContain('pants-cargo');
  });

  it('volta ao visual equipado quando o ponteiro ou o foco sai (LOJA-09)', () => {
    for (const markup of [
      drawerAfter((ui) => { ui.card('Cargo').onMouseEnter(); ui.card('Cargo').onMouseLeave(); }),
      drawerAfter((ui) => { ui.card('Cargo').onFocus(); ui.card('Cargo').onBlur(); }),
    ]) {
      expect(preview(markup)).toContain('<span class="micro-label">Visual atual</span>');
      expect(layersOf(preview(markup))).toContain('pants-jeans');
      expect(layersOf(preview(markup))).not.toContain('pants-cargo');
    }
  });

  it('fixa a prova pelo botão depois do hover e desfaz ao acionar de novo (LOJA-12)', () => {
    const pinned = drawerAfter((ui) => { ui.card('Cargo').onMouseEnter(); ui.tryButton('Cargo').onClick(); ui.card('Cargo').onMouseLeave(); });
    expect(card(pinned, 'Cargo')).toContain('aria-pressed="true" aria-label="Provar Cargo"');
    expect(preview(pinned)).toContain('<span class="micro-label">Provando</span>');
    const released = drawerAfter((ui) => { ui.tryButton('Cargo').onClick(); ui.tryButton('Cargo').onClick(); });
    expect(card(released, 'Cargo')).toContain('aria-pressed="false" aria-label="Provar Cargo"');
    expect(preview(released)).toContain('<span class="micro-label">Visual atual</span>');
  });

  it('descarta a prova fixada quando a aba muda (LOJA-10)', () => {
    const markup = drawerAfter((ui) => { ui.tryButton('Cargo').onClick(); ui.tab('Caracol').onClick(); });
    expect(markup).toContain('<h2>O guarda-roupa do caracol</h2>');
    expect(preview(markup)).toContain('<span class="micro-label">Visual atual</span>');
    expect(markup).not.toContain('aria-pressed="true"');
  });

  it('não compra nem equipa ao provar, em nenhum card (LOJA-11)', () => {
    const onPurchase = vi.fn();
    const onEquip = vi.fn();
    const markup = drawerAfter((ui) => {
      for (const item of CARACOL_COSMETIC_CATALOG) {
        const handlers = ui.card(item.name);
        handlers.onMouseEnter();
        handlers.onFocus();
        ui.tryButton(item.name).onClick();
        handlers.onBlur();
        handlers.onMouseLeave();
      }
    }, { onPurchase, onEquip });
    expect(onPurchase).not.toHaveBeenCalled();
    expect(onEquip).not.toHaveBeenCalled();
    expect(card(markup, 'Bucket')).toContain('aria-pressed="true" aria-label="Provar Bucket"');
    expect(markup.match(/aria-pressed="true"/g)).toHaveLength(1);
  });
});

