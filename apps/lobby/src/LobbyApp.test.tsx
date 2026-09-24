import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GAME_CATALOG } from '../../../packages/game-catalog/src';
import { LobbyApp, resolveGameHref } from './LobbyApp';

describe('lobby navigation', () => {
  it('renders one dedicated link for every catalog game', () => {
    const markup = renderToStaticMarkup(<LobbyApp />);

    expect(GAME_CATALOG).toHaveLength(4);
    for (const game of GAME_CATALOG) {
      expect(markup).toContain(`href="https://${game.domain}/"`);
      expect(markup).toContain(game.title);
    }
  });

  it('keeps game links external and does not route through the legacy game query', () => {
    const markup = renderToStaticMarkup(<LobbyApp />);

    expect(markup).not.toContain('?game=');
    expect(markup.match(/href="https:\/\/[^\"]+\.gamegamegame\.site\/"/g)).toHaveLength(4);
  });

  it('routes the HML lobby to HML game domains', () => {
    const markup = renderToStaticMarkup(<LobbyApp hostname="hml.gamegamegame.site" />);

    for (const game of GAME_CATALOG) {
      expect(markup).toContain(`href="https://hml-${game.domain}/"`);
    }
  });

  it('only rewrites canonical game URLs on the HML lobby host', () => {
    expect(resolveGameHref('https://whoami.gamegamegame.site/', 'hml.gamegamegame.site'))
      .toBe('https://hml-whoami.gamegamegame.site/');
    expect(resolveGameHref('https://whoami.gamegamegame.site/', 'gamegamegame.site'))
      .toBe('https://whoami.gamegamegame.site/');
    expect(resolveGameHref('https://example.com/', 'hml.gamegamegame.site'))
      .toBe('https://example.com/');
  });
});
