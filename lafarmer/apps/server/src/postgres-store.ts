import { Pool, type QueryResultRow } from "pg";
import type { Account, FarmItem, LandPlot, MarketListing, PlayerState, Session, Specialization } from "./domain.js";
import type { AccountRepository, FarmRepository, MarketRepository, PlayerRepository, RepositoryBundle, SessionRepository } from "./repositories.js";

export const POSTGRES_SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY,
  normalized_nick TEXT NOT NULL UNIQUE,
  nick TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  farm_name TEXT NOT NULL DEFAULT '',
  specialization TEXT,
  plot JSONB,
  clothing TEXT NOT NULL CHECK (clothing IN ('forest', 'coral', 'river')),
  hair TEXT NOT NULL CHECK (hair IN ('short', 'long')),
  coins INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0),
  inventory JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  position_x DOUBLE PRECISION NOT NULL DEFAULT 5,
  position_y DOUBLE PRECISION NOT NULL DEFAULT 5
);

ALTER TABLE players ADD COLUMN IF NOT EXISTS inventory JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE players ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE players ADD COLUMN IF NOT EXISTS farm_name TEXT NOT NULL DEFAULT '';
ALTER TABLE players ADD COLUMN IF NOT EXISTS specialization TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS plot JSONB;

CREATE TABLE IF NOT EXISTS farm_items (
  id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  content_id TEXT NOT NULL,
  planted_at TIMESTAMPTZ NOT NULL,
  last_care_at TIMESTAMPTZ,
  position_x DOUBLE PRECISION NOT NULL,
  position_y DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS market_listings (
  id UUID PRIMARY KEY,
  seller_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  seller_name TEXT NOT NULL,
  content_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price > 0),
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
`;

export async function initializePostgresSchema(pool: Pool): Promise<void> {
  await pool.query(POSTGRES_SCHEMA);
}

class PostgresAccounts implements AccountRepository {
  constructor(private readonly pool: Pool) {}

  async findById(id: string): Promise<Account | undefined> {
    const result = await this.pool.query<AccountRow>(
      "SELECT id, normalized_nick, nick, password_hash, created_at FROM accounts WHERE id = $1",
      [id]
    );
    return result.rows[0] ? mapAccount(result.rows[0]) : undefined;
  }

  async findByNormalizedNick(normalizedNick: string): Promise<Account | undefined> {
    const result = await this.pool.query<AccountRow>(
      "SELECT id, normalized_nick, nick, password_hash, created_at FROM accounts WHERE normalized_nick = $1",
      [normalizedNick]
    );
    return result.rows[0] ? mapAccount(result.rows[0]) : undefined;
  }

  async insert(account: Account): Promise<void> {
    await this.pool.query(
      `INSERT INTO accounts (id, normalized_nick, nick, password_hash, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [account.id, account.normalizedNick, account.nick, account.passwordHash, account.createdAt]
    );
  }
}

class PostgresSessions implements SessionRepository {
  constructor(private readonly pool: Pool) {}

  async findByToken(token: string): Promise<Session | undefined> {
    const result = await this.pool.query<SessionRow>(
      "SELECT token, account_id, expires_at FROM sessions WHERE token = $1",
      [token]
    );
    return result.rows[0] ? mapSession(result.rows[0]) : undefined;
  }

  async insert(session: Session): Promise<void> {
    await this.pool.query(
      `INSERT INTO sessions (token, account_id, expires_at)
       VALUES ($1, $2, to_timestamp($3 / 1000.0))`,
      [session.token, session.accountId, session.expiresAt]
    );
  }

  async delete(token: string): Promise<void> {
    await this.pool.query("DELETE FROM sessions WHERE token = $1", [token]);
  }
}

class PostgresPlayers implements PlayerRepository {
  constructor(private readonly pool: Pool) {}

  async findById(id: string): Promise<PlayerState | undefined> {
    const result = await this.pool.query<PlayerRow>(playerSelect + " WHERE id = $1", [id]);
    return result.rows[0] ? mapPlayer(result.rows[0]) : undefined;
  }

  async findByAccountId(accountId: string): Promise<PlayerState | undefined> {
    const result = await this.pool.query<PlayerRow>(playerSelect + " WHERE account_id = $1", [accountId]);
    return result.rows[0] ? mapPlayer(result.rows[0]) : undefined;
  }

  async insert(player: PlayerState): Promise<void> {
    await this.pool.query(
      `INSERT INTO players (id, account_id, name, farm_name, specialization, plot, clothing, hair, coins, inventory, last_active_at, position_x, position_y)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, to_timestamp($11 / 1000.0), $12, $13)`,
      [
        player.id,
        player.accountId,
        player.name,
        player.farmName,
        player.specialization,
        player.plot ? JSON.stringify(player.plot) : null,
        player.appearance.clothing,
        player.appearance.hair,
        player.coins,
        JSON.stringify(player.inventory),
        player.lastActiveAt,
        player.position.x,
        player.position.y
      ]
    );
  }

  async update(player: PlayerState): Promise<void> {
    await this.pool.query(
      `UPDATE players
       SET name = $2, farm_name = $3, specialization = $4, plot = $5, clothing = $6, hair = $7, coins = $8, inventory = $9, last_active_at = to_timestamp($10 / 1000.0), position_x = $11, position_y = $12
       WHERE id = $1`,
      [
        player.id,
        player.name,
        player.farmName,
        player.specialization,
        player.plot ? JSON.stringify(player.plot) : null,
        player.appearance.clothing,
        player.appearance.hair,
        player.coins,
        JSON.stringify(player.inventory),
        player.lastActiveAt,
        player.position.x,
        player.position.y
      ]
    );
  }

  async listAll(): Promise<PlayerState[]> {
    const result = await this.pool.query<PlayerRow>(playerSelect);
    return result.rows.map(mapPlayer);
  }
}

class PostgresFarm implements FarmRepository {
  constructor(private readonly pool: Pool) {}
  async listByOwnerId(ownerId: string): Promise<FarmItem[]> { const result = await this.pool.query<FarmRow>(farmSelect + " WHERE owner_id = $1", [ownerId]); return result.rows.map(mapFarm); }
  async listAll(): Promise<FarmItem[]> { const result = await this.pool.query<FarmRow>(farmSelect); return result.rows.map(mapFarm); }
  async insert(item: FarmItem): Promise<void> { await this.pool.query("INSERT INTO farm_items (id, owner_id, content_id, planted_at, last_care_at, position_x, position_y) VALUES ($1, $2, $3, to_timestamp($4 / 1000.0), CASE WHEN $5::bigint IS NULL THEN NULL ELSE to_timestamp($5 / 1000.0) END, $6, $7)", [item.id, item.ownerId, item.contentId, item.plantedAt, item.lastCareAt, item.position.x, item.position.y]); }
  async update(item: FarmItem): Promise<void> { await this.pool.query("UPDATE farm_items SET last_care_at = CASE WHEN $2::bigint IS NULL THEN NULL ELSE to_timestamp($2 / 1000.0) END, position_x = $3, position_y = $4 WHERE id = $1", [item.id, item.lastCareAt, item.position.x, item.position.y]); }
  async delete(id: string): Promise<void> { await this.pool.query("DELETE FROM farm_items WHERE id = $1", [id]); }
}

class PostgresMarket implements MarketRepository {
  constructor(private readonly pool: Pool) {}
  async listActive(): Promise<MarketListing[]> { const result = await this.pool.query<MarketRow>(marketSelect); return result.rows.map(mapMarket); }
  async findById(id: string): Promise<MarketListing | undefined> { const result = await this.pool.query<MarketRow>(marketSelect + " WHERE id = $1", [id]); return result.rows[0] ? mapMarket(result.rows[0]) : undefined; }
  async insert(listing: MarketListing): Promise<void> { await this.pool.query("INSERT INTO market_listings (id, seller_id, seller_name, content_id, quantity, unit_price, created_at) VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0))", [listing.id, listing.sellerId, listing.sellerName, listing.contentId, listing.quantity, listing.unitPrice, listing.createdAt]); }
  async delete(id: string): Promise<void> { await this.pool.query("DELETE FROM market_listings WHERE id = $1", [id]); }
}

export function createPostgresRepositories(pool: Pool): RepositoryBundle {
  return {
    accounts: new PostgresAccounts(pool),
    sessions: new PostgresSessions(pool),
    players: new PostgresPlayers(pool),
    farm: new PostgresFarm(pool),
    market: new PostgresMarket(pool)
  };
}

type AccountRow = QueryResultRow & {
  id: string;
  normalized_nick: string;
  nick: string;
  password_hash: string;
  created_at: Date | string;
};

type SessionRow = QueryResultRow & {
  token: string;
  account_id: string;
  expires_at: Date | string;
};

type PlayerRow = QueryResultRow & {
  id: string;
  account_id: string;
  name: string;
  farm_name: string;
  specialization: Specialization | null;
  plot: LandPlot | null;
  clothing: "forest" | "coral" | "river";
  hair: "short" | "long";
  coins: number;
  inventory: Record<string, number>;
  last_active_at: Date | string;
  position_x: number;
  position_y: number;
};

const playerSelect = `SELECT id, account_id, name, farm_name, specialization, plot, clothing, hair, coins, inventory, last_active_at, position_x, position_y FROM players`;
const farmSelect = `SELECT id, owner_id, content_id, planted_at, last_care_at, position_x, position_y FROM farm_items`;
const marketSelect = `SELECT id, seller_id, seller_name, content_id, quantity, unit_price, created_at FROM market_listings`;

type FarmRow = QueryResultRow & { id: string; owner_id: string; content_id: string; planted_at: Date | string; last_care_at: Date | string | null; position_x: number; position_y: number };
type MarketRow = QueryResultRow & { id: string; seller_id: string; seller_name: string; content_id: string; quantity: number; unit_price: number; created_at: Date | string };

function mapAccount(row: AccountRow): Account {
  return {
    id: row.id,
    normalizedNick: row.normalized_nick,
    nick: row.nick,
    passwordHash: row.password_hash,
    createdAt: asDate(row.created_at)
  };
}

function mapSession(row: SessionRow): Session {
  return {
    token: row.token,
    accountId: row.account_id,
    expiresAt: new Date(row.expires_at).getTime()
  };
}

function mapPlayer(row: PlayerRow): PlayerState {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    farmName: row.farm_name ?? "",
    specialization: row.specialization,
    plot: row.plot,
    appearance: { clothing: row.clothing, hair: row.hair },
    coins: row.coins,
    inventory: row.inventory ?? {},
    lastActiveAt: new Date(row.last_active_at).getTime(),
    position: { x: row.position_x, y: row.position_y }
  };
}

function mapFarm(row: FarmRow): FarmItem { return { id: row.id, ownerId: row.owner_id, contentId: row.content_id, plantedAt: new Date(row.planted_at).getTime(), lastCareAt: row.last_care_at ? new Date(row.last_care_at).getTime() : null, position: { x: row.position_x, y: row.position_y } }; }
function mapMarket(row: MarketRow): MarketListing { return { id: row.id, sellerId: row.seller_id, sellerName: row.seller_name, contentId: row.content_id, quantity: row.quantity, unitPrice: row.unit_price, createdAt: new Date(row.created_at).getTime() }; }

function asDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
