import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GAME_CATALOG } from '../../../packages/game-catalog/src';
import { LobbyApp } from './LobbyApp';

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
});
