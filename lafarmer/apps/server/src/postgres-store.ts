import { Pool, type QueryResultRow } from "pg";
import type { Account, PlayerState, Session } from "./domain.js";
import type { AccountRepository, PlayerRepository, RepositoryBundle, SessionRepository } from "./repositories.js";

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
  clothing TEXT NOT NULL CHECK (clothing IN ('forest', 'coral', 'river')),
  hair TEXT NOT NULL CHECK (hair IN ('short', 'long')),
  coins INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0),
  position_x DOUBLE PRECISION NOT NULL DEFAULT 5,
  position_y DOUBLE PRECISION NOT NULL DEFAULT 5
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
      `INSERT INTO players (id, account_id, name, clothing, hair, coins, position_x, position_y)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        player.id,
        player.accountId,
        player.name,
        player.appearance.clothing,
        player.appearance.hair,
        player.coins,
        player.position.x,
        player.position.y
      ]
    );
  }

  async update(player: PlayerState): Promise<void> {
    await this.pool.query(
      `UPDATE players
       SET name = $2, clothing = $3, hair = $4, coins = $5, position_x = $6, position_y = $7
       WHERE id = $1`,
      [
        player.id,
        player.name,
        player.appearance.clothing,
        player.appearance.hair,
        player.coins,
        player.position.x,
        player.position.y
      ]
    );
  }
}

export function createPostgresRepositories(pool: Pool): RepositoryBundle {
  return {
    accounts: new PostgresAccounts(pool),
    sessions: new PostgresSessions(pool),
    players: new PostgresPlayers(pool)
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
  clothing: "forest" | "coral" | "river";
  hair: "short" | "long";
  coins: number;
  position_x: number;
  position_y: number;
};

const playerSelect = `SELECT id, account_id, name, clothing, hair, coins, position_x, position_y FROM players`;

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
    appearance: { clothing: row.clothing, hair: row.hair },
    coins: row.coins,
    position: { x: row.position_x, y: row.position_y }
  };
}

function asDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
