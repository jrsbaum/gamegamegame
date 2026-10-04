import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GAME_CATALOG } from '../../../packages/game-catalog/src';
import { LobbyApp, resolveGameHref } from './LobbyApp';

describe('lobby navigation', () => {
  it('renders one dedicated link for every catalog game', () => {
    const markup = renderToStaticMarkup(<LobbyApp />);

    expect(GAME_CATALOG).toHaveLength(6);
    for (const game of GAME_CATALOG) {
      expect(markup).toContain(`href="https://${game.domain}/"`);
      expect(markup).toContain(game.title);
    }
  });

  it('keeps game links external and does not route through the legacy game query', () => {
    const markup = renderToStaticMarkup(<LobbyApp />);

    expect(markup).not.toContain('?game=');
    expect(markup.match(/href="https:\/\/[^\"]+\.gamegamegame\.site\/"/g)).toHaveLength(6);
  });

  it('routes every game, including the village, to its HML domain on the HML lobby', () => {
    const markup = renderToStaticMarkup(<LobbyApp hostname="hml.gamegamegame.site" />);
    for (const game of GAME_CATALOG) expect(markup).toContain(`href="https://hml-${game.domain}/"`);
    expect(markup).toContain('href="https://hml-agents.gamegamegame.site/"');
  });

  it('only rewrites canonical HTTPS game destinations on the HML lobby', () => {
    expect(resolveGameHref('https://agents.gamegamegame.site/', 'hml.gamegamegame.site')).toBe('https://hml-agents.gamegamegame.site/');
    expect(resolveGameHref('https://agents.gamegamegame.site/', 'gamegamegame.site')).toBe('https://agents.gamegamegame.site/');
    expect(resolveGameHref('https://example.com/', 'hml.gamegamegame.site')).toBe('https://example.com/');
    expect(resolveGameHref('https://hml-agents.gamegamegame.site/', 'hml.gamegamegame.site')).toBe('https://hml-agents.gamegamegame.site/');
  });
});
