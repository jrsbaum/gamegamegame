import type { JSX } from 'react';
import { GAME_CATALOG, getGameNavigation, type CatalogGame } from '../../../packages/game-catalog/src';
import { GAME_STATUS_LABELS } from '../../../packages/platform-contracts/src';

export function resolveGameHref(href: string, hostname: string): string {
  if (hostname !== 'hml.gamegamegame.site') return href;

  const destination = new URL(href);
  if (destination.protocol !== 'https:' || !destination.hostname.endsWith('.gamegamegame.site') || destination.hostname.startsWith('hml-')) return href;

  destination.hostname = `hml-${destination.hostname}`;
  return destination.toString();
}

function GameCard({ game, index, hostname }: { game: CatalogGame; index: number; hostname: string }): JSX.Element {
  const navigation = getGameNavigation(game.id);
  const className = `lobby-game-card ${game.tone}${navigation.kind === 'unavailable' ? ' is-unavailable' : ''}`;
  const content = (
    <>
      <span className="lobby-game-index">{String(index + 1).padStart(2, '0')}</span>
      <span className="lobby-game-mark" aria-hidden="true">{game.mark}</span>
      <span className="lobby-game-copy">
        <strong>{game.title}</strong>
        <span>{game.description}</span>
      </span>
      <span className="lobby-game-detail">{game.detail}</span>
      <span className="lobby-game-arrow" aria-hidden="true">
        {navigation.kind === 'link' ? '↗' : GAME_STATUS_LABELS[game.status]}
      </span>
    </>
  );

  if (navigation.kind === 'link') {
    return <a className={className} href={resolveGameHref(navigation.href, hostname)}>{content}</a>;
  }

  return (
    <div className={className} aria-disabled="true" data-status={navigation.status}>
      {content}
    </div>
  );
}

export function LobbyApp({
  hostname = typeof window === 'undefined' ? '' : window.location.hostname,
}: { hostname?: string } = {}): JSX.Element {
  return (
    <main className="lobby-shell">
      <div className="lobby-orbit lobby-orbit-one" aria-hidden="true" />
      <div className="lobby-orbit lobby-orbit-two" aria-hidden="true" />

      <header className="lobby-topbar">
        <a className="lobby-brand" href="/" aria-label="GameGameGame, página inicial">
          <span className="lobby-brand-mark">G</span>
          <span><b>GAME</b><b>GAME</b><b>GAME</b></span>
        </a>
        <span className="lobby-top-note">jogos para jogar junto</span>
      </header>

      <section className="lobby-hero" aria-labelledby="lobby-title">
        <div className="lobby-hero-copy">
          <p className="eyebrow">Uma plataforma · quatro jeitos de brincar</p>
          <h1 id="lobby-title">Escolha uma<br /><span>confusão.</span></h1>
          <p className="lobby-lede">Cada jogo tem sua própria mesa, seu próprio ritmo e seu próprio deploy. Entre direto onde a brincadeira começa.</p>
          <div className="lobby-rule" aria-hidden="true"><span /> <small>sem cadastro para as salas</small></div>
        </div>

        <div className="lobby-games" aria-label="Jogos disponíveis">
          {GAME_CATALOG.map((game, index) => <GameCard game={game} index={index} hostname={hostname} key={game.id} />)}
        </div>
      </section>

      <footer className="lobby-footer">
        <span>GameGameGame</span>
        <span>uma sala diferente para cada jogo</span>
      </footer>
    </main>
  );
}
