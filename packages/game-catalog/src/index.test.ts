import { describe, expect, it } from 'vitest';
import { GAME_IDS } from '../../platform-contracts/src';
import { GAME_CATALOG, getGame, getGameNavigation, hasCatalogGame, listGames } from './index';

describe('GameGameGame catalog', () => {
  it('lists every supported game exactly once with its canonical domain', () => {
    expect(GAME_CATALOG.map((game) => game.id)).toEqual([...GAME_IDS]);
    expect(GAME_CATALOG.map((game) => game.domain)).toEqual([
      'whoami.gamegamegame.site',
      'impostor.gamegamegame.site',
      'caracol.gamegamegame.site',
      'lafarmer.gamegamegame.site',
    ]);
    expect(new Set(GAME_CATALOG.map((game) => game.domain)).size).toBe(GAME_CATALOG.length);
  });

  it('keeps the catalog readonly and addressable by game id', () => {
    expect(listGames()).toBe(GAME_CATALOG);
    expect(getGame('lafarmer')).toMatchObject({ title: 'LaFarmer', status: 'active' });
    expect(hasCatalogGame('caracol')).toBe(true);
    expect(hasCatalogGame('unknown')).toBe(false);
  });

  it('maps active catalog entries to their dedicated navigation URLs', () => {
    expect(GAME_CATALOG.every((game) => getGameNavigation(game.id).kind === 'link')).toBe(true);
    expect(getGameNavigation('impostor')).toEqual({
      kind: 'link',
      href: 'https://impostor.gamegamegame.site/',
    });
  });
});
