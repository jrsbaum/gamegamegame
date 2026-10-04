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
      'lafarmer2.gamegamegame.site',
      'agents.gamegamegame.site',
    ]);
    expect(new Set(GAME_CATALOG.map((game) => game.domain)).size).toBe(GAME_CATALOG.length);
  });

  it('keeps the catalog readonly and addressable by game id', () => {
    expect(listGames()).toBe(GAME_CATALOG);
    expect(getGame('lafarmer')).toMatchObject({ title: 'LaFarmer 1', status: 'active' });
    expect(getGame('lafarmer2')).toMatchObject({ title: 'LaFarmer 2', status: 'active' });
    expect(getGame('agent-village')).toMatchObject({ title: 'Vila dos Agentes', status: 'active' });
    expect(hasCatalogGame('caracol')).toBe(true);
    expect(hasCatalogGame('unknown')).toBe(false);
  });

  it('maps active catalog entries to their dedicated navigation URLs', () => {
    expect(GAME_CATALOG.every((game) => getGameNavigation(game.id).kind === 'link')).toBe(true);
    expect(getGameNavigation('impostor')).toEqual({
      kind: 'link',
      href: 'https://impostor.gamegamegame.site/',
    });
    expect(getGameNavigation('agent-village')).toEqual({ kind: 'link', href: 'https://agents.gamegamegame.site/' });
  });
});
