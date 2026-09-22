import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient, type PoolConfig } from 'pg';
import {
  caracolRouletteItemById,
  emptyCaracolOutfit,
  type CaracolEffectScope,
  type CaracolHistoryEntry,
  type CaracolHistoryType,
  type CaracolOutfit,
  type CaracolRouletteItemId,
} from '../../shared/caracol';
import {
  CARACOL_BASE_SPEED_KMH,
  CARACOL_BRAZILIA,
  CARACOL_STARTING_COINS,
} from '../../shared/caracol';

export interface CaracolAccountRecord {
  id: string;
  nickname: string;
  normalizedNickname: string;
  passwordHash: string;
  coins: number;
  alive: boolean;
  cityId: string | null;
  cityName: string | null;
  cityUf: string | null;
  cityLat: number | null;
  cityLon: number | null;
  speedDiscountLevel: number;
  cosmeticOwnedItemIds: string[];
  cosmeticOutfit: CaracolOutfit;
  lastCoinAccruedAt: number;
  lastRouletteAt: number | null;
  lastRouletteItemId: CaracolRouletteItemId | null;
  createdAt: number;
  updatedAt: number;
}

export interface CaracolWorldRecord {
  snailLat: number;
  snailLon: number;
  speedLevel: number;
  redirectLevel: number;
  targetAccountId: string | null;
  snailCosmeticOwnedItemIds: string[];
  snailCosmeticOutfit: CaracolOutfit;
  lastTickAt: number;
}

export type CaracolHistoryRecord = CaracolHistoryEntry;

/**
 * Efeito da roleta que está valendo. Vence por conta (`expiresAt` comparado ao
 * relógio), nunca por timer. O `id` é derivado do dono e do item, então o mesmo
 * item de novo para o mesmo dono renova em vez de somar.
 */
export interface CaracolEffectRecord {
  id: string;
  scope: CaracolEffectScope;
  accountId: string | null;
  itemId: CaracolRouletteItemId;
  createdAt: number;
  expiresAt: number;
  charges: number | null;
}

/** Mudanças gravadas juntas: ou todas entram no banco, ou nenhuma. */
export interface CaracolCommit {
  accounts?: CaracolAccountRecord[];
  world?: CaracolWorldRecord;
  upsertEffects?: CaracolEffectRecord[];
  deleteEffectIds?: string[];
}

export function caracolEffectId(scope: CaracolEffectScope, accountId: string | null, itemId: CaracolRouletteItemId): string {
  return `${scope}:${accountId ?? 'world'}:${itemId}`;
}

export interface CaracolPushRecord {
  accountId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  expirationTime: number | null;
  updatedAt: number;
}

export interface CaracolSnapshot {
  accounts: CaracolAccountRecord[];
  world: CaracolWorldRecord;
  pushSubscriptions: CaracolPushRecord[];
  effects: CaracolEffectRecord[];
}

export class CaracolNicknameTakenError extends Error {
  constructor() {
    super('Esse nick já está sendo usado.');
    this.name = 'CaracolNicknameTakenError';
  }
}

export interface CaracolStore {
  initialize(): Promise<void>;
  loadSnapshot(): Promise<CaracolSnapshot>;
  createAccount(input: Omit<CaracolAccountRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<CaracolAccountRecord>;
  saveAccount(account: CaracolAccountRecord): Promise<void>;
  saveWorld(world: CaracolWorldRecord): Promise<void>;
  commit(changes: CaracolCommit): Promise<void>;
  appendHistory(input: Omit<CaracolHistoryRecord, 'id'>): Promise<CaracolHistoryRecord>;
  listHistory(input: { beforeId?: string | null; limit: number }): Promise<{
    entries: CaracolHistoryRecord[];
    hasMore: boolean;
    nextCursor: string | null;
  }>;
  upsertPushSubscription(subscription: CaracolPushRecord): Promise<void>;
  deletePushSubscription(endpoint: string): Promise<void>;
  close(): Promise<void>;
}

const WORLD_ID = 1;

function initialWorld(now = Date.now()): CaracolWorldRecord {
  return {
    snailLat: CARACOL_BRAZILIA.lat,
    snailLon: CARACOL_BRAZILIA.lon,
    speedLevel: 0,
    redirectLevel: 0,
    targetAccountId: null,
    snailCosmeticOwnedItemIds: [],
    snailCosmeticOutfit: emptyCaracolOutfit(),
    lastTickAt: now,
  };
}

export function cloneAccount(account: CaracolAccountRecord): CaracolAccountRecord {
  return { ...account, cosmeticOwnedItemIds: [...account.cosmeticOwnedItemIds], cosmeticOutfit: { ...account.cosmeticOutfit } };
}

export function cloneWorld(world: CaracolWorldRecord): CaracolWorldRecord {
  return { ...world, snailCosmeticOwnedItemIds: [...world.snailCosmeticOwnedItemIds], snailCosmeticOutfit: { ...world.snailCosmeticOutfit } };
}

function clonePush(subscription: CaracolPushRecord): CaracolPushRecord {
  return { ...subscription };
}

function cloneEffect(effect: CaracolEffectRecord): CaracolEffectRecord {
  return { ...effect };
}

function rouletteItemIdFromValue(value: unknown): CaracolRouletteItemId | null {
  return typeof value === 'string' && caracolRouletteItemById.has(value as CaracolRouletteItemId) ? value as CaracolRouletteItemId : null;
}

const schemaSql = `
CREATE TABLE IF NOT EXISTS caracol_accounts (
  id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL,
  normalized_nickname TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  coins INTEGER NOT NULL DEFAULT ${CARACOL_STARTING_COINS},
  alive BOOLEAN NOT NULL DEFAULT TRUE,
  city_id TEXT,
  city_name TEXT,
  city_uf TEXT,
  city_lat DOUBLE PRECISION,
  city_lon DOUBLE PRECISION,
  speed_discount_level INTEGER NOT NULL DEFAULT 0,
  cosmetic_owned_item_ids TEXT[] NOT NULL DEFAULT '{}',
  cosmetic_outfit JSONB NOT NULL DEFAULT '{}'::JSONB,
  last_coin_accrued_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT caracol_city_complete CHECK (
    (city_id IS NULL AND city_name IS NULL AND city_uf IS NULL AND city_lat IS NULL AND city_lon IS NULL)
    OR (city_id IS NOT NULL AND city_name IS NOT NULL AND city_uf IS NOT NULL AND city_lat IS NOT NULL AND city_lon IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS caracol_accounts_alive_city_idx
  ON caracol_accounts (alive, city_id);

CREATE TABLE IF NOT EXISTS caracol_world (
  id INTEGER PRIMARY KEY CHECK (id = ${WORLD_ID}),
  snail_lat DOUBLE PRECISION NOT NULL,
  snail_lon DOUBLE PRECISION NOT NULL,
  speed_level INTEGER NOT NULL DEFAULT 0,
  redirect_level INTEGER NOT NULL DEFAULT 0,
  target_account_id TEXT REFERENCES caracol_accounts(id) ON DELETE SET NULL,
  snail_cosmetic_owned_item_ids TEXT[] NOT NULL DEFAULT '{}',
  snail_cosmetic_outfit JSONB NOT NULL DEFAULT '{}'::JSONB,
  last_tick_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS caracol_push_subscriptions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES caracol_accounts(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  expiration_time BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS caracol_push_account_idx
  ON caracol_push_subscriptions (account_id);

CREATE TABLE IF NOT EXISTS caracol_history (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  actor_nickname TEXT,
  target_nickname TEXT,
  amount INTEGER,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS caracol_history_created_idx
  ON caracol_history (id DESC);

CREATE TABLE IF NOT EXISTS caracol_effects (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('account', 'world')),
  account_id TEXT REFERENCES caracol_accounts(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  charges INTEGER,
  CONSTRAINT caracol_effects_owner CHECK ((scope = 'world') = (account_id IS NULL))
);

-- UNIQUE (scope, account_id, item_id). O COALESCE existe porque no PostgreSQL
-- dois NULL nunca colidem, e o Raio (escopo mundo) não tem dono.
CREATE UNIQUE INDEX IF NOT EXISTS caracol_effects_owner_item_idx
  ON caracol_effects (scope, (COALESCE(account_id, '')), item_id);
`;

/**
 * O `pg` devolve TIMESTAMPTZ como `Date`. `new Date(String(date))` passa pelo
 * `toString()`, que não tem milissegundos, e o valor voltava arredondado.
 */
function timestampFromValue(value: unknown): number {
  return value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
}

function accountFromRow(row: Record<string, unknown>): CaracolAccountRecord {
  return {
    id: String(row.id),
    nickname: String(row.nickname),
    normalizedNickname: String(row.normalized_nickname),
    passwordHash: String(row.password_hash),
    coins: Number(row.coins),
    alive: Boolean(row.alive),
    cityId: row.city_id === null ? null : String(row.city_id),
    cityName: row.city_name === null ? null : String(row.city_name),
    cityUf: row.city_uf === null ? null : String(row.city_uf),
    cityLat: row.city_lat === null ? null : Number(row.city_lat),
    cityLon: row.city_lon === null ? null : Number(row.city_lon),
    speedDiscountLevel: Number(row.speed_discount_level),
    cosmeticOwnedItemIds: Array.isArray(row.cosmetic_owned_item_ids) ? row.cosmetic_owned_item_ids.map(String) : [],
    cosmeticOutfit: outfitFromValue(row.cosmetic_outfit),
    lastCoinAccruedAt: timestampFromValue(row.last_coin_accrued_at),
    lastRouletteAt: row.last_roulette_at == null ? null : timestampFromValue(row.last_roulette_at),
    lastRouletteItemId: rouletteItemIdFromValue(row.last_roulette_item_id),
    createdAt: timestampFromValue(row.created_at),
    updatedAt: timestampFromValue(row.updated_at),
  };
}

function worldFromRow(row: Record<string, unknown>): CaracolWorldRecord {
  return {
    snailLat: Number(row.snail_lat),
    snailLon: Number(row.snail_lon),
    speedLevel: Number(row.speed_level),
    redirectLevel: Number(row.redirect_level ?? 0),
    targetAccountId: row.target_account_id === null ? null : String(row.target_account_id),
    snailCosmeticOwnedItemIds: Array.isArray(row.snail_cosmetic_owned_item_ids) ? row.snail_cosmetic_owned_item_ids.map(String) : [],
    snailCosmeticOutfit: outfitFromValue(row.snail_cosmetic_outfit),
    lastTickAt: timestampFromValue(row.last_tick_at),
  };
}

function outfitFromValue(value: unknown): CaracolOutfit {
  const outfit = emptyCaracolOutfit();
  if (!value || typeof value !== 'object') return outfit;
  for (const slot of Object.keys(outfit) as Array<keyof CaracolOutfit>) {
    const itemId = (value as Record<string, unknown>)[slot];
    outfit[slot] = typeof itemId === 'string' && itemId.length > 0 ? itemId : null;
  }
  return outfit;
}

function historyFromRow(row: Record<string, unknown>): CaracolHistoryRecord {
  return {
    id: String(row.id),
    type: String(row.event_type) as CaracolHistoryType,
    message: String(row.message),
    actorNickname: row.actor_nickname === null ? null : String(row.actor_nickname),
    targetNickname: row.target_nickname === null ? null : String(row.target_nickname),
    amount: row.amount === null ? null : Number(row.amount),
    createdAt: timestampFromValue(row.created_at),
  };
}

function effectFromRow(row: Record<string, unknown>): CaracolEffectRecord | null {
  const itemId = rouletteItemIdFromValue(row.item_id);
  // Um item que saiu do catálogo deixa a linha órfã; ela é ignorada até vencer.
  if (!itemId) return null;
  return {
    id: String(row.id),
    scope: row.scope === 'world' ? 'world' : 'account',
    accountId: row.account_id === null ? null : String(row.account_id),
    itemId,
    createdAt: timestampFromValue(row.created_at),
    expiresAt: timestampFromValue(row.expires_at),
    charges: row.charges === null ? null : Number(row.charges),
  };
}

function pushFromRow(row: Record<string, unknown>): CaracolPushRecord {
  return {
    accountId: String(row.account_id),
    endpoint: String(row.endpoint),
    p256dh: String(row.p256dh),
    auth: String(row.auth),
    expirationTime: row.expiration_time === null ? null : Number(row.expiration_time),
    updatedAt: timestampFromValue(row.updated_at),
  };
}

export class MemoryCaracolStore implements CaracolStore {
  private readonly accounts = new Map<string, CaracolAccountRecord>();
  private readonly pushes = new Map<string, CaracolPushRecord>();
  private readonly effects = new Map<string, CaracolEffectRecord>();
  private readonly history: CaracolHistoryRecord[] = [];
  private nextHistoryId = 1;
  private world: CaracolWorldRecord = initialWorld();

  async initialize(): Promise<void> {
    // The in-memory implementation is intentionally used by local development
    // and unit tests when DATABASE_URL is absent.
  }

  async loadSnapshot(): Promise<CaracolSnapshot> {
    return {
      accounts: Array.from(this.accounts.values(), cloneAccount),
      world: cloneWorld(this.world),
      pushSubscriptions: Array.from(this.pushes.values(), clonePush),
      effects: Array.from(this.effects.values(), cloneEffect),
    };
  }

  async createAccount(input: Omit<CaracolAccountRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<CaracolAccountRecord> {
    if (Array.from(this.accounts.values()).some((account) => account.normalizedNickname === input.normalizedNickname)) {
      throw new CaracolNicknameTakenError();
    }
    const now = Date.now();
    const account: CaracolAccountRecord = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
    this.accounts.set(account.id, cloneAccount(account));
    return cloneAccount(account);
  }

  async saveAccount(account: CaracolAccountRecord): Promise<void> {
    account.updatedAt = Date.now();
    this.accounts.set(account.id, cloneAccount(account));
  }

  async saveWorld(world: CaracolWorldRecord): Promise<void> {
    this.world = cloneWorld(world);
  }

  async commit(changes: CaracolCommit): Promise<void> {
    for (const account of changes.accounts ?? []) await this.saveAccount(account);
    if (changes.world) await this.saveWorld(changes.world);
    for (const effect of changes.upsertEffects ?? []) this.effects.set(effect.id, cloneEffect(effect));
    for (const effectId of changes.deleteEffectIds ?? []) this.effects.delete(effectId);
  }

  async appendHistory(input: Omit<CaracolHistoryRecord, 'id'>): Promise<CaracolHistoryRecord> {
    const entry = { ...input, id: String(this.nextHistoryId++) };
    this.history.push({ ...entry });
    return { ...entry };
  }

  async listHistory(input: { beforeId?: string | null; limit: number }): Promise<{
    entries: CaracolHistoryRecord[];
    hasMore: boolean;
    nextCursor: string | null;
  }> {
    const limit = Math.max(1, input.limit);
    const before = input.beforeId && /^\d+$/.test(input.beforeId) ? Number(input.beforeId) : null;
    const entries = this.history
      .filter((entry) => before === null || Number(entry.id) < before)
      .slice()
      .sort((a, b) => Number(b.id) - Number(a.id));
    const page = entries.slice(0, limit).map((entry) => ({ ...entry }));
    const hasMore = entries.length > limit;
    return { entries: page, hasMore, nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null };
  }

  async upsertPushSubscription(subscription: CaracolPushRecord): Promise<void> {
    this.pushes.set(subscription.endpoint, clonePush(subscription));
  }

  async deletePushSubscription(endpoint: string): Promise<void> {
    this.pushes.delete(endpoint);
  }

  async close(): Promise<void> {
    // Nothing to close.
  }
}

export class PgCaracolStore implements CaracolStore {
  private readonly pool: Pool;

  constructor(config: PoolConfig | string) {
    this.pool = typeof config === 'string' ? new Pool({ connectionString: config }) : new Pool(config);
  }

  async initialize(): Promise<void> {
    await this.pool.query(schemaSql);
    await this.pool.query("ALTER TABLE caracol_accounts ADD COLUMN IF NOT EXISTS cosmetic_owned_item_ids TEXT[] NOT NULL DEFAULT '{}' ");
    await this.pool.query("ALTER TABLE caracol_accounts ADD COLUMN IF NOT EXISTS cosmetic_outfit JSONB NOT NULL DEFAULT '{}'::JSONB");
    await this.pool.query("ALTER TABLE caracol_world ADD COLUMN IF NOT EXISTS snail_cosmetic_owned_item_ids TEXT[] NOT NULL DEFAULT '{}' ");
    await this.pool.query("ALTER TABLE caracol_world ADD COLUMN IF NOT EXISTS snail_cosmetic_outfit JSONB NOT NULL DEFAULT '{}'::JSONB");
    await this.pool.query('ALTER TABLE caracol_world ADD COLUMN IF NOT EXISTS redirect_level INTEGER NOT NULL DEFAULT 0');
    // CREATE TABLE IF NOT EXISTS não mexe em caracol_accounts que já existe em
    // produção; sem estes ALTER a coluna nova nunca apareceria.
    await this.pool.query('ALTER TABLE caracol_accounts ADD COLUMN IF NOT EXISTS last_roulette_at TIMESTAMPTZ');
    await this.pool.query('ALTER TABLE caracol_accounts ADD COLUMN IF NOT EXISTS last_roulette_item_id TEXT');
    await this.pool.query(
      `INSERT INTO caracol_world (id, snail_lat, snail_lon, speed_level, redirect_level, last_tick_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [WORLD_ID, CARACOL_BRAZILIA.lat, CARACOL_BRAZILIA.lon, 0, 0],
    );
  }

  async loadSnapshot(): Promise<CaracolSnapshot> {
    const [accounts, world, pushes, effects] = await Promise.all([
      this.pool.query('SELECT * FROM caracol_accounts ORDER BY nickname'),
      this.pool.query('SELECT * FROM caracol_world WHERE id = $1', [WORLD_ID]),
      this.pool.query('SELECT * FROM caracol_push_subscriptions'),
      this.pool.query('SELECT * FROM caracol_effects'),
    ]);
    const worldRow = world.rows[0] as Record<string, unknown> | undefined;
    return {
      accounts: accounts.rows.map((row) => accountFromRow(row as Record<string, unknown>)),
      world: worldRow ? worldFromRow(worldRow) : initialWorld(),
      pushSubscriptions: pushes.rows.map((row) => pushFromRow(row as Record<string, unknown>)),
      effects: effects.rows
        .map((row) => effectFromRow(row as Record<string, unknown>))
        .filter((effect): effect is CaracolEffectRecord => effect !== null),
    };
  }

  async createAccount(input: Omit<CaracolAccountRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<CaracolAccountRecord> {
    try {
      const result = await this.pool.query(
        `INSERT INTO caracol_accounts (
          id, nickname, normalized_nickname, password_hash, coins, alive,
          city_id, city_name, city_uf, city_lat, city_lon,
          speed_discount_level, cosmetic_owned_item_ids, cosmetic_outfit, last_coin_accrued_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, TO_TIMESTAMP($15 / 1000.0))
        RETURNING *`,
        [
          randomUUID(), input.nickname, input.normalizedNickname, input.passwordHash,
          input.coins, input.alive, input.cityId, input.cityName, input.cityUf,
          input.cityLat, input.cityLon, input.speedDiscountLevel, input.cosmeticOwnedItemIds,
          JSON.stringify(input.cosmeticOutfit), input.lastCoinAccruedAt,
        ],
      );
      return accountFromRow(result.rows[0] as Record<string, unknown>);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        throw new CaracolNicknameTakenError();
      }
      throw error;
    }
  }

  async saveAccount(account: CaracolAccountRecord): Promise<void> {
    await this.writeAccount(this.pool, account);
  }

  async saveWorld(world: CaracolWorldRecord): Promise<void> {
    await this.writeWorld(this.pool, world);
  }

  /**
   * Roda `work` entre BEGIN e COMMIT. Se o ROLLBACK também falhar, o erro que
   * sobe continua sendo o original, e o client sai do pool em vez de voltar
   * com a transação aberta para a próxima consulta.
   */
  private async transaction(work: (client: PoolClient) => Promise<void>): Promise<void> {
    const client = await this.pool.connect();
    let brokenConnection: Error | undefined;
    try {
      await client.query('BEGIN');
      await work(client);
      await client.query('COMMIT');
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        brokenConnection = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
      }
      throw error;
    } finally {
      client.release(brokenConnection);
    }
  }

  async commit(changes: CaracolCommit): Promise<void> {
    await this.transaction(async (client) => {
      for (const account of changes.accounts ?? []) await this.writeAccount(client, account);
      if (changes.world) await this.writeWorld(client, changes.world);
      for (const effect of changes.upsertEffects ?? []) {
        await client.query(
          `INSERT INTO caracol_effects (id, scope, account_id, item_id, created_at, expires_at, charges)
           VALUES ($1, $2, $3, $4, TO_TIMESTAMP($5 / 1000.0), TO_TIMESTAMP($6 / 1000.0), $7)
           ON CONFLICT (id) DO UPDATE SET created_at = EXCLUDED.created_at,
             expires_at = EXCLUDED.expires_at, charges = EXCLUDED.charges`,
          [effect.id, effect.scope, effect.accountId, effect.itemId, effect.createdAt, effect.expiresAt, effect.charges],
        );
      }
      if (changes.deleteEffectIds?.length) {
        await client.query('DELETE FROM caracol_effects WHERE id = ANY($1::TEXT[])', [changes.deleteEffectIds]);
      }
    });
  }

  private async writeAccount(db: Pick<Pool, 'query'>, account: CaracolAccountRecord): Promise<void> {
    await db.query(
      `UPDATE caracol_accounts SET
        coins = $2, alive = $3, city_id = $4, city_name = $5, city_uf = $6,
        city_lat = $7, city_lon = $8, speed_discount_level = $9,
        cosmetic_owned_item_ids = $10, cosmetic_outfit = $11,
        last_coin_accrued_at = TO_TIMESTAMP($12 / 1000.0),
        last_roulette_at = CASE WHEN $13::DOUBLE PRECISION IS NULL THEN NULL ELSE TO_TIMESTAMP($13::DOUBLE PRECISION / 1000.0) END,
        last_roulette_item_id = $14, updated_at = NOW()
       WHERE id = $1`,
      [account.id, account.coins, account.alive, account.cityId, account.cityName, account.cityUf, account.cityLat, account.cityLon, account.speedDiscountLevel, account.cosmeticOwnedItemIds, JSON.stringify(account.cosmeticOutfit), account.lastCoinAccruedAt, account.lastRouletteAt, account.lastRouletteItemId],
    );
  }

  private async writeWorld(db: Pick<Pool, 'query'>, world: CaracolWorldRecord): Promise<void> {
    await db.query(
      `UPDATE caracol_world SET snail_lat = $2, snail_lon = $3, speed_level = $4,
        redirect_level = $5, target_account_id = $6, snail_cosmetic_owned_item_ids = $7,
        snail_cosmetic_outfit = $8, last_tick_at = TO_TIMESTAMP($9 / 1000.0), updated_at = NOW()
       WHERE id = $1`,
      [WORLD_ID, world.snailLat, world.snailLon, world.speedLevel, world.redirectLevel, world.targetAccountId, world.snailCosmeticOwnedItemIds, JSON.stringify(world.snailCosmeticOutfit), world.lastTickAt],
    );
  }

  async appendHistory(input: Omit<CaracolHistoryRecord, 'id'>): Promise<CaracolHistoryRecord> {
    const result = await this.pool.query(
      `INSERT INTO caracol_history (event_type, message, actor_nickname, target_nickname, amount, created_at)
       VALUES ($1, $2, $3, $4, $5, TO_TIMESTAMP($6 / 1000.0))
       RETURNING *`,
      [input.type, input.message, input.actorNickname, input.targetNickname, input.amount, input.createdAt],
    );
    return historyFromRow(result.rows[0] as Record<string, unknown>);
  }

  async listHistory(input: { beforeId?: string | null; limit: number }): Promise<{
    entries: CaracolHistoryRecord[];
    hasMore: boolean;
    nextCursor: string | null;
  }> {
    const limit = Math.max(1, Math.min(100, Math.floor(input.limit)));
    const hasCursor = Boolean(input.beforeId && /^\d+$/.test(input.beforeId));
    const result = hasCursor
      ? await this.pool.query('SELECT * FROM caracol_history WHERE id < $1 ORDER BY id DESC LIMIT $2', [input.beforeId, limit + 1])
      : await this.pool.query('SELECT * FROM caracol_history ORDER BY id DESC LIMIT $1', [limit + 1]);
    const rows = result.rows.map((row) => historyFromRow(row as Record<string, unknown>));
    const hasMore = rows.length > limit;
    const entries = rows.slice(0, limit);
    return { entries, hasMore, nextCursor: hasMore ? entries[entries.length - 1]?.id ?? null : null };
  }

  async upsertPushSubscription(subscription: CaracolPushRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO caracol_push_subscriptions (id, account_id, endpoint, p256dh, auth, expiration_time)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (endpoint) DO UPDATE SET account_id = EXCLUDED.account_id,
         p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
         expiration_time = EXCLUDED.expiration_time, updated_at = NOW()`,
      [randomUUID(), subscription.accountId, subscription.endpoint, subscription.p256dh, subscription.auth, subscription.expirationTime],
    );
  }

  async deletePushSubscription(endpoint: string): Promise<void> {
    await this.pool.query('DELETE FROM caracol_push_subscriptions WHERE endpoint = $1', [endpoint]);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createCaracolStore(): CaracolStore {
  const connectionString = process.env.CARACOL_DATABASE_URL || process.env.DATABASE_URL;
  return connectionString ? new PgCaracolStore(connectionString) : new MemoryCaracolStore();
}
