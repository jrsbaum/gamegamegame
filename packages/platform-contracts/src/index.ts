export const GAME_IDS = ['whoami', 'impostor', 'caracol', 'lafarmer'] as const;
export type GameId = typeof GAME_IDS[number];

export const GAME_STATUSES = ['active', 'soon', 'maintenance'] as const;
export type GameStatus = typeof GAME_STATUSES[number];

export type GameDomain = 'gamegamegame.site' | `${string}.gamegamegame.site`;

export interface GameCatalogEntry {
  readonly id: GameId;
  readonly domain: GameDomain;
  readonly status: GameStatus;
  readonly title: string;
  readonly description: string;
  readonly detail: string;
  readonly mark: string;
  readonly tone: string;
}

export type GameNavigation =
  | { readonly kind: 'link'; readonly href: string }
  | { readonly kind: 'unavailable'; readonly status: Exclude<GameStatus, 'active'>; readonly label: string };

export const GAME_STATUS_LABELS: Readonly<Record<GameStatus, string>> = {
  active: 'jogar agora',
  soon: 'em breve',
  maintenance: 'em manutenção',
};

export function gameUrl(domain: GameDomain): string {
  return `https://${domain}/`;
}

export function gameNavigation(game: Pick<GameCatalogEntry, 'domain' | 'status'>): GameNavigation {
  if (game.status === 'active') return { kind: 'link', href: gameUrl(game.domain) };
  return {
    kind: 'unavailable',
    status: game.status,
    label: GAME_STATUS_LABELS[game.status],
  };
}
