import { hashSync } from 'bcryptjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CARACOL_BRAZILIA,
  CARACOL_COIN_INTERVAL_MS,
  CARACOL_ONLINE_COINS_PER_INTERVAL,
  CARACOL_ROULETTE_CATALOG,
  CARACOL_ROULETTE_COOLDOWN_MS,
  emptyCaracolOutfit,
  type CaracolActionResult,
  type CaracolNoticePayload,
  type CaracolRouletteItemId,
  type CaracolRouletteResult,
  type CaracolStateView,
} from '../shared/caracol';
import { brazilianCities, cityById } from '../shared/cities';
import { createCaracolManager, type CaracolGameManager } from '../server/caracol/game';
import { distanceKm, moveTowards } from '../server/caracol/geo';
import {
  caracolEffectId,
  MemoryCaracolStore,
  PgCaracolStore,
  type CaracolAccountRecord,
  type CaracolCommit,
  type CaracolEffectRecord,
} from '../server/caracol/store';
import { normalizeText } from '../server/normalization';

// A roleta é testada pelo manager, com relógio, sorteio e tick controlados, e
// sockets falsos no lugar do Socket.IO: nada aqui depende do transporte, e a
// suíte de socket real tem flake de timeout registrado em .specs/STATE.md.

const PASSWORD = 'senha-segura';
const PASSWORD_HASH = hashSync(PASSWORD, 4);
const HOUR = 60 * 60 * 1_000;
const SAO_PAULO = '3550308';
const RIO = '3304557';
const BRASILIA = '5300108';
const MANAUS = '1302603';
const PORTO_ALEGRE = '4314902';

class TestStore extends MemoryCaracolStore {
  failNextCommit = false;
  /** Roda antes ou depois do próximo commit gravar: um tick que chega durante o `await`. */
  beforeNextCommit: (() => Promise<void>) | null = null;
  afterNextCommit: (() => Promise<void>) | null = null;

  override async commit(changes: CaracolCommit): Promise<void> {
    if (this.failNextCommit) {
      this.failNextCommit = false;
      throw new Error('banco fora do ar');
    }
    const before = this.beforeNextCommit;
    const after = this.afterNextCommit;
    this.beforeNextCommit = null;
    this.afterNextCommit = null;
    await before?.();
    await super.commit(changes);
    await after?.();
  }
}

type Handler = (...args: unknown[]) => void;

class FakeSocket {
  private static nextId = 1;
  readonly id = `fake-${FakeSocket.nextId++}`;
  readonly data: Record<string, unknown> = {};
  readonly received: Array<{ event: string; payload: unknown }> = [];
  private readonly handlers = new Map<string, Handler>();

  on(event: string, handler: Handler): this {
    this.handlers.set(event, handler);
    return this;
  }

  emit(event: string, payload: unknown): boolean {
    this.received.push({ event, payload });
    return true;
  }

  request<T>(event: string, ...args: unknown[]): Promise<T> {
    return new Promise((resolve) => this.handlers.get(event)!(...args, resolve));
  }

  async disconnect(): Promise<void> {
    this.handlers.get('disconnect')!();
    await flush();
  }

  notices(code: CaracolNoticePayload['code']): CaracolNoticePayload[] {
    return this.received
      .filter((entry) => entry.event === 'caracol:notice')
      .map((entry) => entry.payload as CaracolNoticePayload)
      .filter((notice) => notice.code === code);
  }
}

interface World {
  store: TestStore;
  now: { value: number };
  rolls: number[];
  manager: CaracolGameManager;
}

interface Player {
  socket: FakeSocket;
  state: CaracolStateView;
}

const managers: CaracolGameManager[] = [];

afterEach(() => {
  managers.splice(0).forEach((manager) => manager.dispose());
});

/**
 * O relógio falso nasce antes do store: o mundo inicial grava `lastTickAt` com
 * o relógio real, e o tick de boot não pode ver tempo passado, senão quem mora
 * em Brasília morre antes do teste começar.
 */
function fresh(): { store: TestStore; now: { value: number } } {
  const now = { value: Date.now() };
  return { store: new TestStore(), now };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function seedAccount(
  store: TestStore,
  now: number,
  nickname: string,
  cityId: string | null,
  overrides: Partial<CaracolAccountRecord> = {},
): Promise<CaracolAccountRecord> {
  const city = cityId ? cityById.get(cityId)! : null;
  return store.createAccount({
    nickname,
    normalizedNickname: normalizeText(nickname),
    passwordHash: PASSWORD_HASH,
    coins: 5,
    alive: true,
    cityId: city?.id ?? null,
    cityName: city?.name ?? null,
    cityUf: city?.uf ?? null,
    cityLat: city?.lat ?? null,
    cityLon: city?.lon ?? null,
    speedDiscountLevel: 0,
    cosmeticOwnedItemIds: [],
    cosmeticOutfit: emptyCaracolOutfit(),
    lastCoinAccruedAt: now,
    lastRouletteAt: null,
    lastRouletteItemId: null,
    ...overrides,
  });
}

async function seedEffect(
  store: TestStore,
  accountId: string | null,
  itemId: CaracolRouletteItemId,
  now: number,
  overrides: Partial<CaracolEffectRecord> = {},
): Promise<void> {
  const item = CARACOL_ROULETTE_CATALOG.find((candidate) => candidate.id === itemId)!;
  await store.commit({
    upsertEffects: [{
      id: caracolEffectId(item.scope, accountId, itemId),
      scope: item.scope,
      accountId,
      itemId,
      createdAt: now,
      expiresAt: now + (item.durationMs ?? HOUR),
      charges: item.charges,
      ...overrides,
    }],
  });
}

async function openWorld(store = new TestStore(), now = { value: Date.now() }): Promise<World> {
  const rolls: number[] = [];
  const manager = createCaracolManager({} as never, {
    store,
    clock: () => now.value,
    random: () => rolls.shift() ?? Math.random(),
    autoTick: false,
  });
  managers.push(manager);
  await manager.ready();
  return { store, now, rolls, manager };
}

async function connect(world: World, nickname: string): Promise<Player> {
  const socket = new FakeSocket();
  world.manager.bindSocket(socket as never);
  const result = await socket.request<CaracolActionResult>('caracol:login', { nickname, password: PASSWORD });
  if (!result.ok) throw new Error(`login falhou: ${result.message}`);
  return { socket, state: result.state };
}

function forceItem(world: World, itemId: CaracolRouletteItemId): void {
  const item = CARACOL_ROULETTE_CATALOG.find((candidate) => candidate.id === itemId)!;
  const pool = CARACOL_ROULETTE_CATALOG.filter((candidate) => candidate.category === item.category);
  world.rolls.push(item.category === 'buff' ? 0.25 : 0.75, (pool.indexOf(item) + 0.5) / pool.length);
}

function spin(player: Player): Promise<CaracolRouletteResult> {
  return player.socket.request<CaracolRouletteResult>('caracol:roulette');
}

async function spinItem(world: World, player: Player, itemId: CaracolRouletteItemId): Promise<CaracolStateView> {
  forceItem(world, itemId);
  const result = await spin(player);
  if (!result.ok) throw new Error(`giro falhou: ${result.code}`);
  expect(result.itemId).toBe(itemId);
  return result.state;
}

async function sync(player: Player): Promise<CaracolStateView> {
  const result = await player.socket.request<CaracolActionResult>('caracol:sync');
  if (!result.ok) throw new Error(`sync falhou: ${result.code}`);
  return result.state;
}

function act(player: Player, event: string, ...args: unknown[]): Promise<CaracolActionResult> {
  return player.socket.request<CaracolActionResult>(event, ...args);
}

/** Resolve com o resultado ou, se a promessa pendurar, com 'pendurou' depois de `ms`. */
function within<T>(promise: Promise<T>, ms: number): Promise<T | 'pendurou'> {
  return Promise.race([promise, new Promise<'pendurou'>((resolve) => { setTimeout(() => resolve('pendurou'), ms); })]);
}

function failureCode(result: CaracolActionResult | CaracolRouletteResult): string | null {
  return result.ok ? null : result.code;
}

function effectOf(state: CaracolStateView, itemId: CaracolRouletteItemId) {
  return state.you.effects.find((effect) => effect.itemId === itemId) ?? null;
}

describe('roleta do Caracol: o giro', () => {
  it('gira uma vez a cada 24 horas corridas e grava item, histórico e cooldown (ROL-01/03/04/09/10/12)', async () => {
    const { store, now } = fresh();
    await seedAccount(store, now.value, 'Girador', SAO_PAULO);
    const world = await openWorld(store, now);
    const player = await connect(world, 'Girador');
    expect(player.state.you.roulette).toEqual({ availableAt: null, lastItemId: null });

    forceItem(world, 'star');
    const first = await spin(player);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.itemId).toBe('star');
    expect(first.category).toBe('buff');
    expect(first.state.you.roulette).toEqual({ availableAt: now.value + CARACOL_ROULETTE_COOLDOWN_MS, lastItemId: 'star' });

    const persisted = (await store.loadSnapshot()).accounts[0]!;
    expect(persisted.lastRouletteAt).toBe(now.value);
    const page = await store.listHistory({ limit: 5 });
    const entry = page.entries.find((candidate) => candidate.type === 'roulette');
    expect(entry?.actorNickname).toBe('Girador');
    expect(entry?.message).toContain('Super Star');

    now.value += CARACOL_ROULETTE_COOLDOWN_MS - 1;
    forceItem(world, 'coin');
    const early = await spin(player);
    expect(failureCode(early)).toBe('ROULETTE_COOLDOWN');
    expect(effectOf(await sync(player), 'coin')).toBeNull();

    now.value += 1;
    const next = await spin(player);
    expect(next.ok && next.itemId).toBe('coin');
  });

  it('recusa quem está morto, sem cidade ou sem login, sem mudar estado (ROL-05/06)', async () => {
    const { store, now } = fresh();
    await seedAccount(store, now.value, 'SemCidade', null);
    await seedAccount(store, now.value, 'Defunto', RIO, { alive: false, coins: 0 });
    const world = await openWorld(store, now);

    for (const nickname of ['SemCidade', 'Defunto']) {
      const player = await connect(world, nickname);
      const result = await spin(player);
      expect(failureCode(result)).toBe('NEEDS_CITY');
      expect((await sync(player)).you.roulette.availableAt).toBeNull();
    }
    expect((await store.loadSnapshot()).accounts.every((account) => account.lastRouletteAt === null)).toBe(true);

    const anonymous = new FakeSocket();
    world.manager.bindSocket(anonymous as never);
    expect(failureCode(await anonymous.request<CaracolRouletteResult>('caracol:roulette'))).toBe('NOT_AUTHENTICATED');
  });

  it('aplica um giro só quando dois chegam juntos (ROL-07)', async () => {
    const { store, now } = fresh();
    await seedAccount(store, now.value, 'Apressado', SAO_PAULO);
    const world = await openWorld(store, now);
    const player = await connect(world, 'Apressado');

    const results = await Promise.all([spin(player), spin(player)]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => failureCode(result) === 'ROULETTE_COOLDOWN')).toHaveLength(1);
    const history = await store.listHistory({ limit: 20 });
    expect(history.entries.filter((entry) => entry.type === 'roulette')).toHaveLength(1);
  });

  it('sorteia a categoria e depois o item com o random injetado (ROL-02/08)', async () => {
    const { store, now } = fresh();
    await seedAccount(store, now.value, 'Sorteado', SAO_PAULO, { coins: 40 });
    const world = await openWorld(store, now);
    const player = await connect(world, 'Sorteado');
    const buffs = CARACOL_ROULETTE_CATALOG.filter((item) => item.category === 'buff');
    const debuffs = CARACOL_ROULETTE_CATALOG.filter((item) => item.category === 'debuff');

    world.rolls.push(0.4999, 0);
    const buff = await spin(player);
    expect(buff.ok && buff.itemId).toBe(buffs[0]!.id);

    now.value += CARACOL_ROULETTE_COOLDOWN_MS;
    world.rolls.push(0.5, 0.9999);
    const debuff = await spin(player);
    expect(debuff.ok && debuff.itemId).toBe(debuffs[debuffs.length - 1]!.id);
  });

  it('fica perto de 50/50 em 10 000 giros com sorteio real', async () => {
    const { store, now } = fresh();
    await seedAccount(store, now.value, 'Estatistico', SAO_PAULO);
    const manager = createCaracolManager({} as never, { store, clock: () => now.value, autoTick: false });
    managers.push(manager);
    await manager.ready();
    const player = await connect({ store, now, rolls: [], manager }, 'Estatistico');

    let buffs = 0;
    for (let index = 0; index < 10_000; index += 1) {
      const result = await spin(player);
      if (!result.ok) throw new Error(result.code);
      if (result.category === 'buff') buffs += 1;
      now.value += CARACOL_ROULETTE_COOLDOWN_MS;
    }
    expect(buffs / 10_000).toBeGreaterThanOrEqual(0.48);
    expect(buffs / 10_000).toBeLessThanOrEqual(0.52);
  }, 60_000);

  it('não muda nada em memória quando a gravação falha, e o giro continua disponível (ROL-11)', async () => {
    const { store, now } = fresh();
    await seedAccount(store, now.value, 'Azarado', SAO_PAULO, { coins: 40 });
    const world = await openWorld(store, now);
    const player = await connect(world, 'Azarado');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    store.failNextCommit = true;
    forceItem(world, 'bomb');
    const failed = await spin(player);
    expect(failureCode(failed)).toBe('ROULETTE_FAILED');
    const after = await sync(player);
    expect(after.you.coins).toBe(40);
    expect(after.you.roulette).toEqual({ availableAt: null, lastItemId: null });

    store.failNextCommit = true;
    forceItem(world, 'star');
    expect(failureCode(await spin(player))).toBe('ROULETTE_FAILED');
    expect((await sync(player)).you.effects).toEqual([]);

    const retry = await spinItem(world, player, 'star');
    expect(effectOf(retry, 'star')).not.toBeNull();
    expect(logged).toHaveBeenCalledTimes(2);
    logged.mockRestore();
  });
});

describe('roleta do Caracol: regra de ouro e ciclo de vida', () => {
  it('nenhum dos 13 itens muda o ganho de moedas por tempo (EFX-01)', async () => {
    const { store, now } = fresh();
    const cities = brazilianCities.filter((city) => city.uf === 'SP').slice(0, 14);
    await seedAccount(store, now.value, 'Controle', cities[0]!.id, { coins: 100 });
    for (const [index, item] of CARACOL_ROULETTE_CATALOG.entries()) {
      await seedAccount(store, now.value, `Item${index}`, cities[index + 1]!.id, { coins: 100 });
    }
    const world = await openWorld(store, now);

    const before = new Map<string, number>();
    const control = await connect(world, 'Controle');
    before.set('Controle', control.state.you.coins);
    const players: Player[] = [control];
    for (const [index, item] of CARACOL_ROULETTE_CATALOG.entries()) {
      const player = await connect(world, `Item${index}`);
      const state = await spinItem(world, player, item.id);
      before.set(`Item${index}`, state.you.coins);
      players.push(player);
    }
    for (const player of players) await player.socket.disconnect();

    now.value += HOUR;
    const gains = new Map<string, number>();
    for (const nickname of before.keys()) {
      const player = await connect(world, nickname);
      gains.set(nickname, player.state.you.coins - before.get(nickname)!);
    }
    expect(gains.get('Controle')).toBe(360);
    for (const [nickname, gain] of gains) expect(gain, nickname).toBe(gains.get('Controle'));
  });

  it('liquida as moedas pendentes antes da Bomba mexer no saldo (EFX-02/35)', async () => {
    const { store, now } = fresh();
    await seedAccount(store, now.value, 'Explodido', SAO_PAULO, { coins: 5 });
    const world = await openWorld(store, now);
    const player = await connect(world, 'Explodido');

    now.value += 30_000;
    const state = await spinItem(world, player, 'bomb');
    expect(state.you.coins).toBe(Math.floor((5 + 30) / 2));
  });

  it('arredonda a Bomba para baixo, e saldo 1 vira 0 (EFX-35)', async () => {
    const { store, now } = fresh();
    await seedAccount(store, now.value, 'Sete', SAO_PAULO, { coins: 7 });
    await seedAccount(store, now.value, 'Um', RIO, { coins: 1 });
    const world = await openWorld(store, now);
    expect((await spinItem(world, await connect(world, 'Sete'), 'bomb')).you.coins).toBe(3);
    expect((await spinItem(world, await connect(world, 'Um'), 'bomb')).you.coins).toBe(0);
  });

  it('renova o Raio em vez de somar, com um efeito só no banco (EFX-03/PER-03)', async () => {
    const { store, now } = fresh();
    await seedAccount(store, now.value, 'Primeiro', SAO_PAULO);
    await seedAccount(store, now.value, 'Segundo', RIO);
    const world = await openWorld(store, now);
    const first = await connect(world, 'Primeiro');
    const second = await connect(world, 'Segundo');

    const afterFirst = await spinItem(world, first, 'lightning');
    expect(afterFirst.world.effects).toEqual([{ itemId: 'lightning', expiresAt: now.value + HOUR, charges: null }]);

    now.value += 30 * 60_000;
    const afterSecond = await spinItem(world, second, 'lightning');
    expect(afterSecond.world.effects).toEqual([{ itemId: 'lightning', expiresAt: now.value + HOUR, charges: null }]);
    const stored = (await store.loadSnapshot()).effects.filter((effect) => effect.itemId === 'lightning');
    expect(stored).toHaveLength(1);
  });

  it('ignora efeito vencido antes do tick e remove com aviso no tick (EFX-04/05)', async () => {
    const { store, now } = fresh();
    const account = await seedAccount(store, now.value, 'Economico', SAO_PAULO);
    await seedEffect(store, account.id, 'coin', now.value, { expiresAt: now.value + 1_000 });
    const world = await openWorld(store, now);
    const player = await connect(world, 'Economico');
    expect(player.state.world.snail.speedCost).toBe(25);

    now.value += 1_000;
    const expired = await sync(player);
    expect(expired.world.snail.speedCost).toBe(50);
    expect(expired.you.effects).toEqual([]);
    expect((await store.loadSnapshot()).effects).toHaveLength(1);

    await world.manager.tickOnce();
    expect((await store.loadSnapshot()).effects).toHaveLength(0);
    expect(player.socket.notices('effect-expired')).toHaveLength(1);
  });

  it('mantém os efeitos depois da morte (EFX-07)', async () => {
    const { store, now } = fresh();
    await seedAccount(store, now.value, 'Pego', BRASILIA);
    const world = await openWorld(store, now);
    const player = await connect(world, 'Pego');
    await spinItem(world, player, 'banana');

    now.value += 1_000;
    await world.manager.tickOnce();
    const dead = await sync(player);
    expect(dead.you.alive).toBe(false);
    expect(effectOf(dead, 'banana')).not.toBeNull();
  });

  it('restaura efeitos e cooldown depois de reiniciar o servidor (PER-01/04)', async () => {
    const { store, now } = fresh();
    await seedAccount(store, now.value, 'Persistente', SAO_PAULO);
    const world = await openWorld(store, now);
    const before = await spinItem(world, await connect(world, 'Persistente'), 'star');
    world.manager.dispose();

    now.value += 10 * 60_000;
    const restarted = await openWorld(store, now);
    const after = (await connect(restarted, 'Persistente')).state;
    expect(after.you.effects).toEqual(before.you.effects);
    expect(after.you.roulette).toEqual(before.you.roulette);
  });

  it('cria a tabela e as colunas novas com ALTER TABLE sobre um banco existente (PER-02)', async () => {
    const store = new PgCaracolStore('postgres://caracol@127.0.0.1:1/caracol');
    const statements: string[] = [];
    Object.assign(store, { pool: { query: vi.fn(async (sql: string) => { statements.push(sql); return { rows: [] }; }) } });
    await store.initialize();
    const sql = statements.join('\n');
    expect(sql).toMatch(/ALTER TABLE caracol_accounts ADD COLUMN IF NOT EXISTS last_roulette_at TIMESTAMPTZ/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS caracol_effects/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS caracol_effects_owner_item_idx\s+ON caracol_effects \(scope, \(COALESCE\(account_id, ''\)\), item_id\)/);
  });
});

describe('roleta do Caracol: buffs', () => {
  it('Cogumelo troca a cidade viva uma vez e liquida as moedas (EFX-10/11/12)', async () => {
    const { store, now } = fresh();
    await seedAccount(store, now.value, 'Mudanca', SAO_PAULO, { coins: 10 });
    const world = await openWorld(store, now);
    const player = await connect(world, 'Mudanca');
    const state = await spinItem(world, player, 'mushroom');
    expect(effectOf(state, 'mushroom')).toEqual({ itemId: 'mushroom', expiresAt: now.value + 24 * HOUR, charges: 1 });

    now.value += 30_000;
    const moved = await act(player, 'caracol:select-city', { cityId: MANAUS });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.state.you.city?.id).toBe(MANAUS);
    expect(moved.state.you.coins).toBe(10 + 30);
    expect(effectOf(moved.state, 'mushroom')).toBeNull();

    expect(failureCode(await act(player, 'caracol:select-city', { cityId: RIO }))).toBe('CITY_LOCKED');
  });

  it('Cogumelo não é gasto por quem escolhe cidade morto (EFX-13)', async () => {
    const { store, now } = fresh();
    const account = await seedAccount(store, now.value, 'Renascido', RIO, { alive: false, coins: 0 });
    await seedEffect(store, account.id, 'mushroom', now.value);
    const world = await openWorld(store, now);
    const player = await connect(world, 'Renascido');
    const chosen = await act(player, 'caracol:select-city', { cityId: MANAUS });
    expect(chosen.ok).toBe(true);
    if (chosen.ok) expect(effectOf(chosen.state, 'mushroom')?.charges).toBe(1);
  });

  it('Super Star tira o alvo na hora, mantém o caracol parado e recusa redirect (EFX-14/15/16/17)', async () => {
    const { store, now } = fresh();
    await seedAccount(store, now.value, 'Estrela', SAO_PAULO, { coins: 40 });
    await seedAccount(store, now.value, 'Longe', MANAUS, { coins: 40 });
    const world = await openWorld(store, now);
    const star = await connect(world, 'Estrela');
    const far = await connect(world, 'Longe');
    now.value += HOUR;
    await world.manager.tickOnce();
    const moving = await sync(far);
    expect(moving.world.snail.targetNickname).toBe('Estrela');

    const state = await spinItem(world, star, 'star');
    expect(effectOf(state, 'star')?.expiresAt).toBe(now.value + 2 * HOUR);
    expect(state.world.snail.targetNickname).toBe('Longe');
    expect(state.world.snail.lat).toBe(moving.world.snail.lat);
    expect(state.world.snail.lon).toBe(moving.world.snail.lon);

    const coinsBefore = (await sync(far)).you.coins;
    const refused = await act(far, 'caracol:redirect', { targetNickname: 'Estrela' });
    expect(failureCode(refused)).toBe('TARGET_PROTECTED');
    expect((await sync(far)).you.coins).toBe(coinsBefore);
  });

  it('Super Star não morre na chegada do caracol, e todos com Star deixam o caracol sem alvo (EFX-18)', async () => {
    const { store, now } = fresh();
    const account = await seedAccount(store, now.value, 'Intocavel', BRASILIA);
    await seedEffect(store, account.id, 'star', now.value);
    const world = await openWorld(store, now);
    const player = await connect(world, 'Intocavel');

    now.value += 60_000;
    await world.manager.tickOnce();
    const state = await sync(player);
    expect(state.you.alive).toBe(true);
    expect(state.world.snail.targetAccountId).toBeNull();
    expect(state.world.snail.lat).toBe(CARACOL_BRAZILIA.lat);
  });

  it('Flor de Fogo redireciona três vezes de graça sem encarecer o mundo (EFX-19/20/06)', async () => {
    const { store, now } = fresh();
    await seedAccount(store, now.value, 'Florista', SAO_PAULO, { coins: 3 });
    await seedAccount(store, now.value, 'Alvo', RIO);
    const world = await openWorld(store, now);
    const player = await connect(world, 'Florista');
    const state = await spinItem(world, player, 'fire-flower');
    expect(effectOf(state, 'fire-flower')).toEqual({ itemId: 'fire-flower', expiresAt: now.value + 2 * HOUR, charges: 3 });

    for (const remaining of [2, 1, 0]) {
      const result = await act(player, 'caracol:redirect', { targetNickname: 'Alvo' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.state.you.coins).toBe(3);
      expect(result.state.world.snail.redirectCost).toBe(8);
      expect(result.state.world.snail.targetNickname).toBe('Alvo');
      expect(effectOf(result.state, 'fire-flower')?.charges ?? 0).toBe(remaining);
    }
    expect((await store.loadSnapshot()).effects).toHaveLength(0);
    expect(failureCode(await act(player, 'caracol:redirect', { targetNickname: 'Alvo' }))).toBe('INSUFFICIENT_COINS');
  });

  it('Bumerangue rouba 20% arredondado para baixo e gasta a carga (EFX-21/22/24)', async () => {
    const { store, now } = fresh();
    await seedAccount(store, now.value, 'Ladrao', SAO_PAULO, { coins: 10 });
    await seedAccount(store, now.value, 'Rico', RIO, { coins: 54 });
    const world = await openWorld(store, now);
    const thief = await connect(world, 'Ladrao');
    const rich = await connect(world, 'Rico');
    const state = await spinItem(world, thief, 'boomerang');
    expect(effectOf(state, 'boomerang')).toEqual({ itemId: 'boomerang', expiresAt: now.value + 24 * HOUR, charges: 1 });

    const thrown = await act(thief, 'caracol:boomerang', { targetNickname: 'Rico' });
    expect(thrown.ok).toBe(true);
    if (!thrown.ok) return;
    expect(thrown.state.you.coins).toBe(10 + 10);
    expect(effectOf(thrown.state, 'boomerang')).toBeNull();
    expect((await sync(rich)).you.coins).toBe(44);
    expect(rich.socket.notices('boomerang')).toHaveLength(1);
    expect(failureCode(await act(thief, 'caracol:boomerang', { targetNickname: 'Rico' }))).toBe('NO_CHARGE');
  });

  it('Bumerangue mantém a carga com alvo inválido e gasta com alvo pobre (EFX-23)', async () => {
    const { store, now } = fresh();
    const thiefAccount = await seedAccount(store, now.value, 'Mirador', SAO_PAULO, { coins: 10 });
    await seedAccount(store, now.value, 'Morto', RIO, { alive: false, coins: 90 });
    await seedAccount(store, now.value, 'Pobre', MANAUS, { coins: 4 });
    await seedEffect(store, thiefAccount.id, 'boomerang', now.value);
    const world = await openWorld(store, now);
    const thief = await connect(world, 'Mirador');

    for (const targetNickname of ['Mirador', 'Morto', 'Ninguem']) {
      expect(failureCode(await act(thief, 'caracol:boomerang', { targetNickname }))).toBe('TARGET_NOT_FOUND');
    }
    expect(effectOf(await sync(thief), 'boomerang')?.charges).toBe(1);

    const wasted = await act(thief, 'caracol:boomerang', { targetNickname: 'Pobre' });
    expect(wasted.ok).toBe(true);
    if (!wasted.ok) return;
    expect(wasted.state.you.coins).toBe(10);
    expect(effectOf(wasted.state, 'boomerang')).toBeNull();
  });

  it('Bullet Bill leva à cidade mais longe do caracol e o alvo continua o mesmo (EFX-25)', async () => {
    const { store, now } = fresh();
    await seedAccount(store, now.value, 'Projetil', SAO_PAULO);
    const world = await openWorld(store, now);
    const player = await connect(world, 'Projetil');
    expect(player.state.world.snail.targetNickname).toBe('Projetil');

    const expected = brazilianCities.reduce((best, city) => {
      const km = distanceKm(CARACOL_BRAZILIA, city);
      const bestKm = distanceKm(CARACOL_BRAZILIA, best);
      return km > bestKm || (km === bestKm && Number(city.id) < Number(best.id)) ? city : best;
    });
    const state = await spinItem(world, player, 'bullet-bill');
    expect(state.you.city?.id).toBe(expected.id);
    expect(state.world.snail.targetNickname).toBe('Projetil');
    expect(state.you.effects).toEqual([]);
  });

  it('Moeda corta pela metade todo preço, e a cobrança bate com a tela (EFX-26/27/38)', async () => {
    const { store, now } = fresh();
    await seedAccount(store, now.value, 'Poupador', SAO_PAULO, { coins: 1_000 });
    await seedAccount(store, now.value, 'Alvo', RIO);
    const world = await openWorld(store, now);
    const player = await connect(world, 'Poupador');
    const state = await spinItem(world, player, 'coin');
    expect(effectOf(state, 'coin')?.expiresAt).toBe(now.value + 6 * HOUR);
    expect(state.world.snail.speedCost).toBe(25);
    expect(state.world.snail.redirectCost).toBe(4);
    expect(state.you.discountCost).toBe(5);
    expect(state.shop.catalog.find((item) => item.id === 'pants-jeans')?.price).toBe(12);

    const speed = await act(player, 'caracol:buy-speed');
    expect(speed.ok && speed.state.you.coins).toBe(1_000 - 25);
    const shop = await act(player, 'caracol:shop-purchase', { wearer: 'player', itemId: 'pants-jeans' });
    expect(shop.ok && shop.state.you.coins).toBe(1_000 - 25 - 12);
    const discount = await act(player, 'caracol:buy-discount');
    expect(discount.ok && discount.state.you.coins).toBe(1_000 - 25 - 12 - 5);
  });

  it('respeita os pisos da fórmula de preço com desconto e Moeda (EFX-38)', async () => {
    const { store, now } = fresh();
    const account = await seedAccount(store, now.value, 'Descontado', SAO_PAULO, { speedDiscountLevel: 2 });
    await seedEffect(store, account.id, 'coin', now.value);
    const world = await openWorld(store, now);
    const state = (await connect(world, 'Descontado')).state;
    expect(state.world.snail.redirectCost).toBe(4);
    expect(state.world.snail.speedCost).toBe(14);
    expect(state.you.discountCost).toBeNull();
  });

  it('Casco defensivo absorve o primeiro ataque, cobra o atacante e avisa os dois (EFX-28/29)', async () => {
    const { store, now } = fresh();
    await seedAccount(store, now.value, 'Blindado', SAO_PAULO);
    await seedAccount(store, now.value, 'Atacante', MANAUS, { coins: 50 });
    const world = await openWorld(store, now);
    const shielded = await connect(world, 'Blindado');
    const attacker = await connect(world, 'Atacante');
    const state = await spinItem(world, shielded, 'shield');
    expect(effectOf(state, 'shield')).toEqual({ itemId: 'shield', expiresAt: now.value + 24 * HOUR, charges: 1 });
    const redirectOther = await act(attacker, 'caracol:redirect', { targetNickname: 'Blindado' });
    expect(redirectOther.ok).toBe(true);
    if (!redirectOther.ok) return;
    expect(redirectOther.state.you.coins).toBe(42);
    expect(redirectOther.state.world.snail.redirectCost).toBe(8);
    expect(effectOf(await sync(shielded), 'shield')).toBeNull();
    expect(attacker.socket.notices('shield')).toHaveLength(1);
    expect(shielded.socket.notices('shield')).toHaveLength(1);

    const second = await act(attacker, 'caracol:redirect', { targetNickname: 'Blindado' });
    expect(second.ok && second.state.world.snail.redirectCost).toBe(16);
  });

  it('Casco defensivo absorve o bumerangue (EFX-29)', async () => {
    const { store, now } = fresh();
    const shieldedAccount = await seedAccount(store, now.value, 'Cofre', SAO_PAULO, { coins: 100 });
    const thiefAccount = await seedAccount(store, now.value, 'Gatuno', MANAUS, { coins: 10 });
    await seedEffect(store, shieldedAccount.id, 'shield', now.value);
    await seedEffect(store, thiefAccount.id, 'boomerang', now.value);
    const world = await openWorld(store, now);
    const safe = await connect(world, 'Cofre');
    const thief = await connect(world, 'Gatuno');

    const thrown = await act(thief, 'caracol:boomerang', { targetNickname: 'Cofre' });
    expect(thrown.ok).toBe(true);
    if (!thrown.ok) return;
    expect(thrown.state.you.coins).toBe(10);
    expect(effectOf(thrown.state, 'boomerang')).toBeNull();
    const safeState = await sync(safe);
    expect(safeState.you.coins).toBe(100);
    expect(effectOf(safeState, 'shield')).toBeNull();
  });

  it('Casco defensivo não se gasta com a própria roleta nem com a chegada do caracol (EFX-30)', async () => {
    const { store, now } = fresh();
    const account = await seedAccount(store, now.value, 'Escudado', BRASILIA, { coins: 20 });
    await seedEffect(store, account.id, 'shield', now.value);
    const world = await openWorld(store, now);
    const player = await connect(world, 'Escudado');

    const bombed = await spinItem(world, player, 'bomb');
    expect(bombed.you.coins).toBe(10);
    expect(effectOf(bombed, 'shield')?.charges).toBe(1);

    now.value += 1_000;
    await world.manager.tickOnce();
    const dead = await sync(player);
    expect(dead.you.alive).toBe(false);
    expect(effectOf(dead, 'shield')?.charges).toBe(1);
  });
});

describe('roleta do Caracol: debuffs', () => {
  it('Casco vermelho marca o dono antes do ack e trava o redirect de terceiros (EFX-31/33)', async () => {
    const { store, now } = fresh();
    await seedAccount(store, now.value, 'Perto', SAO_PAULO);
    await seedAccount(store, now.value, 'Marcado', MANAUS);
    await seedAccount(store, now.value, 'Terceiro', PORTO_ALEGRE, { coins: 50 });
    const world = await openWorld(store, now);
    const marked = await connect(world, 'Marcado');
    const third = await connect(world, 'Terceiro');
    expect(marked.state.world.snail.targetNickname).toBe('Perto');

    const state = await spinItem(world, marked, 'red-shell');
    expect(effectOf(state, 'red-shell')?.expiresAt).toBe(now.value + 2 * HOUR);
    expect(state.world.snail.targetNickname).toBe('Marcado');

    const locked = await act(third, 'caracol:redirect', { targetNickname: 'Perto' });
    expect(failureCode(locked)).toBe('TARGET_LOCKED');
    expect((await sync(third)).you.coins).toBe(50);
    const allowed = await act(third, 'caracol:redirect', { targetNickname: 'Marcado' });
    expect(allowed.ok && allowed.state.you.coins).toBe(42);
  });

  it('vale a trava mais nova e volta para a anterior quando o dono dela morre (EFX-32)', async () => {
    const { store, now } = fresh();
    const older = await seedAccount(store, now.value, 'Antigo', MANAUS);
    const newer = await seedAccount(store, now.value, 'Novo', BRASILIA);
    await seedAccount(store, now.value, 'Vizinho', SAO_PAULO);
    await seedEffect(store, older.id, 'red-shell', now.value - 10 * 60_000);
    await seedEffect(store, newer.id, 'red-shell', now.value - 5 * 60_000);
    const world = await openWorld(store, now);
    const watcher = await connect(world, 'Vizinho');
    expect(watcher.state.world.snail.targetNickname).toBe('Novo');

    now.value += 1_000;
    await world.manager.tickOnce();
    const state = await sync(watcher);
    expect(state.players.find((player) => player.nickname === 'Novo')?.alive).toBe(false);
    expect(state.world.snail.targetNickname).toBe('Antigo');
  });

  it('Super Star vence o Casco vermelho no mesmo jogador (EFX-34)', async () => {
    const { store, now } = fresh();
    const both = await seedAccount(store, now.value, 'Contraditorio', SAO_PAULO);
    await seedAccount(store, now.value, 'Outro', MANAUS, { coins: 50 });
    await seedEffect(store, both.id, 'red-shell', now.value);
    await seedEffect(store, both.id, 'star', now.value);
    const world = await openWorld(store, now);
    const other = await connect(world, 'Outro');
    expect(other.state.world.snail.targetNickname).toBe('Outro');
    expect(failureCode(await act(other, 'caracol:redirect', { targetNickname: 'Contraditorio' }))).toBe('TARGET_PROTECTED');
  });

  it('Raio dobra o preço de todo mundo, e Moeda com Raio volta ao preço normal (EFX-36/37)', async () => {
    const { store, now } = fresh();
    const saver = await seedAccount(store, now.value, 'ComMoeda', SAO_PAULO);
    await seedAccount(store, now.value, 'Culpado', RIO);
    await seedAccount(store, now.value, 'Vitima', MANAUS, { coins: 99 });
    await seedEffect(store, saver.id, 'coin', now.value);
    const world = await openWorld(store, now);
    const guilty = await connect(world, 'Culpado');
    const victim = await connect(world, 'Vitima');
    const withCoin = await connect(world, 'ComMoeda');

    const state = await spinItem(world, guilty, 'lightning');
    expect(state.world.effects).toEqual([{ itemId: 'lightning', expiresAt: now.value + HOUR, charges: null }]);
    expect(state.world.snail.speedCost).toBe(100);

    const victimState = await sync(victim);
    expect(victimState.world.snail.speedCost).toBe(100);
    expect(victimState.world.snail.redirectCost).toBe(16);
    expect(victimState.you.discountCost).toBe(20);
    expect(victimState.shop.catalog.find((item) => item.id === 'pants-jeans')?.price).toBe(50);
    expect(failureCode(await act(victim, 'caracol:buy-speed'))).toBe('INSUFFICIENT_COINS');

    const normal = await sync(withCoin);
    expect(normal.world.snail.speedCost).toBe(50);
    expect(normal.world.snail.redirectCost).toBe(8);
  });

  it('Blooper esconde o caracol só no estado de quem tem tinta (EFX-39/40/41)', async () => {
    const { store, now } = fresh();
    await seedAccount(store, now.value, 'Tintado', SAO_PAULO);
    await seedAccount(store, now.value, 'Limpo', MANAUS);
    const world = await openWorld(store, now);
    const inked = await connect(world, 'Tintado');
    const clean = await connect(world, 'Limpo');

    const state = await spinItem(world, inked, 'blooper');
    expect(effectOf(state, 'blooper')?.expiresAt).toBe(now.value + 2 * HOUR);
    expect(state.world.snail).toMatchObject({ lat: null, lon: null, distanceKm: null, etaMs: null, hidden: true, targetNickname: 'Tintado' });

    const other = await sync(clean);
    expect(other.world.snail.hidden).toBe(false);
    expect(other.world.snail.lat).toBe(CARACOL_BRAZILIA.lat);
    expect(other.world.snail.distanceKm).not.toBeNull();
    expect(other.world.snail.etaMs).not.toBeNull();
  });

  it('Congelamento recusa o que gasta ou ataca e deixa vestir e mudar de cidade (EFX-42/43/44)', async () => {
    const { store, now } = fresh();
    const account = await seedAccount(store, now.value, 'Gelado', SAO_PAULO, { coins: 500, cosmeticOwnedItemIds: ['cap-flat'] });
    await seedAccount(store, now.value, 'Alvo', RIO);
    await seedEffect(store, account.id, 'boomerang', now.value);
    await seedEffect(store, account.id, 'mushroom', now.value);
    const world = await openWorld(store, now);
    const player = await connect(world, 'Gelado');

    const state = await spinItem(world, player, 'freeze');
    expect(effectOf(state, 'freeze')?.expiresAt).toBe(now.value + HOUR);

    const refused = [
      await act(player, 'caracol:redirect', { targetNickname: 'Alvo' }),
      await act(player, 'caracol:buy-speed'),
      await act(player, 'caracol:buy-discount'),
      await act(player, 'caracol:shop-purchase', { wearer: 'player', itemId: 'pants-jeans' }),
      await act(player, 'caracol:boomerang', { targetNickname: 'Alvo' }),
    ];
    expect(refused.map(failureCode)).toEqual(['FROZEN', 'FROZEN', 'FROZEN', 'FROZEN', 'FROZEN']);
    const unchanged = await sync(player);
    expect(unchanged.you.coins).toBe(500);
    expect(effectOf(unchanged, 'boomerang')?.charges).toBe(1);

    expect((await act(player, 'caracol:shop-equip', { wearer: 'player', slot: 'cap', itemId: 'cap-flat' })).ok).toBe(true);
    expect((await act(player, 'caracol:select-city', { cityId: MANAUS })).ok).toBe(true);
  });

  it('Banana acelera 1,5 vez só contra o dono, sem mudar a velocidade global (EFX-45/46/47)', async () => {
    async function movedKm(withBanana: boolean): Promise<{ moved: number; state: CaracolStateView }> {
      const { store, now } = fresh();
      const target = await seedAccount(store, now.value, 'Escorregou', SAO_PAULO);
      await seedAccount(store, now.value, 'Plateia', MANAUS);
      if (withBanana) await seedEffect(store, target.id, 'banana', now.value);
      const world = await openWorld(store, now);
      const watcher = await connect(world, 'Plateia');
      // Dentro das 4 horas da Banana.
      now.value += 3 * HOUR;
      await world.manager.tickOnce();
      const state = await sync(watcher);
      return { moved: distanceKm(CARACOL_BRAZILIA, { lat: state.world.snail.lat!, lon: state.world.snail.lon! }), state };
    }

    const normal = await movedKm(false);
    const slippery = await movedKm(true);
    expect(slippery.moved / normal.moved).toBeCloseTo(1.5, 3);
    expect(slippery.state.world.snail.speedKmh).toBe(normal.state.world.snail.speedKmh);
    expect(slippery.state.world.snail.speedLevel).toBe(0);
    const eta = slippery.state.world.snail;
    expect(eta.etaMs).toBeCloseTo(eta.distanceKm! / (eta.speedKmh * 1.5) * 3_600_000, 0);
  });

  it('mostra na lista de jogadores os efeitos de todo mundo (UI-06)', async () => {
    const { store, now } = fresh();
    const owner = await seedAccount(store, now.value, 'Enfeitado', SAO_PAULO);
    await seedAccount(store, now.value, 'Curioso', MANAUS);
    await seedEffect(store, owner.id, 'banana', now.value);
    await seedEffect(store, owner.id, 'shield', now.value);
    const world = await openWorld(store, now);
    const curious = await connect(world, 'Curioso');
    const row = curious.state.players.find((player) => player.nickname === 'Enfeitado');
    expect(row?.effectItemIds).toEqual(['shield', 'banana']);
  });
});

describe('roleta do Caracol: aviso de aproximação de quem se muda', () => {
  // 600 km/h: os 10 minutos do aviso viram 100 km, e a perseguição cabe no teste.
  const SPEED_LEVEL = 6;
  const SPEED_KMH = SPEED_LEVEL * 100;

  async function snailNear(store: TestStore, now: number, cityId: string, km: number): Promise<void> {
    const snail = moveTowards(cityById.get(cityId)!, CARACOL_BRAZILIA, km);
    const { world } = await store.loadSnapshot();
    await store.saveWorld({ ...world, snailLat: snail.lat, snailLon: snail.lon, speedLevel: SPEED_LEVEL, lastTickAt: now });
  }

  async function approachingCount(store: TestStore): Promise<number> {
    return (await store.listHistory({ limit: 50 })).entries.filter((entry) => entry.type === 'approaching').length;
  }

  it.each([
    ['Cogumelo', async (world: World, player: Player) => {
      await spinItem(world, player, 'mushroom');
      const moved = await act(player, 'caracol:select-city', { cityId: RIO });
      expect(moved.ok).toBe(true);
    }],
    ['Bullet Bill', async (world: World, player: Player) => {
      await spinItem(world, player, 'bullet-bill');
    }],
  ])('%s: o alvo que se muda recebe o aviso de novo na cidade nova', async (_item, move) => {
    const { store, now } = fresh();
    await seedAccount(store, now.value, 'Mudado', SAO_PAULO);
    await snailNear(store, now.value, SAO_PAULO, SPEED_KMH / 10);
    const world = await openWorld(store, now);
    expect(await approachingCount(store)).toBe(1);

    const player = await connect(world, 'Mudado');
    await move(world, player);
    const moved = await sync(player);
    expect(moved.you.city?.id).not.toBe(SAO_PAULO);
    expect(moved.world.snail.targetNickname).toBe('Mudado');
    expect(moved.world.snail.etaMs!).toBeGreaterThan(10 * 60_000);

    // Leva o caracol até 6 min da cidade nova, sem chegar.
    now.value += (moved.world.snail.distanceKm! - SPEED_KMH / 10) / SPEED_KMH * HOUR;
    await world.manager.tickOnce();
    const chased = await sync(player);
    expect(chased.you.alive).toBe(true);
    expect(chased.world.snail.etaMs!).toBeLessThanOrEqual(10 * 60_000);
    expect(await approachingCount(store)).toBe(2);
    expect(player.socket.notices('approaching')).toHaveLength(1);
  });
});

describe('roleta do Caracol: gravação antes da memória', () => {
  it('responde com falha e não gasta nada quando a gravação falha', async () => {
    const { store, now } = fresh();
    const actor = await seedAccount(store, now.value, 'Azarento', SAO_PAULO, { coins: 100, cosmeticOwnedItemIds: ['pants-jeans'] });
    await seedAccount(store, now.value, 'Vitima', RIO, { coins: 50 });
    await seedEffect(store, actor.id, 'boomerang', now.value);
    await seedEffect(store, actor.id, 'mushroom', now.value);
    const world = await openWorld(store, now);
    const player = await connect(world, 'Azarento');
    const victim = await connect(world, 'Vitima');
    const before = await sync(player);
    expect(before.world.snail.targetNickname).toBe('Azarento');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const attempts: Array<[string, ...unknown[]]> = [
      ['caracol:boomerang', { targetNickname: 'Vitima' }],
      ['caracol:redirect', { targetNickname: 'Vitima' }],
      ['caracol:select-city', { cityId: MANAUS }],
      ['caracol:buy-speed'],
      ['caracol:buy-discount'],
      ['caracol:shop-purchase', { wearer: 'player', itemId: 'shirt-basic' }],
      ['caracol:shop-purchase', { wearer: 'snail', itemId: 'shirt-basic' }],
      ['caracol:shop-equip', { wearer: 'player', slot: 'pants', itemId: 'pants-jeans' }],
    ];
    for (const [event, ...args] of attempts) {
      store.failNextCommit = true;
      expect(failureCode(await act(player, event, ...args)), event).toBe('SAVE_FAILED');
    }

    const after = await sync(player);
    expect(after.you.coins).toBe(100);
    expect(after.you.effects).toEqual(before.you.effects);
    expect(after.you.city?.id).toBe(SAO_PAULO);
    expect(after.you.speedDiscountLevel).toBe(0);
    expect(after.world.snail.targetNickname).toBe('Azarento');
    expect(after.world.snail.redirectCost).toBe(before.world.snail.redirectCost);
    expect(after.world.snail.speedLevel).toBe(0);
    expect(after.shop).toEqual(before.shop);
    expect((await sync(victim)).you.coins).toBe(50);
    const persisted = await store.loadSnapshot();
    expect(persisted.effects).toHaveLength(2);
    expect(persisted.world.snailCosmeticOwnedItemIds).toEqual([]);
    expect(persisted.accounts.find((account) => account.id === actor.id)?.cosmeticOwnedItemIds).toEqual(['pants-jeans']);
    expect(logged).toHaveBeenCalledTimes(attempts.length);
    logged.mockRestore();
  });

  it('um Push que não responde não segura a fila nem a ação de outro jogador', async () => {
    const { store, now } = fresh();
    await seedAccount(store, now.value, 'Alfa', SAO_PAULO, { coins: 1_000 });
    await seedAccount(store, now.value, 'Beto', RIO);
    await seedAccount(store, now.value, 'Caio', MANAUS, { coins: 1_000 });
    const world = await openWorld(store, now);
    const send = vi.fn(() => new Promise<void>(() => undefined));
    Object.assign(world.manager, { push: { send, getPublicKey: () => null } });
    const alfa = await connect(world, 'Alfa');
    const caio = await connect(world, 'Caio');

    // Beto está offline: o aviso de alvo cai no Push, que nunca responde.
    expect(await within(act(alfa, 'caracol:redirect', { targetNickname: 'Beto' }), 1_000)).toMatchObject({ ok: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await within(act(caio, 'caracol:buy-speed'), 1_000)).toMatchObject({ ok: true });
  });

  it('a Bomba tira o que anunciou mesmo quando o tick paga moedas no meio da gravação', async () => {
    const { store, now } = fresh();
    await seedAccount(store, now.value, 'Explodido', SAO_PAULO, { coins: 40 });
    const world = await openWorld(store, now);
    const player = await connect(world, 'Explodido');
    store.afterNextCommit = async () => {
      now.value += 10 * CARACOL_COIN_INTERVAL_MS;
      await world.manager.tickOnce();
    };

    const state = await spinItem(world, player, 'bomb');
    expect(state.you.coins).toBe(40 + 10 * CARACOL_ONLINE_COINS_PER_INTERVAL - 20);
    expect((await store.loadSnapshot()).accounts[0]!.coins).toBe(state.you.coins);
    const entry = (await store.listHistory({ limit: 20 })).entries.find((candidate) => candidate.type === 'roulette');
    expect(entry?.amount).toBe(20);
  });

  it('não grava vivo quem o caracol pegou no meio do giro', async () => {
    const { store, now } = fresh();
    await seedAccount(store, now.value, 'Condenado', BRASILIA, { coins: 40 });
    const world = await openWorld(store, now);
    const player = await connect(world, 'Condenado');
    store.beforeNextCommit = async () => {
      now.value += 1_000;
      await world.manager.tickOnce();
    };

    const state = await spinItem(world, player, 'bomb');
    expect(state.you.alive).toBe(false);
    expect(state.you.coins).toBe(0);
    const persisted = (await store.loadSnapshot()).accounts[0]!;
    expect(persisted.alive).toBe(false);
    expect(persisted.coins).toBe(0);
  });
});

describe('roleta do Caracol: PgCaracolStore', () => {
  function pgStore(pool: object): PgCaracolStore {
    const store = new PgCaracolStore('postgres://caracol@127.0.0.1:1/caracol');
    Object.assign(store, { pool });
    return store;
  }

  it('devolve o erro original e descarta a conexão quando o ROLLBACK também falha', async () => {
    const { world } = await new MemoryCaracolStore().loadSnapshot();
    const release = vi.fn();
    let failWrite = true;
    const client = {
      release,
      query: vi.fn(async (sql: string) => {
        if (failWrite && sql.includes('UPDATE caracol_world')) throw new Error('escrita recusada');
        if (failWrite && sql === 'ROLLBACK') throw new Error('conexão perdida');
        return { rows: [] };
      }),
    };
    const store = pgStore({ connect: vi.fn(async () => client) });

    await expect(store.commit({ world })).rejects.toThrow('escrita recusada');
    expect(release).toHaveBeenCalledWith(expect.objectContaining({ message: 'conexão perdida' }));

    failWrite = false;
    release.mockClear();
    await store.commit({ world });
    expect(release).toHaveBeenCalledWith(undefined);
  });

  it('lê os TIMESTAMPTZ do Postgres sem perder os milissegundos', async () => {
    const at = new Date(Date.UTC(2026, 8, 21, 12, 0, 0, 123));
    const city = cityById.get(SAO_PAULO)!;
    const rows: Record<string, unknown[]> = {
      caracol_accounts: [{
        id: 'conta-1', nickname: 'Preciso', normalized_nickname: 'preciso', password_hash: PASSWORD_HASH,
        coins: 5, alive: true, city_id: city.id, city_name: city.name, city_uf: city.uf, city_lat: city.lat, city_lon: city.lon,
        speed_discount_level: 0, cosmetic_owned_item_ids: [], cosmetic_outfit: {},
        last_coin_accrued_at: at, last_roulette_at: at, last_roulette_item_id: 'coin', created_at: at, updated_at: at,
      }],
      caracol_world: [{
        snail_lat: CARACOL_BRAZILIA.lat, snail_lon: CARACOL_BRAZILIA.lon, speed_level: 0, redirect_level: 0,
        target_account_id: null, snail_cosmetic_owned_item_ids: [], snail_cosmetic_outfit: {}, last_tick_at: at,
      }],
      caracol_push_subscriptions: [],
      caracol_effects: [{
        id: caracolEffectId('account', 'conta-1', 'coin'), scope: 'account', account_id: 'conta-1', item_id: 'coin',
        created_at: at, expires_at: new Date(at.getTime() + HOUR), charges: null,
      }],
    };
    const store = pgStore({
      query: vi.fn(async (sql: string) => ({ rows: rows[/FROM (\w+)/.exec(sql)![1]!] ?? [] })),
    });

    const snapshot = await store.loadSnapshot();
    expect(snapshot.accounts[0]!.lastRouletteAt).toBe(at.getTime());
    expect(snapshot.accounts[0]!.lastCoinAccruedAt).toBe(at.getTime());
    expect(snapshot.world.lastTickAt).toBe(at.getTime());
    expect(snapshot.effects[0]!.createdAt).toBe(at.getTime());
    expect(snapshot.effects[0]!.expiresAt).toBe(at.getTime() + HOUR);
  });
});
