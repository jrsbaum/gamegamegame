import { createHash, randomBytes } from 'node:crypto';
import { compare, hash } from 'bcryptjs';
import type { Server, Socket } from 'socket.io';
import {
  type CaracolActionResult,
  type CaracolActionFailure,
  type CaracolBoomerangInput,
  CARACOL_COSMETIC_CATALOG,
  CARACOL_ROULETTE_CATALOG,
  CARACOL_ROULETTE_COOLDOWN_MS,
  caracolRouletteItemById,
  type CaracolCosmeticItem,
  type CaracolDeathPayload,
  type CaracolEffectView,
  type CaracolHistoryInput,
  type CaracolHistoryResult,
  type CaracolLoginInput,
  type CaracolNoticePayload,
  type CaracolPushSubscriptionInput,
  type CaracolRedirectInput,
  type CaracolRegisterInput,
  type CaracolResumeInput,
  type CaracolRouletteItem,
  type CaracolRouletteItemId,
  type CaracolRouletteResult,
  type CaracolSelectCityInput,
  type CaracolCosmeticSlot,
  type CaracolCosmeticWearer,
  type CaracolShopEquipInput,
  type CaracolShopPurchaseInput,
  type CaracolStateView,
  type CaracolVisibilityInput,
  CARACOL_BASE_SPEED_KMH,
  CARACOL_COIN_INTERVAL_MS,
  CARACOL_DISCOUNT_COSTS,
  CARACOL_HISTORY_PAGE_SIZE,
  CARACOL_OFFLINE_COINS_PER_INTERVAL,
  CARACOL_ONLINE_COINS_PER_INTERVAL,
  CARACOL_REDIRECT_COST,
  CARACOL_STARTING_COINS,
  emptyCaracolOutfit,
  type CaracolCity,
} from '../../shared/caracol';
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from '../../shared/protocol';
import { cityById, type BrazilianCity } from '../../shared/cities';
import { normalizeText } from '../normalization';
import { distanceKm, moveTowards, type GeoPoint } from './geo';
import {
  CaracolNicknameTakenError,
  caracolEffectId,
  cloneAccount,
  cloneWorld,
  createCaracolStore,
  type CaracolAccountRecord,
  type CaracolEffectRecord,
  type CaracolPushRecord,
  type CaracolStore,
  type CaracolHistoryRecord,
  type CaracolWorldRecord,
} from './store';
import { CaracolPushService } from './push';

type CaracolSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type CaracolIo = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

interface RuntimeAccount extends CaracolAccountRecord {
  sockets: Set<string>;
  visibleSockets: Set<string>;
}

interface CaracolManagerOptions {
  store?: CaracolStore;
  clock?: () => number;
  /** Sorteio da roleta; injetável como o relógio para os testes escolherem o item. */
  random?: () => number;
  autoTick?: boolean;
}

/**
 * Mudança numa conta, aplicada duas vezes: no rascunho gravado e, depois do
 * commit, na memória. Escrita como delta (`coins -= x`), e não recalculada da
 * base, para não apagar moedas que o tick pagar durante o `await`.
 */
type AccountChange = (account: CaracolAccountRecord) => void;

/** O que uma ação grava de uma vez só; `commitPlan` grava e só então muda a memória. */
interface CommitPlan {
  accounts?: Array<[RuntimeAccount, AccountChange]>;
  world?: (world: CaracolWorldRecord) => void;
  upsertEffects?: CaracolEffectRecord[];
  deleteEffectIds?: string[];
}

/** O que um item sorteado faz na conta. */
interface RouletteOutcome {
  effect: CaracolEffectRecord | null;
  apply: AccountChange;
  detail: string;
  amount: number | null;
}

const MIN_NICKNAME_LENGTH = 2;
const MAX_NICKNAME_LENGTH = 24;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 72;
const APPROACHING_ETA_MS = 10 * 60_000;
const TICK_MS = 1_000;
const BANANA_SPEED_FACTOR = 1.5;
const BOOMERANG_SHARE_DIVISOR = 5;

export class CaracolGameManager {
  private readonly store: CaracolStore;
  private readonly clock: () => number;
  private readonly random: () => number;
  private readonly accounts = new Map<string, RuntimeAccount>();
  private readonly effects = new Map<string, CaracolEffectRecord>();
  private readonly sockets = new Map<string, CaracolSocket>();
  private readonly sessions = new Map<string, string>();
  private readonly pushSubscriptions = new Map<string, CaracolPushRecord>();
  private readonly approachingSent = new Set<string>();
  private readonly push: CaracolPushService;
  private readonly readyPromise: Promise<void>;
  private world!: CaracolWorldRecord;
  private tickTimer: NodeJS.Timeout | null = null;
  private tickInFlight = false;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly io: CaracolIo, options: CaracolManagerOptions = {}) {
    this.store = options.store ?? createCaracolStore();
    this.clock = options.clock ?? (() => Date.now());
    this.random = options.random ?? Math.random;
    this.push = new CaracolPushService((endpoint) => this.removePushSubscription(endpoint));
    this.readyPromise = this.initialize();
    if (options.autoTick !== false) {
      this.tickTimer = setInterval(() => { void this.runTick(); }, TICK_MS);
      this.tickTimer.unref();
    }
  }

  async ready(): Promise<void> {
    await this.readyPromise;
  }

  async initialize(): Promise<void> {
    await this.store.initialize();
    const snapshot = await this.store.loadSnapshot();
    this.world = snapshot.world;
    this.accounts.clear();
    for (const account of snapshot.accounts) {
      this.accounts.set(account.id, { ...account, sockets: new Set(), visibleSockets: new Set() });
    }
    this.pushSubscriptions.clear();
    for (const subscription of snapshot.pushSubscriptions) this.pushSubscriptions.set(subscription.endpoint, subscription);
    this.effects.clear();
    for (const effect of snapshot.effects) this.effects.set(effect.id, effect);

    await this.tickInternal(this.clock(), false);
  }

  bindSocket(socket: CaracolSocket): void {
    this.sockets.set(socket.id, socket);
    socket.on('caracol:register', (payload, ack) => { void this.afterReady(() => this.register(socket, payload, ack)); });
    socket.on('caracol:login', (payload, ack) => { void this.afterReady(() => this.login(socket, payload, ack)); });
    socket.on('caracol:resume', (payload, ack) => { void this.afterReady(() => this.resume(socket, payload, ack)); });
    socket.on('caracol:sync', (ack) => { void this.afterReady(() => this.sync(socket, ack)); });
    // Tudo que gasta moeda ou carga passa pela mesma fila. Essas ações conferem
    // o saldo e gravam pelo `commitPlan` (`await`) antes de mudar a memória;
    // fora da fila, dois cliques rápidos passariam juntos pela conferência e
    // gastariam duas vezes. O tick fica fora: ele só paga moedas e mata, e o
    // `commitPlan` lida com isso. Nada aqui dentro pode esperar rede de
    // terceiros: o Push sai por `notify`, que não segura a fila.
    socket.on('caracol:select-city', (payload, ack) => { void this.afterReady(() => this.enqueueMutation(() => this.selectCity(socket, payload, ack))); });
    socket.on('caracol:redirect', (payload, ack) => { void this.afterReady(() => this.enqueueMutation(() => this.redirect(socket, payload, ack))); });
    socket.on('caracol:buy-speed', (ack) => { void this.afterReady(() => this.enqueueMutation(() => this.buySpeed(socket, ack))); });
    socket.on('caracol:buy-discount', (ack) => { void this.afterReady(() => this.enqueueMutation(() => this.buyDiscount(socket, ack))); });
    socket.on('caracol:shop-purchase', (payload, ack) => { void this.afterReady(() => this.enqueueMutation(() => this.shopPurchase(socket, payload, ack))); });
    socket.on('caracol:shop-equip', (payload, ack) => { void this.afterReady(() => this.enqueueMutation(() => this.shopEquip(socket, payload, ack))); });
    socket.on('caracol:roulette', (ack) => { void this.afterReady(() => this.enqueueMutation(() => this.roulette(socket, ack))); });
    socket.on('caracol:boomerang', (payload, ack) => { void this.afterReady(() => this.enqueueMutation(() => this.boomerang(socket, payload, ack))); });
    socket.on('caracol:visibility', (payload) => { void this.afterReady(() => this.setVisibility(socket, payload)); });
    socket.on('caracol:push-subscribe', (payload, ack) => { void this.afterReady(() => this.subscribePush(socket, payload, ack)); });
    socket.on('caracol:push-unsubscribe', (payload, ack) => { void this.afterReady(() => this.unsubscribePush(socket, payload, ack)); });
    socket.on('caracol:history', (payload, ack) => { void this.afterReady(() => this.history(socket, payload, ack)); });
    socket.on('caracol:logout', () => { void this.afterReady(() => this.logout(socket)); });
    socket.on('disconnect', () => { void this.afterReady(() => this.disconnect(socket)); });
  }

  dispose(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
    void this.store.close();
  }

  getOnlineCount(): number {
    return Array.from(this.accounts.values()).filter((account) => account.sockets.size > 0).length;
  }

  /** Deterministic hook used by integration tests; production uses the timer. */
  async tickOnce(): Promise<void> {
    await this.readyPromise;
    await this.tickInternal(this.clock(), true);
  }

  private async afterReady(work: () => Promise<void>): Promise<void> {
    try {
      await this.readyPromise;
      await work();
    } catch (error) {
      console.error('[caracol] operação falhou', error);
    }
  }

  private async register(socket: CaracolSocket, payload: CaracolRegisterInput, ack: (result: CaracolActionResult) => void): Promise<void> {
    const nickname = this.cleanNickname(payload?.nickname);
    const password = typeof payload?.password === 'string' ? payload.password : '';
    const validation = this.validateCredentials(nickname, password);
    if (validation) {
      ack(this.failure('INVALID_CREDENTIALS', validation));
      return;
    }
    const normalizedNickname = normalizeText(nickname);
    if (Array.from(this.accounts.values()).some((account) => account.normalizedNickname === normalizedNickname)) {
      ack(this.failure('NICKNAME_TAKEN', 'Esse nick já está sendo usado.'));
      return;
    }

    const now = this.clock();
    try {
      const account = await this.store.createAccount({
        nickname,
        normalizedNickname,
        passwordHash: await hash(password, 12),
        coins: CARACOL_STARTING_COINS,
        alive: true,
        cityId: null,
        cityName: null,
        cityUf: null,
        cityLat: null,
        cityLon: null,
        speedDiscountLevel: 0,
        cosmeticOwnedItemIds: [],
        cosmeticOutfit: emptyCaracolOutfit(),
        lastCoinAccruedAt: now,
        lastRouletteAt: null,
        lastRouletteItemId: null,
      });
      const runtime = this.addRuntimeAccount(account);
      await this.attachSocket(socket, runtime, now);
      await this.recordHistory({
        type: 'account',
        message: `${runtime.nickname} entrou no jogo com ${CARACOL_STARTING_COINS} moedas.`,
        actorNickname: runtime.nickname,
        targetNickname: null,
        amount: CARACOL_STARTING_COINS,
        createdAt: now,
      });
      await this.ensureTarget();
      const sessionToken = this.issueSession(socket, runtime);
      ack({ ok: true, accountId: runtime.id, nickname: runtime.nickname, sessionToken, state: this.stateFor(runtime) });
      this.broadcastState();
    } catch (error) {
      ack(error instanceof CaracolNicknameTakenError ? this.failure('NICKNAME_TAKEN', error.message) : this.failure('REGISTER_FAILED', 'Não consegui criar sua conta agora.'));
    }
  }

  private async login(socket: CaracolSocket, payload: CaracolLoginInput, ack: (result: CaracolActionResult) => void): Promise<void> {
    const nickname = this.cleanNickname(payload?.nickname);
    const password = typeof payload?.password === 'string' ? payload.password : '';
    if (!nickname || !password) {
      ack(this.failure('INVALID_CREDENTIALS', 'Digite seu nick e sua senha.'));
      return;
    }
    const account = Array.from(this.accounts.values()).find((candidate) => candidate.normalizedNickname === normalizeText(nickname));
    if (!account || !(await compare(password, account.passwordHash))) {
      ack(this.failure('INVALID_LOGIN', 'Nick ou senha incorretos. Não há recuperação de senha.'));
      return;
    }
    const now = this.clock();
    await this.attachSocket(socket, account, now);
    await this.ensureTarget();
    const sessionToken = this.issueSession(socket, account);
    ack({ ok: true, accountId: account.id, nickname: account.nickname, sessionToken, state: this.stateFor(account) });
    this.broadcastState();
  }

  private async resume(socket: CaracolSocket, payload: CaracolResumeInput, ack: (result: CaracolActionResult) => void): Promise<void> {
    const sessionToken = typeof payload?.sessionToken === 'string' ? payload.sessionToken.trim() : '';
    const tokenHash = this.hashSessionToken(sessionToken);
    const accountId = tokenHash ? this.sessions.get(tokenHash) : undefined;
    const account = accountId ? this.accounts.get(accountId) : undefined;
    if (!account) {
      ack(this.failure('SESSION_EXPIRED', 'Sua sessão do Caracol expirou. Entre novamente com seu nick e sua senha.'));
      return;
    }
    const now = this.clock();
    await this.attachSocket(socket, account, now);
    socket.data.caracolSessionTokenHash = tokenHash;
    await this.ensureTarget();
    ack({ ok: true, accountId: account.id, nickname: account.nickname, sessionToken, state: this.stateFor(account) });
    this.broadcastState();
  }

  private async sync(socket: CaracolSocket, ack: (result: CaracolActionResult) => void): Promise<void> {
    const account = this.authenticatedAccount(socket, ack);
    if (!account) return;
    await this.settleCoins(account);
    const targetChanged = await this.ensureTarget();
    if (targetChanged) await this.store.saveWorld(this.world);
    ack({ ok: true, state: this.stateFor(account) });
  }

  private async history(socket: CaracolSocket, payload: CaracolHistoryInput, ack: (result: CaracolHistoryResult) => void): Promise<void> {
    if (!this.authenticatedAccount(socket)) {
      ack(this.failure('NOT_AUTHENTICATED', 'Entre no Caracol com seu nick e sua senha.'));
      return;
    }
    const requestedLimit = Number(payload?.limit ?? CARACOL_HISTORY_PAGE_SIZE);
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(CARACOL_HISTORY_PAGE_SIZE, Math.floor(requestedLimit)))
      : CARACOL_HISTORY_PAGE_SIZE;
    const page = await this.store.listHistory({
      beforeId: typeof payload?.beforeId === 'string' ? payload.beforeId : null,
      limit,
    });
    ack({ ok: true, ...page });
  }

  private async selectCity(socket: CaracolSocket, payload: CaracolSelectCityInput, ack: (result: CaracolActionResult) => void): Promise<void> {
    const account = this.authenticatedAccount(socket, ack);
    if (!account) return;
    const moving = account.alive && account.cityId !== null;
    // Quem se muda vivo continua ganhando moedas: liquida o pendente em vez de
    // zerar o relógio de moedas, que é o que acontece ao voltar da morte.
    if (moving) await this.settleCoins(account);
    const mushroom = moving ? this.activeEffect(account.id, 'mushroom') : null;
    if (moving && !mushroom) {
      ack(this.failure('CITY_LOCKED', 'Sua cidade fica travada enquanto você estiver vivo.'));
      return;
    }
    const city = cityById.get(String(payload?.cityId ?? ''));
    if (!city) {
      ack(this.failure('CITY_NOT_FOUND', 'Escolha uma cidade válida do mapa.'));
      return;
    }
    const now = this.clock();
    const plan: CommitPlan = {
      accounts: [[account, (target) => {
        if (!mushroom) {
          target.alive = true;
          target.lastCoinAccruedAt = now;
        }
        this.setAccountCity(target, city);
      }]],
    };
    if (mushroom) this.spendCharge(mushroom, plan);
    if (!(await this.commitPlan(plan, ack))) return;
    // Quem se muda vivo continua sendo o alvo, então o alvo não "muda" e nada
    // limpa a flag sozinho: sem isto, o aviso da cidade nova nunca sairia.
    if (mushroom) this.approachingSent.delete(account.id);
    await this.recordHistory({
      type: 'city',
      message: mushroom
        ? `${account.nickname} usou o Cogumelo e se mudou para ${city.name} (${city.uf}).`
        : `${account.nickname} escolheu ${city.name} (${city.uf}) para morar.`,
      actorNickname: account.nickname,
      targetNickname: null,
      amount: null,
      createdAt: this.clock(),
    });
    await this.ensureTarget();
    await this.store.saveWorld(this.world);
    ack({ ok: true, state: this.stateFor(account) });
    this.broadcastState();
  }

  private async redirect(socket: CaracolSocket, payload: CaracolRedirectInput, ack: (result: CaracolActionResult) => void): Promise<void> {
    const account = this.authenticatedAccount(socket, ack);
    if (!account) return;
    if (!account.alive || !account.cityId) {
      ack(this.failure('NEEDS_CITY', 'Escolha sua cidade antes de agir.'));
      return;
    }
    if (this.rejectFrozen(account, ack)) return;
    await this.settleCoins(account);
    const target = this.livingOpponent(account, payload?.targetNickname);
    if (!target) {
      ack(this.failure('TARGET_NOT_FOUND', 'Esse nick não está vivo no mapa.'));
      return;
    }
    const now = this.clock();
    if (this.activeEffect(target.id, 'star', now)) {
      ack(this.failure('TARGET_PROTECTED', `${target.nickname} está com a Super Star. O caracol não consegue escolher essa pessoa.`));
      return;
    }
    const locked = this.lockedTarget(now);
    if (locked && locked.id !== target.id) {
      ack(this.failure('TARGET_LOCKED', `O Casco vermelho de ${locked.nickname} prende o caracol. Ninguém tira o foco dele agora.`));
      return;
    }
    const fireFlower = this.activeEffect(account.id, 'fire-flower', now);
    const cost = fireFlower ? 0 : this.redirectCost(account);
    if (account.coins < cost) {
      ack(this.failure('INSUFFICIENT_COINS', `Você precisa de ${cost} moedas para redirecionar o caracol.`));
      return;
    }
    const plan: CommitPlan = { accounts: [[account, (payer) => { payer.coins = Math.max(0, payer.coins - cost); }]] };
    if (fireFlower) this.spendCharge(fireFlower, plan);
    const shield = this.activeEffect(target.id, 'shield', now);
    if (shield) {
      await this.absorbAttack(account, target, shield, plan, ack, {
        type: 'redirect',
        message: `${account.nickname} tentou mandar o caracol atrás de ${target.nickname}, mas bateu no Casco defensivo${cost > 0 ? ` e perdeu ${cost} moedas` : ''}.`,
        actorNickname: account.nickname,
        targetNickname: target.nickname,
        amount: cost,
        createdAt: now,
      });
      return;
    }
    plan.world = (world) => {
      world.targetAccountId = target.id;
      // A Flor de Fogo redireciona sem encarecer o próximo redirecionamento do mundo.
      if (!fireFlower) world.redirectLevel += 1;
    };
    if (!(await this.commitPlan(plan, ack))) return;
    this.approachingSent.clear();
    await this.recordHistory({
      type: 'redirect',
      message: fireFlower
        ? `${account.nickname} mandou o caracol atrás de ${target.nickname} com a Flor de Fogo, sem pagar nada.`
        : `${account.nickname} mandou o caracol atrás de ${target.nickname} por ${cost} moedas.`,
      actorNickname: account.nickname,
      targetNickname: target.nickname,
      amount: cost,
      createdAt: this.clock(),
    });
    this.ioNotice('redirected', `O caracol mudou de ideia: agora vai atrás de ${target.nickname}.`);
    this.notify(target, 'targeted', `O caracol está indo atrás de você. Alguém pagou para mudar o alvo para ${target.nickname}.`);
    ack({ ok: true, state: this.stateFor(account) });
    this.broadcastState();
  }

  private async buySpeed(socket: CaracolSocket, ack: (result: CaracolActionResult) => void): Promise<void> {
    const account = this.authenticatedAccount(socket, ack);
    if (!account) return;
    if (!account.alive || !account.cityId) {
      ack(this.failure('NEEDS_CITY', 'Escolha sua cidade antes de agir.'));
      return;
    }
    if (this.rejectFrozen(account, ack)) return;
    await this.settleCoins(account);
    const nextLevel = this.world.speedLevel + 1;
    const cost = this.speedCost(account);
    if (account.coins < cost) {
      ack(this.failure('INSUFFICIENT_COINS', `Você precisa de ${cost} moedas para levar o caracol a ${nextLevel * 100} km/h.`));
      return;
    }
    const committed = await this.commitPlan({
      accounts: [[account, (payer) => { payer.coins = Math.max(0, payer.coins - cost); }]],
      world: (world) => { world.speedLevel = nextLevel; },
    }, ack);
    if (!committed) return;
    await this.recordHistory({
      type: 'speed',
      message: `${account.nickname} acelerou o caracol para ${nextLevel * 100} km/h por ${cost} moedas${account.speedDiscountLevel > 0 ? `, com desconto nível ${account.speedDiscountLevel}` : ''}.`,
      actorNickname: account.nickname,
      targetNickname: null,
      amount: cost,
      createdAt: this.clock(),
    });
    this.ioNotice('speed', `${account.nickname} pagou para o caracol correr a ${nextLevel * 100} km/h.`);
    ack({ ok: true, state: this.stateFor(account) });
    this.broadcastState();
  }

  private async buyDiscount(socket: CaracolSocket, ack: (result: CaracolActionResult) => void): Promise<void> {
    const account = this.authenticatedAccount(socket, ack);
    if (!account) return;
    if (this.rejectFrozen(account, ack)) return;
    await this.settleCoins(account);
    const nextLevel = account.speedDiscountLevel + 1;
    const cost = this.discountCost(account);
    if (cost === null) {
      ack(this.failure('MAX_DISCOUNT', 'Seu desconto do caracol já está no máximo.'));
      return;
    }
    if (account.coins < cost) {
      ack(this.failure('INSUFFICIENT_COINS', `Você precisa de ${cost} moedas para melhorar seu desconto.`));
      return;
    }
    const committed = await this.commitPlan({
      accounts: [[account, (payer) => {
        payer.coins = Math.max(0, payer.coins - cost);
        payer.speedDiscountLevel = nextLevel;
      }]],
    }, ack);
    if (!committed) return;
    await this.recordHistory({
      type: 'discount',
      message: `${account.nickname} comprou o desconto do caracol nível ${nextLevel} por ${cost} moedas.`,
      actorNickname: account.nickname,
      targetNickname: null,
      amount: cost,
      createdAt: this.clock(),
    });
    this.ioNotice('discount', `${account.nickname} melhorou o próprio desconto do caracol.`);
    ack({ ok: true, state: this.stateFor(account) });
    this.broadcastState();
  }

  private enqueueMutation(work: () => Promise<void>): Promise<void> {
    const next = this.mutationQueue.then(work, work);
    this.mutationQueue = next.catch(() => undefined);
    return next;
  }

  private async shopPurchase(socket: CaracolSocket, payload: CaracolShopPurchaseInput, ack: (result: CaracolActionResult) => void): Promise<void> {
    const account = this.authenticatedAccount(socket, ack);
    if (!account) return;
    if (this.rejectFrozen(account, ack)) return;
    const wearer = this.validCosmeticWearer(payload?.wearer);
    const item = this.cosmeticItem(payload?.itemId);
    if (!wearer || !item) {
      ack(this.failure('INVALID_COSMETIC', 'Essa peça não existe na loja.'));
      return;
    }

    await this.settleCoins(account);
    const ownedItemIds = wearer === 'player' ? account.cosmeticOwnedItemIds : this.world.snailCosmeticOwnedItemIds;
    if (ownedItemIds.includes(item.id)) {
      ack(this.failure('COSMETIC_ALREADY_OWNED', 'Essa peça já está no guarda-roupa.'));
      return;
    }
    const price = this.shopPrice(account, item);
    if (account.coins < price) {
      ack(this.failure('INSUFFICIENT_COINS', `Você precisa de ${price} moedas para comprar ${item.name}.`));
      return;
    }

    const plan: CommitPlan = {
      accounts: [[account, (payer) => {
        payer.coins = Math.max(0, payer.coins - price);
        if (wearer !== 'player') return;
        payer.cosmeticOwnedItemIds.push(item.id);
        payer.cosmeticOutfit[item.slot] = item.id;
      }]],
    };
    if (wearer === 'snail') {
      plan.world = (world) => {
        world.snailCosmeticOwnedItemIds.push(item.id);
        world.snailCosmeticOutfit[item.slot] = item.id;
      };
    }
    if (!(await this.commitPlan(plan, ack))) return;
    await this.recordHistory({
      type: 'shop',
      message: `${account.nickname} comprou ${item.name} para ${wearer === 'player' ? 'si' : 'o caracol'} por ${price} moedas.`,
      actorNickname: account.nickname,
      targetNickname: wearer === 'snail' ? 'Caracol' : null,
      amount: price,
      createdAt: this.clock(),
    });
    this.ioNotice('shop', `${account.nickname} vestiu ${wearer === 'player' ? 'o próprio personagem' : 'o caracol'} com ${item.name}.`);
    ack({ ok: true, state: this.stateFor(account) });
    this.broadcastState();
  }

  private async shopEquip(socket: CaracolSocket, payload: CaracolShopEquipInput, ack: (result: CaracolActionResult) => void): Promise<void> {
    const account = this.authenticatedAccount(socket, ack);
    if (!account) return;
    const wearer = this.validCosmeticWearer(payload?.wearer);
    const slot = this.validCosmeticSlot(payload?.slot);
    if (!wearer || !slot) {
      ack(this.failure('INVALID_COSMETIC', 'Essa categoria não existe na loja.'));
      return;
    }

    const itemId = payload?.itemId;
    if (itemId !== null) {
      const item = this.cosmeticItem(itemId);
      const ownedItemIds = wearer === 'player' ? account.cosmeticOwnedItemIds : this.world.snailCosmeticOwnedItemIds;
      if (!item || item.slot !== slot || !ownedItemIds.includes(item.id)) {
        ack(this.failure('COSMETIC_NOT_OWNED', 'Compre essa peça antes de equipá-la.'));
        return;
      }
    }

    const plan: CommitPlan = wearer === 'player'
      ? { accounts: [[account, (owner) => { owner.cosmeticOutfit[slot] = itemId; }]] }
      : { world: (world) => { world.snailCosmeticOutfit[slot] = itemId; } };
    if (!(await this.commitPlan(plan, ack))) return;
    ack({ ok: true, state: this.stateFor(account) });
    this.broadcastState();
  }

  private async roulette(socket: CaracolSocket, ack: (result: CaracolRouletteResult) => void): Promise<void> {
    const account = this.authenticatedAccount(socket, ack);
    if (!account) return;
    if (!account.alive || !account.cityId) {
      ack(this.failure('NEEDS_CITY', 'Escolha sua cidade antes de girar a roleta. Quem está morto não gira.'));
      return;
    }
    const now = this.clock();
    const availableAt = this.rouletteAvailableAt(account, now);
    if (availableAt !== null) {
      ack(this.failure('ROULETTE_COOLDOWN', `A roleta volta em ${this.formatEta(availableAt - now)}.`));
      return;
    }

    // A memória só muda depois que o banco confirmou: se a gravação falhar, o
    // jogador não vê um item que sumiria no próximo reinício e o giro continua
    // disponível.
    const failed = this.failure('ROULETTE_FAILED', 'Não consegui girar a roleta agora. Seu giro continua disponível.');
    try {
      await this.settleCoins(account);
    } catch (error) {
      console.error('[caracol] giro da roleta falhou', error);
      ack(failed);
      return;
    }
    const item = this.drawRouletteItem();
    const outcome = this.rouletteOutcome(account, item, now);
    const committed = await this.commitPlan({
      accounts: [[account, (target) => {
        target.lastRouletteAt = now;
        target.lastRouletteItemId = item.id;
        outcome.apply(target);
      }]],
      upsertEffects: outcome.effect ? [outcome.effect] : [],
    }, ack, failed);
    if (!committed) return;
    // O Bullet Bill muda a cidade sem mudar o alvo: o aviso de aproximação
    // precisa valer de novo para a cidade nova.
    if (item.id === 'bullet-bill') this.approachingSent.delete(account.id);

    try {
      await this.recordHistory({
        type: 'roulette',
        message: `${account.nickname} girou a roleta e tirou ${item.name}${outcome.detail}.`,
        actorNickname: account.nickname,
        targetNickname: null,
        amount: outcome.amount,
        createdAt: now,
      });
      // Super Star no alvo atual e Casco vermelho trocam o alvo antes do ack.
      await this.ensureTarget();
      await this.store.saveWorld(this.world);
    } catch (error) {
      console.error('[caracol] giro gravado, mas o pós-giro falhou', error);
    }
    this.ioNotice('roulette', `${account.nickname} girou a roleta e tirou ${item.name}.`);
    ack({ ok: true, itemId: item.id, category: item.category, state: this.stateFor(account) });
    this.broadcastState();
  }

  private async boomerang(socket: CaracolSocket, payload: CaracolBoomerangInput, ack: (result: CaracolActionResult) => void): Promise<void> {
    const account = this.authenticatedAccount(socket, ack);
    if (!account) return;
    if (!account.alive || !account.cityId) {
      ack(this.failure('NEEDS_CITY', 'Escolha sua cidade antes de agir.'));
      return;
    }
    if (this.rejectFrozen(account, ack)) return;
    const now = this.clock();
    const charge = this.activeEffect(account.id, 'boomerang', now);
    if (!charge) {
      ack(this.failure('NO_CHARGE', 'Você não tem Bumerangue para lançar.'));
      return;
    }
    const target = this.livingOpponent(account, payload?.targetNickname);
    if (!target) {
      ack(this.failure('TARGET_NOT_FOUND', 'Esse nick não está vivo no mapa.'));
      return;
    }
    // Saldo só muda sobre número atualizado: paga o pendente dos dois antes.
    await this.settleCoins(account);
    await this.settleCoins(target);
    const plan: CommitPlan = {};
    this.spendCharge(charge, plan);
    const shield = this.activeEffect(target.id, 'shield', now);
    if (shield) {
      await this.absorbAttack(account, target, shield, plan, ack, {
        type: 'roulette',
        message: `${account.nickname} lançou o Bumerangue em ${target.nickname}, mas ele bateu no Casco defensivo.`,
        actorNickname: account.nickname,
        targetNickname: target.nickname,
        amount: 0,
        createdAt: now,
      });
      return;
    }
    // floor(saldo × 0,2) em aritmética inteira, sem erro de ponto flutuante.
    const amount = Math.floor(target.coins / BOOMERANG_SHARE_DIVISOR);
    plan.accounts = [
      [target, (victim) => { victim.coins = Math.max(0, victim.coins - amount); }],
      [account, (thrower) => { thrower.coins += amount; }],
    ];
    if (!(await this.commitPlan(plan, ack))) return;
    await this.recordHistory({
      type: 'roulette',
      message: `${account.nickname} lançou o Bumerangue em ${target.nickname} e trouxe ${amount} moeda${amount === 1 ? '' : 's'}.`,
      actorNickname: account.nickname,
      targetNickname: target.nickname,
      amount,
      createdAt: now,
    });
    this.noticeAccount(target, 'boomerang', `${account.nickname} acertou você com o Bumerangue e levou ${amount} moeda${amount === 1 ? '' : 's'}.`);
    ack({ ok: true, state: this.stateFor(account) });
    this.broadcastState();
  }

  /**
   * O escudo absorve o ataque: o atacante já pagou (ou gastou a carga), o
   * escudo se gasta e nada mais acontece. A resposta é sucesso porque a ação
   * aconteceu e foi cobrada; o aviso `shield` conta aos dois o que houve.
   */
  private async absorbAttack(
    attacker: RuntimeAccount,
    target: RuntimeAccount,
    shield: CaracolEffectRecord,
    plan: CommitPlan,
    ack: (result: CaracolActionResult) => void,
    history: Omit<CaracolHistoryRecord, 'id'>,
  ): Promise<void> {
    this.spendCharge(shield, plan);
    if (!(await this.commitPlan(plan, ack))) return;
    await this.recordHistory(history);
    this.noticeAccount(attacker, 'shield', `${target.nickname} tinha um Casco defensivo. Seu ataque foi bloqueado.`);
    this.noticeAccount(target, 'shield', `Seu Casco defensivo bloqueou um ataque de ${attacker.nickname}.`);
    ack({ ok: true, state: this.stateFor(attacker) });
    this.broadcastState();
  }

  /**
   * Grava primeiro e só depois muda a memória, como o giro da roleta: se o
   * banco recusar, memória e banco continuam iguais e o jogador recebe a falha
   * em vez de ficar sem resposta. Quem chama precisa estar na fila de mutações,
   * porque agora existe um `await` entre conferir o saldo e gastar.
   */
  private async commitPlan(
    plan: CommitPlan,
    ack: (result: CaracolActionFailure) => void,
    failure = this.failure('SAVE_FAILED', 'Não consegui gravar sua ação agora. Nada mudou; tente de novo.'),
  ): Promise<boolean> {
    const accounts = plan.accounts ?? [];
    // Clones com arrays e roupas próprios: um `push` no rascunho não vaza para a memória.
    const drafts = accounts.map(([account, change]) => {
      const draft = cloneAccount(account);
      change(draft);
      return draft;
    });
    // A cópia do mundo é de antes do `await`: se o tick gravar o mundo no meio, o
    // banco pode ficar com o caracol um instante atrás. A memória está certa e o
    // tick regrava o mundo a cada segundo; só o que o plano muda precisa bater.
    const world = plan.world ? cloneWorld(this.world) : undefined;
    if (world) plan.world!(world);
    try {
      await this.store.commit({ accounts: drafts, world, upsertEffects: plan.upsertEffects, deleteEffectIds: plan.deleteEffectIds });
    } catch (error) {
      console.error('[caracol] gravação falhou; a memória não mudou', error);
      ack(failure);
      return false;
    }

    for (const [index, [account, change]] of accounts.entries()) {
      change(account);
      // O tick não passa pela fila. Se ele pagou moedas ou matou a conta durante
      // o `await`, o rascunho gravado ficou para trás: grava a memória de novo.
      const draft = drafts[index]!;
      const touched = account.coins !== draft.coins || account.alive !== draft.alive
        || account.lastCoinAccruedAt !== draft.lastCoinAccruedAt || account.speedDiscountLevel !== draft.speedDiscountLevel;
      if (touched) await this.store.saveAccount(account).catch((error: unknown) => console.error('[caracol] conta não regravada depois do tick', error));
    }
    plan.world?.(this.world);
    for (const effect of plan.upsertEffects ?? []) this.effects.set(effect.id, { ...effect });
    for (const effectId of plan.deleteEffectIds ?? []) this.effects.delete(effectId);
    return true;
  }

  private drawRouletteItem(): CaracolRouletteItem {
    // Dois passos: a categoria primeiro garante 50/50 com listas de tamanhos diferentes.
    const category = this.random() < 0.5 ? 'buff' : 'debuff';
    const pool = CARACOL_ROULETTE_CATALOG.filter((item) => item.category === category);
    const index = Math.max(0, Math.min(pool.length - 1, Math.floor(this.random() * pool.length)));
    return pool[index]!;
  }

  private rouletteOutcome(account: RuntimeAccount, item: CaracolRouletteItem, now: number): RouletteOutcome {
    const effect: CaracolEffectRecord | null = item.durationMs === null ? null : {
      id: caracolEffectId(item.scope, item.scope === 'world' ? null : account.id, item.id),
      scope: item.scope,
      accountId: item.scope === 'world' ? null : account.id,
      itemId: item.id,
      createdAt: now,
      expiresAt: now + item.durationMs,
      charges: item.charges,
    };
    if (item.id === 'bomb') {
      const lost = account.coins - Math.floor(account.coins / 2);
      return {
        effect,
        // Delta sobre o saldo liquidado: banco, memória e o "perdeu X" do histórico batem.
        apply: (target) => { target.coins = Math.max(0, target.coins - lost); },
        detail: `: perdeu ${lost} moeda${lost === 1 ? '' : 's'}`,
        amount: lost,
      };
    }
    if (item.id === 'bullet-bill') {
      const city = this.farthestCityFromSnail();
      return {
        effect,
        apply: (target) => this.setAccountCity(target, city),
        detail: ` e foi lançado para ${city.name} (${city.uf})`,
        amount: null,
      };
    }
    return { effect, apply: () => undefined, detail: '', amount: null };
  }

  /** A cidade do catálogo mais distante da posição atual do caracol; empate pelo menor código. */
  private farthestCityFromSnail(): BrazilianCity {
    const snail: GeoPoint = { lat: this.world.snailLat, lon: this.world.snailLon };
    let farthest: BrazilianCity | null = null;
    let farthestKm = -1;
    for (const city of cityById.values()) {
      const km = distanceKm(snail, city);
      if (km > farthestKm || (km === farthestKm && farthest && Number(city.id) < Number(farthest.id))) {
        farthest = city;
        farthestKm = km;
      }
    }
    return farthest!;
  }

  private rouletteAvailableAt(account: CaracolAccountRecord, now: number): number | null {
    if (account.lastRouletteAt === null) return null;
    const availableAt = account.lastRouletteAt + CARACOL_ROULETTE_COOLDOWN_MS;
    return now < availableAt ? availableAt : null;
  }

  /** Efeito vigente pelo relógio: vencido conta como inexistente mesmo antes do tick removê-lo. */
  private activeEffect(accountId: string | null, itemId: CaracolRouletteItemId, now = this.clock()): CaracolEffectRecord | null {
    const scope = caracolRouletteItemById.get(itemId)?.scope ?? 'account';
    const effect = this.effects.get(caracolEffectId(scope, scope === 'world' ? null : accountId, itemId));
    if (!effect || now >= effect.expiresAt) return null;
    if (effect.charges !== null && effect.charges <= 0) return null;
    return effect;
  }

  private activeEffectsOf(accountId: string | null, now: number): CaracolEffectRecord[] {
    const scope = accountId === null ? 'world' : 'account';
    return CARACOL_ROULETTE_CATALOG
      .filter((item) => item.scope === scope)
      .map((item) => this.activeEffect(accountId, item.id, now))
      .filter((effect): effect is CaracolEffectRecord => effect !== null);
  }

  private effectView(effect: CaracolEffectRecord): CaracolEffectView {
    return { itemId: effect.itemId, expiresAt: effect.expiresAt, charges: effect.charges };
  }

  /** Anota no plano o gasto de uma carga; a última carga remove o efeito. A memória só muda no commit. */
  private spendCharge(effect: CaracolEffectRecord, plan: CommitPlan): void {
    const remaining = (effect.charges ?? 1) - 1;
    if (remaining <= 0) {
      plan.deleteEffectIds = [...(plan.deleteEffectIds ?? []), effect.id];
      return;
    }
    plan.upsertEffects = [...(plan.upsertEffects ?? []), { ...effect, charges: remaining }];
  }

  /** O Congelamento trava tudo que gasta ou ataca; vestir e escolher cidade seguem livres. */
  private rejectFrozen(account: RuntimeAccount, ack: (result: CaracolActionFailure) => void): boolean {
    const now = this.clock();
    const freeze = this.activeEffect(account.id, 'freeze', now);
    if (!freeze) return false;
    ack(this.failure('FROZEN', `Você está congelado por mais ${this.formatEta(freeze.expiresAt - now)}. Nada de comprar, acelerar, redirecionar ou lançar bumerangue.`));
    return true;
  }

  private livingOpponent(account: RuntimeAccount, nickname: unknown): RuntimeAccount | undefined {
    const normalized = normalizeText(this.cleanNickname(nickname));
    return Array.from(this.accounts.values()).find((candidate) => candidate.normalizedNickname === normalized && candidate.alive && candidate.cityId && candidate.id !== account.id);
  }

  private async setVisibility(socket: CaracolSocket, payload: CaracolVisibilityInput): Promise<void> {
    const account = this.authenticatedAccount(socket);
    if (!account) return;
    if (payload?.visible) account.visibleSockets.add(socket.id);
    else account.visibleSockets.delete(socket.id);
  }

  private async subscribePush(socket: CaracolSocket, payload: CaracolPushSubscriptionInput, ack: (result: CaracolActionResult) => void): Promise<void> {
    const account = this.authenticatedAccount(socket, ack);
    if (!account) return;
    if (!payload || typeof payload.endpoint !== 'string' || !payload.endpoint.startsWith('https://') || payload.endpoint.length > 2048 || !payload.keys?.p256dh || !payload.keys?.auth) {
      ack(this.failure('INVALID_PUSH_SUBSCRIPTION', 'A inscrição de notificação não é válida.'));
      return;
    }
    const subscription: CaracolPushRecord = {
      accountId: account.id,
      endpoint: payload.endpoint,
      p256dh: String(payload.keys.p256dh),
      auth: String(payload.keys.auth),
      expirationTime: payload.expirationTime ?? null,
      updatedAt: this.clock(),
    };
    this.pushSubscriptions.set(subscription.endpoint, subscription);
    await this.store.upsertPushSubscription(subscription);
    ack({ ok: true, state: this.stateFor(account) });
  }

  private async unsubscribePush(socket: CaracolSocket, payload: { endpoint: string }, ack: (result: CaracolActionResult) => void): Promise<void> {
    const account = this.authenticatedAccount(socket, ack);
    if (!account) return;
    const current = this.pushSubscriptions.get(payload?.endpoint);
    if (current?.accountId === account.id) await this.removePushSubscription(payload.endpoint);
    ack({ ok: true, state: this.stateFor(account) });
  }

  private async logout(socket: CaracolSocket): Promise<void> {
    this.revokeSession(socket);
    await this.detachSocket(socket);
    this.broadcastState();
  }

  private async disconnect(socket: CaracolSocket): Promise<void> {
    await this.detachSocket(socket);
    this.sockets.delete(socket.id);
    this.broadcastState();
  }

  private async attachSocket(socket: CaracolSocket, account: RuntimeAccount, now: number): Promise<void> {
    if (socket.data.caracolAccountId && socket.data.caracolAccountId !== account.id) await this.detachSocket(socket, false);
    const wasOnline = account.sockets.size > 0;
    const gainedIntervals = this.accrueCoins(account, now, wasOnline);
    if (gainedIntervals) await this.store.saveAccount(account);
    account.sockets.add(socket.id);
    account.visibleSockets.add(socket.id);
    socket.data.caracolAccountId = account.id;
  }

  private issueSession(socket: CaracolSocket, account: RuntimeAccount): string {
    this.revokeSession(socket);
    const sessionToken = randomBytes(32).toString('base64url');
    const tokenHash = this.hashSessionToken(sessionToken);
    this.sessions.set(tokenHash, account.id);
    socket.data.caracolSessionTokenHash = tokenHash;
    return sessionToken;
  }

  private revokeSession(socket: CaracolSocket): void {
    const tokenHash = socket.data.caracolSessionTokenHash;
    if (tokenHash) this.sessions.delete(tokenHash);
    delete socket.data.caracolSessionTokenHash;
  }

  private hashSessionToken(sessionToken: string): string {
    if (sessionToken.length < 32 || sessionToken.length > 256) return '';
    return createHash('sha256').update(sessionToken).digest('hex');
  }

  private async detachSocket(socket: CaracolSocket, persist = true): Promise<void> {
    const accountId = socket.data.caracolAccountId;
    if (!accountId) return;
    const account = this.accounts.get(accountId);
    if (!account) {
      delete socket.data.caracolAccountId;
      return;
    }
    const gainedIntervals = this.accrueCoins(account, this.clock(), true);
    account.sockets.delete(socket.id);
    account.visibleSockets.delete(socket.id);
    delete socket.data.caracolAccountId;
    if (persist && gainedIntervals) await this.store.saveAccount(account);
  }

  private authenticatedAccount(socket: CaracolSocket, ack?: (result: CaracolActionFailure) => void): RuntimeAccount | null {
    const accountId = socket.data.caracolAccountId;
    const account = accountId ? this.accounts.get(accountId) : undefined;
    if (account) return account;
    if (ack) ack(this.failure('NOT_AUTHENTICATED', 'Entre no Caracol com seu nick e sua senha.'));
    return null;
  }

  private addRuntimeAccount(account: CaracolAccountRecord): RuntimeAccount {
    const runtime: RuntimeAccount = { ...account, sockets: new Set(), visibleSockets: new Set() };
    this.accounts.set(runtime.id, runtime);
    return runtime;
  }

  private cleanNickname(value: unknown): string {
    return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, MAX_NICKNAME_LENGTH) : '';
  }

  private validateCredentials(nickname: string, password: string): string | null {
    if (nickname.length < MIN_NICKNAME_LENGTH || nickname.length > MAX_NICKNAME_LENGTH || !normalizeText(nickname)) return 'Use um nick entre 2 e 24 caracteres.';
    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) return 'Use uma senha entre 8 e 72 caracteres.';
    return null;
  }

  private setAccountCity(account: CaracolAccountRecord, city: BrazilianCity): void {
    account.cityId = city.id;
    account.cityName = city.name;
    account.cityUf = city.uf;
    account.cityLat = city.lat;
    account.cityLon = city.lon;
  }

  private validCosmeticWearer(value: unknown): CaracolCosmeticWearer | null {
    return value === 'player' || value === 'snail' ? value : null;
  }

  private validCosmeticSlot(value: unknown): CaracolCosmeticSlot | null {
    return value === 'pants' || value === 'shirt' || value === 'watch' || value === 'glasses' || value === 'cap' ? value : null;
  }

  private cosmeticItem(value: unknown) {
    return typeof value === 'string' ? CARACOL_COSMETIC_CATALOG.find((item) => item.id === value) ?? null : null;
  }

  private cityFor(account: CaracolAccountRecord): CaracolCity | null {
    if (!account.cityId || account.cityName === null || account.cityUf === null || account.cityLat === null || account.cityLon === null) return null;
    return { id: account.cityId, name: account.cityName, uf: account.cityUf, lat: account.cityLat, lon: account.cityLon };
  }

  /** Velocidade global exibida; nenhum efeito mexe nela. */
  private speedKmh(): number {
    return this.world.speedLevel === 0 ? CARACOL_BASE_SPEED_KMH : this.world.speedLevel * 100;
  }

  /** Velocidade real da perseguição: a Banana acelera só contra o próprio dono. */
  private chaseSpeedKmh(target: RuntimeAccount | undefined, now = this.clock()): number {
    return this.speedKmh() * (target && this.activeEffect(target.id, 'banana', now) ? BANANA_SPEED_FACTOR : 1);
  }

  /**
   * Fórmula única de preço: max(piso, floor(base × 0,75^desconto × fatores)).
   * A tela e a cobrança leem daqui, então nunca discordam. O desconto pessoal
   * só entra onde já entrava (redirect e aceleração); Moeda e Raio entram em tudo.
   */
  private price(account: CaracolAccountRecord, baseCost: number, minimum: number, withDiscount: boolean): number {
    const now = this.clock();
    const factor = (this.activeEffect(account.id, 'coin', now) ? 0.5 : 1) * (this.activeEffect(null, 'lightning', now) ? 2 : 1);
    const discount = withDiscount ? 0.75 ** account.speedDiscountLevel : 1;
    return Math.max(minimum, Math.floor(baseCost * discount * factor));
  }

  private redirectCost(account: CaracolAccountRecord): number {
    return this.price(account, CARACOL_REDIRECT_COST * 2 ** this.world.redirectLevel, 4, true);
  }

  private speedCost(account: CaracolAccountRecord): number {
    return this.price(account, 50 * (this.world.speedLevel + 1) ** 2, 1, true);
  }

  private discountCost(account: CaracolAccountRecord): number | null {
    const baseCost = CARACOL_DISCOUNT_COSTS[account.speedDiscountLevel];
    return baseCost === undefined ? null : this.price(account, baseCost, 1, false);
  }

  private shopPrice(account: CaracolAccountRecord, item: CaracolCosmeticItem): number {
    return this.price(account, item.price, 1, false);
  }

  /** Pode ser perseguido: vivo, com cidade e sem Super Star. */
  private isChaseable(account: RuntimeAccount | undefined, now: number): account is RuntimeAccount {
    return Boolean(account?.alive && account.cityId && account.cityLat !== null && account.cityLon !== null && !this.activeEffect(account.id, 'star', now));
  }

  /**
   * Casco vermelho vigente: a trava mais nova de alguém que ainda pode ser
   * perseguido. A Star do dono vence a trava, e dono morto não trava nada.
   */
  private lockedTarget(now: number): RuntimeAccount | null {
    let locked: { account: RuntimeAccount; createdAt: number } | null = null;
    for (const effect of this.effects.values()) {
      if (effect.itemId !== 'red-shell' || !effect.accountId || now >= effect.expiresAt) continue;
      const owner = this.accounts.get(effect.accountId);
      if (!this.isChaseable(owner, now)) continue;
      if (!locked || effect.createdAt > locked.createdAt) locked = { account: owner, createdAt: effect.createdAt };
    }
    return locked?.account ?? null;
  }

  private async ensureTarget(): Promise<boolean> {
    const now = this.clock();
    const current = this.world.targetAccountId ? this.accounts.get(this.world.targetAccountId) : undefined;
    const locked = this.lockedTarget(now);
    let next: RuntimeAccount | undefined = locked ?? (this.isChaseable(current, now) ? current : undefined);
    if (!next) {
      const snail: GeoPoint = { lat: this.world.snailLat, lon: this.world.snailLon };
      const candidates = Array.from(this.accounts.values()).filter((account) => this.isChaseable(account, now));
      next = candidates.sort((a, b) => distanceKm(snail, { lat: a.cityLat!, lon: a.cityLon! }) - distanceKm(snail, { lat: b.cityLat!, lon: b.cityLon! }))[0];
    }
    const changed = this.world.targetAccountId !== (next?.id ?? null);
    this.world.targetAccountId = next?.id ?? null;
    if (changed) {
      this.approachingSent.clear();
      if (next) {
        const byLock = next === locked;
        await this.recordHistory({
          type: 'target',
          message: byLock ? `O Casco vermelho puxou o caracol para ${next.nickname}.` : `O caracol escolheu ${next.nickname} como novo alvo.`,
          actorNickname: null,
          targetNickname: next.nickname,
          amount: null,
          createdAt: now,
        });
        this.notify(next, 'targeted', byLock ? 'O Casco vermelho te marcou: o caracol está indo atrás de você.' : `O caracol despertou e está indo atrás de você.`);
      }
    }
    return changed;
  }

  /** Remove do banco e da memória o que venceu e avisa o dono. Nenhum timer desliga efeito. */
  private async expireEffects(now: number): Promise<void> {
    const expired = Array.from(this.effects.values()).filter((effect) => now >= effect.expiresAt);
    if (expired.length === 0) return;
    await this.store.commit({ deleteEffectIds: expired.map((effect) => effect.id) });
    for (const effect of expired) {
      this.effects.delete(effect.id);
      const itemName = caracolRouletteItemById.get(effect.itemId)?.name ?? 'O efeito';
      if (effect.scope === 'world') {
        this.ioNotice('effect-expired', `${itemName} acabou. Os preços voltaram ao normal.`);
        continue;
      }
      const owner = effect.accountId ? this.accounts.get(effect.accountId) : undefined;
      if (owner) this.noticeAccount(owner, 'effect-expired', `${itemName} acabou.`);
    }
  }

  private async runTick(): Promise<void> {
    if (this.tickInFlight) return;
    this.tickInFlight = true;
    try {
      await this.readyPromise;
      await this.tickInternal(this.clock(), true);
    } catch (error) {
      console.error('[caracol] erro no motor global', error);
    } finally {
      this.tickInFlight = false;
    }
  }

  private async tickInternal(now: number, broadcast: boolean): Promise<void> {
    const elapsedMs = Math.max(0, now - this.world.lastTickAt);
    this.world.lastTickAt = now;
    await this.expireEffects(now);
    for (const account of this.accounts.values()) {
      if (account.sockets.size === 0) continue;
      const gainedIntervals = this.accrueCoins(account, now, true);
      if (gainedIntervals) {
        await this.store.saveAccount(account);
      }
    }

    await this.ensureTarget();
    const target = this.world.targetAccountId ? this.accounts.get(this.world.targetAccountId) : undefined;
    if (this.isChaseable(target, now) && elapsedMs > 0) {
      const from: GeoPoint = { lat: this.world.snailLat, lon: this.world.snailLon };
      const to: GeoPoint = { lat: target.cityLat!, lon: target.cityLon! };
      const remainingKm = distanceKm(from, to);
      const travelKm = this.chaseSpeedKmh(target, now) * elapsedMs / 3_600_000;
      if (remainingKm <= travelKm || remainingKm <= 0.001) {
        this.world.snailLat = to.lat;
        this.world.snailLon = to.lon;
        await this.eliminate(target, now);
        await this.ensureTarget();
      } else {
        const next = moveTowards(from, to, travelKm);
        this.world.snailLat = next.lat;
        this.world.snailLon = next.lon;
      }
    }

    await this.maybeApproachPush();
    await this.store.saveWorld(this.world);
    if (broadcast) this.broadcastState();
  }

  private async eliminate(target: RuntimeAccount, now: number): Promise<void> {
    const death: CaracolDeathPayload = {
      nickname: target.nickname,
      message: 'O caracol chegou. Você perdeu suas moedas e precisa escolher uma nova cidade.',
    };
    target.alive = false;
    target.coins = 0;
    target.lastCoinAccruedAt = now;
    target.speedDiscountLevel = 0;
    this.world.speedLevel = 0;
    this.world.redirectLevel = 0;
    this.world.targetAccountId = null;
    this.approachingSent.clear();
    await Promise.all([this.store.saveAccount(target), this.store.saveWorld(this.world)]);
    await this.recordHistory({
      type: 'death',
      message: `${target.nickname} foi alcançado pelo caracol e perdeu as moedas.`,
      actorNickname: target.nickname,
      targetNickname: null,
      amount: 0,
      createdAt: now,
    });
    for (const socketId of target.sockets) this.sockets.get(socketId)?.emit('caracol:death', death);
    this.notify(target, 'death', death.message);
    this.ioNotice('death', `${target.nickname} foi alcançado pelo caracol.`);
  }

  private async maybeApproachPush(): Promise<void> {
    const target = this.world.targetAccountId ? this.accounts.get(this.world.targetAccountId) : undefined;
    if (!target?.alive || target.cityLat === null || target.cityLon === null) return;
    const speed = this.chaseSpeedKmh(target);
    const distance = distanceKm({ lat: this.world.snailLat, lon: this.world.snailLon }, { lat: target.cityLat, lon: target.cityLon });
    const etaMs = distance / speed * 3_600_000;
    if (etaMs <= APPROACHING_ETA_MS && !this.approachingSent.has(target.id)) {
      this.approachingSent.add(target.id);
      await this.recordHistory({
        type: 'approaching',
        message: `O caracol ficou a caminho de ${target.nickname}, com chegada estimada em ${this.formatEta(etaMs)}.`,
        actorNickname: null,
        targetNickname: target.nickname,
        amount: null,
        createdAt: this.clock(),
      });
      // O aviso não pode entregar a chegada a quem está com Blooper.
      this.notify(target, 'approaching', this.activeEffect(target.id, 'blooper')
        ? 'O caracol está chegando perto de você.'
        : `O caracol está a caminho e chega em aproximadamente ${this.formatEta(etaMs)}.`);
    }
  }

  /**
   * O aviso por socket sai na hora; o Push é "dispara e esquece". Quem chama
   * pode estar na fila de mutações ou no tick, e um endpoint lento ou
   * pendurado não pode segurar a ação de todos os jogadores.
   */
  private notify(account: RuntimeAccount, code: 'targeted' | 'approaching' | 'death', message: string): void {
    const payload = { code, message } as const;
    for (const socketId of account.sockets) this.sockets.get(socketId)?.emit('caracol:notice', payload);
    if (account.sockets.size > 0 && account.visibleSockets.size > 0) return;
    void this.push.send(account.id, Array.from(this.pushSubscriptions.values()), {
      title: code === 'death' ? 'Caracol: você foi pego' : 'Caracol: atenção',
      body: message,
      tag: `caracol-${code}`,
      url: '/',
      data: payload,
    }).catch((error: unknown) => console.warn('[caracol] Push falhou', error));
  }

  private ioNotice(code: CaracolNoticePayload['code'], message: string): void {
    for (const socket of this.sockets.values()) {
      if (socket.data.caracolAccountId) socket.emit('caracol:notice', { code, message });
    }
  }

  /** Aviso só na tela do dono, sem Push: a roleta não notifica fora do jogo. */
  private noticeAccount(account: RuntimeAccount, code: CaracolNoticePayload['code'], message: string): void {
    for (const socketId of account.sockets) this.sockets.get(socketId)?.emit('caracol:notice', { code, message });
  }

  private async removePushSubscription(endpoint: string): Promise<void> {
    this.pushSubscriptions.delete(endpoint);
    await this.store.deletePushSubscription(endpoint);
  }

  private async recordHistory(input: Omit<CaracolHistoryRecord, 'id'>): Promise<CaracolHistoryRecord> {
    const entry = await this.store.appendHistory(input);
    for (const socket of this.sockets.values()) {
      if (socket.data.caracolAccountId) socket.emit('caracol:history-added', entry);
    }
    return entry;
  }

  private stateFor(account: RuntimeAccount): CaracolStateView {
    const now = this.clock();
    const target = this.world.targetAccountId ? this.accounts.get(this.world.targetAccountId) : undefined;
    const distance = target?.cityLat !== null && target?.cityLat !== undefined && target?.cityLon !== null && target?.cityLon !== undefined
      ? distanceKm({ lat: this.world.snailLat, lon: this.world.snailLon }, { lat: target.cityLat, lon: target.cityLon })
      : null;
    // Blooper esconde no servidor: a posição nunca sai daqui para quem tem tinta.
    const hidden = this.activeEffect(account.id, 'blooper', now) !== null;
    return {
      world: {
        snail: {
          lat: hidden ? null : this.world.snailLat,
          lon: hidden ? null : this.world.snailLon,
          hidden,
          speedKmh: this.speedKmh(),
          speedLevel: this.world.speedLevel,
          speedCost: this.speedCost(account),
          targetAccountId: target?.id ?? null,
          targetNickname: target?.nickname ?? null,
          distanceKm: hidden ? null : distance,
          etaMs: hidden || distance === null ? null : distance / this.chaseSpeedKmh(target, now) * 3_600_000,
          redirectCost: this.redirectCost(account),
          outfit: { ...this.world.snailCosmeticOutfit },
        },
        effects: this.activeEffectsOf(null, now).map((effect) => this.effectView(effect)),
        serverNow: now,
      },
      players: Array.from(this.accounts.values())
        .filter((candidate) => this.cityFor(candidate) !== null)
        .sort((a, b) => a.nickname.localeCompare(b.nickname, 'pt-BR'))
        .map((candidate) => ({
          accountId: candidate.id,
          nickname: candidate.nickname,
          alive: candidate.alive,
          city: this.cityFor(candidate)!,
          online: candidate.sockets.size > 0,
          isYou: candidate.id === account.id,
          outfit: { ...candidate.cosmeticOutfit },
          effectItemIds: this.activeEffectsOf(candidate.id, now).map((effect) => effect.itemId),
        })),
      you: {
        accountId: account.id,
        nickname: account.nickname,
        alive: account.alive,
        coins: account.coins,
        city: this.cityFor(account),
        speedDiscountLevel: account.speedDiscountLevel,
        discountCost: this.discountCost(account),
        roulette: {
          availableAt: this.rouletteAvailableAt(account, now),
          lastItemId: account.lastRouletteItemId,
        },
        effects: this.activeEffectsOf(account.id, now).map((effect) => this.effectView(effect)),
      },
      shop: {
        // O preço da loja já vem com Moeda e Raio: o botão mostra o que será cobrado.
        catalog: CARACOL_COSMETIC_CATALOG.map((item) => ({ ...item, price: this.shopPrice(account, item) })),
        player: {
          ownedItemIds: [...account.cosmeticOwnedItemIds],
          outfit: { ...account.cosmeticOutfit },
        },
        snail: {
          ownedItemIds: [...this.world.snailCosmeticOwnedItemIds],
          outfit: { ...this.world.snailCosmeticOutfit },
        },
      },
      needsCity: !account.alive || !account.cityId,
      pushPublicKey: this.push.getPublicKey(),
    };
  }

  private broadcastState(): void {
    for (const socket of this.sockets.values()) {
      const accountId = socket.data.caracolAccountId;
      const account = accountId ? this.accounts.get(accountId) : undefined;
      if (account) socket.emit('caracol:state', this.stateFor(account));
    }
  }

  private accrueCoins(account: RuntimeAccount, now: number, online: boolean): number {
    const elapsed = Math.max(0, now - account.lastCoinAccruedAt);
    const intervals = Math.floor(elapsed / CARACOL_COIN_INTERVAL_MS);
    if (intervals <= 0) return 0;
    account.coins += intervals * (online ? CARACOL_ONLINE_COINS_PER_INTERVAL : CARACOL_OFFLINE_COINS_PER_INTERVAL);
    account.lastCoinAccruedAt += intervals * CARACOL_COIN_INTERVAL_MS;
    return intervals;
  }

  private async settleCoins(account: RuntimeAccount): Promise<void> {
    const online = account.sockets.size > 0;
    const gainedIntervals = this.accrueCoins(account, this.clock(), online);
    if (!gainedIntervals) return;
    await this.store.saveAccount(account);
  }

  private failure(code: string, message: string): CaracolActionFailure {
    return { ok: false, code, message };
  }

  private formatEta(etaMs: number): string {
    const minutes = Math.max(1, Math.round(etaMs / 60_000));
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h${minutes % 60 ? ` ${minutes % 60}min` : ''}`;
  }
}

export function createCaracolManager(io: CaracolIo, options?: CaracolManagerOptions): CaracolGameManager {
  return new CaracolGameManager(io, options);
}
