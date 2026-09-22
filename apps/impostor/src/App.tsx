import { useEffect, useMemo, useRef, useState, type FormEvent, type JSX, type ReactNode } from 'react';
import type {
  DrawingStroke,
  DrawTurnDuration,
  GameMode,
  GameErrorPayload,
  GuessResultPayload,
  PlayerSolvedPayload,
  RoomActionResult,
  RoomNoticePayload,
  RoomView,
  RoundFinishedPayload,
} from '../shared/protocol';
import { availableHintPowerups } from '../shared/hints';
import { formatDuration } from '../shared/time';
import { NotesPanel } from './NotesPanel';
import { clearSession, readSession, saveSession, serverMayHibernate, socket, wakeServer, type SessionData } from './socket';
import { DrawingFinish, DrawingRound, type DrawingFeedback } from './DrawingGame';

type HomeMode = 'create' | 'join';
type SelectedGame = GameMode;
type ConnectionState = 'offline' | 'connecting' | 'waking' | 'online' | 'reconnecting';
type Feedback = { tone: 'neutral' | 'success' | 'error'; message: string } | null;
type AppProps = { allowedGame?: GameMode };

const MAX_NICKNAME_LENGTH = 24;
const DEFAULT_GAME_MODE: GameMode = 'whoami';
const DEFAULT_DRAW_TURN: DrawTurnDuration = 10_000;

function initialSelectedGame(allowedGame?: GameMode): SelectedGame {
  if (allowedGame) return allowedGame;
  return DEFAULT_GAME_MODE;
}

function App({ allowedGame }: AppProps = {}): JSX.Element {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [homeMode, setHomeMode] = useState<HomeMode>('create');
  const [nickname, setNickname] = useState(readSession()?.nickname ?? '');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [selectedGame, setSelectedGame] = useState<SelectedGame>(() => initialSelectedGame(allowedGame));
  const [drawTurnMs, setDrawTurnMs] = useState<DrawTurnDuration>(DEFAULT_DRAW_TURN);
  const [pendingAction, setPendingAction] = useState<{ mode: HomeMode; nickname: string; code: string; gameMode: GameMode; drawTurnMs: DrawTurnDuration } | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('offline');
  const [error, setError] = useState<string | null>(null);
  const [guess, setGuess] = useState('');
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [copied, setCopied] = useState(false);
  const [lastSolved, setLastSolved] = useState<PlayerSolvedPayload | null>(null);
  const [finalRanking, setFinalRanking] = useState<RoundFinishedPayload['ranking']>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [hintPickerOpen, setHintPickerOpen] = useState(false);
  const [drawFeedback, setDrawFeedback] = useState<DrawingFeedback>(null);

  useEffect(() => {
    const session = readSession();

    const onConnect = (): void => {
      setConnection('online');
      setError(null);
      if (!pendingAction) return;

      const action = pendingAction;
      setPendingAction(null);
      emitRoomAction(action.mode, action.nickname, action.code, action.gameMode, action.drawTurnMs);
    };
    const onDisconnect = (): void => setConnection('offline');
    const onConnectError = (): void => {
      // Num servidor que hiberna, as primeiras falhas são esperadas enquanto ele
      // sobe — o Socket.IO ainda tem tentativas de sobra. Só vira erro visível
      // quando o orçamento de reconexão acaba (`reconnect_failed`), para não
      // acusar falha de um servidor que está apenas acordando.
      if (serverMayHibernate) {
        setConnection('waking');
        return;
      }
      setConnection('offline');
      setError('Não consegui conectar agora. Tente novamente em alguns segundos.');
    };
    const onReconnectFailed = (): void => {
      setConnection('offline');
      setError('Não consegui conectar agora. Tente novamente em alguns segundos.');
    };
    const onRoomState = (nextRoom: RoomView): void => {
      setRoom(nextRoom);
      setConnection('online');
      if (nextRoom.phase === 'lobby') {
        setFeedback(null);
        setDrawFeedback(null);
        setFinalRanking([]);
        setNotice(null);
      }
    };
    const onRoundStarted = ({ room: nextRoom }: { room: RoomView }): void => {
      setRoom(nextRoom);
      setGuess('');
      setFeedback(null);
      setDrawFeedback(null);
      setLastSolved(null);
      setFinalRanking([]);
    };
    const onGuessResult = (result: GuessResultPayload): void => {
      setGuess('');
      setFeedback({ tone: result.correct ? 'success' : 'neutral', message: result.message });
      setRoom((current) => (current ? { ...current, guessHistory: result.history } : current));
    };
    const onPlayerSolved = (player: PlayerSolvedPayload): void => {
      setLastSolved(player);
    };
    const onRoundFinished = (payload: RoundFinishedPayload): void => {
      setRoom(payload.room);
      setFinalRanking(payload.ranking);
      if (payload.room.mode === 'draw-impostor') {
        setDrawFeedback({ tone: 'success', message: payload.room.draw?.outcome?.message ?? 'A rodada foi revelada.' });
      } else {
        setFeedback({ tone: 'success', message: 'Todo mundo descobriu. Agora a sala está revelada.' });
      }
    };
    const onDrawStroke = (stroke: DrawingStroke): void => {
      setRoom((current) => {
        if (!current?.draw || current.draw.strokes.some((existing) => existing.id === stroke.id)) return current;
        return { ...current, draw: { ...current.draw, strokes: [...current.draw.strokes, stroke] } };
      });
    };
    const onDrawAccusationResult = (result: { correct: boolean; eliminated: boolean; message: string }): void => {
      setDrawFeedback({ tone: result.correct ? 'success' : 'neutral', message: result.message });
    };
    const onDrawWordResult = (result: { correct: boolean; message: string }): void => {
      setDrawFeedback({ tone: result.correct ? 'success' : 'neutral', message: result.message });
    };
    const onRoomNotice = (payload: RoomNoticePayload): void => {
      setNotice(payload.message);
    };
    const onGameError = (payload: GameErrorPayload): void => {
      setError(payload.message);
      setDrawFeedback({ tone: 'error', message: payload.message });
      if (payload.code === 'SESSION_EXPIRED') {
        clearSession();
        setRoom(null);
        socket.disconnect();
      }
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.io.on('reconnect_failed', onReconnectFailed);
    socket.on('room:state', onRoomState);
    socket.on('round:started', onRoundStarted);
    socket.on('guess:result', onGuessResult);
    socket.on('player:solved', onPlayerSolved);
    socket.on('round:finished', onRoundFinished);
    socket.on('room:notice', onRoomNotice);
    socket.on('draw:stroke', onDrawStroke);
    socket.on('draw:accusation:result', onDrawAccusationResult);
    socket.on('draw:word:result', onDrawWordResult);
    socket.on('error', onGameError);

    let cancelled = false;
    if (session) {
      setConnection(serverMayHibernate ? 'waking' : 'reconnecting');
      socket.auth = session;
      void wakeServer().then(() => {
        if (!cancelled && !socket.connected) socket.connect();
      });
    }

    return () => {
      cancelled = true;
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.io.off('reconnect_failed', onReconnectFailed);
      socket.off('room:state', onRoomState);
      socket.off('round:started', onRoundStarted);
      socket.off('guess:result', onGuessResult);
      socket.off('player:solved', onPlayerSolved);
      socket.off('round:finished', onRoundFinished);
      socket.off('room:notice', onRoomNotice);
      socket.off('draw:stroke', onDrawStroke);
      socket.off('draw:accusation:result', onDrawAccusationResult);
      socket.off('draw:word:result', onDrawWordResult);
      socket.off('error', onGameError);
    };
  }, [pendingAction]);

  const me = useMemo(() => room?.players.find((player) => player.id === room.you.id) ?? null, [room]);
  const otherPlayers = useMemo(() => room?.players.filter((player) => player.id !== room.you.id) ?? [], [room]);
  const solvedCount = room?.players.filter((player) => player.solved).length ?? 0;
  const isHost = Boolean(room && room.hostId === room.you.id);
  // END-05/END-06: o comando de encerrar só existe quando a rodada está de fato
  // travada — alguém desconectado e ainda sem acertar — e só para o anfitrião.
  // O rótulo não diz quem caiu: a rodada não expõe identidade de desconectado.
  const roundIsStalled = Boolean(room?.players.some((player) => !player.connected && !player.solved));
  const elapsedMs = useRoundClock(room);
  // HINT-06: o disponível é derivado do mesmo cálculo do servidor
  // (`shared/hints.ts`) sobre o relógio dele (AD-003). O bloco só é lido por
  // quem ainda não acertou, então o tempo decorrido corrente basta.
  const hintsAvailable = me && elapsedMs !== null ? availableHintPowerups(elapsedMs, me.hintsUsed) : 0;
  // HINT-07/HINT-14: só quem já acertou tem o que dizer, então só ele entra na
  // lista de alvos. O servidor recusa o resto; a lista evita o pedido inútil.
  const hintTargets = useMemo(() => room?.players.filter((player) => player.solved && player.id !== room.you.id) ?? [], [room]);
  // HINT-09: o comando de responder é de quem foi escolhido, um por pedido
  // dirigido a ele — dois jogadores podem estar pedindo ao mesmo tempo.
  const hintAskers = useMemo(() => room?.players.filter((player) => player.hintRequestTargetId === room.you.id) ?? [], [room]);
  const hintTargetOfMine = useMemo(() => room?.players.find((player) => player.id === me?.hintRequestTargetId) ?? null, [room, me]);

  function emitRoomAction(mode: HomeMode, nextNickname: string, code: string, gameMode: GameMode, selectedDrawTurnMs: DrawTurnDuration): void {
    const handleResult = (result: RoomActionResult): void => {
      if (!result.ok) {
        setError(result.message);
        return;
      }
      const session: SessionData = {
        roomCode: result.roomCode,
        playerId: result.playerId,
        sessionToken: result.sessionToken,
        nickname: nextNickname,
      };
      saveSession(session);
      socket.auth = session;
      setRoom(result.room);
      setError(null);
      setFeedback(null);
      setDrawFeedback(null);
    };

    if (mode === 'create') {
      socket.emit('room:create', { nickname: nextNickname, mode: gameMode, drawTurnMs: selectedDrawTurnMs }, handleResult);
    } else {
      socket.emit('room:join', { nickname: nextNickname, code }, handleResult);
    }
  }

  function handleHomeSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const cleanNickname = nickname.trim().replace(/\s+/g, ' ');
    const cleanCode = roomCodeInput.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (cleanNickname.length < 2 || cleanNickname.length > MAX_NICKNAME_LENGTH) {
      setError('Escolha um apelido entre 2 e 24 caracteres.');
      return;
    }
    if (homeMode === 'join' && cleanCode.length !== 6) {
      setError('Digite o código de 6 letras da sala.');
      return;
    }

    setNickname(cleanNickname);
    setError(null);
    const action = { mode: homeMode, nickname: cleanNickname, code: cleanCode, gameMode: selectedGame, drawTurnMs };
    setPendingAction(action);
    if (socket.connected) {
      setPendingAction(null);
      emitRoomAction(action.mode, action.nickname, action.code, action.gameMode, action.drawTurnMs);
    } else {
      setConnection(serverMayHibernate ? 'waking' : 'connecting');
      socket.auth = {};
      void wakeServer().then(() => {
        if (!socket.connected) socket.connect();
      });
    }
  }

  function toggleReady(): void {
    if (!me || !room || room.phase !== 'lobby') return;
    socket.emit('player:ready', { ready: !me.ready });
  }

  function submitGuess(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!guess.trim() || me?.solved || room?.phase !== 'playing') return;
    setFeedback(null);
    setDrawFeedback(null);
    socket.emit('round:guess', { text: guess });
  }

  function copyRoomCode(): void {
    if (!room) return;
    void navigator.clipboard?.writeText(room.code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  function leaveRoom(): void {
    socket.emit('room:leave');
    socket.disconnect();
    clearSession();
    setRoom(null);
    setFinalRanking([]);
    setFeedback(null);
    setDrawFeedback(null);
    setError(null);
    setConnection('offline');
  }

  function playAgain(): void {
    socket.emit('round:playAgain');
  }

  function endRoundEarly(): void {
    socket.emit('round:endEarly');
  }

  function requestHint(targetId: string): void {
    socket.emit('hint:request', { targetId });
    setHintPickerOpen(false);
  }

  function answerHint(askerId: string): void {
    socket.emit('hint:answer', { askerId });
  }

  function cancelHint(): void {
    socket.emit('hint:cancel');
  }

  function removeAbsent(playerId: string): void {
    socket.emit('room:removeAbsent', { playerId });
  }

  if (!room) {
    return (
      <main className="app-shell home-shell">
        <div className="ambient-shape ambient-shape-one" />
        <div className="ambient-shape ambient-shape-two" />
        <header className="topbar home-topbar">
          <Logo />
          <ConnectionPill state={connection} />
        </header>

        <section className="home-layout" aria-labelledby="home-title">
          <div className="home-intro">
            <p className="eyebrow">Duas brincadeiras · uma sala</p>
            <h1 id="home-title">{selectedGame === 'whoami' ? <>Quem está<br />na sua<br />testa?</> : <>Quem é<br />o impostor?</>}</h1>
            <p className="home-lede">
              {selectedGame === 'whoami' ? 'Monte uma sala, distribua personagens e descubra quem você é sem olhar a sua própria carta.' : 'Montem um mural em 10 segundos por pessoa, descubram o desenho e encontrem quem não recebeu a palavra.'}
            </p>
            <div className="intro-stamp" aria-label="Regras rápidas">
              <span>2–12 pessoas</span>
              <span>sem login</span>
              <span>{selectedGame === 'whoami' ? 'em tempo real' : '10s por pessoa'}</span>
            </div>
          </div>

          <div className="home-card paper-card">
            <div className="mode-switch" role="tablist" aria-label="Ação da sala">
              <button className={homeMode === 'create' ? 'mode-button active' : 'mode-button'} type="button" onClick={() => { setHomeMode('create'); setError(null); }} role="tab" aria-selected={homeMode === 'create'}>
                Criar sala
              </button>
              <button className={homeMode === 'join' ? 'mode-button active' : 'mode-button'} type="button" onClick={() => { setHomeMode('join'); setError(null); }} role="tab" aria-selected={homeMode === 'join'}>
                Entrar
              </button>
            </div>
            {homeMode === 'create' ? (
                <div className="game-picker service-game-picker" aria-label="Jogo deste serviço">
                  <span className="micro-label">Jogo deste endereço</span>
                  <div className="game-choice is-selected service-game-choice">
                    <span className={allowedGame === 'whoami' ? 'game-choice-mark' : 'game-choice-mark draw-choice-mark'}>{allowedGame === 'whoami' ? 'Q?' : '✎'}</span>
                    <span><strong>{allowedGame === 'whoami' ? 'Quem Sou Eu' : 'Quem é o impostor'}</strong><small>{allowedGame === 'whoami' ? 'personagens na testa' : 'um mural · uma palavra'}</small></span>
                    <b aria-hidden="true">●</b>
                  </div>
                </div>
            ) : <p className="join-mode-note"><span aria-hidden="true">✦</span> O código já define qual jogo está esperando você.</p>}
            <form className="stack-form" onSubmit={handleHomeSubmit}>
              {homeMode === 'join' && (
                <label className="field-label" htmlFor="room-code">
                  Código da sala
                  <input id="room-code" className="text-input code-input" value={roomCodeInput} onChange={(event) => setRoomCodeInput(event.target.value.toUpperCase().slice(0, 6))} placeholder="ABC123" autoComplete="off" maxLength={6} />
                </label>
              )}
              <label className="field-label" htmlFor="nickname">
                Seu apelido
                <input id="nickname" className="text-input" value={nickname} onChange={(event) => setNickname(event.target.value.slice(0, MAX_NICKNAME_LENGTH))} placeholder="Como a turma vai te chamar?" autoComplete="nickname" maxLength={MAX_NICKNAME_LENGTH} />
              </label>
              <button className="primary-button full-button" type="submit">
                {homeMode === 'create' ? 'Abrir uma sala' : 'Entrar na sala'}
                <span aria-hidden="true">↗</span>
              </button>
            </form>
            {error && <InlineNotice tone="error">{error}</InlineNotice>}
            {connection === 'waking' && !error && (
              <InlineNotice tone="neutral">
                Acordando o servidor. No plano gratuito ele hiberna sem uso, e voltar leva cerca de um minuto.
              </InlineNotice>
            )}
            <p className="privacy-note"><span aria-hidden="true">✦</span> {selectedGame === 'whoami' ? 'Seu personagem nunca é enviado para a sua tela durante a rodada.' : 'A palavra nunca é enviada para o impostor.'}</p>
          </div>
        </section>

        <footer className="home-footer">
          <span>Distribua a dúvida.</span>
          <span>Descubra a resposta.</span>
          <span>Não olhe a sua testa.</span>
        </footer>
      </main>
    );
  }

  if (room.phase === 'lobby') {
    return (
      <main className="app-shell room-shell">
        <RoomHeader room={room} connection={connection} onLeave={leaveRoom} elapsedMs={elapsedMs} />
        <section className="lobby-layout" aria-labelledby="lobby-title">
          <div className="lobby-main">
            <p className="eyebrow">Sala aberta · {room.mode === 'whoami' ? 'Quem Sou Eu' : 'Quem é o impostor'}</p>
            <h1 id="lobby-title">{room.mode === 'whoami' ? 'Preparem as testas.' : 'Preparem o mural.'}</h1>
            <p className="section-lede">{room.mode === 'whoami' ? 'Quando todas as pessoas marcarem OK, cada uma recebe uma identidade que só as outras conseguem ver.' : `Quando todo mundo marcar OK, cada pessoa desenha por ${formatDrawDuration(room.drawTurnMs)}. Uma delas não vai saber o que fazer.`}</p>
            <div className="lobby-mode-note"><span className="lobby-mode-mark">{room.mode === 'whoami' ? 'Q?' : '✎'}</span><div><strong>{room.mode === 'whoami' ? 'Personagens na testa' : 'Quem é o impostor'}</strong><span>{room.mode === 'whoami' ? 'Acerte o que está na sua carta.' : `${formatDrawDuration(room.drawTurnMs)} por pessoa · passe a vez quando terminar.`}</span></div></div>
            <div className="room-code-card">
              <div>
                <span className="micro-label">Código para compartilhar</span>
                <strong>{room.code}</strong>
              </div>
              <button className="ghost-button" type="button" onClick={copyRoomCode}>{copied ? 'Copiado' : 'Copiar código'}</button>
            </div>
            <div className="ready-cta">
              <div className="ready-copy">
                <span className="ready-count">{room.players.filter((player) => player.ready).length}/{room.players.length}</span>
                <span>{room.players.length < 2 ? 'Esperando mais uma pessoa' : 'pessoas prontas'}</span>
              </div>
              <button className={me?.ready ? 'ready-button is-ready' : 'ready-button'} type="button" onClick={toggleReady}>
                <span className="ready-dot" aria-hidden="true" />
                {me?.ready ? 'Estou pronto' : 'Dar OK'}
              </button>
            </div>
            {error && <InlineNotice tone="error">{error}</InlineNotice>}
          </div>
          <aside className="players-panel paper-card" aria-label="Participantes da sala">
            <div className="panel-heading">
              <div>
                <span className="micro-label">Na sala</span>
                <h2>{room.players.length} jogadores</h2>
              </div>
              <span className="panel-mark">{room.round === 0 ? 'R00' : `R${String(room.round).padStart(2, '0')}`}</span>
            </div>
            <div className="player-list">
              {(room.round === 0 ? room.players : sortBySessionScore(room.players)).map((player) => <PlayerRow key={player.id} player={player} you={player.id === room.you.id} showScore={room.round > 0} onRemove={isHost && !player.connected && player.id !== room.you.id ? () => removeAbsent(player.id) : undefined} />)}
            </div>
            <p className="panel-footnote">O anfitrião muda automaticamente se alguém sair.</p>
          </aside>
        </section>
      </main>
    );
  }

  if (room.mode === 'draw-impostor' && room.phase === 'finished') {
    return (
      <main className="app-shell room-shell finish-shell">
        <RoomHeader room={room} connection={connection} onLeave={leaveRoom} />
        <DrawingFinish room={room} onPlayAgain={playAgain} isHost={isHost} />
      </main>
    );
  }

  if (room.phase === 'finished') {
    return (
      <main className="app-shell room-shell finish-shell">
        <RoomHeader room={room} connection={connection} onLeave={leaveRoom} elapsedMs={elapsedMs} />
        <section className="finish-layout" aria-labelledby="finish-title">
          <div className="finish-hero">
            <p className="eyebrow">Quadro revelado · rodada {String(room.round).padStart(2, '0')}</p>
            <h1 id="finish-title">Agora todo mundo sabe quem era.</h1>
            <p className="section-lede">A resposta só aparece aqui, depois que todas as pessoas encontraram a própria identidade.</p>
            {isHost ? <button className="primary-button" type="button" onClick={playAgain}>Jogar outra rodada <span aria-hidden="true">↗</span></button> : <div className="waiting-chip">Esperando o anfitrião abrir outra rodada</div>}
          </div>
          <div className="reveal-grid">
            <div className="ranking-card paper-card">
              <div className="panel-heading"><div><span className="micro-label">Placar da rodada</span><h2>Quem descobriu primeiro</h2></div><span className="panel-mark">RANK</span></div>
              <div className="ranking-list">
                {finalRanking.map((player, index) => <div className="ranking-row" key={player.playerId}><span className={`rank-number rank-${index + 1}`}>{player.rank ?? '—'}</span><span className="ranking-name">{player.nickname}{player.playerId === room.you.id ? <small> você</small> : null}</span><span className="rank-time">{player.solveMs === null ? '—' : formatDuration(player.solveMs)}</span><span className="rank-label">{index === 0 ? 'primeiro' : index === 1 ? 'segundo' : index === 2 ? 'terceiro' : 'resolvido'}</span></div>)}
              </div>
              <div className="session-standings">
                <div className="standings-heading"><span className="micro-label">Placar da sessão</span><span>rodada {String(room.round).padStart(2, '0')}</span></div>
                <div className="standings-list">
                  {sortBySessionScore(room.players).map((player) => <div className="standings-row" key={player.id}><span className="standings-name">{player.nickname}{player.id === room.you.id ? <small> você</small> : null}</span><span className="standings-gain">+{player.roundPoints ?? 0} na rodada</span><strong className="standings-total">{player.score}</strong></div>)}
                </div>
              </div>
            </div>
            <div className="reveal-card paper-card">
              <div className="panel-heading"><div><span className="micro-label">A fita completa</span><h2>Quem era quem</h2></div><span className="panel-mark">ALL IN</span></div>
              <div className="reveal-list">
                {room.players.map((player) => <RevealRow key={player.id} player={player} />)}
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (room.mode === 'draw-impostor') {
    return (
      <main className="app-shell room-shell game-shell draw-game-shell">
        <RoomHeader room={room} connection={connection} onLeave={leaveRoom} />
        <DrawingRound room={room} feedback={drawFeedback} onFeedback={setDrawFeedback} />
      </main>
    );
  }

  return (
    <main className="app-shell room-shell game-shell">
      <RoomHeader room={room} connection={connection} onLeave={leaveRoom} elapsedMs={elapsedMs} />
      <section className="game-layout" aria-labelledby="game-title">
        <div className="game-main">
          <div className="game-intro-row">
            <div><p className="eyebrow">Rodada {String(room.round).padStart(2, '0')} · olhe para os outros</p><h1 id="game-title">Você vê todo mundo.<br /><span>Menos você.</span></h1></div>
            <div className="game-meters"><div className="solve-meter"><strong>{solvedCount}</strong><span>de {room.players.length}<br />resolvidos</span></div>{room.round > 1 && me && <div className="session-meter" aria-label={`Seu total na sessão: ${me.score} pontos`}><strong>{me.score}</strong><span>pontos<br />na sessão</span></div>}</div>
          </div>
          {notice && <InlineNotice tone="neutral">{notice}</InlineNotice>}
          {isHost && roundIsStalled && (
            <div className="stalled-round-control">
              <button className="text-button end-round-button" type="button" onClick={endRoundEarly}>Encerrar rodada</button>
              <p>A rodada não vai fechar sozinha. Encerre para revelar e seguir para a próxima.</p>
            </div>
          )}
          {!me?.solved && hintsAvailable > 0 && (
            <div className="hint-powerup">
              <span className="hint-powerup-count" aria-hidden="true">{hintsAvailable}</span>
              <p><strong>Power-up de dica</strong>{hintsAvailable > 1 ? ` · ${hintsAvailable} disponíveis` : ' · 1 disponível'}<br />A rodada travou. Peça uma dica a quem já descobriu.</p>
              <button className="text-button hint-powerup-button" type="button" aria-expanded={hintPickerOpen} onClick={() => setHintPickerOpen((open) => !open)}>{hintPickerOpen ? 'Fechar' : 'Pedir dica'}</button>
              {hintPickerOpen && (hintTargets.length === 0
                ? <p className="hint-picker-empty">Ninguém descobriu ainda nesta rodada. Sem alguém do outro lado, não há de quem pedir.</p>
                : <div className="hint-picker" role="group" aria-label="Escolha de quem pedir a dica">{hintTargets.map((player) => <button className="ghost-button hint-target-button" key={player.id} type="button" onClick={() => requestHint(player.id)}>Pedir a {player.nickname}</button>)}</div>)}
            </div>
          )}
          {me?.hintRequestTargetId !== null && me !== null && (
            <div className="hint-pending">
              <p>Você pediu dica{hintTargetOfMine ? ` a ${hintTargetOfMine.nickname}` : ''}. Espere a resposta na call.</p>
              <button className="text-button hint-cancel-button" type="button" onClick={cancelHint}>Cancelar pedido</button>
            </div>
          )}
          {hintAskers.map((asker) => (
            <div className="hint-answer-request" key={asker.id}>
              <p><strong>{asker.nickname}</strong> pediu uma dica a você. Ajude na call sem entregar o nome.</p>
              <button className="text-button hint-answer-button" type="button" onClick={() => answerHint(asker.id)}>Marcar que respondi</button>
            </div>
          ))}
          {lastSolved && !me?.solved && <div className="ticker" role="status"><span className="ticker-pulse" aria-hidden="true" />{lastSolved.nickname} acabou de descobrir. A fila anda.</div>}
          <div className="identity-board">
            <div className="secret-card" data-testid="secret-card">
              <span className="card-kicker">sua testa</span>
              <div className="secret-symbol" aria-hidden="true"><span>?</span><span>?</span><span>?</span></div>
              <strong>Você não pode ver</strong>
              <p>Faça perguntas. Escute as pistas. Digite o palpite.</p>
              <span className="card-stamp">IDENTIDADE LACRADA</span>
            </div>
            <div className="others-grid" aria-label="Personagens dos outros jogadores">
              {otherPlayers.map((player, index) => <CharacterCard key={`${player.id}-${player.character?.image?.url ?? 'sem-foto'}`} player={player} index={index} />)}
            </div>
          </div>
        </div>
        <aside className="guess-panel paper-card">
          <div className="guess-panel-head"><div><span className="micro-label">Sua vez de arriscar</span><h2>{me?.solved ? 'Identidade encontrada' : 'Quem é você?'}</h2></div><span className="question-mark" aria-hidden="true">?</span></div>
          {me?.solved ? <div className="solved-box"><span className="solved-icon" aria-hidden="true">✓</span><strong>Você matou a charada.</strong><p>Agora assista à turma terminar a rodada.</p></div> : <form className="guess-form" onSubmit={submitGuess}><label className="field-label" htmlFor="guess">Digite um nome</label><div className="guess-input-wrap"><input id="guess" className="text-input" value={guess} onChange={(event) => setGuess(event.target.value)} placeholder="Ex.: uma pessoa, herói ou personagem" autoComplete="off" maxLength={100} /><button className="guess-submit" type="submit" aria-label="Enviar palpite">↗</button></div><p className="guess-hint">Sem dicas automáticas. O match aceita nomes alternativos.</p></form>}
          {feedback && <InlineNotice tone={feedback.tone}>{feedback.message}</InlineNotice>}
          <div className="history-block"><div className="history-heading"><span className="micro-label">Seu histórico</span><span>{room.guessHistory.length} palpites</span></div>{room.guessHistory.length === 0 ? <p className="history-empty">Seus palpites aparecem aqui — só para você.</p> : <ol className="guess-history">{room.guessHistory.map((item, index) => <li key={`${item}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span>{item}</li>)}</ol>}</div>
        </aside>
      </section>
      <NotesPanel roomCode={room.code} round={room.round} />
    </main>
  );
}

/**
 * Cronômetro da rodada (AD-003): o servidor é a única fonte da verdade.
 * `offset = serverNow - Date.now()` é recalculado a cada RoomView recebido
 * e o tick de 1s só existe enquanto `phase === 'playing'` — nada de relógio
 * do cliente, nada de contagem fora de rodada.
 */
function useRoundClock(room: RoomView | null): number | null {
  const offsetRef = useRef(0);
  const phase = room?.phase ?? null;
  const roundStartedAt = room?.roundStartedAt ?? null;
  const serverNow = room?.serverNow ?? null;

  useEffect(() => {
    if (serverNow === null) return;
    offsetRef.current = serverNow - Date.now();
  }, [serverNow]);

  const [elapsedMs, setElapsedMs] = useState<number | null>(() =>
    phase === 'playing' && roundStartedAt !== null ? Date.now() + offsetRef.current - roundStartedAt : null,
  );

  useEffect(() => {
    if (phase !== 'playing' || roundStartedAt === null) {
      setElapsedMs(null);
      return;
    }
    const tick = (): void => setElapsedMs(Date.now() + offsetRef.current - roundStartedAt);
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [phase, roundStartedAt]);

  return elapsedMs;
}

function Logo(): JSX.Element {
  return <div className="logo" aria-label="Quem Sou Eu"><span className="logo-mark">Q?</span><span className="logo-word">QUEM<br /><b>SOU EU</b></span></div>;
}

function formatDrawDuration(duration: DrawTurnDuration): string {
  if (duration === null) return 'sem limite';
  if (duration >= 60_000 && duration % 60_000 === 0) return `${duration / 60_000} minuto${duration === 60_000 ? '' : 's'}`;
  return `${duration / 1_000} segundos`;
}

function ConnectionPill({ state }: { state: ConnectionState }): JSX.Element {
  const labels: Record<ConnectionState, string> = { offline: 'desconectado', connecting: 'conectando', waking: 'acordando servidor', online: 'ao vivo', reconnecting: 'reconectando' };
  return <span className={`connection-pill connection-${state}`}><span className="connection-dot" aria-hidden="true" />{labels[state]}</span>;
}

function RoomHeader({ room, connection, onLeave, elapsedMs }: { room: RoomView; connection: ConnectionState; onLeave: () => void; elapsedMs?: number | null }): JSX.Element {
  return <header className="topbar room-topbar"><Logo /><div className="room-meta"><span className="room-meta-label">sala</span><strong>{room.code}</strong><span className="room-round">R{String(room.round).padStart(2, '0')}</span><span className="room-game">{room.mode === 'whoami' ? 'Q?' : '✎'}</span>{elapsedMs !== null && elapsedMs !== undefined && <span className="round-clock" aria-label="Tempo decorrido da rodada">{formatDuration(elapsedMs)}</span>}</div><div className="topbar-actions"><ConnectionPill state={connection} /><button className="text-button" type="button" onClick={onLeave}>Sair</button></div></header>;
}

/**
 * END-22: `onRemove` só chega preenchido nas linhas que o anfitrião pode
 * remover — jogador desconectado que não é ele mesmo. Sem callback, sem botão.
 */
function PlayerRow({ player, you, showScore, onRemove }: { player: RoomView['players'][number]; you: boolean; showScore: boolean; onRemove?: () => void }): JSX.Element {
  return <div className={`player-row ${player.ready ? 'player-ready' : ''} ${!player.connected ? 'player-away' : ''}`}><span className="player-avatar">{player.nickname.slice(0, 1).toUpperCase()}</span><div className="player-name"><strong>{player.nickname}{you ? <small> você</small> : null}</strong><span>{player.isHost ? 'anfitrião' : player.connected ? player.ready ? 'pronto' : 'pensando' : 'reconectando'}</span></div>{showScore && <span className="player-score" aria-label={`${player.score} pontos na sessão`}><strong>{player.score}</strong><span>pts</span></span>}{onRemove && <button className="ghost-button remove-absent-button" type="button" onClick={onRemove} aria-label={`Remover ${player.nickname} da sala`}>Remover</button>}<span className="status-ring" aria-label={player.ready ? 'pronto' : 'não pronto'}>{player.ready ? '✓' : ''}</span></div>;
}

/**
 * Ordem do placar acumulado (SCORE-14): total decrescente, desempate pelo
 * apelido em ordem alfabética.
 */
function sortBySessionScore(players: RoomView['players']): RoomView['players'] {
  return [...players].sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname, 'pt-BR'));
}

function CharacterCard({ player, index }: { player: RoomView['players'][number]; index: number }): JSX.Element {
  const [imageFailed, setImageFailed] = useState(false);
  const image = player.character?.image;
  const showImage = Boolean(image) && !imageFailed;
  // HINT-08: o destaque diz que este jogador está pedindo dica, e só isso — ele
  // não muda nada do personagem mostrado no card.
  const asking = player.hintRequestTargetId !== null;
  return (
    <article className={`character-card character-color-${index % 4} ${player.solved ? 'character-solved' : ''} ${asking ? 'character-asking' : ''} ${showImage ? 'character-has-photo' : ''}`}>
      <div className="character-card-top"><span className="card-number">0{index + 1}</span><span className="character-status">{asking ? 'pedindo dica' : player.solved ? 'descobriu' : 'na testa'}</span></div>
      {showImage ? <img className="character-photo" src={image!.url} alt={`Foto de ${player.character!.name}`} loading="lazy" onError={() => setImageFailed(true)} /> : <div className="character-avatar" aria-hidden="true">{player.nickname.slice(0, 1).toUpperCase()}</div>}
      <div className="character-info"><strong>{player.nickname}</strong>{player.character ? <><span>{player.character.name}</span><em>{player.character.category}</em></> : <span>personagem reservado</span>}</div>
    </article>
  );
}

function RevealRow({ player }: { player: RoomView['players'][number] }): JSX.Element {
  const [imageFailed, setImageFailed] = useState(false);
  const image = player.character?.image;
  const showImage = Boolean(image) && !imageFailed;
  return (
    <div className="reveal-row">
      {showImage ? <img className="reveal-photo" src={image!.url} alt={`Foto de ${player.character!.name}`} loading="lazy" onError={() => setImageFailed(true)} /> : <span className="reveal-avatar">{player.nickname.slice(0, 1).toUpperCase()}</span>}
      <div>
        <strong>{player.nickname}</strong>
        <span>{player.character?.name ?? 'Sem personagem'}</span>
      </div>
      <em>{player.character?.category ?? '—'}</em>
    </div>
  );
}

function InlineNotice({ tone, children }: { tone: 'neutral' | 'success' | 'error'; children: ReactNode }): JSX.Element {
  return <div className={`inline-notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>;
}

export default App;
