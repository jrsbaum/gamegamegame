import { describe, expect, it } from 'vitest';
import { GAME_STATUS_LABELS, GAME_STATUSES, gameNavigation, gameUrl, type GameCatalogEntry } from './index';

const baseGame: GameCatalogEntry = {
  id: 'whoami',
  domain: 'whoami.gamegamegame.site',
  status: 'active',
  title: 'Quem Sou Eu',
  description: 'Descubra o personagem.',
  detail: 'salas',
  mark: 'Q?',
  tone: 'lobby-game-whoami',
};

describe('platform game contracts', () => {
  it('exposes the complete strict status vocabulary', () => {
    expect(GAME_STATUSES).toEqual(['active', 'soon', 'maintenance']);
    expect(GAME_STATUS_LABELS).toEqual({
      active: 'jogar agora',
      soon: 'em breve',
      maintenance: 'em manutenção',
    });
  });

  it('builds canonical HTTPS URLs from game domains', () => {
    expect(gameUrl(baseGame.domain)).toBe('https://whoami.gamegamegame.site/');
  });

  it('only makes active games navigable', () => {
    expect(gameNavigation(baseGame)).toEqual({ kind: 'link', href: 'https://whoami.gamegamegame.site/' });
    expect(gameNavigation({ domain: baseGame.domain, status: 'soon' })).toEqual({
      kind: 'unavailable',
      status: 'soon',
      label: 'em breve',
    });
    expect(gameNavigation({ domain: baseGame.domain, status: 'maintenance' })).toEqual({
      kind: 'unavailable',
      status: 'maintenance',
      label: 'em manutenção',
    });
  });
});
