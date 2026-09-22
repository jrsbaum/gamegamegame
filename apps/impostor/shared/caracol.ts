import type { BrazilianCity } from './cities';

export const CARACOL_BASE_SPEED_KMH = 0.05;
export const CARACOL_REDIRECT_COST = 8;
export const CARACOL_HISTORY_PAGE_SIZE = 20;
export const CARACOL_STARTING_COINS = 5;
export const CARACOL_COIN_INTERVAL_MS = 10_000;
export const CARACOL_OFFLINE_COINS_PER_INTERVAL = 1;
export const CARACOL_ONLINE_COINS_PER_INTERVAL = 10;
export const CARACOL_DISCOUNT_COSTS = [10, 15] as const;
export const CARACOL_BRAZILIA: BrazilianCity = {
  id: '5300108',
  name: 'Brasília',
  uf: 'DF',
  lat: -15.7795,
  lon: -47.9297,
};

export const CARACOL_COSMETIC_SLOTS = ['pants', 'shirt', 'watch', 'glasses', 'cap'] as const;
export type CaracolCosmeticSlot = typeof CARACOL_COSMETIC_SLOTS[number];
export type CaracolCosmeticWearer = 'player' | 'snail';

export interface CaracolCosmeticItem {
  id: string;
  slot: CaracolCosmeticSlot;
  name: string;
  price: number;
  tier: 1 | 2 | 3;
}

export const CARACOL_COSMETIC_CATALOG: readonly CaracolCosmeticItem[] = [
  { id: 'pants-jeans', slot: 'pants', name: 'Jeans', price: 25, tier: 1 },
  { id: 'pants-cargo', slot: 'pants', name: 'Cargo', price: 50, tier: 2 },
  { id: 'pants-neon-race', slot: 'pants', name: 'Corrida neon', price: 100, tier: 3 },
  { id: 'shirt-basic', slot: 'shirt', name: 'Básica', price: 25, tier: 1 },
  { id: 'shirt-striped', slot: 'shirt', name: 'Listrada', price: 50, tier: 2 },
  { id: 'shirt-tropical', slot: 'shirt', name: 'Tropical', price: 100, tier: 3 },
  { id: 'watch-digital', slot: 'watch', name: 'Digital', price: 25, tier: 1 },
  { id: 'watch-gold', slot: 'watch', name: 'Dourado', price: 50, tier: 2 },
  { id: 'watch-holographic', slot: 'watch', name: 'Holográfico', price: 100, tier: 3 },
  { id: 'glasses-round', slot: 'glasses', name: 'Redondos', price: 25, tier: 1 },
  { id: 'glasses-dark', slot: 'glasses', name: 'Escuros', price: 50, tier: 2 },
  { id: 'glasses-neon-visor', slot: 'glasses', name: 'Visor neon', price: 100, tier: 3 },
  { id: 'cap-flat', slot: 'cap', name: 'Aba reta', price: 25, tier: 1 },
  { id: 'cap-trucker', slot: 'cap', name: 'Trucker', price: 50, tier: 2 },
  { id: 'cap-bucket', slot: 'cap', name: 'Bucket', price: 100, tier: 3 },
];

export const CARACOL_ROULETTE_COOLDOWN_MS = 24 * 60 * 60 * 1_000;

export type CaracolRouletteCategory = 'buff' | 'debuff';
export type CaracolEffectScope = 'account' | 'world';
export type CaracolRouletteItemId =
  | 'mushroom'
  | 'star'
  | 'fire-flower'
  | 'boomerang'
  | 'bullet-bill'
  | 'coin'
  | 'shield'
  | 'red-shell'
  | 'bomb'
  | 'lightning'
  | 'blooper'
  | 'freeze'
  | 'banana';

/**
 * Todo item mexe em saldo (só na hora), custos, alvo, velocidade ou
 * informação. Nenhum item muda a taxa de ganho de moedas por tempo: o
 * pagamento é preguiçoso e em lote, e um multiplicador por período pagaria
 * errado em silêncio. Leia plano/roleta-do-caracol.md, seção 5, antes de
 * adicionar um item aqui.
 */
export interface CaracolRouletteItem {
  id: CaracolRouletteItemId;
  category: CaracolRouletteCategory;
  scope: CaracolEffectScope;
  name: string;
  shortName: string;
  summary: string;
  description: string;
  /** Validade do efeito; `null` para item instantâneo, que não é gravado. */
  durationMs: number | null;
  /** Cargas do efeito; `null` para efeito que vale só por tempo. */
  charges: number | null;
  durationLabel: string;
}

const HOUR_MS = 60 * 60 * 1_000;

export const CARACOL_ROULETTE_CATALOG: readonly CaracolRouletteItem[] = [
  { id: 'mushroom', category: 'buff', scope: 'account', name: 'Cogumelo', shortName: 'Cogumelo', summary: 'Troca de cidade mesmo vivo.', description: 'Você pode mudar de cidade mesmo estando vivo. A carga é gasta quando você escolhe a cidade nova.', durationMs: 24 * HOUR_MS, charges: 1, durationLabel: '1 uso, até 24 horas' },
  { id: 'star', category: 'buff', scope: 'account', name: 'Super Star', shortName: 'Estrela', summary: 'O caracol não pode te escolher.', description: 'O caracol não consegue te escolher. Se já estava vindo, ele desiste no lugar onde está.', durationMs: 2 * HOUR_MS, charges: null, durationLabel: 'vale por 2 horas' },
  { id: 'fire-flower', category: 'buff', scope: 'account', name: 'Flor de Fogo', shortName: 'Flor', summary: 'Três redirecionamentos de graça.', description: 'Seus próximos três redirecionamentos saem de graça e não encarecem o preço do mundo.', durationMs: 2 * HOUR_MS, charges: 3, durationLabel: '3 usos, até 2 horas' },
  { id: 'boomerang', category: 'buff', scope: 'account', name: 'Flor Bumerangue', shortName: 'Bumerangue', summary: 'Rouba 20% das moedas de alguém.', description: 'Escolha alguém vivo no mapa e traga 20% das moedas dessa pessoa para o seu bolso.', durationMs: 24 * HOUR_MS, charges: 1, durationLabel: '1 uso, até 24 horas' },
  { id: 'bullet-bill', category: 'buff', scope: 'account', name: 'Bullet Bill', shortName: 'Bullet Bill', summary: 'Te lança para a cidade mais longe do caracol.', description: 'Você foi lançado para a cidade do Brasil mais distante de onde o caracol está agora.', durationMs: null, charges: null, durationLabel: 'na hora' },
  { id: 'coin', category: 'buff', scope: 'account', name: 'Moeda', shortName: 'Moeda', summary: 'Tudo que você compra custa metade.', description: 'Redirecionar, acelerar, comprar desconto e comprar na loja custam metade para você.', durationMs: 6 * HOUR_MS, charges: null, durationLabel: 'vale por 6 horas' },
  { id: 'shield', category: 'buff', scope: 'account', name: 'Casco defensivo', shortName: 'Escudo', summary: 'Bloqueia o próximo ataque de alguém.', description: 'O próximo redirecionamento ou bumerangue de outra pessoa contra você bate no escudo e não faz nada.', durationMs: 24 * HOUR_MS, charges: 1, durationLabel: 'até usar, máximo 24 horas' },
  { id: 'red-shell', category: 'debuff', scope: 'account', name: 'Casco vermelho', shortName: 'Casco', summary: 'O caracol te marca e ninguém tira o foco.', description: 'O caracol te marca agora e ninguém consegue mandar ele atrás de outra pessoa.', durationMs: 2 * HOUR_MS, charges: null, durationLabel: 'vale por 2 horas' },
  { id: 'bomb', category: 'debuff', scope: 'account', name: 'Bomba', shortName: 'Bomba', summary: 'Perde metade das moedas na hora.', description: 'Metade das suas moedas explodiu. O ganho de moedas continua igual.', durationMs: null, charges: null, durationLabel: 'na hora' },
  { id: 'lightning', category: 'debuff', scope: 'world', name: 'Raio', shortName: 'Raio', summary: 'Tudo em dobro para o jogo inteiro. Inclusive você.', description: 'Tudo fica o dobro do preço para o jogo inteiro, inclusive para você.', durationMs: HOUR_MS, charges: null, durationLabel: 'vale por 1 hora' },
  { id: 'blooper', category: 'debuff', scope: 'account', name: 'Blooper', shortName: 'Blooper', summary: 'Tinta: você para de ver onde o caracol está.', description: 'Tinta na tela: você para de ver onde o caracol está, a que distância e quando chega.', durationMs: 2 * HOUR_MS, charges: null, durationLabel: 'vale por 2 horas' },
  { id: 'freeze', category: 'debuff', scope: 'account', name: 'Congelamento', shortName: 'Gelo', summary: 'Não pode comprar, acelerar nem redirecionar.', description: 'Você não pode comprar, acelerar, redirecionar nem lançar bumerangue. As moedas continuam entrando.', durationMs: HOUR_MS, charges: null, durationLabel: 'vale por 1 hora' },
  { id: 'banana', category: 'debuff', scope: 'account', name: 'Banana', shortName: 'Banana', summary: 'O caracol vem 50% mais rápido atrás de você.', description: 'Quando o caracol estiver vindo atrás de você, ele anda 50% mais rápido.', durationMs: 4 * HOUR_MS, charges: null, durationLabel: 'vale por 4 horas' },
];

export const caracolRouletteItemById: ReadonlyMap<CaracolRouletteItemId, CaracolRouletteItem> = new Map(
  CARACOL_ROULETTE_CATALOG.map((item) => [item.id, item]),
);

export interface CaracolEffectView {
  itemId: CaracolRouletteItemId;
  expiresAt: number;
  charges: number | null;
}

export interface CaracolRouletteView {
  /** Instante do relógio do servidor em que o próximo giro abre; `null` quando já está disponível. */
  availableAt: number | null;
  lastItemId: CaracolRouletteItemId | null;
}

export type CaracolOutfit = Record<CaracolCosmeticSlot, string | null>;

export function emptyCaracolOutfit(): CaracolOutfit {
  return { pants: null, shirt: null, watch: null, glasses: null, cap: null };
}

export interface CaracolWardrobeView {
  ownedItemIds: string[];
  outfit: CaracolOutfit;
}

export interface CaracolShopView {
  catalog: CaracolCosmeticItem[];
  player: CaracolWardrobeView;
  snail: CaracolWardrobeView;
}

export interface CaracolCity {
  id: string;
  name: string;
  uf: string;
  lat: number;
  lon: number;
}

export interface CaracolPlayerView {
  accountId: string;
  nickname: string;
  alive: boolean;
  city: CaracolCity;
  online: boolean;
  isYou: boolean;
  outfit: CaracolOutfit;
  effectItemIds: CaracolRouletteItemId[];
}

export interface CaracolYouView {
  accountId: string;
  nickname: string;
  alive: boolean;
  coins: number;
  city: CaracolCity | null;
  speedDiscountLevel: number;
  /** Preço do próximo nível de desconto já com Moeda e Raio; `null` no máximo. */
  discountCost: number | null;
  roulette: CaracolRouletteView;
  effects: CaracolEffectView[];
}

export interface CaracolWorldView {
  snail: {
    /** Posição, distância e chegada vêm `null` para quem está com Blooper. */
    lat: number | null;
    lon: number | null;
    hidden: boolean;
    speedKmh: number;
    speedLevel: number;
    speedCost: number;
    targetAccountId: string | null;
    targetNickname: string | null;
    distanceKm: number | null;
    etaMs: number | null;
    redirectCost: number;
    outfit: CaracolOutfit;
  };
  effects: CaracolEffectView[];
  serverNow: number;
}

export interface CaracolStateView {
  world: CaracolWorldView;
  players: CaracolPlayerView[];
  you: CaracolYouView;
  shop: CaracolShopView;
  needsCity: boolean;
  pushPublicKey: string | null;
}

export interface CaracolRegisterInput {
  nickname: string;
  password: string;
}

export interface CaracolLoginInput {
  nickname: string;
  password: string;
}

export interface CaracolResumeInput {
  sessionToken: string;
}

export interface CaracolSelectCityInput {
  cityId: string;
}

export interface CaracolRedirectInput {
  targetNickname: string;
}

export interface CaracolBoomerangInput {
  targetNickname: string;
}

export interface CaracolShopPurchaseInput {
  wearer: CaracolCosmeticWearer;
  itemId: string;
}

export interface CaracolShopEquipInput {
  wearer: CaracolCosmeticWearer;
  slot: CaracolCosmeticSlot;
  itemId: string | null;
}

export interface CaracolVisibilityInput {
  visible: boolean;
}

export interface CaracolPushSubscriptionInput {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export type CaracolHistoryType =
  | 'account'
  | 'city'
  | 'coins'
  | 'redirect'
  | 'speed'
  | 'discount'
  | 'target'
  | 'approaching'
  | 'death'
  | 'shop'
  | 'roulette';

export interface CaracolHistoryEntry {
  id: string;
  type: CaracolHistoryType;
  message: string;
  actorNickname: string | null;
  targetNickname: string | null;
  amount: number | null;
  createdAt: number;
}

export interface CaracolHistoryInput {
  beforeId?: string | null;
  limit?: number;
}

export interface CaracolHistoryPage {
  ok: true;
  entries: CaracolHistoryEntry[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface CaracolAuthSuccess {
  ok: true;
  accountId: string;
  nickname: string;
  sessionToken: string;
  state: CaracolStateView;
}

export interface CaracolActionSuccess {
  ok: true;
  state: CaracolStateView;
}

export interface CaracolActionFailure {
  ok: false;
  code: string;
  message: string;
}

export interface CaracolRouletteSuccess {
  ok: true;
  itemId: CaracolRouletteItemId;
  category: CaracolRouletteCategory;
  state: CaracolStateView;
}

export type CaracolAuthResult = CaracolAuthSuccess | CaracolActionFailure;
export type CaracolActionResult = CaracolAuthSuccess | CaracolActionSuccess | CaracolActionFailure;
export type CaracolHistoryResult = CaracolHistoryPage | CaracolActionFailure;
export type CaracolRouletteResult = CaracolRouletteSuccess | CaracolActionFailure;

export interface CaracolDeathPayload {
  nickname: string;
  message: string;
}

export interface CaracolNoticePayload {
  code: 'targeted' | 'approaching' | 'speed' | 'redirected' | 'death' | 'discount' | 'shop' | 'roulette' | 'boomerang' | 'effect-expired' | 'shield';
  message: string;
}
