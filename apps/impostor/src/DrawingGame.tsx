import { useEffect, useMemo, useRef, useState, type FormEvent, type JSX, type PointerEvent as ReactPointerEvent } from 'react';
import type { DrawingPoint, DrawingStroke, RoomView } from '../shared/protocol';
import { socket } from './socket';

export type DrawingFeedback = { tone: 'neutral' | 'success' | 'error'; message: string } | null;

interface DrawingRoundProps {
  room: RoomView;
  feedback: DrawingFeedback;
  onFeedback: (feedback: DrawingFeedback) => void;
}

interface DrawingCanvasProps {
  strokes: DrawingStroke[];
  previewPoints?: DrawingPoint[];
  interactive?: boolean;
  onCommit?: (points: DrawingPoint[]) => void;
}

const PEN_WIDTH = 4;

export function DrawingRound({ room, feedback, onFeedback }: DrawingRoundProps): JSX.Element {
  const draw = room.draw;
  const me = room.players.find((player) => player.id === room.you.id);
  const isImpostor = room.you.drawRole === 'impostor';
  const [now, setNow] = useState(() => Date.now());
  const [selectedPlayerId, setSelectedPlayerId] = useState('');
  const [wordGuess, setWordGuess] = useState('');

  useEffect(() => {
    if (!draw || draw.phase !== 'drawing' || !draw.turnEndsAt) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [draw?.phase, draw?.turnEndsAt]);

  useEffect(() => {
    setSelectedPlayerId('');
    setWordGuess('');
  }, [draw?.phase]);

  const turnEndsAt = draw?.turnEndsAt ?? null;
  const hasTurnTimer = turnEndsAt !== null;
  const remainingSeconds = turnEndsAt === null ? 0 : Math.max(0, Math.ceil((turnEndsAt - now) / 1000));
  const isCurrentTurnMine = Boolean(draw?.phase === 'drawing' && draw.currentTurnPlayerId === room.you.id);
  const isMyTurn = Boolean(draw?.phase === 'drawing' && draw.currentTurnPlayerId === room.you.id && (!hasTurnTimer || remainingSeconds > 0));
  const isHost = room.hostId === room.you.id;
  const canPassTurn = Boolean(draw?.phase === 'drawing' && (isMyTurn || isHost));
  const availableAccusationTargets = useMemo(
    () => room.players.filter((player) => player.id !== room.you.id && !player.drawEliminated),
    [room.players, room.you.id],
  );

  function commitStroke(points: DrawingPoint[]): void {
    if (!isMyTurn || points.length === 0) return;
    socket.emit('draw:stroke', { points, width: PEN_WIDTH });
  }

  function accuse(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!selectedPlayerId || room.you.drawAccusationUsed || room.you.drawEliminated) return;
    onFeedback(null);
    socket.emit('draw:accuse', { targetPlayerId: selectedPlayerId });
  }

  function guessWord(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!wordGuess.trim() || room.you.drawWordGuessUsed) return;
    onFeedback(null);
    socket.emit('draw:guess-word', { text: wordGuess });
  }

  function passTurn(): void {
    onFeedback(null);
    socket.emit('draw:pass');
  }

  function endRound(): void {
    onFeedback(null);
    socket.emit('draw:end');
  }

  if (!draw) return <div className="empty-game-state">Preparando o mural…</div>;

  const isDrawing = draw.phase === 'drawing';
  const currentPlayer = room.players.find((player) => player.id === draw.currentTurnPlayerId);
  const heading = <>Desenhem uma parte.<br /><span>Sem tempo a perder.</span></>;

  return (
    <section className="draw-layout" aria-labelledby="draw-title">
      <div className="draw-main">
        <div className="game-intro-row">
          <div>
            <p className="eyebrow">Rodada {String(room.round).padStart(2, '0')} · mural em andamento</p>
            <h1 id="draw-title">{heading}</h1>
          </div>
        </div>

        {isDrawing && <div className="ticker draw-turn-ticker" role="status"><span className="ticker-pulse" aria-hidden="true" />{isMyTurn ? 'Sua vez: faça um pedaço e passe o pincel.' : `${currentPlayer?.nickname ?? 'A próxima pessoa'} está desenhando agora.`}</div>}

        <div className={`drawing-board paper-card ${isCurrentTurnMine ? 'drawing-board-my-turn' : 'drawing-board-other-turn'}`}>
          <div className="drawing-board-head">
            <div className="drawing-board-heading"><span className="micro-label">Mural compartilhado</span><strong>Todo mundo vê o mesmo traço</strong></div>
            <div className="drawing-board-status">
              <div className={`draw-timer draw-timer-inside ${isCurrentTurnMine ? 'draw-timer-my-turn' : 'draw-timer-other-turn'} ${remainingSeconds <= 3 && isDrawing && hasTurnTimer ? 'draw-timer-critical' : ''}`} aria-live="polite">
                {hasTurnTimer ? <><strong>{String(remainingSeconds).padStart(2, '0')}</strong><span>segundos<br />na vez</span></> : <><strong>∞</strong><span>sem limite<br />na vez</span></>}
              </div>
              <span className="panel-mark">PARTE {draw.turnNumber}/{draw.totalTurns}</span>
            </div>
          </div>
          <DrawingCanvas strokes={draw.strokes} interactive={isMyTurn} onCommit={commitStroke} />
          <div className="drawing-board-foot">
            <span><i className="legend-dot legend-dot-acid" />{isMyTurn ? 'desenhe dentro da área' : 'observe os detalhes'}</span>
            <span>{draw.strokes.length === 0 ? 'o primeiro risco ainda não veio' : `${draw.strokes.length} ${draw.strokes.length === 1 ? 'traço registrado' : 'traços registrados'}`}</span>
            {isDrawing && canPassTurn && <button className="draw-pass-button" type="button" onClick={passTurn}>{isMyTurn ? 'Concluir minha parte' : 'Pular esta vez'} <span aria-hidden="true">↗</span></button>}
          </div>
        </div>
      </div>

      <aside className="draw-panel paper-card">
        <div className="guess-panel-head">
          <div><span className="micro-label">Seu papel na mesa</span><h2>{isImpostor ? 'Você é o impostor.' : 'Você sabe o que desenhar.'}</h2></div>
          <span className={`question-mark ${isImpostor ? 'question-mark-coral' : ''}`} aria-hidden="true">{isImpostor ? '!' : '?'}</span>
        </div>

        <DrawingRoleCard room={room} isImpostor={isImpostor} />

        {isImpostor ? (
          <form className="draw-guess-form" onSubmit={guessWord}>
            <label className="field-label" htmlFor="draw-word-guess">Qual animal ou objeto você acha que é?</label>
            <div className="guess-input-wrap"><input id="draw-word-guess" className="text-input" value={wordGuess} onChange={(event) => setWordGuess(event.target.value)} placeholder="Ex.: elefante" autoComplete="off" maxLength={100} disabled={room.you.drawWordGuessUsed} /><button className="guess-submit" type="submit" aria-label="Chutar palavra" disabled={room.you.drawWordGuessUsed}>↗</button></div>
            <p className="guess-hint">Uma tentativa. Se acertar, o impostor vence.</p>
          </form>
        ) : room.you.drawEliminated ? (
          <div className="solved-box draw-out-box"><span className="solved-icon" aria-hidden="true">×</span><strong>Você está fora.</strong><p>Seu palpite não bateu. Fique em silêncio para não entregar a resposta.</p></div>
        ) : room.you.drawAccusationUsed ? (
          <div className="solved-box"><span className="solved-icon" aria-hidden="true">✓</span><strong>Palpite registrado.</strong><p>Agora observe a sala — você só tinha uma chance.</p></div>
        ) : (
          <form className="draw-accuse-form" onSubmit={accuse}>
            <label className="field-label" htmlFor="impostor-choice">Quem você acha que é?</label>
            <div className="accusation-list" id="impostor-choice">
              {availableAccusationTargets.map((player) => <button key={player.id} className={selectedPlayerId === player.id ? 'accusation-choice is-selected' : 'accusation-choice'} type="button" onClick={() => setSelectedPlayerId(player.id)}><span className="player-avatar">{player.nickname.slice(0, 1).toUpperCase()}</span><span>{player.nickname}</span><span className="choice-mark" aria-hidden="true">{selectedPlayerId === player.id ? '✓' : ''}</span></button>)}
            </div>
            <button className="primary-button full-button" type="submit" disabled={!selectedPlayerId}>Acusar uma pessoa <span aria-hidden="true">↗</span></button>
            <p className="guess-hint">Uma chance. Se errar, você sai e não pode revelar o seu palpite.</p>
          </form>
        )}

        {isHost && <button className="draw-end-button" type="button" onClick={endRound}>Encerrar e revelar <span aria-hidden="true">↗</span></button>}

        {feedback && <div className={`inline-notice notice-${feedback.tone}`} role={feedback.tone === 'error' ? 'alert' : 'status'}>{feedback.message}</div>}

        <div className="draw-players-block">
          <div className="history-heading"><span className="micro-label">Na mesa</span><span>{room.players.length} pessoas</span></div>
          <div className="draw-player-list">
            {room.players.map((player) => <DrawPlayerRow key={player.id} player={player} isCurrent={player.id === draw.currentTurnPlayerId} isYou={player.id === room.you.id} />)}
          </div>
          <p className="draw-private-note"><span aria-hidden="true">✦</span>{isImpostor ? 'A palavra nunca aparece para você.' : 'Não conte a palavra em voz alta.'}</p>
        </div>
      </aside>
    </section>
  );
}

function DrawingRoleCard({ room, isImpostor }: { room: RoomView; isImpostor: boolean }): JSX.Element {
  return isImpostor ? (
    <div className="draw-role-card draw-role-impostor">
      <span className="card-kicker">papel secreto</span>
      <div className="impostor-mark" aria-hidden="true">!</div>
      <strong>Você não viu a palavra.</strong>
      <p>Desenhe algo que pareça fazer sentido e use os detalhes do mural para descobrir o animal ou objeto.</p>
      <span className="card-stamp">IMPOSTOR</span>
    </div>
  ) : (
    <div className="draw-role-card draw-role-drawer">
      <span className="card-kicker">palavra para desenhar</span>
      <div className="draw-word-display">{room.draw?.word?.name ?? 'palavra protegida'}</div>
      <span className="draw-word-category">{room.draw?.word?.category ?? '—'}</span>
      <p>Faça só um pedaço. Deixe as próximas pessoas completarem a ideia.</p>
      <span className="card-stamp">NÃO FALE</span>
    </div>
  );
}

function DrawPlayerRow({ player, isCurrent, isYou }: { player: RoomView['players'][number]; isCurrent: boolean; isYou: boolean }): JSX.Element {
  const status = player.drawEliminated ? 'fora' : isCurrent ? 'desenhando' : player.drawAccusationUsed ? 'já palpitou' : player.connected ? 'na mesa' : 'reconectando';
  return <div className={`draw-player-row ${isCurrent ? 'draw-player-current' : ''} ${player.drawEliminated ? 'draw-player-out' : ''}`}><span className="player-avatar">{player.nickname.slice(0, 1).toUpperCase()}</span><div className="player-name"><strong>{player.nickname}{isYou ? <small> você</small> : null}</strong><span>{status}</span></div><span className="draw-status-mark" aria-hidden="true">{player.drawEliminated ? '×' : isCurrent ? '•' : player.drawAccusationUsed ? '✓' : ''}</span></div>;
}

export function DrawingFinish({ room, onPlayAgain, isHost }: { room: RoomView; onPlayAgain: () => void; isHost: boolean }): JSX.Element {
  const draw = room.draw;
  const outcome = draw?.outcome;
  const impostor = room.players.find((player) => player.drawRole === 'impostor');
  const groupWon = outcome?.winner === 'players';

  return (
    <section className="finish-layout draw-finish-layout" aria-labelledby="draw-finish-title">
      <div className="finish-hero">
        <p className="eyebrow">Mural revelado · rodada {String(room.round).padStart(2, '0')}</p>
        <h1 id="draw-finish-title">{groupWon ? 'O impostor foi descoberto.' : 'O impostor levou a rodada.'}</h1>
        <p className="section-lede">{outcome?.message ?? 'A rodada chegou ao fim.'} A palavra era <strong>{draw?.word?.name ?? '—'}</strong>.</p>
        {isHost ? <button className="primary-button" type="button" onClick={onPlayAgain}>Desenhar outra rodada <span aria-hidden="true">↗</span></button> : <div className="waiting-chip">Esperando o anfitrião abrir outra rodada</div>}
      </div>

      <div className="draw-reveal-grid">
        <div className="draw-reveal-word paper-card">
          <div className="panel-heading"><div><span className="micro-label">A palavra escondida</span><h2>{draw?.word?.name ?? 'Sem palavra'}</h2></div><span className="panel-mark">{draw?.word?.category ?? '—'}</span></div>
          <DrawingCanvas strokes={draw?.strokes ?? []} />
          <p className="draw-finish-caption">O mural completo, com cada traço registrado na ordem em que apareceu.</p>
        </div>
        <div className="draw-reveal-players paper-card">
          <div className="panel-heading"><div><span className="micro-label">Papéis revelados</span><h2>Quem estava desenhando</h2></div><span className="panel-mark">FINAL</span></div>
          <div className="reveal-list">
            {room.players.map((player) => <div className={`reveal-row ${player.drawRole === 'impostor' ? 'reveal-impostor' : ''}`} key={player.id}><span className="reveal-avatar">{player.nickname.slice(0, 1).toUpperCase()}</span><div><strong>{player.nickname}{player.id === room.you.id ? <small> você</small> : null}</strong><span>{player.drawRole === 'impostor' ? 'impostor' : 'desenhista'}</span></div><em>{player.drawRole === 'impostor' ? 'não viu a palavra' : 'viu a palavra'}</em></div>)}
          </div>
          {impostor && <p className="draw-finish-note"><span aria-hidden="true">!</span> O impostor era <strong>{impostor.nickname}</strong>. Os palpites individuais continuam privados.</p>}
        </div>
      </div>
    </section>
  );
}

export function DrawingCanvas({ strokes, previewPoints = [], interactive = false, onCommit }: DrawingCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activePointsRef = useRef<DrawingPoint[]>([]);
  const [activePoints, setActivePoints] = useState<DrawingPoint[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const draw = (): void => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.max(1, Math.floor(rect.height * ratio));
      const context = canvas.getContext('2d');
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);
      context.strokeStyle = '#151525';
      context.fillStyle = '#151525';
      context.lineCap = 'round';
      context.lineJoin = 'round';
      strokes.forEach((stroke) => drawStroke(context, rect.width, rect.height, stroke.points, stroke.width));
      if (previewPoints.length > 0) drawStroke(context, rect.width, rect.height, previewPoints, PEN_WIDTH);
      if (activePoints.length > 0) drawStroke(context, rect.width, rect.height, activePoints, PEN_WIDTH);
    };
    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, [activePoints, previewPoints, strokes]);

  function pointFromEvent(event: ReactPointerEvent<HTMLCanvasElement>): DrawingPoint {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (!interactive) return;
    const point = pointFromEvent(event);
    activePointsRef.current = [point];
    setActivePoints([point]);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (!interactive || activePointsRef.current.length === 0) return;
    const points = [...activePointsRef.current, pointFromEvent(event)];
    activePointsRef.current = points;
    setActivePoints(points);
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (!interactive || activePointsRef.current.length === 0) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const points = activePointsRef.current;
    activePointsRef.current = [];
    setActivePoints([]);
    onCommit?.(points);
  }

  function handlePointerCancel(): void {
    activePointsRef.current = [];
    setActivePoints([]);
  }

  return <div className={`drawing-canvas-wrap ${interactive ? 'drawing-canvas-live' : 'drawing-canvas-readonly'}`}><canvas ref={canvasRef} className="drawing-canvas" aria-label={interactive ? 'Área para desenhar' : 'Mural final'} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerCancel} /></div>;
}

function drawStroke(context: CanvasRenderingContext2D, width: number, height: number, points: DrawingPoint[], lineWidth: number): void {
  if (points.length === 0) return;
  const first = points[0]!;
  context.lineWidth = lineWidth;
  if (points.length === 1) {
    context.beginPath();
    context.arc(first.x * width, first.y * height, Math.max(1.5, lineWidth / 2), 0, Math.PI * 2);
    context.fill();
    return;
  }
  context.beginPath();
  context.moveTo(first.x * width, first.y * height);
  for (const point of points.slice(1)) context.lineTo(point.x * width, point.y * height);
  context.stroke();
}
