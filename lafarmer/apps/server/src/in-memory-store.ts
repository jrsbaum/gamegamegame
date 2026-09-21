import type { Account, FarmItem, MarketListing, PlayerState, Session } from "./domain.js";
import type { AccountRepository, FarmRepository, MarketRepository, PlayerRepository, RepositoryBundle, SessionRepository } from "./repositories.js";

class InMemoryAccounts implements AccountRepository {
  private readonly byId = new Map<string, Account>();
  private readonly byNick = new Map<string, Account>();

  async findById(id: string): Promise<Account | undefined> {
    return this.byId.get(id);
  }

  async findByNormalizedNick(normalizedNick: string): Promise<Account | undefined> {
    return this.byNick.get(normalizedNick);
  }

  async insert(account: Account): Promise<void> {
    this.byId.set(account.id, account);
    this.byNick.set(account.normalizedNick, account);
  }
}

class InMemorySessions implements SessionRepository {
  private readonly sessions = new Map<string, Session>();

  async findByToken(token: string): Promise<Session | undefined> {
    return this.sessions.get(token);
  }

  async insert(session: Session): Promise<void> {
    this.sessions.set(session.token, session);
  }

  async delete(token: string): Promise<void> {
    this.sessions.delete(token);
  }
}

class InMemoryPlayers implements PlayerRepository {
  private readonly byId = new Map<string, PlayerState>();
  private readonly byAccountId = new Map<string, PlayerState>();

  async findById(id: string): Promise<PlayerState | undefined> {
    return this.byId.get(id);
  }

  async findByAccountId(accountId: string): Promise<PlayerState | undefined> {
    return this.byAccountId.get(accountId);
  }

  async insert(player: PlayerState): Promise<void> {
    this.byId.set(player.id, player);
    this.byAccountId.set(player.accountId, player);
  }

  async update(player: PlayerState): Promise<void> {
    this.byId.set(player.id, player);
    this.byAccountId.set(player.accountId, player);
  }

  async listAll(): Promise<PlayerState[]> { return [...this.byId.values()]; }
}

class InMemoryFarm implements FarmRepository {
  private readonly items = new Map<string, FarmItem>();
  async listByOwnerId(ownerId: string): Promise<FarmItem[]> { return [...this.items.values()].filter((item) => item.ownerId === ownerId); }
  async listAll(): Promise<FarmItem[]> { return [...this.items.values()]; }
  async insert(item: FarmItem): Promise<void> { this.items.set(item.id, item); }
  async update(item: FarmItem): Promise<void> { this.items.set(item.id, item); }
  async delete(id: string): Promise<void> { this.items.delete(id); }
}

class InMemoryMarket implements MarketRepository {
  private readonly listings = new Map<string, MarketListing>();
  async listActive(): Promise<MarketListing[]> { return [...this.listings.values()]; }
  async findById(id: string): Promise<MarketListing | undefined> { return this.listings.get(id); }
  async insert(listing: MarketListing): Promise<void> { this.listings.set(listing.id, listing); }
  async delete(id: string): Promise<void> { this.listings.delete(id); }
}

/** Dev-only adapter. Replace this bundle with PostgreSQL implementations without changing use cases. */
export function createInMemoryRepositories(): RepositoryBundle {
  return {
    accounts: new InMemoryAccounts(),
    sessions: new InMemorySessions(),
    players: new InMemoryPlayers()
    , farm: new InMemoryFarm()
    , market: new InMemoryMarket()
  };
}
