import { CARACOL_COSMETIC_SLOTS, type CaracolCosmeticSlot, type CaracolCosmeticWearer, type CaracolOutfit } from '../../shared/caracol';

// Modelo da arte do Caracol: tudo que é dado e regra, sem JSX. Cada personagem
// é desenhado uma vez em coordenadas fixas (jogador em 200 × 400, caracol em
// 240 × 240), e cada recorte é só um viewBox diferente sobre o mesmo desenho.

/**
 * Atributo de apresentação SVG não aceita `var()`, e a splash é arquivo
 * estático, então a arte copia os hex. As cores que vêm de `:root` em
 * src/styles.css têm teste de paridade.
 */
export const CARACOL_ART_PALETTE = {
  ink: '#151525',
  paper: '#f6f2e8',
  white: '#fffdf8',
  acid: '#ddf45c',
  acidDark: '#94a329',
  coral: '#ff745f',
  sky: '#75d9e9',
  lavender: '#b39bff',
  skin: '#c78261',
  hair: '#4a2d25',
  shell: '#d86b51',
  snailBody: '#efb37d',
  jeans: '#4d628f',
  jeansLight: '#7189bd',
  olive: '#7b7753',
  oliveDark: '#5f5c3f',
  tropical: '#4f9f7f',
  basic: '#e8d6c2',
  gold: '#e7bc52',
  goldDark: '#9c722b',
} as const;

/** As peças com desenho. Peça nova no catálogo precisa entrar aqui e ganhar arte nos dois personagens. */
export const CARACOL_ART_ITEM_IDS = [
  'pants-jeans',
  'pants-cargo',
  'pants-neon-race',
  'shirt-basic',
  'shirt-striped',
  'shirt-tropical',
  'watch-digital',
  'watch-gold',
  'watch-holographic',
  'glasses-round',
  'glasses-dark',
  'glasses-neon-visor',
  'cap-flat',
  'cap-trucker',
  'cap-bucket',
] as const;

export type CaracolArtItemId = typeof CARACOL_ART_ITEM_IDS[number];
export type CaracolArtCrop = 'portrait' | 'full' | CaracolCosmeticSlot;
export type CaracolArtBox = readonly [x: number, y: number, width: number, height: number];

export type PlayerArtLayer =
  | 'legs' | 'pants-default' | 'arms' | 'shirt-default' | 'head' | 'fringe' | 'eyes' | 'mouth'
  | CaracolArtItemId;
export type SnailArtLayer = 'body' | 'stalks' | 'head' | CaracolArtItemId;
export type CaracolArtLayer = PlayerArtLayer | SnailArtLayer;
export type CaracolPlayerTone = 'default' | 'you' | 'target' | 'dead';
export type CaracolMedallionTone = CaracolPlayerTone | 'equipped' | 'unaffordable';

/** Abaixo disso o tremido da tinta só borra o traço, e o filtro custaria em cada token do mapa. */
export const CARACOL_INK_MIN_PX = 56;

export const CARACOL_ART_CROPS: Record<CaracolCosmeticWearer, Record<CaracolArtCrop, CaracolArtBox>> = {
  player: {
    full: [18, 14, 172, 372],
    portrait: [30, 24, 140, 140],
    cap: [48, 14, 104, 104],
    glasses: [56, 42, 88, 88],
    shirt: [30, 110, 140, 140],
    watch: [127, 74, 60, 60],
    pants: [20, 222, 160, 160],
  },
  snail: {
    full: [6, -6, 236, 236],
    portrait: [22, -6, 150, 150],
    cap: [48, 36, 94, 94],
    glasses: [42, -26, 106, 106],
    shirt: [34, 104, 122, 122],
    watch: [48, 26, 58, 58],
    pants: [38, 140, 114, 114],
  },
};

export function caracolArtViewBox(wearer: CaracolCosmeticWearer, crop: CaracolArtCrop): string {
  return CARACOL_ART_CROPS[wearer][crop].join(' ');
}

/**
 * As camadas que o outfit mostra, de trás para frente. Id sem arte vale como
 * slot vazio: o personagem aparece sem a peça em vez de quebrar a tela.
 */
export function caracolArtLayers(wearer: 'player', outfit: CaracolOutfit): PlayerArtLayer[];
export function caracolArtLayers(wearer: 'snail', outfit: CaracolOutfit): SnailArtLayer[];
export function caracolArtLayers(wearer: CaracolCosmeticWearer, outfit: CaracolOutfit): CaracolArtLayer[];
export function caracolArtLayers(wearer: CaracolCosmeticWearer, outfit: CaracolOutfit): CaracolArtLayer[] {
  const item = (slot: CaracolCosmeticSlot): CaracolArtItemId | null => {
    const id = outfit[slot];
    return id !== null && (CARACOL_ART_ITEM_IDS as readonly string[]).includes(id) ? id as CaracolArtItemId : null;
  };
  const piece = (slot: CaracolCosmeticSlot): CaracolArtItemId[] => {
    const id = item(slot);
    return id ? [id] : [];
  };
  if (wearer === 'snail') {
    return ['body', ...piece('pants'), ...piece('shirt'), 'stalks', ...piece('watch'), 'head', ...piece('cap'), ...piece('glasses')];
  }
  // O boné cobre a franja e cada par de óculos desenha os próprios olhos.
  return [
    'legs', item('pants') ?? 'pants-default', 'arms', item('shirt') ?? 'shirt-default', ...piece('watch'),
    'head', ...(item('cap') ? [] : ['fringe' as const]), ...(item('glasses') ? [] : ['eyes' as const]), 'mouth',
    ...piece('glasses'), ...piece('cap'),
  ];
}

/** Morte é o fato mais forte, alvo é perigo imediato, e "você" já tem a faixa ácida na linha. */
export function caracolPlayerTone({ isYou, isTarget, alive }: { isYou: boolean; isTarget: boolean; alive: boolean }): CaracolPlayerTone {
  if (!alive) return 'dead';
  if (isTarget) return 'target';
  return isYou ? 'you' : 'default';
}

/** `price` já chega do servidor com Moeda e Raio aplicados. */
export function caracolShopItemTone({ owned, equipped, coins, price }: { owned: boolean; equipped: boolean; coins: number; price: number }): CaracolMedallionTone {
  if (equipped) return 'equipped';
  if (!owned && coins < price) return 'unaffordable';
  return 'default';
}

/** O estado chega a cada segundo com outfits em objetos novos: comparar por valor evita redesenhar o avatar. */
export function sameCaracolOutfit(a: CaracolOutfit, b: CaracolOutfit): boolean {
  return CARACOL_COSMETIC_SLOTS.every((slot) => a[slot] === b[slot]);
}
