import type { JSX } from 'react';

type LobbyGame = {
  href: string;
  mark: string;
  title: string;
  description: string;
  detail: string;
  tone: string;
};

const DEFAULT_GAME_URLS = {
  whoami: 'https://whoami.gamegamegame.site/',
  impostor: 'https://impostor.gamegamegame.site/',
  caracol: 'https://caracol.gamegamegame.site/',
} as const;

const games: LobbyGame[] = [
  {
    href: import.meta.env.VITE_WHOAMI_URL || DEFAULT_GAME_URLS.whoami,
    mark: 'Q?',
    title: 'Quem Sou Eu',
    description: 'Descubra o personagem que todo mundo já enxerga — menos você.',
    detail: 'salas · personagens · palpites',
    tone: 'lobby-game-whoami',
  },
  {
    href: import.meta.env.VITE_IMPOSTOR_URL || DEFAULT_GAME_URLS.impostor,
    mark: '✎',
    title: 'Quem é o impostor',
    description: 'Uma palavra, um mural e uma pessoa tentando acompanhar a turma.',
    detail: 'mural · turnos · blefe',
    tone: 'lobby-game-impostor',
  },
  {
    href: import.meta.env.VITE_CARACOL_URL || DEFAULT_GAME_URLS.caracol,
    mark: '🐌',
    title: 'Caracol',
    description: 'Escolha uma cidade, junte moedas e não deixe o mapa te alcançar.',
    detail: 'mapa · perseguição · tempo real',
    tone: 'lobby-game-caracol',
  },
];

export function LobbyApp(): JSX.Element {
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
          <p className="eyebrow">Uma plataforma · três jeitos de brincar</p>
          <h1 id="lobby-title">Escolha uma<br /><span>confusão.</span></h1>
          <p className="lobby-lede">Cada jogo tem sua própria mesa, seu próprio ritmo e seu próprio deploy. Entre direto onde a brincadeira começa.</p>
          <div className="lobby-rule" aria-hidden="true"><span /> <small>sem cadastro para as salas</small></div>
        </div>

        <div className="lobby-games" aria-label="Jogos disponíveis">
          {games.map((game, index) => (
            <a className={`lobby-game-card ${game.tone}`} href={game.href} key={game.title}>
              <span className="lobby-game-index">{String(index + 1).padStart(2, '0')}</span>
              <span className="lobby-game-mark" aria-hidden="true">{game.mark}</span>
              <span className="lobby-game-copy"><strong>{game.title}</strong><span>{game.description}</span></span>
              <span className="lobby-game-detail">{game.detail}</span>
              <span className="lobby-game-arrow" aria-hidden="true">↗</span>
            </a>
          ))}
        </div>
      </section>

      <footer className="lobby-footer">
        <span>GameGameGame</span>
        <span>uma sala diferente para cada jogo</span>
      </footer>
    </main>
  );
}
