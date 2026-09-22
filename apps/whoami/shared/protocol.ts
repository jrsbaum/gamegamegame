import type {
  CaracolActionResult,
  CaracolBoomerangInput,
  CaracolDeathPayload,
  CaracolHistoryInput,
  CaracolHistoryResult,
  CaracolLoginInput,
  CaracolNoticePayload,
  CaracolPushSubscriptionInput,
  CaracolRedirectInput,
  CaracolRegisterInput,
  CaracolResumeInput,
  CaracolRouletteResult,
  CaracolSelectCityInput,
  CaracolShopEquipInput,
  CaracolShopPurchaseInput,
  CaracolStateView,
  CaracolVisibilityInput,
} from './caracol';

export type GameMode = 'whoami' | 'draw-impostor';
export type RoomPhase = 'lobby' | 'playing' | 'finished';
export type DrawPhase = 'drawing' | 'finished';
export type DrawRole = 'drawer' | 'impostor';
export type DrawTurnDuration = number | null;
export type DrawOutcomeWinner = 'players' | 'impostor';
export type DrawOutcomeReason = 'impostor-caught' | 'impostor-guessed' | 'impostor-missed' | 'all-accusations-used' | 'host-ended';

export interface DrawWordPublic {
  id: string;
  name: string;
  category: string;
}

export interface DrawingPoint {
  x: number;
  y: number;
}

export interface DrawingStroke {
  id: string;
  playerId: string;
  points: DrawingPoint[];
  width: number;
}

export interface DrawOutcome {
  winner: DrawOutcomeWinner;
  reason: DrawOutcomeReason;
  message: string;
}

export interface DrawGameView {
  phase: DrawPhase;
  currentTurnPlayerId: string | null;
  turnEndsAt: number | null;
  turnNumber: number;
  totalTurns: number;
  strokes: DrawingStroke[];
  word?: DrawWordPublic;
  outcome?: DrawOutcome;
}

export interface CharacterPublic {
  id: string;
  name: string;
  category: string;
  // Espelha CharacterImage de server/character-images.ts sem importar
  // código de servidor: shared/ não deve depender de server/, mesmo motivo
  // pelo qual name e category já são redeclarados aqui.
  image?: {
    url: string;
    author: string;
    license: string;
    // Fonte da imagem: 'Wikimedia Commons' (licença livre) ou 'AniList' (arte
    // de estúdio, uso não comercial tolerado) — IMG-02, IMG-07.
    source: string;
  };
}

export interface PlayerView {
  id: string;
  nickname: string;
  isHost: boolean;
  ready: boolean;
  connected: boolean;
  solved: boolean;
  rank: number | null;
  drawEliminated: boolean;
  drawAccusationUsed: boolean;
  drawRole?: DrawRole;
  character?: CharacterPublic;
  solveMs: number | null;
  /** Total acumulado da sessão, sempre calculado pelo servidor (SCORE-05). */
  score: number;
  /**
   * Pontos ganhos na rodada corrente. `null` enquanto o jogador não acertou:
   * distingue "ainda não acertou" de "acertou e levou 0", caso que a fórmula
   * atual não produz mas que uma mudança de fórmula criaria.
   */
  roundPoints: number | null;
  /**
   * Power-ups de dica já gastos na rodada. O contrato expõe o usado, e não o
   * disponível, porque o disponível depende do relógio: ele é derivado dos dois
   * lados por `availableHintPowerups` de `shared/hints.ts`, a partir de
   * `roundStartedAt` e `serverNow`. Mandar o disponível congelaria no instante
   * do broadcast e ficaria errado assim que a rodada cruzasse o marco seguinte.
   */
  hintsUsed: number;
  /** Id do jogador a quem este jogador pediu dica; null sem pedido pendente. */
  hintRequestTargetId: string | null;
}

export interface RoomView {
  code: string;
  mode: GameMode;
  drawTurnMs: DrawTurnDuration;
  phase: RoomPhase;
  round: number;
  hostId: string;
  players: PlayerView[];
  you: {
    id: string;
    nickname: string;
    drawRole?: DrawRole;
    drawWordGuessUsed?: boolean;
    drawAccusationUsed?: boolean;
    drawEliminated?: boolean;
  };
  guessHistory: string[];
  roundStartedAt: number | null;
  serverNow: number;
  draw?: DrawGameView;
}

export interface CreateRoomInput {
  nickname: string;
  mode?: GameMode;
  drawTurnMs?: DrawTurnDuration;
}

export interface JoinRoomInput {
  code: string;
  nickname: string;
}

export interface ReadyInput {
  ready: boolean;
}

export interface GuessInput {
  text: string;
}

/**
 * Único payload do protocolo que identifica um terceiro: todos os outros
 * eventos agem sobre quem os emite. É o anfitrião tirando da sala alguém que
 * caiu e não voltou — sem isso, `everyoneReady` nunca fecha e a sala não
 * consegue começar a rodada seguinte.
 */
export interface RemoveAbsentInput {
  playerId: string;
}

/** Alvo do pedido de dica: alguém que já acertou nesta rodada (HINT-07). */
export interface HintRequestInput {
  targetId: string;
}

/** Quem pediu a dica, informado pelo alvo ao marcar que respondeu (HINT-10). */
export interface HintAnswerInput {
  askerId: string;
}

export interface DrawStrokeInput {
  points: DrawingPoint[];
  width?: number;
}

export interface DrawAccusationInput {
  targetPlayerId: string;
}

export interface DrawWordGuessInput {
  text: string;
}

export interface RoomActionSuccess {
  ok: true;
  roomCode: string;
  playerId: string;
  sessionToken: string;
  room: RoomView;
}

export interface RoomActionFailure {
  ok: false;
  code: string;
  message: string;
}

export type RoomActionResult = RoomActionSuccess | RoomActionFailure;

export interface GuessResultPayload {
  correct: boolean;
  alreadySolved: boolean;
  attempts: number;
  message: string;
  history: string[];
}

export interface PlayerSolvedPayload {
  playerId: string;
  nickname: string;
  rank: number;
  solveMs: number;
}

export interface RoundStartedPayload {
  room: RoomView;
}

export interface RoundFinishedPayload {
  room: RoomView;
  ranking: Array<{
    playerId: string;
    nickname: string;
    rank: number | null;
    solveMs: number | null;
  }>;
}

export interface DrawAccusationResultPayload {
  correct: boolean;
  eliminated: boolean;
  message: string;
}

export interface DrawWordResultPayload {
  correct: boolean;
  message: string;
}

export interface GameErrorPayload {
  code: string;
  message: string;
}

export interface RoomNoticePayload {
  code: string;
  message: string;
}

export interface ClientToServerEvents {
  'room:create': (payload: CreateRoomInput, ack: (result: RoomActionResult) => void) => void;
  'room:join': (payload: JoinRoomInput, ack: (result: RoomActionResult) => void) => void;
  'player:ready': (payload: ReadyInput) => void;
  'round:guess': (payload: GuessInput) => void;
  'draw:stroke': (payload: DrawStrokeInput) => void;
  'draw:pass': () => void;
  'draw:accuse': (payload: DrawAccusationInput) => void;
  'draw:guess-word': (payload: DrawWordGuessInput) => void;
  'draw:end': () => void;
  'round:playAgain': () => void;
  // A rodada só termina sozinha quando todo mundo acerta, então um jogador que
  // cai antes de descobrir a própria identidade a congela para sempre. Este
  // comando é a saída manual: o anfitrião encerra a rodada travada e a sala
  // segue para a próxima sem precisar ser dissolvida.
  'round:endEarly': () => void;
  'room:removeAbsent': (payload: RemoveAbsentInput) => void;
  'room:leave': () => void;
  // Power-up de dica: quem está preso gasta um power-up apontando para alguém
  // que já acertou, o alvo marca que respondeu, e quem pediu pode desistir.
  'hint:request': (payload: HintRequestInput) => void;
  'hint:answer': (payload: HintAnswerInput) => void;
  'hint:cancel': () => void;
  'caracol:register': (payload: CaracolRegisterInput, ack: (result: CaracolActionResult) => void) => void;
  'caracol:login': (payload: CaracolLoginInput, ack: (result: CaracolActionResult) => void) => void;
  'caracol:resume': (payload: CaracolResumeInput, ack: (result: CaracolActionResult) => void) => void;
  'caracol:sync': (ack: (result: CaracolActionResult) => void) => void;
  'caracol:select-city': (payload: CaracolSelectCityInput, ack: (result: CaracolActionResult) => void) => void;
  'caracol:redirect': (payload: CaracolRedirectInput, ack: (result: CaracolActionResult) => void) => void;
  'caracol:buy-speed': (ack: (result: CaracolActionResult) => void) => void;
  'caracol:buy-discount': (ack: (result: CaracolActionResult) => void) => void;
  'caracol:shop-purchase': (payload: CaracolShopPurchaseInput, ack: (result: CaracolActionResult) => void) => void;
  'caracol:shop-equip': (payload: CaracolShopEquipInput, ack: (result: CaracolActionResult) => void) => void;
  'caracol:roulette': (ack: (result: CaracolRouletteResult) => void) => void;
  'caracol:boomerang': (payload: CaracolBoomerangInput, ack: (result: CaracolActionResult) => void) => void;
  'caracol:visibility': (payload: CaracolVisibilityInput) => void;
  'caracol:push-subscribe': (payload: CaracolPushSubscriptionInput, ack: (result: CaracolActionResult) => void) => void;
  'caracol:push-unsubscribe': (payload: { endpoint: string }, ack: (result: CaracolActionResult) => void) => void;
  'caracol:history': (payload: CaracolHistoryInput, ack: (result: CaracolHistoryResult) => void) => void;
  'caracol:logout': () => void;
}

export interface ServerToClientEvents {
  'room:state': (room: RoomView) => void;
  'round:started': (payload: RoundStartedPayload) => void;
  'guess:result': (payload: GuessResultPayload) => void;
  'player:solved': (payload: PlayerSolvedPayload) => void;
  'round:finished': (payload: RoundFinishedPayload) => void;
  'room:notice': (payload: RoomNoticePayload) => void;
  'draw:stroke': (stroke: DrawingStroke) => void;
  'draw:accusation:result': (payload: DrawAccusationResultPayload) => void;
  'draw:word:result': (payload: DrawWordResultPayload) => void;
  error: (payload: GameErrorPayload) => void;
  'caracol:state': (state: CaracolStateView) => void;
  'caracol:notice': (payload: CaracolNoticePayload) => void;
  'caracol:death': (payload: CaracolDeathPayload) => void;
  'caracol:history-added': (entry: import('./caracol').CaracolHistoryEntry) => void;
}

export interface InterServerEvents {
  ping: () => void;
}

export interface SocketData {
  roomCode?: string;
  playerId?: string;
  caracolAccountId?: string;
  caracolSessionTokenHash?: string;
}
