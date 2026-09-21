import type { Account, PlayerState, Session } from "./domain.js";

export interface AccountRepository {
  findById(id: string): Promise<Account | undefined>;
  findByNormalizedNick(normalizedNick: string): Promise<Account | undefined>;
  insert(account: Account): Promise<void>;
}

export interface SessionRepository {
  findByToken(token: string): Promise<Session | undefined>;
  insert(session: Session): Promise<void>;
  delete(token: string): Promise<void>;
}

export interface PlayerRepository {
  findById(id: string): Promise<PlayerState | undefined>;
  findByAccountId(accountId: string): Promise<PlayerState | undefined>;
  insert(player: PlayerState): Promise<void>;
  update(player: PlayerState): Promise<void>;
}

export type RepositoryBundle = {
  accounts: AccountRepository;
  sessions: SessionRepository;
  players: PlayerRepository;
};
