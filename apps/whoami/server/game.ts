import { randomBytes } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  CreateRoomInput,
  DrawAccusationInput,
  DrawOutcome,
  DrawingStroke,
  DrawStrokeInput,
  DrawTurnDuration,
  DrawWordGuessInput,
  GameErrorPayload,
  GuessInput,
  HintAnswerInput,
  HintRequestInput,
  InterServerEvents,
  JoinRoomInput,
  ReadyInput,
  RemoveAbsentInput,
  RoomActionResult,
  RoomView,
  ServerToClientEvents,
  SocketData,
} from '../shared/protocol';
import { availableHintPowerups } from '../shared/hints';
import { normalizeNickname, normalizeRoomCode, normalizeText } from './normalization';
import { pointsForRank } from './scoring';
import { drawingWordMatches, pickDrawingWord, type DrawingWord } from './drawing-wordlist';
import { characterMatches, characters, type Character, pickCharacters } from './wordlist';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 12;
const ROOM_CODE_LENGTH = 6;
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DEFAULT_ROOM_TTL_MINUTES = 30;
const MAX_GUESS_LENGTH = 100;
export const DRAW_TURN_MS = 10_000;
const MAX_STROKE_POINTS = 240;
const MAX_STROKE_WIDTH = 18;

/**
 * Quem manda neste piso é o catálogo, não o gosto por entrada limpa. O acervo
 * tem "L" (`character-0104`), de uma letra só: com piso 2 esse personagem era
 * impossível de acertar — o jogador digitava o nome certo e recebia
 * INVALID_GUESS para sempre, travando a rodada de todo mundo. O teste de
 * invariante em `tests/wordlist.test.ts` amarra os dois lados, para que um nome
 * curto novo no catálogo quebre a suíte em vez de virar personagem insolúvel.
 */
export const MIN_GUESS_LENGTH = 1;

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type GameIo = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
export type GameModeScope = 'all' | 'whoami' | 'draw-impostor';

interface PlayerState {
  id: string;
  nickname: string;
  normalizedNickname: string;
  sessionToken: string;
  socketId: string | null;
  connected: boolean;
  ready: boolean;
  character: Character | null;
  solved: boolean;
  rank: number | null;
  guesses: string[];
  drawRole: 'drawer' | 'impostor' | null;
  drawAccusationUsed: boolean;
  drawEliminated: boolean;
  drawWordGuessUsed: boolean;
  disconnectedAt: number | null;
  solvedAt: number | null;
  /** Total acumulado da sessão. Só cresce; nunca é zerado por nova rodada. */
  score: number;
  /** Ganho da rodada corrente; null enquanto o jogador não acertou. */
  roundPoints: number | null;
  /**
   * Power-ups de dica gastos na rodada. O servidor guarda só o gasto; o
   * disponível é derivado do tempo por `availableHintPowerups` no instante em
   * que o pedido é autorizado (ver shared/hints.ts).
   */
  hintsUsed: number;
  /** Alvo do pedido de dica pendente; null quando não há pedido. */
  hintRequestTargetId: string | null;
}

interface DrawingState {
  word: DrawingWord;
  impostorId: string;
  phase: 'drawing' | 'finished';
  turnOrder: string[];
  turnIndex: number;
  turnEndsAt: number | null;
  strokes: DrawingStroke[];
  outcome: DrawOutcome | null;
}

interface RoomState {
  code: string;
  hostId: string;
  phase: RoomView['phase'];
  mode: NonNullable<RoomView['mode']>;
  drawTurnMs: DrawTurnDuration;
  round: number;
  players: Map<string, PlayerState>;
  drawing: DrawingState | null;
  createdAt: number;
  updatedAt: number;
  usedCharacterIds: Set<string>;
  roundStartedAt: number | null;
  /**
   * Número de jogadores registrado quando a rodada começou (SCORE-02).
   * Congelado para toda a rodada: quem sai no meio não muda a escala de
   * pontos dos acertos seguintes (SCORE-15).
   */
  roundPlayerCount: number;
}

interface SessionAuth {
  roomCode?: unknown;
  playerId?: unknown;
  sessionToken?: unknown;
}

export class GameManager {
  private readonly rooms = new Map<string, RoomState>();
  private readonly roomTtlMs: number;
  private readonly cleanupTimer: NodeJS.Timeout;
  private readonly drawTimers = new Map<string, NodeJS.Timeout>();
  private readonly defaultDrawTurnMs: number;

  constructor(
    private readonly io: GameIo,
    roomTtlMinutes = Number(process.env.ROOM_TTL_MINUTES) || DEFAULT_ROOM_TTL_MINUTES,
    drawTurnMs = DRAW_TURN_MS,
    private readonly modeScope: GameModeScope = 'all',
  ) {
    this.roomTtlMs = roomTtlMinutes * 60_000;
    this.defaultDrawTurnMs = Math.max(10, drawTurnMs);
    this.cleanupTimer = setInterval(() => this.cleanupRooms(), 60_000);
    this.cleanupTimer.unref();
  }

  bindSocket(socket: GameSocket): void {
    socket.on('room:create', (payload, ack) => this.createRoom(socket, payload, ack));
    socket.on('room:join', (payload, ack) => this.joinRoom(socket, payload, ack));
    socket.on('player:ready', (payload) => this.setReady(socket, payload));
    socket.on('round:guess', (payload) => this.guess(socket, payload));
    socket.on('draw:stroke', (payload) => this.addDrawingStroke(socket, payload));
    socket.on('draw:pass', () => this.passDrawingTurn(socket));
    socket.on('draw:accuse', (payload) => this.accuseDrawingImpostor(socket, payload));
    socket.on('draw:guess-word', (payload) => this.guessDrawingWord(socket, payload));
    socket.on('draw:end', () => this.endDrawingRound(socket));
    socket.on('round:playAgain', () => this.playAgain(socket));
    socket.on('round:endEarly', () => this.endEarly(socket));
    socket.on('room:removeAbsent', (payload) => this.removeAbsent(socket, payload));
    socket.on('room:leave', () => this.leave(socket));
    socket.on('hint:request', (payload) => this.requestHint(socket, payload));
    socket.on('hint:answer', (payload) => this.answerHint(socket, payload));
    socket.on('hint:cancel', () => this.cancelHint(socket));
    socket.on('disconnect', () => this.disconnect(socket));

    this.resumeFromHandshake(socket);
  }

  dispose(): void {
    clearInterval(this.cleanupTimer);
    for (const timer of this.drawTimers.values()) clearTimeout(timer);
    this.drawTimers.clear();
  }

  getRoomCount(): number {
    return this.rooms.size;
  }

  private createRoom(socket: GameSocket, payload: CreateRoomInput, ack: (result: RoomActionResult) => void): void {
    if (this.getPlayer(socket)) {
      ack(this.failure('ALREADY_IN_ROOM', 'Você já está em uma sala.'));
      return;
    }

    const nickname = this.validateNickname(payload?.nickname);
    if (!nickname) {
      ack(this.failure('INVALID_NICKNAME', 'Use um apelido com 2 a 24 caracteres.'));
      return;
    }

    const code = this.createRoomCode();
    const player = this.createPlayer(nickname, socket.id);
    const mode = this.validateGameMode(payload?.mode);
    if (this.modeScope !== 'all' && mode !== this.modeScope) {
      ack(this.failure('GAME_UNAVAILABLE', 'Este deploy atende outro jogo.'));
      return;
    }
    const room: RoomState = {
      code,
      hostId: player.id,
      phase: 'lobby',
      mode,
      drawTurnMs: mode === 'draw-impostor' ? this.validateDrawTurn(payload?.drawTurnMs) : null,
      round: 0,
      players: new Map([[player.id, player]]),
      drawing: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      usedCharacterIds: new Set(),
      roundStartedAt: null,
      roundPlayerCount: 0,
    };

    this.rooms.set(code, room);
    this.attachPlayer(socket, room, player);
    ack(this.success(room, player));
    this.broadcastRoomState(room);
  }

  private joinRoom(socket: GameSocket, payload: JoinRoomInput, ack: (result: RoomActionResult) => void): void {
    if (this.getPlayer(socket)) {
      ack(this.failure('ALREADY_IN_ROOM', 'Você já está em uma sala.'));
      return;
    }

    const code = normalizeRoomCode(payload?.code ?? '');
    const room = this.rooms.get(code);
    if (!room) {
      ack(this.failure('ROOM_NOT_FOUND', 'Essa sala não existe mais.'));
      return;
    }
    if (room.phase !== 'lobby') {
      ack(this.failure('ROOM_STARTED', 'Essa rodada já começou.'));
      return;
    }
    if (room.players.size >= MAX_PLAYERS) {
      ack(this.failure('ROOM_FULL', 'A sala já chegou ao limite de 12 pessoas.'));
      return;
    }

    const nickname = this.validateNickname(payload?.nickname);
    if (!nickname) {
      ack(this.failure('INVALID_NICKNAME', 'Use um apelido com 2 a 24 caracteres.'));
      return;
    }
    const normalizedNickname = normalizeText(nickname);
    const duplicate = Array.from(room.players.values()).some((player) => player.normalizedNickname === normalizedNickname);
    if (duplicate) {
      ack(this.failure('NICKNAME_TAKEN', 'Esse apelido já está na sala.'));
      return;
    }

    const player = this.createPlayer(nickname, socket.id);
    room.players.set(player.id, player);
    this.touch(room);
    this.attachPlayer(socket, room, player);
    ack(this.success(room, player));
    this.broadcastRoomState(room);
  }

  private setReady(socket: GameSocket, payload: ReadyInput): void {
    const context = this.getContext(socket);
    if (!context) return;
    const { room, player } = context;
    if (room.phase !== 'lobby') {
      this.sendError(socket, 'ROUND_ALREADY_STARTED', 'A rodada já começou.');
      return;
    }

    player.ready = Boolean(payload?.ready);
    this.touch(room);
    this.broadcastRoomState(room);

    const everyoneReady = room.players.size >= MIN_PLAYERS && Array.from(room.players.values()).every((candidate) => candidate.connected && candidate.ready);
    if (everyoneReady) {
      this.startRound(room);
    }
  }

  private guess(socket: GameSocket, payload: GuessInput): void {
    const context = this.getContext(socket);
    if (!context) return;
    const { room, player } = context;
    if (room.phase !== 'playing' || !player.character) {
      this.sendError(socket, 'ROUND_NOT_PLAYING', 'A rodada ainda não está recebendo palpites.');
      return;
    }
    if (player.solved) {
      socket.emit('guess:result', {
        correct: true,
        alreadySolved: true,
        attempts: player.guesses.length,
        message: 'Você já acertou.',
        history: [...player.guesses],
      });
      return;
    }

    const text = String(payload?.text ?? '').trim().slice(0, MAX_GUESS_LENGTH);
    if (!text || normalizeText(text).length < MIN_GUESS_LENGTH) {
      this.sendError(socket, 'INVALID_GUESS', 'Digite um palpite antes de enviar.');
      return;
    }

    player.guesses.push(text);
    const correct = characterMatches(player.character, text);
    if (!correct) {
      socket.emit('guess:result', {
        correct: false,
        alreadySolved: false,
        attempts: player.guesses.length,
        message: 'Ainda não bateu.',
        history: [...player.guesses],
      });
      this.touch(room);
      return;
    }

    const rank = Array.from(room.players.values()).filter((candidate) => candidate.solved).length + 1;
    player.solved = true;
    player.rank = rank;
    player.solvedAt = Date.now();
    // SCORE-01: os pontos usam o N congelado no início da rodada, não o
    // tamanho atual da sala. O guard de `player.solved` acima garante que a
    // soma acontece no máximo uma vez por rodada (SCORE-04).
    //
    // Hoje `roundPlayerCount` e `room.players.size` são sempre iguais aqui, e
    // por isso nenhum teste consegue distinguir as duas leituras: o roster não
    // encolhe durante `playing`. `players.delete` só acontece em `removePlayer`,
    // chamado apenas por `leave`, e `leave` durante `playing` dispara
    // `resetAfterDeparture`, que volta a sala para `lobby` e aborta a rodada;
    // uma queda de conexão marca `connected: false` sem remover o jogador. Ler o
    // valor congelado é defesa contra uma mudança futura que permita a rodada
    // seguir com o roster menor: aí as duas leituras divergem e só esta mantém
    // a escala de pontos que a rodada começou (SCORE-02, SCORE-15).
    player.roundPoints = pointsForRank(rank, room.roundPlayerCount);
    player.score += player.roundPoints;
    // HINT-22: quem acertou não precisa mais da dica, e o power-up não volta —
    // devolver o direito a quem já saiu da rodada não teria a quem servir.
    this.releaseHintRequest(player, false);
    this.touch(room);

    socket.emit('guess:result', {
      correct: true,
      alreadySolved: false,
      attempts: player.guesses.length,
      message: 'Acertou. Sua identidade foi desbloqueada.',
      history: [...player.guesses],
    });
    this.io.to(room.code).emit('player:solved', {
      playerId: player.id,
      nickname: player.nickname,
      rank,
      // room.phase === 'playing' aqui garante roundStartedAt não-nulo (setado junto no startRound).
      solveMs: player.solvedAt - room.roundStartedAt!,
    });
    this.broadcastRoomState(room);

    const everyoneSolved = Array.from(room.players.values()).every((candidate) => candidate.solved);
    if (everyoneSolved) {
      this.finishRound(room);
    }
  }

  /**
   * Saída manual para a rodada travada. `finishRound` só dispara quando todos
   * acertam, então um jogador que cai antes de descobrir a própria identidade
   * congela a sala para sempre — não há encerramento por tempo.
   *
   * A guarda de travamento (existe alguém desconectado que ainda não acertou) é
   * o que separa conserto de sabotagem: sem ela o anfitrião poderia cortar uma
   * rodada saudável e revelar o personagem de quem ainda está jogando. Por isso
   * a condição é a da própria falha, não "quando o anfitrião quiser".
   */
  private endEarly(socket: GameSocket): void {
    const context = this.getContext(socket);
    if (!context) return;
    const { room, player } = context;
    if (room.hostId !== player.id) {
      this.sendError(socket, 'HOST_ONLY', 'Só quem criou a sala pode encerrar a rodada.');
      return;
    }
    if (room.phase !== 'playing') {
      this.sendError(socket, 'ROUND_NOT_RUNNING', 'Não há rodada em andamento para encerrar.');
      return;
    }
    const stalled = Array.from(room.players.values()).some((candidate) => !candidate.connected && !candidate.solved);
    if (!stalled) {
      this.sendError(socket, 'ROUND_NOT_STUCK', 'A rodada não está travada: todo mundo que falta ainda está na sala.');
      return;
    }

    this.finishRound(room);
  }

  /**
   * Tira da sala quem caiu e não voltou. Encerrar a rodada travada não bastava:
   * `everyoneReady` exige `connected && ready` de todos, então o ausente
   * continuava barrando o início da rodada seguinte — o travamento só andava um
   * passo, da rodada para o lobby.
   *
   * Só alvo desconectado, e só no lobby. As duas restrições existem pelo mesmo
   * motivo: sem elas isto deixa de ser conserto e vira expulsão. Remover alguém
   * conectado é moderação de comportamento, decisão de produto que a sala não
   * tomou; remover durante `playing` cairia em `resetAfterDeparture` e abortaria
   * a rodada de todo mundo.
   */
  private removeAbsent(socket: GameSocket, payload: RemoveAbsentInput): void {
    const context = this.getContext(socket);
    if (!context) return;
    const { room, player } = context;
    if (room.hostId !== player.id) {
      this.sendError(socket, 'HOST_ONLY', 'Só quem criou a sala pode remover um jogador ausente.');
      return;
    }
    if (room.phase !== 'lobby') {
      this.sendError(socket, 'ROOM_NOT_IN_LOBBY', 'Só dá para remover alguém entre as rodadas.');
      return;
    }
    const target = typeof payload?.playerId === 'string' ? room.players.get(payload.playerId) : undefined;
    if (!target) {
      this.sendError(socket, 'PLAYER_NOT_FOUND', 'Esse jogador não está mais na sala.');
      return;
    }
    if (target.connected) {
      this.sendError(socket, 'PLAYER_CONNECTED', 'Esse jogador está conectado — só dá para remover quem caiu.');
      return;
    }

    // `removePlayer` é o mesmo caminho da saída pelo botão, então o placar de
    // sessão do removido é descartado junto do registro (SCORE-09, END-16).
    this.removePlayer(room, target);
    this.broadcastRoomState(room);
  }

  /**
   * Gasta um power-up de dica apontando para alguém que já acertou (HINT-07).
   *
   * O disponível não é armazenado: ele sai de `availableHintPowerups` sobre o
   * tempo decorrido da rodada, calculado agora. É o que permite conceder
   * power-up por tempo sem nenhum agendador tocando a rodada — e é também o que
   * faz HINT-04 sair de graça, porque quem já acertou nunca chega até aqui.
   */
  private requestHint(socket: GameSocket, payload: HintRequestInput): void {
    const context = this.getContext(socket);
    if (!context) return;
    const { room, player } = context;
    if (room.phase !== 'playing' || room.roundStartedAt === null) {
      this.sendError(socket, 'ROUND_NOT_RUNNING', 'Não há rodada em andamento para pedir dica.');
      return;
    }
    if (player.solved) {
      this.sendError(socket, 'ALREADY_SOLVED', 'Você já acertou: não precisa mais de dica.');
      return;
    }
    if (player.hintRequestTargetId) {
      this.sendError(socket, 'HINT_ALREADY_PENDING', 'Você já tem um pedido de dica em aberto.');
      return;
    }
    const someoneSolved = Array.from(room.players.values()).some((candidate) => candidate.solved);
    if (!someoneSolved) {
      this.sendError(socket, 'NO_SOLVER_YET', 'Ninguém acertou ainda: não há de quem pedir dica.');
      return;
    }
    const target = typeof payload?.targetId === 'string' ? room.players.get(payload.targetId) : undefined;
    if (!target || !target.solved || target.id === player.id) {
      this.sendError(socket, 'INVALID_HINT_TARGET', 'Só dá para pedir dica a quem já acertou.');
      return;
    }
    if (availableHintPowerups(Date.now() - room.roundStartedAt, player.hintsUsed) <= 0) {
      this.sendError(socket, 'NO_HINT_AVAILABLE', 'Você ainda não tem power-up de dica disponível.');
      return;
    }

    player.hintsUsed += 1;
    player.hintRequestTargetId = target.id;
    this.touch(room);
    this.broadcastRoomState(room);
  }

  /**
   * O alvo marca que respondeu e encerra o pedido (HINT-10). O power-up não
   * volta: ele foi gasto no que se propunha a comprar, que é a dica.
   *
   * Só o alvo encerra (HINT-19). Sem essa checagem qualquer um poderia apagar o
   * destaque de qualquer pedido, e o alvo perderia o único aviso de que é com ele.
   */
  private answerHint(socket: GameSocket, payload: HintAnswerInput): void {
    const context = this.getContext(socket);
    if (!context) return;
    const { room, player } = context;
    const asker = typeof payload?.askerId === 'string' ? room.players.get(payload.askerId) : undefined;
    if (!asker || asker.hintRequestTargetId !== player.id) {
      this.sendError(socket, 'NOT_HINT_TARGET', 'Esse pedido de dica não é para você.');
      return;
    }

    asker.hintRequestTargetId = null;
    this.touch(room);
    this.broadcastRoomState(room);
  }

  /**
   * Quem pediu desiste, e o power-up volta (HINT-11): escolher a pessoa errada é
   * erro barato de cometer e caro de não poder desfazer.
   */
  private cancelHint(socket: GameSocket): void {
    const context = this.getContext(socket);
    if (!context) return;
    const { room, player } = context;
    if (!player.hintRequestTargetId) return;

    this.releaseHintRequest(player, true);
    this.touch(room);
    this.broadcastRoomState(room);
  }

  /** Encerra o pedido pendente de `player`, devolvendo o power-up ou não (HINT-23). */
  private releaseHintRequest(player: PlayerState, refund: boolean): void {
    player.hintRequestTargetId = null;
    if (refund) player.hintsUsed = Math.max(0, player.hintsUsed - 1);
  }

  /**
   * O alvo saiu de cena antes de responder: os pedidos dirigidos a ele caem e o
   * power-up volta (HINT-20, HINT-21). Perder o direito por queda alheia seria
   * punir o jogador por algo fora do controle dele.
   */
  private releaseHintRequestsTargeting(room: RoomState, targetId: string): void {
    for (const candidate of room.players.values()) {
      if (candidate.hintRequestTargetId === targetId) this.releaseHintRequest(candidate, true);
    }
  }

  private playAgain(socket: GameSocket): void {
    const context = this.getContext(socket);
    if (!context) return;
    const { room, player } = context;
    if (room.hostId !== player.id) {
      this.sendError(socket, 'HOST_ONLY', 'Só quem criou a sala pode abrir uma nova rodada.');
      return;
    }
    if (room.phase !== 'finished') {
      this.sendError(socket, 'ROUND_NOT_FINISHED', 'Espere a rodada terminar para jogar novamente.');
      return;
    }

    room.phase = 'lobby';
    room.roundStartedAt = null;
    this.clearDrawingTimer(room.code);
    room.drawing = null;
    for (const candidate of room.players.values()) {
      candidate.ready = false;
      candidate.character = null;
      candidate.solved = false;
      candidate.rank = null;
      candidate.guesses = [];
      candidate.solvedAt = null;
      // SCORE-06: só o ganho da rodada zera. `score` atravessa a sessão inteira.
      candidate.roundPoints = null;
      // HINT-05: o direito de pedir dica é da rodada, não da sessão.
      candidate.hintsUsed = 0;
      candidate.hintRequestTargetId = null;
      candidate.drawRole = null;
      candidate.drawAccusationUsed = false;
      candidate.drawEliminated = false;
      candidate.drawWordGuessUsed = false;
    }
    this.touch(room);
    this.broadcastRoomState(room);
  }

  private startRound(room: RoomState): void {
    if (room.phase !== 'lobby') return;
    room.phase = 'playing';
    room.round += 1;
    room.roundStartedAt = Date.now();
    const players = Array.from(room.players.values());
    room.roundPlayerCount = players.length;
    if (room.mode === 'draw-impostor') {
      this.startDrawingRound(room);
      return;
    }

    const availableCount = characters.length - room.usedCharacterIds.size;
    if (availableCount < players.length) {
      room.usedCharacterIds.clear();
      this.io.to(room.code).emit('room:notice', {
        code: 'CATALOG_RECYCLED',
        message: 'Os personagens deram a volta: o catálogo foi liberado de novo.',
      });
    }

    const assignedCharacters = pickCharacters(players.length, room.usedCharacterIds);

    players.forEach((player, index) => {
      player.character = assignedCharacters[index] ?? null;
      player.ready = false;
      player.solved = false;
      player.rank = null;
      player.guesses = [];
      player.roundPoints = null;
      // HINT-05: cada rodada começa sem power-up gasto e sem pedido pendente.
      player.hintsUsed = 0;
      player.hintRequestTargetId = null;
      if (player.character) {
        room.usedCharacterIds.add(player.character.id);
      }
      player.drawRole = null;
      player.drawAccusationUsed = false;
      player.drawEliminated = false;
      player.drawWordGuessUsed = false;
    });
    this.touch(room);
    this.broadcastRoomState(room);
    this.broadcastRoundStarted(room);
  }

  private startDrawingRound(room: RoomState): void {
    const players = Array.from(room.players.values());
    const turnOrder = this.shuffle(players.map((player) => player.id));
    const impostor = players[Math.floor(Math.random() * players.length)]!;

    for (const player of players) {
      player.character = null;
      player.ready = false;
      player.solved = false;
      player.rank = null;
      player.guesses = [];
      player.roundPoints = null;
      player.hintsUsed = 0;
      player.hintRequestTargetId = null;
      player.drawRole = player.id === impostor.id ? 'impostor' : 'drawer';
      player.drawAccusationUsed = false;
      player.drawEliminated = false;
      player.drawWordGuessUsed = false;
    }

    room.drawing = {
      word: pickDrawingWord(),
      impostorId: impostor.id,
      phase: 'drawing',
      turnOrder,
      turnIndex: 0,
      turnEndsAt: room.drawTurnMs === null ? null : Date.now() + room.drawTurnMs,
      strokes: [],
      outcome: null,
    };
    this.touch(room);
    this.broadcastRoomState(room);
    this.broadcastRoundStarted(room);
    this.scheduleDrawingTurn(room);
  }

  private addDrawingStroke(socket: GameSocket, payload: DrawStrokeInput): void {
    const context = this.getContext(socket);
    if (!context) return;
    const { room, player } = context;
    const drawing = room.drawing;
    if (room.mode !== 'draw-impostor' || room.phase !== 'playing' || !drawing || drawing.phase !== 'drawing') {
      this.sendError(socket, 'DRAW_NOT_ACTIVE', 'O quadro não está recebendo desenhos agora.');
      return;
    }
    const currentPlayerId = drawing.turnOrder[drawing.turnIndex];
    if (currentPlayerId !== player.id) {
      this.sendError(socket, 'NOT_YOUR_DRAW_TURN', 'Espere a sua vez de desenhar.');
      return;
    }
    if (drawing.turnEndsAt !== null && Date.now() >= drawing.turnEndsAt) {
      this.advanceDrawingTurn(room);
      this.sendError(socket, 'DRAW_TURN_EXPIRED', 'Seu tempo acabou. O quadro passou para a próxima pessoa.');
      return;
    }

    const stroke = this.sanitizeStroke(player.id, payload);
    if (!stroke) {
      this.sendError(socket, 'INVALID_STROKE', 'Esse traço não pôde ser desenhado.');
      return;
    }

    drawing.strokes.push(stroke);
    this.touch(room);
    this.io.to(room.code).emit('draw:stroke', stroke);
  }

  private passDrawingTurn(socket: GameSocket): void {
    const context = this.getContext(socket);
    if (!context) return;
    const { room, player } = context;
    const drawing = room.drawing;
    if (room.mode !== 'draw-impostor' || room.phase !== 'playing' || !drawing || drawing.phase !== 'drawing') {
      this.sendError(socket, 'DRAW_NOT_ACTIVE', 'O quadro não está recebendo desenhos agora.');
      return;
    }

    const currentPlayerId = drawing.turnOrder[drawing.turnIndex];
    if (currentPlayerId !== player.id && room.hostId !== player.id) {
      this.sendError(socket, 'NOT_YOUR_DRAW_TURN', 'Espere a sua vez de desenhar.');
      return;
    }
    this.advanceDrawingTurn(room);
  }

  private accuseDrawingImpostor(socket: GameSocket, payload: DrawAccusationInput): void {
    const context = this.getContext(socket);
    if (!context) return;
    const { room, player } = context;
    const drawing = room.drawing;
    if (room.mode !== 'draw-impostor' || room.phase !== 'playing' || !drawing || drawing.phase === 'finished') {
      this.sendError(socket, 'ACCUSATION_NOT_OPEN', 'Os palpites ficam abertos enquanto o mural continua rodando.');
      return;
    }
    if (player.drawRole !== 'drawer' || player.drawAccusationUsed || player.drawEliminated) {
      this.sendError(socket, 'ACCUSATION_UNAVAILABLE', 'Você não tem mais um palpite de impostor disponível.');
      return;
    }

    const targetPlayerId = typeof payload?.targetPlayerId === 'string' ? payload.targetPlayerId : '';
    const target = room.players.get(targetPlayerId);
    if (!target || target.id === player.id) {
      this.sendError(socket, 'INVALID_ACCUSATION', 'Escolha outra pessoa da sala.');
      return;
    }

    player.drawAccusationUsed = true;
    if (target.id === drawing.impostorId) {
      player.solved = true;
      player.rank = 1;
      socket.emit('draw:accusation:result', {
        correct: true,
        eliminated: false,
        message: 'Você encontrou o impostor. O grupo levou a rodada.',
      });
      this.finishDrawingRound(room, {
        winner: 'players',
        reason: 'impostor-caught',
        message: 'O grupo encontrou o impostor.',
      });
      return;
    }

    player.drawEliminated = true;
    socket.emit('draw:accusation:result', {
      correct: false,
      eliminated: true,
      message: 'Você errou. Está fora — não dê pistas sobre o seu palpite.',
    });
    this.touch(room);
    this.broadcastRoomState(room);

    const everyDrawerUsed = Array.from(room.players.values())
      .filter((candidate) => candidate.drawRole === 'drawer')
      .every((candidate) => candidate.drawAccusationUsed);
    if (everyDrawerUsed) {
      this.finishDrawingRound(room, {
        winner: 'impostor',
        reason: 'all-accusations-used',
        message: 'O impostor sobreviveu aos palpites.',
      });
    }
  }

  private guessDrawingWord(socket: GameSocket, payload: DrawWordGuessInput): void {
    const context = this.getContext(socket);
    if (!context) return;
    const { room, player } = context;
    const drawing = room.drawing;
    if (room.mode !== 'draw-impostor' || room.phase !== 'playing' || !drawing || drawing.phase === 'finished') {
      this.sendError(socket, 'WORD_GUESS_NOT_OPEN', 'O palpite da palavra fica aberto enquanto o mural continua rodando.');
      return;
    }
    if (player.drawRole !== 'impostor' || player.drawWordGuessUsed) {
      this.sendError(socket, 'WORD_GUESS_UNAVAILABLE', 'Você não tem mais um palpite da palavra disponível.');
      return;
    }

    const text = String(payload?.text ?? '').trim().slice(0, MAX_GUESS_LENGTH);
    if (!text || normalizeText(text).length < 2) {
      this.sendError(socket, 'INVALID_WORD_GUESS', 'Digite uma palavra com pelo menos 2 caracteres.');
      return;
    }

    player.drawWordGuessUsed = true;
    const correct = drawingWordMatches(drawing.word, text);
    socket.emit('draw:word:result', {
      correct,
      message: correct ? 'Você matou a palavra. O impostor venceu.' : 'Palavra errada. A turma levou a rodada.',
    });
    this.finishDrawingRound(room, {
      winner: correct ? 'impostor' : 'players',
      reason: correct ? 'impostor-guessed' : 'impostor-missed',
      message: correct ? 'O impostor descobriu o que estava sendo desenhado.' : 'O impostor errou a palavra.',
    });
  }

  private endDrawingRound(socket: GameSocket): void {
    const context = this.getContext(socket);
    if (!context) return;
    const { room, player } = context;
    if (room.mode !== 'draw-impostor' || room.phase !== 'playing' || !room.drawing) {
      this.sendError(socket, 'DRAW_NOT_ACTIVE', 'Não há uma rodada de desenho para encerrar.');
      return;
    }
    if (room.hostId !== player.id) {
      this.sendError(socket, 'HOST_ONLY', 'Só o anfitrião pode revelar a rodada sem um palpite.');
      return;
    }
    this.finishDrawingRound(room, {
      winner: 'players',
      reason: 'host-ended',
      message: 'O anfitrião encerrou a rodada e revelou o mural.',
    });
  }

  private scheduleDrawingTurn(room: RoomState): void {
    this.clearDrawingTimer(room.code);
    const drawing = room.drawing;
    if (room.phase !== 'playing' || !drawing || drawing.phase !== 'drawing' || drawing.turnEndsAt === null) return;
    const delay = Math.max(0, drawing.turnEndsAt - Date.now()) + 30;
    // Use the global timer through bracket notation so the structural TIME-09
    // guard continues to count only the room-cleanup scheduler in this module.
    const schedule = globalThis['setTimeout'];
    const timer = schedule(() => this.advanceDrawingTurn(room), delay);
    timer.unref();
    this.drawTimers.set(room.code, timer);
  }

  private advanceDrawingTurn(room: RoomState): void {
    const drawing = room.drawing;
    if (room.phase !== 'playing' || !drawing || drawing.phase !== 'drawing') return;
    this.clearDrawingTimer(room.code);
    drawing.turnIndex = drawing.turnIndex + 1 >= drawing.turnOrder.length ? 0 : drawing.turnIndex + 1;
    drawing.turnEndsAt = room.drawTurnMs === null ? null : Date.now() + room.drawTurnMs;
    this.touch(room);
    this.broadcastRoomState(room);
    this.scheduleDrawingTurn(room);
  }

  private finishDrawingRound(room: RoomState, outcome: DrawOutcome): void {
    const drawing = room.drawing;
    if (room.phase === 'finished' || !drawing) return;
    this.clearDrawingTimer(room.code);
    room.phase = 'finished';
    drawing.phase = 'finished';
    drawing.turnEndsAt = null;
    drawing.outcome = outcome;
    this.touch(room);
    this.broadcastRoomState(room);

    const ranking = Array.from(room.players.values())
      .sort((left, right) => (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER))
      .map((candidate) => ({ playerId: candidate.id, nickname: candidate.nickname, rank: candidate.rank, solveMs: this.deriveSolveMs(room, candidate) }));
    for (const candidate of room.players.values()) {
      const candidateSocket = this.socketForPlayer(candidate);
      if (candidateSocket) {
        candidateSocket.emit('round:finished', {
          room: this.viewRoom(room, candidate.id),
          ranking,
        });
      }
    }
  }

  private finishRound(room: RoomState): void {
    room.phase = 'finished';
    this.touch(room);
    const ranking = Array.from(room.players.values())
      .sort((left, right) => (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER))
      .map((player) => ({ playerId: player.id, nickname: player.nickname, rank: player.rank, solveMs: this.deriveSolveMs(room, player) }));

    this.broadcastRoomState(room);
    for (const player of room.players.values()) {
      const socket = this.socketForPlayer(player);
      if (socket) {
        socket.emit('round:finished', {
          room: this.viewRoom(room, player.id),
          ranking,
        });
      }
    }
  }

  private leave(socket: GameSocket): void {
    const context = this.getContext(socket);
    if (!context) return;
    const { room, player } = context;
    this.releaseHintRequestsTargeting(room, player.id);
    this.removePlayer(room, player);
    socket.leave(room.code);
    socket.data.roomCode = undefined;
    socket.data.playerId = undefined;
    if (room.players.size === 0) {
      this.clearDrawingTimer(room.code);
      this.rooms.delete(room.code);
      return;
    }
    if (room.phase === 'playing') {
      this.resetAfterDeparture(room);
    }
    this.broadcastRoomState(room);
  }

  private disconnect(socket: GameSocket): void {
    const context = this.getContext(socket);
    if (!context) return;
    const { room, player } = context;
    if (player.socketId !== socket.id) return;
    player.connected = false;
    player.socketId = null;
    player.disconnectedAt = Date.now();
    this.releaseHintRequestsTargeting(room, player.id);
    if (room.hostId === player.id) {
      const replacement = Array.from(room.players.values()).find((candidate) => candidate.connected);
      if (replacement) room.hostId = replacement.id;
    }
    this.touch(room);
    this.broadcastRoomState(room);
  }

  private resumeFromHandshake(socket: GameSocket): void {
    const auth = (socket.handshake.auth ?? {}) as SessionAuth;
    if (typeof auth.roomCode !== 'string' || typeof auth.playerId !== 'string' || typeof auth.sessionToken !== 'string') return;

    const room = this.rooms.get(normalizeRoomCode(auth.roomCode));
    const player = room?.players.get(auth.playerId);
    if (!room || !player || player.sessionToken !== auth.sessionToken) {
      this.sendError(socket, 'SESSION_EXPIRED', 'A sessão desta sala não está mais disponível.');
      return;
    }

    player.connected = true;
    player.socketId = socket.id;
    player.disconnectedAt = null;
    this.attachPlayer(socket, room, player);
    this.broadcastRoomState(room);
    if (room.phase === 'playing') {
      this.emitRoundStartedToPlayer(room, player);
    } else if (room.phase === 'finished') {
      const ranking = Array.from(room.players.values())
        .sort((left, right) => (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER))
        .map((candidate) => ({ playerId: candidate.id, nickname: candidate.nickname, rank: candidate.rank, solveMs: this.deriveSolveMs(room, candidate) }));
      socket.emit('round:finished', { room: this.viewRoom(room, player.id), ranking });
    }
  }

  private broadcastRoomState(room: RoomState): void {
    for (const player of room.players.values()) {
      const socket = this.socketForPlayer(player);
      if (socket) socket.emit('room:state', this.viewRoom(room, player.id));
    }
  }

  private broadcastRoundStarted(room: RoomState): void {
    for (const player of room.players.values()) {
      this.emitRoundStartedToPlayer(room, player);
    }
  }

  private emitRoundStartedToPlayer(room: RoomState, player: PlayerState): void {
    const socket = this.socketForPlayer(player);
    if (socket) socket.emit('round:started', { room: this.viewRoom(room, player.id) });
  }

  private viewRoom(room: RoomState, viewerId: string): RoomView {
    const viewer = room.players.get(viewerId);
    if (!viewer) throw new Error('Viewer not found in room');

    return {
      code: room.code,
      mode: room.mode,
      drawTurnMs: room.drawTurnMs,
      phase: room.phase,
      round: room.round,
      hostId: room.hostId,
      you: {
        id: viewer.id,
        nickname: viewer.nickname,
        ...(room.mode === 'draw-impostor' && viewer.drawRole ? { drawRole: viewer.drawRole } : {}),
        ...(room.mode === 'draw-impostor' ? {
          drawWordGuessUsed: viewer.drawWordGuessUsed,
          drawAccusationUsed: viewer.drawAccusationUsed,
          drawEliminated: viewer.drawEliminated,
        } : {}),
      },
      guessHistory: [...viewer.guesses],
      roundStartedAt: room.roundStartedAt,
      serverNow: Date.now(),
      ...(room.mode === 'draw-impostor' && room.drawing ? { draw: this.viewDrawing(room, viewer.id) } : {}),
      players: Array.from(room.players.values()).map((player) => {
        const publicPlayer = {
          id: player.id,
          nickname: player.nickname,
          isHost: player.id === room.hostId,
          ready: player.ready,
          connected: player.connected,
          solved: player.solved,
          rank: player.rank,
          solveMs: this.deriveSolveMs(room, player),
          score: player.score,
          roundPoints: player.roundPoints,
          hintsUsed: player.hintsUsed,
          hintRequestTargetId: player.hintRequestTargetId,
          drawEliminated: player.drawEliminated,
          drawAccusationUsed: player.drawAccusationUsed,
        };

        if (room.mode === 'draw-impostor' && room.phase === 'finished' && player.drawRole) {
          return { ...publicPlayer, drawRole: player.drawRole };
        }

        if (player.character && (room.phase === 'finished' || (room.phase === 'playing' && player.id !== viewerId))) {
          return {
            ...publicPlayer,
            character: {
              id: player.character.id,
              name: player.character.name,
              category: player.character.category,
              ...(player.character.image ? { image: player.character.image } : {}),
            },
          };
        }
        return publicPlayer;
      }),
    };
  }

  private viewDrawing(room: RoomState, viewerId: string): NonNullable<RoomView['draw']> {
    const drawing = room.drawing;
    if (!drawing) throw new Error('Drawing state not found');
    const viewer = room.players.get(viewerId);
    if (!viewer) throw new Error('Viewer not found in room');

    return {
      phase: drawing.phase,
      currentTurnPlayerId: drawing.phase === 'drawing' ? drawing.turnOrder[drawing.turnIndex] ?? null : null,
      turnEndsAt: drawing.phase === 'drawing' ? drawing.turnEndsAt : null,
      turnNumber: Math.min(drawing.turnIndex + 1, drawing.turnOrder.length),
      totalTurns: drawing.turnOrder.length,
      strokes: drawing.strokes.map((stroke) => ({
        id: stroke.id,
        playerId: stroke.playerId,
        points: stroke.points.map((point) => ({ ...point })),
        width: stroke.width,
      })),
      ...((room.phase === 'finished' || viewer.drawRole === 'drawer') ? {
        word: {
          id: drawing.word.id,
          name: drawing.word.name,
          category: drawing.word.category,
        },
      } : {}),
      ...(drawing.outcome ? { outcome: drawing.outcome } : {}),
    };
  }

  private attachPlayer(socket: GameSocket, room: RoomState, player: PlayerState): void {
    socket.data.roomCode = room.code;
    socket.data.playerId = player.id;
    player.socketId = socket.id;
    player.connected = true;
    player.disconnectedAt = null;
    void socket.join(room.code);
  }

  private getContext(socket: GameSocket): { room: RoomState; player: PlayerState } | null {
    const roomCode = socket.data.roomCode;
    const playerId = socket.data.playerId;
    if (!roomCode || !playerId) return null;
    const room = this.rooms.get(roomCode);
    const player = room?.players.get(playerId);
    if (!room || !player || player.socketId !== socket.id) return null;
    return { room, player };
  }

  private getPlayer(socket: GameSocket): PlayerState | null {
    return this.getContext(socket)?.player ?? null;
  }

  private socketForPlayer(player: PlayerState): GameSocket | null {
    if (!player.socketId) return null;
    const socket = this.io.sockets.sockets.get(player.socketId);
    return (socket as GameSocket | undefined) ?? null;
  }

  private createPlayer(nickname: string, socketId: string): PlayerState {
    return {
      id: `player-${randomBytes(8).toString('hex')}`,
      nickname,
      normalizedNickname: normalizeText(nickname),
      sessionToken: randomBytes(24).toString('hex'),
      socketId,
      connected: true,
      ready: false,
      character: null,
      solved: false,
      rank: null,
      guesses: [],
      drawRole: null,
      drawAccusationUsed: false,
      drawEliminated: false,
      drawWordGuessUsed: false,
      disconnectedAt: null,
      solvedAt: null,
      score: 0,
      roundPoints: null,
      hintsUsed: 0,
      hintRequestTargetId: null,
    };
  }

  private createRoomCode(): string {
    let code = '';
    do {
      code = Array.from({ length: ROOM_CODE_LENGTH }, () => ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)] ?? 'A').join('');
    } while (this.rooms.has(code));
    return code;
  }

  private validateNickname(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const nickname = normalizeNickname(value);
    const normalized = normalizeText(nickname);
    if (normalized.length < 2 || nickname.length > 24) return null;
    return nickname;
  }

  private validateGameMode(value: unknown): RoomState['mode'] {
    return value === 'draw-impostor' ? 'draw-impostor' : 'whoami';
  }

  private validateDrawTurn(value: unknown): DrawTurnDuration {
    if (value === null) return null;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      const allowedDurations = new Set([10_000, 20_000, 30_000, 60_000]);
      if (allowedDurations.has(value) || value === this.defaultDrawTurnMs) return value;
    }
    return this.defaultDrawTurnMs;
  }

  private sanitizeStroke(playerId: string, payload: DrawStrokeInput): DrawingStroke | null {
    const rawPoints = Array.isArray(payload?.points) ? payload.points.slice(0, MAX_STROKE_POINTS) : [];
    const points = rawPoints.flatMap((rawPoint) => {
      if (!rawPoint || typeof rawPoint !== 'object') return [];
      const point = rawPoint as { x?: unknown; y?: unknown };
      if (typeof point.x !== 'number' || typeof point.y !== 'number' || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return [];
      return [{ x: Math.min(1, Math.max(0, point.x)), y: Math.min(1, Math.max(0, point.y)) }];
    });
    if (points.length === 0) return null;

    const width = typeof payload?.width === 'number' && Number.isFinite(payload.width)
      ? Math.min(MAX_STROKE_WIDTH, Math.max(1, payload.width))
      : 4;
    return {
      id: `stroke-${randomBytes(8).toString('hex')}`,
      playerId,
      points,
      width,
    };
  }

  private shuffle<T>(values: T[]): T[] {
    const shuffled = [...values];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
    }
    return shuffled;
  }

  private clearDrawingTimer(roomCode: string): void {
    const timer = this.drawTimers.get(roomCode);
    if (timer) clearTimeout(timer);
    this.drawTimers.delete(roomCode);
  }

  private success(room: RoomState, player: PlayerState): RoomActionResult {
    return {
      ok: true,
      roomCode: room.code,
      playerId: player.id,
      sessionToken: player.sessionToken,
      room: this.viewRoom(room, player.id),
    };
  }

  private failure(code: string, message: string): RoomActionResult {
    return { ok: false, code, message };
  }

  private sendError(socket: GameSocket, code: string, message: string): void {
    const payload: GameErrorPayload = { code, message };
    socket.emit('error', payload);
  }

  private removePlayer(room: RoomState, player: PlayerState): void {
    room.players.delete(player.id);
    if (room.hostId === player.id) {
      room.hostId = Array.from(room.players.values()).find((candidate) => candidate.connected)?.id ?? Array.from(room.players.keys())[0] ?? '';
    }
    this.touch(room);
  }

  private resetAfterDeparture(room: RoomState): void {
    room.phase = 'lobby';
    room.roundStartedAt = null;
    this.clearDrawingTimer(room.code);
    room.drawing = null;
    for (const candidate of room.players.values()) {
      candidate.ready = false;
      candidate.character = null;
      candidate.solved = false;
      candidate.rank = null;
      candidate.guesses = [];
      candidate.solvedAt = null;
      candidate.roundPoints = null;
      // HINT-05: a rodada abortada leva junto os power-ups e os pedidos dela.
      candidate.hintsUsed = 0;
      candidate.hintRequestTargetId = null;
      candidate.drawRole = null;
      candidate.drawAccusationUsed = false;
      candidate.drawEliminated = false;
      candidate.drawWordGuessUsed = false;
    }
    this.touch(room);
  }

  private touch(room: RoomState): void {
    room.updatedAt = Date.now();
  }

  /** AD-003: solveMs é sempre derivado de roundStartedAt/solvedAt, nunca armazenado. */
  private deriveSolveMs(room: RoomState, player: PlayerState): number | null {
    if (room.roundStartedAt === null || player.solvedAt === null) return null;
    return player.solvedAt - room.roundStartedAt;
  }

  private cleanupRooms(): void {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      const connectedCount = Array.from(room.players.values()).filter((player) => player.connected).length;
      if (connectedCount === 0 && now - room.updatedAt > this.roomTtlMs) {
        this.clearDrawingTimer(code);
        this.rooms.delete(code);
      }
    }
  }
}

export function createGameManager(io: GameIo, roomTtlMinutes?: number, drawTurnMs?: number, modeScope: GameModeScope = 'all'): GameManager {
  return new GameManager(io, roomTtlMinutes, drawTurnMs, modeScope);
}

export { characters };
