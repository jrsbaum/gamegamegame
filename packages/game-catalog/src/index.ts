import {
  GAME_IDS,
  gameNavigation,
  type GameCatalogEntry,
  type GameId,
  type GameNavigation,
} from '../../platform-contracts/src';

export const GAME_CATALOG = [
  {
    id: 'whoami',
    domain: 'whoami.gamegamegame.site',
    status: 'active',
    mark: 'Q?',
    title: 'Quem Sou Eu',
    description: 'Descubra o personagem que todo mundo já enxerga — menos você.',
    detail: 'salas · personagens · palpites',
    tone: 'lobby-game-whoami',
  },
  {
    id: 'impostor',
    domain: 'impostor.gamegamegame.site',
    status: 'active',
    mark: '✎',
    title: 'Quem é o impostor',
    description: 'Uma palavra, um mural e uma pessoa tentando acompanhar a turma.',
    detail: 'mural · turnos · blefe',
    tone: 'lobby-game-impostor',
  },
  {
    id: 'caracol',
    domain: 'caracol.gamegamegame.site',
    status: 'active',
    mark: '🐌',
    title: 'Caracol',
    description: 'Escolha uma cidade, junte moedas e não deixe o mapa te alcançar.',
    detail: 'mapa · perseguição · tempo real',
    tone: 'lobby-game-caracol',
  },
  {
    id: 'lafarmer',
    domain: 'lafarmer.gamegamegame.site',
    status: 'active',
    mark: '🌱',
    title: 'LaFarmer',
    description: 'Cuide do seu pedaço de terra, plante e cresça com os vizinhos.',
    detail: 'fazenda · mapa · comunidade',
    tone: 'lobby-game-lafarmer',
  },
] as const satisfies readonly GameCatalogEntry[];

export type CatalogGame = typeof GAME_CATALOG[number];

const catalogById: Readonly<Record<GameId, CatalogGame>> = Object.fromEntries(
  GAME_CATALOG.map((game) => [game.id, game]),
) as Record<GameId, CatalogGame>;

export function listGames(): readonly CatalogGame[] {
  return GAME_CATALOG;
}

export function getGame(id: GameId): CatalogGame {
  return catalogById[id];
}

export function getGameNavigation(id: GameId): GameNavigation {
  return gameNavigation(getGame(id));
}

export function hasCatalogGame(id: string): id is GameId {
  return (GAME_IDS as readonly string[]).includes(id);
}
