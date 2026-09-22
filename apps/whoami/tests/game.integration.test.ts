import { readFileSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { io as createClient, type Socket } from 'socket.io-client';
import { Server } from 'socket.io';
import type {
  ClientToServerEvents,
  InterServerEvents,
  PlayerSolvedPayload,
  RoomActionResult,
  RoomView,
  RoundFinishedPayload,
  ServerToClientEvents,
  SocketData,
} from '../shared/protocol';
import { createGameManager, MAX_PLAYERS, type GameManager } from '../server/game';
import { characters } from '../server/wordlist';

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let httpServer: HttpServer;
let ioServer: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
let manager: GameManager;
let address = '';
const managerClients: TestSocket[] = [];

/**
 * Acesso de teste ao estado privado da sala. `tests/` não está em nenhum
 * tsconfig (ver design.md Risks), então este cast só é validado pelo
 * transform do vitest, nunca pelo `tsc` do build.
 */
function getInternalRoom(roomCode: string): { usedCharacterIds: Set<string> } | undefined {
  const internalRooms = (manager as unknown as { rooms: Map<string, { usedCharacterIds: Set<string> }> }).rooms;
  return internalRooms.get(roomCode);
}

/**
 * Acesso de teste aos instantes de tempo (T8): `roundStartedAt` e
 * `solvedAt` ainda não são expostos pelo protocolo nesta task (isso é T9),
 * então o único jeito de observá-los é o mesmo cast usado por
 * `getInternalRoom` para `usedCharacterIds`.
 */
function getInternalRoomTiming(
  roomCode: string,
): { roundStartedAt: number | null; players: Map<string, { solvedAt: number | null }> } | undefined {
  const internalRooms = (manager as unknown as {
    rooms: Map<string, { roundStartedAt: number | null; players: Map<string, { solvedAt: number | null }> }>;
  }).rooms;
  return internalRooms.get(roomCode);
}

/**
 * Acesso de teste ao `roundPlayerCount` da sala (SCORE-02). O N congelado no
 * início da rodada é estado interno de propósito — o protocolo expõe só o
 * efeito dele (`score`), nunca o valor —, então observá-lo usa o mesmo cast de
 * `getInternalRoom`.
 */
function getInternalRoomScoring(roomCode: string): { roundPlayerCount: number } | undefined {
  const internalRooms = (manager as unknown as { rooms: Map<string, { roundPlayerCount: number }> }).rooms;
  return internalRooms.get(roomCode);
}

/**
 * Acesso de teste à fase da sala (END-07..10). As recusas de `round:endEarly`
 * exigem provar que a fase NÃO mudou; esperar a ausência de um evento por um
 * prazo arbitrário provaria menos e ainda deixaria o teste lento e instável.
 * Ler a fase direto é determinístico, pelo mesmo cast de `getInternalRoom`.
 */
function getInternalRoomPhase(roomCode: string): string | undefined {
  const internalRooms = (manager as unknown as { rooms: Map<string, { phase: string }> }).rooms;
  return internalRooms.get(roomCode)?.phase;
}

/**
 * Quantidade de jogadores na sala (END-18..21). As recusas de
 * `room:removeAbsent` exigem provar que NINGUÉM saiu; contar direto no estado
 * é determinístico, sem depender da ausência de um broadcast.
 */
function getInternalRoomPlayerCount(roomCode: string): number | undefined {
  const internalRooms = (manager as unknown as { rooms: Map<string, { players: Map<string, unknown> }> }).rooms;
  return internalRooms.get(roomCode)?.players.size;
}

/**
 * Acesso de teste ao estado de dica da sala. `hintsUsed` e
 * `hintRequestTargetId` são expostos pelo protocolo, mas os testes de reset
 * precisam SEMEAR o estado antes de exercitar o reset, e o protocolo só tem
 * caminho de escrita a partir dos 30 minutos de rodada. Escrever direto no
 * estado, pelo mesmo cast de `getInternalRoom`, é o que torna o teste
 * determinístico sem esperar meia hora.
 */
function getInternalRoomHints(
  roomCode: string,
): Map<string, { hintsUsed: number; hintRequestTargetId: string | null }> | undefined {
  const internalRooms = (manager as unknown as {
    rooms: Map<string, { players: Map<string, { hintsUsed: number; hintRequestTargetId: string | null }> }>;
  }).rooms;
  return internalRooms.get(roomCode)?.players;
}

/**
 * Recua `roundStartedAt` da sala para simular uma rodada que já dura `minutes`
 * minutos. `vi.useFakeTimers` não serve aqui: a suíte sobe um Socket.IO real e
 * congelar o relógio do processo quebraria os timeouts de rede.
 */
function rewindRoundStart(roomCode: string, minutes: number): void {
  const internalRooms = (manager as unknown as { rooms: Map<string, { roundStartedAt: number | null }> }).rooms;
  const room = internalRooms.get(roomCode);
  if (!room || room.roundStartedAt === null) throw new Error('sala sem rodada em andamento');
  room.roundStartedAt -= minutes * 60_000;
}

/** Semeia power-ups gastos e um pedido pendente, para exercitar os resets. */
function seedHintState(roomCode: string, playerId: string, hintsUsed: number, targetId: string | null): void {
  const players = getInternalRoomHints(roomCode);
  const player = players?.get(playerId);
  if (!player) throw new Error('jogador não está na sala');
  player.hintsUsed = hintsUsed;
  player.hintRequestTargetId = targetId;
}

function waitForEvent<T>(socket: TestSocket, event: keyof ServerToClientEvents, predicate?: (payload: T) => boolean): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(event as never, listener as never);
      reject(new Error(`Timeout esperando ${String(event)}`));
      // Folga generosa: ver o comentário em vitest.config.ts. Prazo aqui não é
      // asserção, só evita a suíte travar se o evento nunca chegar.
    }, 15_000);
    const listener = (payload: T): void => {
      if (predicate && !predicate(payload)) return;
      clearTimeout(timeout);
      socket.off(event as never, listener as never);
      resolve(payload);
    };
    socket.on(event as never, listener as never);
  });
}

function connectClient(): Promise<TestSocket> {
  const client = createClient(address, { autoConnect: false, forceNew: true });
  managerClients.push(client);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout conectando cliente')), 15_000);
    client.once('connect', () => {
      clearTimeout(timeout);
      resolve(client);
    });
    client.once('connect_error', reject);
    client.connect();
  });
}

function createRoom(client: TestSocket, nickname: string): Promise<RoomActionResult> {
  return new Promise((resolve) => client.emit('room:create', { nickname }, resolve));
}

function joinRoom(client: TestSocket, code: string, nickname: string): Promise<RoomActionResult> {
  return new Promise((resolve) => client.emit('room:join', { code, nickname }, resolve));
}

/**
 * Cria um cliente para reconectar como um jogador já existente, via o mesmo
 * handshake de sessão que o cliente real usa. Não conecta sozinho: o
 * chamador deve registrar os listeners de evento primeiro e só então chamar
 * `.connect()`, seguindo o mesmo idioma do resto do arquivo (o servidor pode
 * emitir `round:started` no mesmo instante da confirmação da conexão).
 */
function createAuthedClient(auth: { roomCode: string; playerId: string; sessionToken: string }): TestSocket {
  const client = createClient(address, { autoConnect: false, forceNew: true, auth });
  managerClients.push(client);
  return client;
}

/**
 * Toca uma rodada completa (ready -> revela personagem do outro -> ambos
 * acertam -> round:finished) e devolve os ids dos personagens de cada um,
 * descobertos via a visão do adversário (o próprio jogador nunca vê o seu).
 */
async function playRoundToFinish(
  hostClient: TestSocket,
  guestClient: TestSocket,
  hostId: string,
  guestId: string,
): Promise<{ hostCharacterId: string; guestCharacterId: string }> {
  const startedHost = waitForEvent<{ room: RoomView }>(hostClient, 'round:started');
  const startedGuest = waitForEvent<{ room: RoomView }>(guestClient, 'round:started');
  hostClient.emit('player:ready', { ready: true });
  guestClient.emit('player:ready', { ready: true });
  const [roundHost, roundGuest] = await Promise.all([startedHost, startedGuest]);

  const hostCharacter = roundGuest.room.players.find((player) => player.id === hostId)?.character;
  const guestCharacter = roundHost.room.players.find((player) => player.id === guestId)?.character;
  if (!hostCharacter || !guestCharacter) {
    throw new Error('personagem do adversário não foi revelado');
  }

  const finishHost = waitForEvent<{ room: RoomView }>(hostClient, 'round:finished');
  const finishGuest = waitForEvent<{ room: RoomView }>(guestClient, 'round:finished');
  const solveHost = waitForEvent<{ correct: boolean }>(hostClient, 'guess:result');
  const solveGuest = waitForEvent<{ correct: boolean }>(guestClient, 'guess:result');
  hostClient.emit('round:guess', { text: hostCharacter.name });
  guestClient.emit('round:guess', { text: guestCharacter.name });
  await Promise.all([solveHost, solveGuest]);
  await Promise.all([finishHost, finishGuest]);

  return { hostCharacterId: hostCharacter.id, guestCharacterId: guestCharacter.id };
}

beforeAll(async () => {
  httpServer = createServer();
  ioServer = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(httpServer, { cors: { origin: true } });
  manager = createGameManager(ioServer, 1);
  ioServer.on('connection', (socket) => manager.bindSocket(socket));
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const serverAddress = httpServer.address() as AddressInfo;
  address = `http://127.0.0.1:${serverAddress.port}`;
});

afterAll(async () => {
  managerClients.forEach((client) => client.disconnect());
  await new Promise<void>((resolve) => ioServer.close(() => resolve()));
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

describe('fluxo protegido de uma rodada', () => {
  it('não envia o personagem secreto para o jogador, valida palpite e revela no fim', async () => {
    const playerA = await connectClient();
    const playerB = await connectClient();
    const created = await createRoom(playerA, 'Ana');
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const joined = await joinRoom(playerB, created.roomCode, 'Bia');
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;

    const startedA = waitForEvent<{ room: RoomView }>(playerA, 'round:started');
    const startedB = waitForEvent<{ room: RoomView }>(playerB, 'round:started');
    playerA.emit('player:ready', { ready: true });
    playerB.emit('player:ready', { ready: true });
    const [roundA, roundB] = await Promise.all([startedA, startedB]);

    const ownA = roundB.room.players.find((player) => player.id === created.playerId)?.character;
    const ownB = roundA.room.players.find((player) => player.id === joined.playerId)?.character;
    expect(ownA).toBeDefined();
    expect(ownB).toBeDefined();
    expect(roundA.room.players.find((player) => player.id === created.playerId)?.character).toBeUndefined();
    expect(roundB.room.players.find((player) => player.id === joined.playerId)?.character).toBeUndefined();
    expect(JSON.stringify(roundA)).not.toContain(ownA!.name);
    expect(JSON.stringify(roundB)).not.toContain(ownB!.name);

    const wrongGuess = waitForEvent<{ correct: boolean; history: string[] }>(playerA, 'guess:result');
    playerA.emit('round:guess', { text: 'uma resposta que não existe' });
    const wrong = await wrongGuess;
    expect(wrong.correct).toBe(false);
    expect(wrong.history).toEqual(['uma resposta que não existe']);

    const solveA = waitForEvent<{ correct: boolean }>(playerA, 'guess:result');
    playerA.emit('round:guess', { text: ownA!.name });
    expect((await solveA).correct).toBe(true);

    const finishA = waitForEvent<{ room: RoomView }>(playerA, 'round:finished');
    const finishB = waitForEvent<{ room: RoomView }>(playerB, 'round:finished');
    const solveB = waitForEvent<{ correct: boolean }>(playerB, 'guess:result');
    playerB.emit('round:guess', { text: ownB!.name });
    expect((await solveB).correct).toBe(true);
    const [finishedA, finishedB] = await Promise.all([finishA, finishB]);
    expect(finishedA.room.phase).toBe('finished');
    expect(finishedA.room.players.every((player) => player.character)).toBe(true);
    expect(finishedB.room.players.find((player) => player.id === joined.playerId)?.character?.name).toBe(ownB!.name);
  });

  it('a URL da imagem do próprio personagem não vaza durante a rodada e aparece na revelação (PRIV-02, PRIV-03)', async () => {
    // Herdar a proteção de viewRoom para o campo `image` sem testar é
    // exatamente como o mutante de POOL-06 sobreviveu na feature anterior
    // (ver design.md Risks). Este teste força o sorteio para dois
    // personagens com imagem aprovada — do contrário, sem imagem sorteada,
    // a asserção de URL passaria vazia e não provaria nada.
    const withImages = characters.filter((character) => character.image);
    expect(withImages.length).toBeGreaterThanOrEqual(2);
    const [chosenHostChar, chosenGuestChar] = withImages;

    const host = await connectClient();
    const guest = await connectClient();
    const created = await createRoom(host, 'Rui');
    const joined = await joinRoom(guest, created.roomCode, 'Zoe');
    expect(created.ok).toBe(true);
    expect(joined.ok).toBe(true);
    if (!created.ok || !joined.ok) return;

    const room = getInternalRoom(created.roomCode);
    expect(room).toBeDefined();
    room!.usedCharacterIds = new Set(
      characters.filter((character) => character.id !== chosenHostChar!.id && character.id !== chosenGuestChar!.id).map((character) => character.id),
    );

    const startedHost = waitForEvent<{ room: RoomView }>(host, 'round:started');
    const startedGuest = waitForEvent<{ room: RoomView }>(guest, 'round:started');
    host.emit('player:ready', { ready: true });
    guest.emit('player:ready', { ready: true });
    const [roundHost, roundGuest] = await Promise.all([startedHost, startedGuest]);

    // O pool tem só os dois personagens escolhidos, mas o sorteio embaralha
    // qual jogador recebe qual — descobre-se o próprio personagem pela visão
    // do adversário, do mesmo jeito que o teste de privacidade do nome já faz.
    const ownHostChar = roundGuest.room.players.find((player) => player.id === created.playerId)?.character;
    const ownGuestChar = roundHost.room.players.find((player) => player.id === joined.playerId)?.character;
    expect(ownHostChar?.image).toBeDefined();
    expect(ownGuestChar?.image).toBeDefined();
    const hostOwnImageUrl = ownHostChar!.image!.url;
    const guestOwnImageUrl = ownGuestChar!.image!.url;
    expect(new Set([chosenHostChar!.image!.url, chosenGuestChar!.image!.url])).toEqual(new Set([hostOwnImageUrl, guestOwnImageUrl]));

    // PRIV-02: a própria imagem não aparece no payload de ninguém durante a
    // rodada, nem embutida em outro campo qualquer.
    expect(JSON.stringify(roundHost)).not.toContain(hostOwnImageUrl);
    expect(JSON.stringify(roundGuest)).not.toContain(guestOwnImageUrl);

    // A imagem do adversário, em contrapartida, chega íntegra.
    expect(roundGuest.room.players.find((player) => player.id === created.playerId)?.character?.image).toEqual(ownHostChar!.image);
    expect(roundHost.room.players.find((player) => player.id === joined.playerId)?.character?.image).toEqual(ownGuestChar!.image);

    const finishHost = waitForEvent<{ room: RoomView }>(host, 'round:finished');
    const finishGuest = waitForEvent<{ room: RoomView }>(guest, 'round:finished');
    const solveHost = waitForEvent<{ correct: boolean }>(host, 'guess:result');
    const solveGuest = waitForEvent<{ correct: boolean }>(guest, 'guess:result');
    host.emit('round:guess', { text: ownHostChar!.name });
    guest.emit('round:guess', { text: ownGuestChar!.name });
    await Promise.all([solveHost, solveGuest]);
    const [finishedHost, finishedGuest] = await Promise.all([finishHost, finishGuest]);

    // PRIV-03: depois de round:finished, o quadro revelado inclui a imagem
    // de todos, inclusive a do próprio jogador.
    expect(finishedHost.room.players.find((player) => player.id === created.playerId)?.character?.image?.url).toBe(hostOwnImageUrl);
    expect(finishedGuest.room.players.find((player) => player.id === joined.playerId)?.character?.image?.url).toBe(guestOwnImageUrl);
  });

  it('recusa a décima terceira pessoa', async () => {
    const clients = await Promise.all(Array.from({ length: MAX_PLAYERS + 1 }, () => connectClient()));
    const created = await createRoom(clients[0]!, 'Host');
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    for (let index = 1; index < MAX_PLAYERS; index += 1) {
      const result = await joinRoom(clients[index]!, created.roomCode, `Pessoa ${index}`);
      expect(result.ok).toBe(true);
    }
    const tooMany = await joinRoom(clients[MAX_PLAYERS]!, created.roomCode, 'Pessoa extra');
    expect(tooMany).toEqual({ ok: false, code: 'ROOM_FULL', message: 'A sala já chegou ao limite de 12 pessoas.' });
  });
});

describe('pool de personagens sem repetição na mesma sala', () => {
  it('3 rodadas seguidas na mesma sala com 2 jogadores produzem 6 personagens distintos (POOL-01, POOL-02)', async () => {
    const host = await connectClient();
    const guest = await connectClient();
    const created = await createRoom(host, 'Ana');
    const joined = await joinRoom(guest, created.roomCode, 'Bia');
    expect(created.ok).toBe(true);
    expect(joined.ok).toBe(true);
    if (!created.ok || !joined.ok) return;

    const usedIds: string[] = [];
    for (let round = 0; round < 3; round += 1) {
      const { hostCharacterId, guestCharacterId } = await playRoundToFinish(host, guest, created.playerId, joined.playerId);
      usedIds.push(hostCharacterId, guestCharacterId);

      // Asserção determinística sobre o registro, não sobre o sorteio: com 304
      // personagens, 6 sorteios só colidem por acaso em ~5% das vezes, então
      // `new Set(usedIds).size === 6` sozinho passaria mesmo com a exclusão
      // quebrada. Conferir o próprio `usedCharacterIds` falha sempre que
      // `startRound` deixa de registrar os sorteados.
      const internal = getInternalRoom(created.roomCode);
      expect(internal).toBeDefined();
      expect(internal!.usedCharacterIds.size).toBe(usedIds.length);
      for (const id of usedIds) {
        expect(internal!.usedCharacterIds.has(id)).toBe(true);
      }

      if (round < 2) {
        const lobbyHost = waitForEvent<RoomView>(host, 'room:state', (room) => room.phase === 'lobby');
        const lobbyGuest = waitForEvent<RoomView>(guest, 'room:state', (room) => room.phase === 'lobby');
        host.emit('round:playAgain');
        await Promise.all([lobbyHost, lobbyGuest]);
      }
    }

    expect(usedIds.length).toBe(6);
    expect(new Set(usedIds).size).toBe(6);
  });

  it('sorteia somente entre os disponíveis: pool reduzido a 2 entrega exatamente esses 2 (POOL-01)', async () => {
    // Contraparte determinística do teste acima. Reduzir o disponível a
    // exatamente o número de jogadores torna o resultado do sorteio único:
    // se `excludeIds` for ignorado, os jogadores recebem 2 dos 304 e a
    // asserção falha praticamente sempre, em vez de depender de colisão.
    const host = await connectClient();
    const guest = await connectClient();
    const created = await createRoom(host, 'Ivo');
    const joined = await joinRoom(guest, created.roomCode, 'Lia');
    expect(created.ok).toBe(true);
    expect(joined.ok).toBe(true);
    if (!created.ok || !joined.ok) return;

    const remaining = characters.slice(-2);
    const room = getInternalRoom(created.roomCode);
    expect(room).toBeDefined();
    room!.usedCharacterIds = new Set(characters.slice(0, characters.length - 2).map((character) => character.id));

    const startedHost = waitForEvent<{ room: RoomView }>(host, 'round:started');
    const startedGuest = waitForEvent<{ room: RoomView }>(guest, 'round:started');
    host.emit('player:ready', { ready: true });
    guest.emit('player:ready', { ready: true });
    const [roundHost, roundGuest] = await Promise.all([startedHost, startedGuest]);

    const hostCharacterId = roundGuest.room.players.find((player) => player.id === created.playerId)?.character?.id;
    const guestCharacterId = roundHost.room.players.find((player) => player.id === joined.playerId)?.character?.id;
    expect(new Set([hostCharacterId, guestCharacterId])).toEqual(new Set(remaining.map((character) => character.id)));
  });

  it('não encerra a rodada por decurso de tempo (TIME-09)', async () => {
    const host = await connectClient();
    const guest = await connectClient();
    const created = await createRoom(host, 'Théo');
    const joined = await joinRoom(guest, created.roomCode, 'Vera');
    expect(created.ok).toBe(true);
    expect(joined.ok).toBe(true);
    if (!created.ok || !joined.ok) return;

    const startedHost = waitForEvent<{ room: RoomView }>(host, 'round:started');
    const startedGuest = waitForEvent<{ room: RoomView }>(guest, 'round:started');
    host.emit('player:ready', { ready: true });
    guest.emit('player:ready', { ready: true });
    await Promise.all([startedHost, startedGuest]);

    // Observação limitada, que é a forma testável do invariante: ninguém
    // palpita durante a janela e nenhum `round:finished` pode chegar. Um
    // limite de tempo implementado por engano encerraria a rodada aqui.
    let finished = false;
    const markFinished = (): void => {
      finished = true;
    };
    host.on('round:finished', markFinished);
    guest.on('round:finished', markFinished);
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    host.off('round:finished', markFinished);
    guest.off('round:finished', markFinished);

    expect(finished).toBe(false);

    // E a rodada segue viva, não apenas "não terminou": um palpite errado
    // ainda é aceito e respondido. Se a rodada tivesse encerrado por tempo,
    // o servidor responderia `error` com ROUND_NOT_PLAYING.
    const stillAccepting = waitForEvent<{ correct: boolean }>(host, 'guess:result');
    host.emit('round:guess', { text: 'palpite depois da espera' });
    expect((await stillAccepting).correct).toBe(false);
  });

  it('nenhum agendador pode encerrar rodada: só o acerto alcança finishRound (TIME-09)', () => {
    // Guarda estrutural, e não comportamental, de propósito. O teste acima
    // observa 1,2s, então por construção não detecta um limite de tempo mais
    // longo que a janela — e um limite realista seria de minutos. Asserir a
    // AUSÊNCIA do mecanismo pega a regressão em qualquer duração.
    const source = readFileSync(new URL('../server/game.ts', import.meta.url), 'utf8');

    // O único agendador do módulo é o de limpeza de salas ociosas.
    const schedulers = source.match(/set(?:Timeout|Interval)\s*\(/g) ?? [];
    expect(schedulers).toEqual(['setInterval(']);
    expect(source).toContain('setInterval(() => this.cleanupRooms(), 60_000)');

    // E finishRound é alcançável só pelos dois caminhos previstos: o acerto do
    // último palpite e o comando do anfitrião para destravar rodada com jogador
    // ausente (END-01). Fixar a identidade dos call sites, e não só a
    // quantidade, é o que mantém a guarda: um terceiro caminho quebra o teste,
    // e trocar um destes dois por um callback de agendador também.
    const callSites = source.split('\n').filter((line) => /this\.finishRound\(/.test(line));
    expect(callSites).toHaveLength(2);
    expect(source).toMatch(/everyoneSolved[\s\S]{0,120}this\.finishRound\(/);
    // Janela limitada de propósito: com quantificador ilimitado esta asserção
    // continuaria passando se a chamada migrasse para um método auxiliar
    // declarado depois de `endEarly`, que é justamente o caso que ela deveria
    // pegar. O corpo de `endEarly` cabe com folga em 1200 caracteres.
    expect(source).toMatch(/private endEarly[\s\S]{0,1200}this\.finishRound\(/);
  });

  it('descarta o registro de personagens usados junto com a sala (POOL-07)', async () => {
    const host = await connectClient();
    const created = await createRoom(host, 'Zeca');
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(getInternalRoom(created.roomCode)).toBeDefined();
    host.emit('room:leave');
    await new Promise((resolve) => setTimeout(resolve, 150));

    // A sala sai do Map, então o Set de usados sai com ela: não há registro
    // global de personagens usados que sobreviva ao fim da sala.
    expect(getInternalRoom(created.roomCode)).toBeUndefined();
  });

  it('mantém os personagens de uma rodada abortada por saída de jogador como usados (POOL-06)', async () => {
    const host = await connectClient();
    const guestB = await connectClient();
    const created = await createRoom(host, 'Carla');
    const joinedB = await joinRoom(guestB, created.roomCode, 'Duda');
    expect(created.ok).toBe(true);
    expect(joinedB.ok).toBe(true);
    if (!created.ok || !joinedB.ok) return;

    const startedHost = waitForEvent<{ room: RoomView }>(host, 'round:started');
    const startedGuestB = waitForEvent<{ room: RoomView }>(guestB, 'round:started');
    host.emit('player:ready', { ready: true });
    guestB.emit('player:ready', { ready: true });
    const [roundHost, roundGuestB] = await Promise.all([startedHost, startedGuestB]);

    const abortedHostCharacterId = roundGuestB.room.players.find((player) => player.id === created.playerId)?.character?.id;
    const abortedGuestCharacterId = roundHost.room.players.find((player) => player.id === joinedB.playerId)?.character?.id;
    expect(abortedHostCharacterId).toBeDefined();
    expect(abortedGuestCharacterId).toBeDefined();

    const lobbyAfterDeparture = waitForEvent<RoomView>(host, 'room:state', (room) => room.phase === 'lobby');
    guestB.emit('room:leave');
    await lobbyAfterDeparture;

    // Asserção determinística: os dois personagens da rodada abortada
    // continuam registrados como usados. Comparar apenas os ids da rodada
    // seguinte (abaixo) é fraco — são 2 sorteios em 304 personagens, então
    // `resetAfterDeparture` limpando o Set passaria por acaso na maioria das
    // execuções. Aqui, limpar o Set falha sempre.
    const abortedRoom = getInternalRoom(created.roomCode);
    expect(abortedRoom).toBeDefined();
    expect(abortedRoom!.usedCharacterIds.has(abortedHostCharacterId!)).toBe(true);
    expect(abortedRoom!.usedCharacterIds.has(abortedGuestCharacterId!)).toBe(true);
    expect(abortedRoom!.usedCharacterIds.size).toBe(2);

    const guestC = await connectClient();
    const joinedC = await joinRoom(guestC, created.roomCode, 'Elis');
    expect(joinedC.ok).toBe(true);
    if (!joinedC.ok) return;

    const startedHost2 = waitForEvent<{ room: RoomView }>(host, 'round:started');
    const startedGuestC = waitForEvent<{ room: RoomView }>(guestC, 'round:started');
    host.emit('player:ready', { ready: true });
    guestC.emit('player:ready', { ready: true });
    const [roundHost2, roundGuestC] = await Promise.all([startedHost2, startedGuestC]);

    const newHostCharacterId = roundGuestC.room.players.find((player) => player.id === created.playerId)?.character?.id;
    const newGuestCharacterId = roundHost2.room.players.find((player) => player.id === joinedC.playerId)?.character?.id;
    expect(newHostCharacterId).toBeDefined();
    expect(newGuestCharacterId).toBeDefined();

    expect(newHostCharacterId).not.toBe(abortedHostCharacterId);
    expect(newHostCharacterId).not.toBe(abortedGuestCharacterId);
    expect(newGuestCharacterId).not.toBe(abortedHostCharacterId);
    expect(newGuestCharacterId).not.toBe(abortedGuestCharacterId);
  });

  it('salas distintas podem sortear os mesmos personagens (POOL-03)', async () => {
    // usedCharacterIds é um Set por sala (não global): duas salas novas, cada
    // uma com o pool inteiro disponível e o mesmo algoritmo de sorteio, devem
    // poder chegar aos mesmos personagens. Fixar Math.random em 0 torna o
    // shuffle determinístico só durante o start de cada rodada, provando que
    // o pool da sala B não herdou nenhuma exclusão da sala A.
    const a1 = await connectClient();
    const a2 = await connectClient();
    const createdA = await createRoom(a1, 'Rita');
    const joinedA = await joinRoom(a2, createdA.roomCode, 'Sara');
    expect(createdA.ok).toBe(true);
    expect(joinedA.ok).toBe(true);
    if (!createdA.ok || !joinedA.ok) return;

    const startedA1 = waitForEvent<{ room: RoomView }>(a1, 'round:started');
    const startedA2 = waitForEvent<{ room: RoomView }>(a2, 'round:started');
    const randomSpyA = vi.spyOn(Math, 'random').mockReturnValue(0);
    a1.emit('player:ready', { ready: true });
    a2.emit('player:ready', { ready: true });
    const [roundA1, roundA2] = await Promise.all([startedA1, startedA2]);
    randomSpyA.mockRestore();

    const charactersA = new Set([
      roundA2.room.players.find((player) => player.id === createdA.playerId)?.character?.id,
      roundA1.room.players.find((player) => player.id === joinedA.playerId)?.character?.id,
    ]);

    const b1 = await connectClient();
    const b2 = await connectClient();
    const createdB = await createRoom(b1, 'Tais');
    const joinedB = await joinRoom(b2, createdB.roomCode, 'Uma');
    expect(createdB.ok).toBe(true);
    expect(joinedB.ok).toBe(true);
    if (!createdB.ok || !joinedB.ok) return;

    const startedB1 = waitForEvent<{ room: RoomView }>(b1, 'round:started');
    const startedB2 = waitForEvent<{ room: RoomView }>(b2, 'round:started');
    const randomSpyB = vi.spyOn(Math, 'random').mockReturnValue(0);
    b1.emit('player:ready', { ready: true });
    b2.emit('player:ready', { ready: true });
    const [roundB1, roundB2] = await Promise.all([startedB1, startedB2]);
    randomSpyB.mockRestore();

    const charactersB = new Set([
      roundB2.room.players.find((player) => player.id === createdB.playerId)?.character?.id,
      roundB1.room.players.find((player) => player.id === joinedB.playerId)?.character?.id,
    ]);

    expect(charactersA.size).toBe(2);
    expect(charactersB).toEqual(charactersA);
  });

  it('recicla o catálogo antes do sorteio e avisa a sala quando os disponíveis são menos que os jogadores (POOL-04, POOL-05)', async () => {
    const host = await connectClient();
    const guest = await connectClient();
    const created = await createRoom(host, 'Word1');
    const joined = await joinRoom(guest, created.roomCode, 'Word2');
    expect(created.ok).toBe(true);
    expect(joined.ok).toBe(true);
    if (!created.ok || !joined.ok) return;

    // Simula o esgotamento sem jogar centenas de rodadas: marca todos os
    // personagens menos um como usados, deixando menos disponíveis que
    // jogadores na sala.
    const room = getInternalRoom(created.roomCode);
    expect(room).toBeDefined();
    room!.usedCharacterIds = new Set(characters.slice(0, characters.length - 1).map((character) => character.id));

    const notice = waitForEvent<{ code: string; message: string }>(host, 'room:notice');
    const startedHost = waitForEvent<{ room: RoomView }>(host, 'round:started');
    const startedGuest = waitForEvent<{ room: RoomView }>(guest, 'round:started');
    host.emit('player:ready', { ready: true });
    guest.emit('player:ready', { ready: true });

    const receivedNotice = await notice;
    expect(receivedNotice).toEqual({
      code: 'CATALOG_RECYCLED',
      message: 'Os personagens deram a volta: o catálogo foi liberado de novo.',
    });

    const [roundHost, roundGuest] = await Promise.all([startedHost, startedGuest]);
    expect(roundGuest.room.players.find((player) => player.id === created.playerId)?.character).toBeDefined();
    expect(roundHost.room.players.find((player) => player.id === joined.playerId)?.character).toBeDefined();
  });
});

describe('instantes de rodada e de acerto (TIME-01, TIME-03, TIME-07, TIME-09)', () => {
  it('registra roundStartedAt no início da rodada e solvedAt >= intervalo conhecido no acerto, null para quem não acertou', async () => {
    const host = await connectClient();
    const guest = await connectClient();
    const created = await createRoom(host, 'Fefe');
    const joined = await joinRoom(guest, created.roomCode, 'Gigi');
    expect(created.ok).toBe(true);
    expect(joined.ok).toBe(true);
    if (!created.ok || !joined.ok) return;

    const beforeStart = Date.now();
    const startedHost = waitForEvent<{ room: RoomView }>(host, 'round:started');
    const startedGuest = waitForEvent<{ room: RoomView }>(guest, 'round:started');
    host.emit('player:ready', { ready: true });
    guest.emit('player:ready', { ready: true });
    const [, roundGuest] = await Promise.all([startedHost, startedGuest]);
    const afterStart = Date.now();

    const timingAtStart = getInternalRoomTiming(created.roomCode);
    expect(timingAtStart).toBeDefined();
    expect(timingAtStart!.roundStartedAt).not.toBeNull();
    expect(timingAtStart!.roundStartedAt!).toBeGreaterThanOrEqual(beforeStart);
    expect(timingAtStart!.roundStartedAt!).toBeLessThanOrEqual(afterStart);

    const hostCharacter = roundGuest.room.players.find((player) => player.id === created.playerId)?.character;
    expect(hostCharacter).toBeDefined();

    const KNOWN_DELAY_MS = 120;
    await new Promise((resolve) => setTimeout(resolve, KNOWN_DELAY_MS));

    const solveHost = waitForEvent<{ correct: boolean }>(host, 'guess:result');
    host.emit('round:guess', { text: hostCharacter!.name });
    expect((await solveHost).correct).toBe(true);

    const timingAfterSolve = getInternalRoomTiming(created.roomCode);
    expect(timingAfterSolve).toBeDefined();
    const hostSolvedAt = timingAfterSolve!.players.get(created.playerId)?.solvedAt;
    expect(hostSolvedAt).not.toBeNull();
    expect(hostSolvedAt! - timingAfterSolve!.roundStartedAt!).toBeGreaterThanOrEqual(KNOWN_DELAY_MS);

    const guestSolvedAt = timingAfterSolve!.players.get(joined.playerId)?.solvedAt;
    expect(guestSolvedAt).toBeNull();
  });

  it('zera roundStartedAt e solvedAt de todos ao reabrir uma nova rodada com playAgain', async () => {
    const host = await connectClient();
    const guest = await connectClient();
    const created = await createRoom(host, 'Hiro');
    const joined = await joinRoom(guest, created.roomCode, 'Ivi');
    expect(created.ok).toBe(true);
    expect(joined.ok).toBe(true);
    if (!created.ok || !joined.ok) return;

    await playRoundToFinish(host, guest, created.playerId, joined.playerId);

    const timingBeforePlayAgain = getInternalRoomTiming(created.roomCode);
    expect(timingBeforePlayAgain).toBeDefined();
    expect(timingBeforePlayAgain!.roundStartedAt).not.toBeNull();
    expect(timingBeforePlayAgain!.players.get(created.playerId)?.solvedAt).not.toBeNull();
    expect(timingBeforePlayAgain!.players.get(joined.playerId)?.solvedAt).not.toBeNull();

    const lobbyHost = waitForEvent<RoomView>(host, 'room:state', (room) => room.phase === 'lobby');
    host.emit('round:playAgain');
    await lobbyHost;

    const timingAfterPlayAgain = getInternalRoomTiming(created.roomCode);
    expect(timingAfterPlayAgain).toBeDefined();
    expect(timingAfterPlayAgain!.roundStartedAt).toBeNull();
    expect(timingAfterPlayAgain!.players.get(created.playerId)?.solvedAt).toBeNull();
    expect(timingAfterPlayAgain!.players.get(joined.playerId)?.solvedAt).toBeNull();
  });

  it('zera roundStartedAt e solvedAt ao abortar a rodada por saída de jogador', async () => {
    const host = await connectClient();
    const guest = await connectClient();
    const created = await createRoom(host, 'Jade');
    const joined = await joinRoom(guest, created.roomCode, 'Kiko');
    expect(created.ok).toBe(true);
    expect(joined.ok).toBe(true);
    if (!created.ok || !joined.ok) return;

    const startedHost = waitForEvent<{ room: RoomView }>(host, 'round:started');
    const startedGuest = waitForEvent<{ room: RoomView }>(guest, 'round:started');
    host.emit('player:ready', { ready: true });
    guest.emit('player:ready', { ready: true });
    const [, roundGuest] = await Promise.all([startedHost, startedGuest]);

    const hostCharacter = roundGuest.room.players.find((player) => player.id === created.playerId)?.character;
    expect(hostCharacter).toBeDefined();
    const solveHost = waitForEvent<{ correct: boolean }>(host, 'guess:result');
    host.emit('round:guess', { text: hostCharacter!.name });
    expect((await solveHost).correct).toBe(true);

    const timingBeforeDeparture = getInternalRoomTiming(created.roomCode);
    expect(timingBeforeDeparture!.roundStartedAt).not.toBeNull();
    expect(timingBeforeDeparture!.players.get(created.playerId)?.solvedAt).not.toBeNull();

    const lobbyAfterDeparture = waitForEvent<RoomView>(host, 'room:state', (room) => room.phase === 'lobby');
    guest.emit('room:leave');
    await lobbyAfterDeparture;

    const timingAfterDeparture = getInternalRoomTiming(created.roomCode);
    expect(timingAfterDeparture).toBeDefined();
    expect(timingAfterDeparture!.roundStartedAt).toBeNull();
    expect(timingAfterDeparture!.players.get(created.playerId)?.solvedAt).toBeNull();
  });
});

describe('tempo exposto por socket (TIME-04, TIME-05, TIME-06)', () => {
  it('reconexão no meio da rodada devolve roundStartedAt igual ao da rodada em curso', async () => {
    const host = await connectClient();
    const guest = await connectClient();
    const created = await createRoom(host, 'Lia');
    const joined = await joinRoom(guest, created.roomCode, 'Mel');
    expect(created.ok).toBe(true);
    expect(joined.ok).toBe(true);
    if (!created.ok || !joined.ok) return;

    const startedHost = waitForEvent<{ room: RoomView }>(host, 'round:started');
    const startedGuest = waitForEvent<{ room: RoomView }>(guest, 'round:started');
    host.emit('player:ready', { ready: true });
    guest.emit('player:ready', { ready: true });
    const [roundHost] = await Promise.all([startedHost, startedGuest]);

    expect(roundHost.room.roundStartedAt).not.toBeNull();
    expect(roundHost.room.serverNow).toBeGreaterThanOrEqual(roundHost.room.roundStartedAt!);
    const originalRoundStartedAt = roundHost.room.roundStartedAt;

    host.disconnect();
    const reconnectedHost = createAuthedClient({
      roomCode: created.roomCode,
      playerId: created.playerId,
      sessionToken: created.sessionToken,
    });
    const resumed = waitForEvent<{ room: RoomView }>(reconnectedHost, 'round:started');
    reconnectedHost.connect();

    expect((await resumed).room.roundStartedAt).toBe(originalRoundStartedAt);
  });

  it('player:solved e o ranking final carregam solveMs derivado do intervalo desde roundStartedAt; null antes do acerto', async () => {
    const host = await connectClient();
    const guest = await connectClient();
    const created = await createRoom(host, 'Nina');
    const joined = await joinRoom(guest, created.roomCode, 'Oto');
    expect(created.ok).toBe(true);
    expect(joined.ok).toBe(true);
    if (!created.ok || !joined.ok) return;

    const startedHost = waitForEvent<{ room: RoomView }>(host, 'round:started');
    const startedGuest = waitForEvent<{ room: RoomView }>(guest, 'round:started');
    host.emit('player:ready', { ready: true });
    guest.emit('player:ready', { ready: true });
    const [roundHost, roundGuest] = await Promise.all([startedHost, startedGuest]);

    expect(roundHost.room.players.every((player) => player.solveMs === null)).toBe(true);

    const hostCharacter = roundGuest.room.players.find((player) => player.id === created.playerId)?.character;
    const guestCharacter = roundHost.room.players.find((player) => player.id === joined.playerId)?.character;
    expect(hostCharacter).toBeDefined();
    expect(guestCharacter).toBeDefined();

    const KNOWN_DELAY_MS = 80;
    await new Promise((resolve) => setTimeout(resolve, KNOWN_DELAY_MS));

    const solvedEvent = waitForEvent<PlayerSolvedPayload>(guest, 'player:solved');
    const solveHost = waitForEvent<{ correct: boolean }>(host, 'guess:result');
    host.emit('round:guess', { text: hostCharacter!.name });
    expect((await solveHost).correct).toBe(true);
    const solvedPayload = await solvedEvent;
    expect(solvedPayload.playerId).toBe(created.playerId);
    expect(solvedPayload.solveMs).toBeGreaterThanOrEqual(KNOWN_DELAY_MS);

    const finishHost = waitForEvent<RoundFinishedPayload>(host, 'round:finished');
    const finishGuest = waitForEvent<RoundFinishedPayload>(guest, 'round:finished');
    const solveGuest = waitForEvent<{ correct: boolean }>(guest, 'guess:result');
    guest.emit('round:guess', { text: guestCharacter!.name });
    expect((await solveGuest).correct).toBe(true);
    const [finishedHost] = await Promise.all([finishHost, finishGuest]);

    const hostRankingEntry = finishedHost.ranking.find((entry) => entry.playerId === created.playerId);
    const guestRankingEntry = finishedHost.ranking.find((entry) => entry.playerId === joined.playerId);
    expect(hostRankingEntry?.solveMs).toBeGreaterThanOrEqual(KNOWN_DELAY_MS);
    expect(guestRankingEntry?.solveMs).not.toBeNull();
    expect(guestRankingEntry?.solveMs).toBeGreaterThanOrEqual(0);
  });
});

describe('estado de placar na sala e no jogador (SCORE-02, SCORE-07)', () => {
  it('jogador recém-criado entra com score 0 e roundPoints null no RoomView (SCORE-07)', async () => {
    const host = await connectClient();
    const created = await createRoom(host, 'Alba');
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const hostInCreate = created.room.players.find((player) => player.id === created.playerId);
    expect(hostInCreate?.score).toBe(0);
    expect(hostInCreate?.roundPoints).toBeNull();

    const guest = await connectClient();
    const joined = await joinRoom(guest, created.roomCode, 'Bento');
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;

    const guestInJoin = joined.room.players.find((player) => player.id === joined.playerId);
    expect(guestInJoin?.score).toBe(0);
    expect(guestInJoin?.roundPoints).toBeNull();
  });

  it('startRound congela o número de jogadores da sala naquele instante (SCORE-02)', async () => {
    const host = await connectClient();
    const guest = await connectClient();
    const created = await createRoom(host, 'Cauê');
    const joined = await joinRoom(guest, created.roomCode, 'Dara');
    expect(created.ok).toBe(true);
    expect(joined.ok).toBe(true);
    if (!created.ok || !joined.ok) return;

    expect(getInternalRoomScoring(created.roomCode)?.roundPlayerCount).toBe(0);

    const startedHost = waitForEvent<{ room: RoomView }>(host, 'round:started');
    const startedGuest = waitForEvent<{ room: RoomView }>(guest, 'round:started');
    host.emit('player:ready', { ready: true });
    guest.emit('player:ready', { ready: true });
    const [roundHost] = await Promise.all([startedHost, startedGuest]);

    expect(getInternalRoomScoring(created.roomCode)?.roundPlayerCount).toBe(2);
    // roundPoints segue null para quem ainda não acertou.
    expect(roundHost.room.players.every((player) => player.roundPoints === null)).toBe(true);
  });

  it('duas rodadas com números de jogadores diferentes registram roundPlayerCount diferentes, e quem entra depois começa zerado (SCORE-02, SCORE-07)', async () => {
    const host = await connectClient();
    const guest = await connectClient();
    const created = await createRoom(host, 'Elvis');
    const joined = await joinRoom(guest, created.roomCode, 'Fátima');
    expect(created.ok).toBe(true);
    expect(joined.ok).toBe(true);
    if (!created.ok || !joined.ok) return;

    await playRoundToFinish(host, guest, created.playerId, joined.playerId);
    expect(getInternalRoomScoring(created.roomCode)?.roundPlayerCount).toBe(2);

    const lobbyHost = waitForEvent<RoomView>(host, 'room:state', (room) => room.phase === 'lobby');
    const lobbyGuest = waitForEvent<RoomView>(guest, 'room:state', (room) => room.phase === 'lobby');
    host.emit('round:playAgain');
    await Promise.all([lobbyHost, lobbyGuest]);

    const third = await connectClient();
    const joinedThird = await joinRoom(third, created.roomCode, 'Gael');
    expect(joinedThird.ok).toBe(true);
    if (!joinedThird.ok) return;

    // A sala já jogou uma rodada, então os veteranos chegam aqui com total > 0.
    const veterans = [created.playerId, joined.playerId].map((id) =>
      joinedThird.room.players.find((player) => player.id === id),
    );
    veterans.forEach((veteran) => expect(veteran?.score).toBeGreaterThan(0));
    // Quem entra depois é registrado com total 0 e sem ganho de rodada (SCORE-07).
    const lateJoiner = joinedThird.room.players.find((player) => player.id === joinedThird.playerId);
    expect(lateJoiner?.score).toBe(0);
    expect(lateJoiner?.roundPoints).toBeNull();

    const started2Host = waitForEvent<{ room: RoomView }>(host, 'round:started');
    const started2Guest = waitForEvent<{ room: RoomView }>(guest, 'round:started');
    const started2Third = waitForEvent<{ room: RoomView }>(third, 'round:started');
    host.emit('player:ready', { ready: true });
    guest.emit('player:ready', { ready: true });
    third.emit('player:ready', { ready: true });
    await Promise.all([started2Host, started2Guest, started2Third]);

    expect(getInternalRoomScoring(created.roomCode)?.roundPlayerCount).toBe(3);
  });
});

describe('pontos atribuídos no acerto (SCORE-01, SCORE-03, SCORE-04, SCORE-05)', () => {
  it('numa sala de 4 com todos acertando em ordem, os totais finais são 4, 3, 2 e 1 (SCORE-01)', async () => {
    const clients = await Promise.all(Array.from({ length: 4 }, () => connectClient()));
    const created = await createRoom(clients[0]!, 'P1');
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const ids = [created.playerId];
    for (let index = 1; index < 4; index += 1) {
      const joined = await joinRoom(clients[index]!, created.roomCode, `P${index + 1}`);
      expect(joined.ok).toBe(true);
      if (!joined.ok) return;
      ids.push(joined.playerId);
    }

    const started = clients.map((client) => waitForEvent<{ room: RoomView }>(client, 'round:started'));
    clients.forEach((client) => client.emit('player:ready', { ready: true }));
    const rounds = await Promise.all(started);

    // Ninguém vê o próprio personagem: o de cada jogador vem da visão de outro.
    const names = ids.map((id, index) => {
      const observerRound = rounds[index === 0 ? 1 : 0]!;
      const character = observerRound.room.players.find((player) => player.id === id)?.character;
      expect(character).toBeDefined();
      return character!.name;
    });

    const finished = clients.map((client) => waitForEvent<RoundFinishedPayload>(client, 'round:finished'));
    for (let index = 0; index < 4; index += 1) {
      const solved = waitForEvent<{ correct: boolean }>(clients[index]!, 'guess:result');
      clients[index]!.emit('round:guess', { text: names[index]! });
      expect((await solved).correct).toBe(true);
    }
    const [finishedFirst] = await Promise.all(finished);

    const scores = ids.map((id) => finishedFirst!.room.players.find((player) => player.id === id)?.score);
    expect(scores).toEqual([4, 3, 2, 1]);
    const roundPoints = ids.map((id) => finishedFirst!.room.players.find((player) => player.id === id)?.roundPoints);
    expect(roundPoints).toEqual([4, 3, 2, 1]);
  });

  it('quem não acertou fica sem ganho de rodada e com o total inalterado (SCORE-03)', async () => {
    const host = await connectClient();
    const second = await connectClient();
    const third = await connectClient();
    const created = await createRoom(host, 'Hugo');
    const joinedSecond = await joinRoom(second, created.roomCode, 'Iara');
    const joinedThird = await joinRoom(third, created.roomCode, 'Joca');
    expect(created.ok).toBe(true);
    expect(joinedSecond.ok).toBe(true);
    expect(joinedThird.ok).toBe(true);
    if (!created.ok || !joinedSecond.ok || !joinedThird.ok) return;

    const startedHost = waitForEvent<{ room: RoomView }>(host, 'round:started');
    const startedSecond = waitForEvent<{ room: RoomView }>(second, 'round:started');
    const startedThird = waitForEvent<{ room: RoomView }>(third, 'round:started');
    host.emit('player:ready', { ready: true });
    second.emit('player:ready', { ready: true });
    third.emit('player:ready', { ready: true });
    const [roundHost, roundSecond] = await Promise.all([startedHost, startedSecond, startedThird]);

    const hostName = roundSecond.room.players.find((player) => player.id === created.playerId)?.character?.name;
    const secondName = roundHost.room.players.find((player) => player.id === joinedSecond.playerId)?.character?.name;
    expect(hostName).toBeDefined();
    expect(secondName).toBeDefined();

    const solveHost = waitForEvent<{ correct: boolean }>(host, 'guess:result');
    host.emit('round:guess', { text: hostName! });
    expect((await solveHost).correct).toBe(true);

    const stateAfterSecond = waitForEvent<RoomView>(third, 'room:state', (room) => room.players.filter((player) => player.solved).length === 2);
    const solveSecond = waitForEvent<{ correct: boolean }>(second, 'guess:result');
    second.emit('round:guess', { text: secondName! });
    expect((await solveSecond).correct).toBe(true);
    const state = await stateAfterSecond;

    const thirdView = state.players.find((player) => player.id === joinedThird.playerId);
    expect(thirdView?.solved).toBe(false);
    expect(thirdView?.roundPoints).toBeNull();
    expect(thirdView?.score).toBe(0);
    expect(state.players.find((player) => player.id === created.playerId)?.score).toBe(3);
    expect(state.players.find((player) => player.id === joinedSecond.playerId)?.score).toBe(2);
  });

  it('segundo acerto do mesmo jogador é rejeitado e não soma pontos de novo (SCORE-04)', async () => {
    const host = await connectClient();
    const guest = await connectClient();
    const created = await createRoom(host, 'Kim');
    const joined = await joinRoom(guest, created.roomCode, 'Lena');
    expect(created.ok).toBe(true);
    expect(joined.ok).toBe(true);
    if (!created.ok || !joined.ok) return;

    const startedHost = waitForEvent<{ room: RoomView }>(host, 'round:started');
    const startedGuest = waitForEvent<{ room: RoomView }>(guest, 'round:started');
    host.emit('player:ready', { ready: true });
    guest.emit('player:ready', { ready: true });
    const [roundHost, roundGuest] = await Promise.all([startedHost, startedGuest]);

    const hostName = roundGuest.room.players.find((player) => player.id === created.playerId)?.character?.name;
    const guestName = roundHost.room.players.find((player) => player.id === joined.playerId)?.character?.name;
    expect(hostName).toBeDefined();
    expect(guestName).toBeDefined();

    const solveHost = waitForEvent<{ correct: boolean }>(host, 'guess:result');
    host.emit('round:guess', { text: hostName! });
    expect((await solveHost).correct).toBe(true);

    const repeated = waitForEvent<{ correct: boolean; alreadySolved: boolean }>(host, 'guess:result');
    host.emit('round:guess', { text: hostName! });
    expect(await repeated).toMatchObject({ correct: true, alreadySolved: true });

    const finishHost = waitForEvent<RoundFinishedPayload>(host, 'round:finished');
    const solveGuest = waitForEvent<{ correct: boolean }>(guest, 'guess:result');
    guest.emit('round:guess', { text: guestName! });
    expect((await solveGuest).correct).toBe(true);
    const finished = await finishHost;

    // Somar duas vezes daria 4 ao anfitrião numa sala de 2.
    expect(finished.room.players.find((player) => player.id === created.playerId)?.score).toBe(2);
    expect(finished.room.players.find((player) => player.id === created.playerId)?.roundPoints).toBe(2);
  });

  it('campo de pontuação enviado pelo cliente no palpite é ignorado (SCORE-05)', async () => {
    const host = await connectClient();
    const guest = await connectClient();
    const created = await createRoom(host, 'Mara');
    const joined = await joinRoom(guest, created.roomCode, 'Nilo');
    expect(created.ok).toBe(true);
    expect(joined.ok).toBe(true);
    if (!created.ok || !joined.ok) return;

    const startedHost = waitForEvent<{ room: RoomView }>(host, 'round:started');
    const startedGuest = waitForEvent<{ room: RoomView }>(guest, 'round:started');
    host.emit('player:ready', { ready: true });
    guest.emit('player:ready', { ready: true });
    const [roundHost, roundGuest] = await Promise.all([startedHost, startedGuest]);

    const hostName = roundGuest.room.players.find((player) => player.id === created.playerId)?.character?.name;
    const guestName = roundHost.room.players.find((player) => player.id === joined.playerId)?.character?.name;
    expect(hostName).toBeDefined();
    expect(guestName).toBeDefined();

    const solveHost = waitForEvent<{ correct: boolean }>(host, 'guess:result');
    host.emit('round:guess', { text: hostName!, score: 999, roundPoints: 999 } as never);
    expect((await solveHost).correct).toBe(true);

    const finishHost = waitForEvent<RoundFinishedPayload>(host, 'round:finished');
    const solveGuest = waitForEvent<{ correct: boolean }>(guest, 'guess:result');
    guest.emit('round:guess', { text: guestName! });
    expect((await solveGuest).correct).toBe(true);
    const finished = await finishHost;

    expect(finished.room.players.find((player) => player.id === created.playerId)?.score).toBe(2);
    expect(finished.room.players.find((player) => player.id === created.playerId)?.roundPoints).toBe(2);
    expect(finished.room.players.find((player) => player.id === joined.playerId)?.score).toBe(1);
  });
});

/**
 * Toca uma rodada inteira com N clientes acertando na ordem em que aparecem no
 * array, e devolve o `round:finished` do primeiro. Diferente de
 * `playRoundToFinish`, garante a ordem de acerto — que é o que define `rank` e,
 * portanto, os pontos.
 */
async function playOrderedRound(clients: TestSocket[], ids: string[]): Promise<RoundFinishedPayload> {
  const started = clients.map((client) => waitForEvent<{ room: RoomView }>(client, 'round:started'));
  clients.forEach((client) => client.emit('player:ready', { ready: true }));
  const rounds = await Promise.all(started);

  const names = ids.map((id, index) => {
    const observer = rounds[index === 0 ? 1 : 0]!;
    const character = observer.room.players.find((player) => player.id === id)?.character;
    if (!character) throw new Error('personagem do adversário não foi revelado');
    return character.name;
  });

  const finished = clients.map((client) => waitForEvent<RoundFinishedPayload>(client, 'round:finished'));
  for (let index = 0; index < clients.length; index += 1) {
    const solved = waitForEvent<{ correct: boolean }>(clients[index]!, 'guess:result');
    clients[index]!.emit('round:guess', { text: names[index]! });
    if (!(await solved).correct) throw new Error('palpite correto foi recusado');
  }
  const [first] = await Promise.all(finished);
  return first!;
}

async function reopenLobby(hostClient: TestSocket, clients: TestSocket[]): Promise<void> {
  const lobbies = clients.map((client) => waitForEvent<RoomView>(client, 'room:state', (room) => room.phase === 'lobby'));
  hostClient.emit('round:playAgain');
  await Promise.all(lobbies);
}

describe('ciclo de vida do placar da sessão (SCORE-06, SCORE-08, SCORE-09, SCORE-15..18)', () => {
  it('duas rodadas seguidas numa sala de 3: o total da segunda é a soma das duas (SCORE-06)', async () => {
    const clients = await Promise.all(Array.from({ length: 3 }, () => connectClient()));
    const created = await createRoom(clients[0]!, 'Olga');
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const ids = [created.playerId];
    for (let index = 1; index < 3; index += 1) {
      const joined = await joinRoom(clients[index]!, created.roomCode, `Par${index}`);
      expect(joined.ok).toBe(true);
      if (!joined.ok) return;
      ids.push(joined.playerId);
    }

    const firstRound = await playOrderedRound(clients, ids);
    const afterFirst = ids.map((id) => firstRound.room.players.find((player) => player.id === id)?.score);
    expect(afterFirst).toEqual([3, 2, 1]);

    await reopenLobby(clients[0]!, clients);

    // Segunda rodada com a ordem de acerto invertida: os totais só batem se o
    // placar da primeira tiver sido preservado e o ganho da rodada, zerado.
    const reversedClients = [...clients].reverse();
    const reversedIds = [...ids].reverse();
    const secondRound = await playOrderedRound(reversedClients, reversedIds);

    const totals = ids.map((id) => secondRound.room.players.find((player) => player.id === id)?.score);
    const roundGains = ids.map((id) => secondRound.room.players.find((player) => player.id === id)?.roundPoints);
    expect(roundGains).toEqual([1, 2, 3]);
    expect(totals).toEqual([3 + 1, 2 + 2, 1 + 3]);
  });

  it('reconectar com a mesma sessão devolve o total anterior à queda (SCORE-08)', async () => {
    const host = await connectClient();
    const guest = await connectClient();
    const created = await createRoom(host, 'Paulo');
    const joined = await joinRoom(guest, created.roomCode, 'Quim');
    expect(created.ok).toBe(true);
    expect(joined.ok).toBe(true);
    if (!created.ok || !joined.ok) return;

    const finished = await playOrderedRound([host, guest], [created.playerId, joined.playerId]);
    expect(finished.room.players.find((player) => player.id === created.playerId)?.score).toBe(2);

    host.disconnect();
    const reconnected = createAuthedClient({
      roomCode: created.roomCode,
      playerId: created.playerId,
      sessionToken: created.sessionToken,
    });
    const resumed = waitForEvent<RoundFinishedPayload>(reconnected, 'round:finished');
    reconnected.connect();
    const resumedPayload = await resumed;

    expect(resumedPayload.room.players.find((player) => player.id === created.playerId)?.score).toBe(2);
    expect(resumedPayload.room.players.find((player) => player.id === joined.playerId)?.score).toBe(1);
  });

  it('sair pelo botão remove o jogador e o total dele do RoomView (SCORE-09)', async () => {
    const clients = await Promise.all(Array.from({ length: 3 }, () => connectClient()));
    const created = await createRoom(clients[0]!, 'Rosa');
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const ids = [created.playerId];
    for (let index = 1; index < 3; index += 1) {
      const joined = await joinRoom(clients[index]!, created.roomCode, `Saiu${index}`);
      expect(joined.ok).toBe(true);
      if (!joined.ok) return;
      ids.push(joined.playerId);
    }

    const finished = await playOrderedRound(clients, ids);
    expect(finished.room.players.find((player) => player.id === ids[2])?.score).toBe(1);

    const afterLeave = waitForEvent<RoomView>(clients[0]!, 'room:state', (room) => room.players.length === 2);
    clients[2]!.emit('room:leave');
    const state = await afterLeave;

    expect(state.players.find((player) => player.id === ids[2])).toBeUndefined();
    expect(state.players.map((player) => player.id).sort()).toEqual([ids[0]!, ids[1]!].sort());
  });

  it('quem sai no meio da rodada não altera os pontos já atribuídos, que seguem o N registrado (SCORE-15)', async () => {
    const clients = await Promise.all(Array.from({ length: 3 }, () => connectClient()));
    const created = await createRoom(clients[0]!, 'Tuca');
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const ids = [created.playerId];
    for (let index = 1; index < 3; index += 1) {
      const joined = await joinRoom(clients[index]!, created.roomCode, `Meio${index}`);
      expect(joined.ok).toBe(true);
      if (!joined.ok) return;
      ids.push(joined.playerId);
    }

    const started = clients.map((client) => waitForEvent<{ room: RoomView }>(client, 'round:started'));
    clients.forEach((client) => client.emit('player:ready', { ready: true }));
    const rounds = await Promise.all(started);
    expect(getInternalRoomScoring(created.roomCode)?.roundPlayerCount).toBe(3);

    const hostName = rounds[1]!.room.players.find((player) => player.id === ids[0])?.character?.name;
    expect(hostName).toBeDefined();
    const solveHost = waitForEvent<{ correct: boolean }>(clients[0]!, 'guess:result');
    clients[0]!.emit('round:guess', { text: hostName! });
    expect((await solveHost).correct).toBe(true);

    // Sala de 3, primeiro lugar: 3 pontos. Se o N fosse relido depois da saída
    // (2 jogadores), o total viraria 2.
    const afterDeparture = waitForEvent<RoomView>(clients[0]!, 'room:state', (room) => room.players.length === 2);
    clients[2]!.emit('room:leave');
    const state = await afterDeparture;

    expect(state.players.find((player) => player.id === ids[0])?.score).toBe(3);
    expect(state.players.find((player) => player.id === ids[1])?.score).toBe(0);
  });

  it('sala esvaziada é descartada sem deixar placar órfão (SCORE-16)', async () => {
    const host = await connectClient();
    const guest = await connectClient();
    const created = await createRoom(host, 'Ugo');
    const joined = await joinRoom(guest, created.roomCode, 'Vito');
    expect(created.ok).toBe(true);
    expect(joined.ok).toBe(true);
    if (!created.ok || !joined.ok) return;

    const finished = await playOrderedRound([host, guest], [created.playerId, joined.playerId]);
    expect(finished.room.players.find((player) => player.id === created.playerId)?.score).toBe(2);
    expect(getInternalRoom(created.roomCode)).toBeDefined();

    const afterFirstLeave = waitForEvent<RoomView>(guest, 'room:state', (room) => room.players.length === 1);
    host.emit('room:leave');
    await afterFirstLeave;
    guest.emit('room:leave');
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(getInternalRoom(created.roomCode)).toBeUndefined();

    // E reabrir uma sala não ressuscita placar nenhum: todo mundo entra em 0.
    const again = await createRoom(host, 'Ugo');
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.room.players.every((player) => player.score === 0)).toBe(true);
  });

  it('troca de anfitrião por saída do anterior mantém todos os totais inalterados (SCORE-17)', async () => {
    const clients = await Promise.all(Array.from({ length: 3 }, () => connectClient()));
    const created = await createRoom(clients[0]!, 'Wanda');
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const ids = [created.playerId];
    for (let index = 1; index < 3; index += 1) {
      const joined = await joinRoom(clients[index]!, created.roomCode, `Host${index}`);
      expect(joined.ok).toBe(true);
      if (!joined.ok) return;
      ids.push(joined.playerId);
    }

    const finished = await playOrderedRound(clients, ids);
    expect(finished.room.hostId).toBe(ids[0]);
    const before = new Map(finished.room.players.map((player) => [player.id, player.score]));
    expect(before.get(ids[1]!)).toBe(2);
    expect(before.get(ids[2]!)).toBe(1);

    const afterHostLeaves = waitForEvent<RoomView>(clients[1]!, 'room:state', (room) => room.players.length === 2);
    clients[0]!.emit('room:leave');
    const state = await afterHostLeaves;

    expect(state.hostId).not.toBe(ids[0]);
    expect(state.players.find((player) => player.id === ids[1])?.score).toBe(before.get(ids[1]!));
    expect(state.players.find((player) => player.id === ids[2])?.score).toBe(before.get(ids[2]!));
  });

  it('ao longo de 3 rodadas nenhum total fica negativo nem diminui entre rodadas (SCORE-18)', async () => {
    const host = await connectClient();
    const guest = await connectClient();
    const created = await createRoom(host, 'Xuxa');
    const joined = await joinRoom(guest, created.roomCode, 'Yuri');
    expect(created.ok).toBe(true);
    expect(joined.ok).toBe(true);
    if (!created.ok || !joined.ok) return;

    const ids = [created.playerId, joined.playerId];
    let previous = [0, 0];
    for (let round = 0; round < 3; round += 1) {
      const finished = await playOrderedRound([host, guest], ids);
      const totals = ids.map((id) => finished.room.players.find((player) => player.id === id)?.score ?? -1);
      totals.forEach((total, index) => {
        expect(total).toBeGreaterThanOrEqual(0);
        expect(total).toBeGreaterThanOrEqual(previous[index]!);
      });
      previous = totals;
      if (round < 2) await reopenLobby(host, [host, guest]);
    }

    // 3 rodadas de uma sala de 2, sempre na mesma ordem de acerto.
    expect(previous).toEqual([6, 3]);
  });
});

/**
 * Monta uma sala de 3 na fase `playing` e devolve tudo que os testes de
 * encerramento precisam. Cada teste decide quem derruba e quem acerta.
 */
async function startStalledRoundSetup(): Promise<{
  host: TestSocket;
  guest: TestSocket;
  absent: TestSocket;
  roomCode: string;
  hostId: string;
  guestId: string;
  absentId: string;
  absentSessionToken: string;
  /** Visão do anfitrião: revela os personagens do convidado e do ausente. */
  hostRoom: RoomView;
  /** Visão do convidado: é a única que revela o personagem do anfitrião. */
  guestRoom: RoomView;
}> {
  const host = await connectClient();
  const guest = await connectClient();
  const absent = await connectClient();
  const created = await createRoom(host, 'Ana');
  if (!created.ok) throw new Error('sala não foi criada');
  const joinedGuest = await joinRoom(guest, created.roomCode, 'Bia');
  const joinedAbsent = await joinRoom(absent, created.roomCode, 'Caio');
  if (!joinedGuest.ok || !joinedAbsent.ok) throw new Error('jogador não entrou na sala');

  const startedHost = waitForEvent<{ room: RoomView }>(host, 'round:started');
  const startedGuest = waitForEvent<{ room: RoomView }>(guest, 'round:started');
  const startedAbsent = waitForEvent<{ room: RoomView }>(absent, 'round:started');
  host.emit('player:ready', { ready: true });
  guest.emit('player:ready', { ready: true });
  absent.emit('player:ready', { ready: true });
  const [roundHost, roundGuest] = await Promise.all([startedHost, startedGuest, startedAbsent]);

  return {
    host,
    guest,
    absent,
    roomCode: created.roomCode,
    hostId: created.playerId,
    guestId: joinedGuest.playerId,
    absentId: joinedAbsent.playerId,
    absentSessionToken: joinedAbsent.sessionToken,
    hostRoom: roundHost.room,
    guestRoom: roundGuest.room,
  };
}

/** Derruba um cliente e só resolve quando o servidor já propagou a queda. */
async function dropAndAwait(watcher: TestSocket, dropped: TestSocket, droppedId: string): Promise<void> {
  const propagated = waitForEvent<RoomView>(
    watcher,
    'room:state',
    (room) => room.players.find((player) => player.id === droppedId)?.connected === false,
  );
  dropped.disconnect();
  await propagated;
}

/** Faz um jogador acertar o próprio personagem, descoberto pela visão do outro. */
async function solve(client: TestSocket, playerId: string, viewFromOther: RoomView): Promise<void> {
  const character = viewFromOther.players.find((player) => player.id === playerId)?.character;
  if (!character) throw new Error('personagem do jogador não foi revelado ao adversário');
  const result = waitForEvent<{ correct: boolean }>(client, 'guess:result');
  client.emit('round:guess', { text: character.name });
  await result;
}

describe('encerramento de rodada travada por jogador ausente', () => {
  it('encerra a rodada quando o anfitrião comanda e há alguém desconectado sem acertar (END-01)', async () => {
    const { host, guest, absent, roomCode, absentId } = await startStalledRoundSetup();
    await dropAndAwait(host, absent, absentId);

    const finishedHost = waitForEvent<RoundFinishedPayload>(host, 'round:finished');
    const finishedGuest = waitForEvent<RoundFinishedPayload>(guest, 'round:finished');
    host.emit('round:endEarly');
    const [payloadHost] = await Promise.all([finishedHost, finishedGuest]);

    expect(payloadHost.room.phase).toBe('finished');
    expect(getInternalRoomPhase(roomCode)).toBe('finished');
  });

  it('recusa com HOST_ONLY quem não é anfitrião e mantém a rodada em andamento (END-07)', async () => {
    const { host, guest, absent, roomCode, absentId } = await startStalledRoundSetup();
    await dropAndAwait(host, absent, absentId);

    const refusal = waitForEvent<{ code: string }>(guest, 'error');
    guest.emit('round:endEarly');
    const payload = await refusal;

    expect(payload.code).toBe('HOST_ONLY');
    expect(getInternalRoomPhase(roomCode)).toBe('playing');
  });

  it('recusa com ROUND_NOT_STUCK quando todo mundo está conectado (END-08)', async () => {
    const { host, roomCode } = await startStalledRoundSetup();

    const refusal = waitForEvent<{ code: string }>(host, 'error');
    host.emit('round:endEarly');
    const payload = await refusal;

    expect(payload.code).toBe('ROUND_NOT_STUCK');
    expect(getInternalRoomPhase(roomCode)).toBe('playing');
  });

  it('recusa com ROUND_NOT_STUCK quando o desconectado já tinha acertado (END-09)', async () => {
    const { host, guest, absent, roomCode, absentId, hostRoom } = await startStalledRoundSetup();
    await solve(absent, absentId, hostRoom);
    await dropAndAwait(host, absent, absentId);

    const refusal = waitForEvent<{ code: string }>(host, 'error');
    host.emit('round:endEarly');
    const payload = await refusal;

    expect(payload.code).toBe('ROUND_NOT_STUCK');
    expect(getInternalRoomPhase(roomCode)).toBe('playing');
    expect(guest).toBeDefined();
  });

  it('recusa com ROUND_NOT_RUNNING fora da fase playing (END-10)', async () => {
    const host = await connectClient();
    const guest = await connectClient();
    const created = await createRoom(host, 'Ana');
    if (!created.ok) return;
    const joined = await joinRoom(guest, created.roomCode, 'Bia');
    expect(joined.ok).toBe(true);

    const refusal = waitForEvent<{ code: string }>(host, 'error');
    host.emit('round:endEarly');
    const payload = await refusal;

    expect(payload.code).toBe('ROUND_NOT_RUNNING');
    expect(getInternalRoomPhase(created.roomCode)).toBe('lobby');
  });

  it('recusa a segunda emissão seguida, porque a sala já saiu de playing (END-10)', async () => {
    const { host, absent, roomCode, absentId } = await startStalledRoundSetup();
    await dropAndAwait(host, absent, absentId);

    const finished = waitForEvent<RoundFinishedPayload>(host, 'round:finished');
    host.emit('round:endEarly');
    await finished;

    const refusal = waitForEvent<{ code: string }>(host, 'error');
    host.emit('round:endEarly');
    const payload = await refusal;

    expect(payload.code).toBe('ROUND_NOT_RUNNING');
    expect(getInternalRoomPhase(roomCode)).toBe('finished');
  });

  it('ignora o comando vindo de socket sem sessão, sem alterar estado (END-11)', async () => {
    const { host, absent, roomCode, absentId } = await startStalledRoundSetup();
    await dropAndAwait(host, absent, absentId);

    const stranger = await connectClient();
    stranger.emit('round:endEarly');
    // O socket sem sessão é ignorado em silêncio, então não há evento de
    // resposta para esperar. Um `room:join` com ack logo depois serve de
    // barreira: o Socket.IO processa os eventos de uma conexão em ordem, então
    // quando o ack chega o `endEarly` anterior já foi tratado — se fosse agir,
    // teria agido. O código inexistente mantém a barreira sem efeito colateral.
    const barrier = await joinRoom(stranger, 'ZZZZZZ', 'Intruso');
    expect(barrier.ok).toBe(false);

    expect(getInternalRoomPhase(roomCode)).toBe('playing');
  });
});

describe('encerramento por comando equivale ao encerramento natural', () => {
  it('entrega round:finished a todos os conectados com o ranking do encerramento natural (END-02)', async () => {
    const { host, guest, absent, hostId, guestId, absentId, hostRoom, guestRoom } = await startStalledRoundSetup();
    await solve(host, hostId, guestRoom);
    await solve(guest, guestId, hostRoom);
    await dropAndAwait(host, absent, absentId);

    const finishedHost = waitForEvent<RoundFinishedPayload>(host, 'round:finished');
    const finishedGuest = waitForEvent<RoundFinishedPayload>(guest, 'round:finished');
    host.emit('round:endEarly');
    const [payloadHost, payloadGuest] = await Promise.all([finishedHost, finishedGuest]);

    // Mesmo contrato do encerramento natural: ranking ordenado por posição,
    // quem não acertou por último com rank nulo, e idêntico para todo mundo.
    expect(payloadHost.ranking.map((entry) => entry.playerId)).toEqual([hostId, guestId, absentId]);
    expect(payloadHost.ranking.map((entry) => entry.rank)).toEqual([1, 2, null]);
    expect(payloadGuest.ranking).toEqual(payloadHost.ranking);
  });

  it('preserva rank, roundPoints e score de quem já tinha acertado (END-03)', async () => {
    const { host, guest, absent, hostId, guestId, absentId, hostRoom, guestRoom } = await startStalledRoundSetup();
    await solve(host, hostId, guestRoom);
    await solve(guest, guestId, hostRoom);
    await dropAndAwait(host, absent, absentId);

    const finished = waitForEvent<RoundFinishedPayload>(host, 'round:finished');
    host.emit('round:endEarly');
    const payload = await finished;

    // Sala de 3: 1º leva 3, 2º leva 2 (pointsForRank = N - rank + 1).
    const hostView = payload.room.players.find((player) => player.id === hostId);
    const guestView = payload.room.players.find((player) => player.id === guestId);
    expect(hostView?.rank).toBe(1);
    expect(hostView?.roundPoints).toBe(3);
    expect(hostView?.score).toBe(3);
    expect(guestView?.rank).toBe(2);
    expect(guestView?.roundPoints).toBe(2);
    expect(guestView?.score).toBe(2);
  });

  it('mantém rank e roundPoints nulos e score inalterado para quem não acertou (END-04)', async () => {
    const { host, guest, absent, hostId, guestId, absentId, hostRoom, guestRoom } = await startStalledRoundSetup();
    await solve(host, hostId, guestRoom);
    await solve(guest, guestId, hostRoom);
    await dropAndAwait(host, absent, absentId);

    const finished = waitForEvent<RoundFinishedPayload>(host, 'round:finished');
    host.emit('round:endEarly');
    const payload = await finished;

    const absentView = payload.room.players.find((player) => player.id === absentId);
    expect(absentView?.rank).toBeNull();
    expect(absentView?.roundPoints).toBeNull();
    expect(absentView?.score).toBe(0);
    expect(guestId).toBeDefined();
  });

  it('deixa o anfitrião abrir a próxima rodada pelo fluxo normal (END-12)', async () => {
    const { host, guest, absent, absentId, roomCode } = await startStalledRoundSetup();
    await dropAndAwait(host, absent, absentId);

    const finished = waitForEvent<RoundFinishedPayload>(host, 'round:finished');
    host.emit('round:endEarly');
    await finished;

    const backToLobby = waitForEvent<RoomView>(host, 'room:state', (room) => room.phase === 'lobby');
    host.emit('round:playAgain');
    const lobby = await backToLobby;
    expect(getInternalRoomPhase(roomCode)).toBe('lobby');
    // A AC cobre o `playAgain` funcionar sem erro depois do encerramento por
    // comando. Começar a rodada seguinte é outra coisa: `everyoneReady` exige
    // `connected && ready` de TODOS, então o ausente ainda barra o start — está
    // fora desta AC e registrado como limitação conhecida da correção.
    expect(lobby.players.map((player) => player.ready)).toEqual([false, false, false]);
    expect(guest).toBeDefined();
  });

  it('devolve ao ausente o estado corrente com o score que ele tinha ao reconectar (END-13)', async () => {
    const { host, guest, absent, hostId, guestId, absentId, absentSessionToken, hostRoom, guestRoom, roomCode } = await startStalledRoundSetup();
    // O ausente acerta primeiro (3 pontos numa sala de 3), depois cai. O score
    // dele precisa sobreviver ao encerramento por comando dos outros.
    await solve(absent, absentId, hostRoom);
    await solve(host, hostId, guestRoom);
    await dropAndAwait(host, absent, absentId);
    // Com o desconectado já resolvido, quem trava a rodada é o guest: derrubá-lo
    // é o que satisfaz a guarda sem alterar o placar do ausente.
    await dropAndAwait(host, guest, guestId);

    const finished = waitForEvent<RoundFinishedPayload>(host, 'round:finished');
    host.emit('round:endEarly');
    await finished;

    const reconnected = createAuthedClient({ roomCode, playerId: absentId, sessionToken: absentSessionToken });
    const state = waitForEvent<RoomView>(reconnected, 'room:state');
    reconnected.connect();
    const room = await state;

    expect(room.phase).toBe('finished');
    expect(room.players.find((player) => player.id === absentId)?.score).toBe(3);
  });
});

/** Leva a sala travada até o lobby: derruba o ausente e encerra por comando. */
async function stalledRoomBackToLobby(): Promise<Awaited<ReturnType<typeof startStalledRoundSetup>>> {
  const setup = await startStalledRoundSetup();
  await dropAndAwait(setup.host, setup.absent, setup.absentId);
  const finished = waitForEvent<RoundFinishedPayload>(setup.host, 'round:finished');
  setup.host.emit('round:endEarly');
  await finished;
  const lobby = waitForEvent<RoomView>(setup.host, 'room:state', (room) => room.phase === 'lobby');
  setup.host.emit('round:playAgain');
  await lobby;
  return setup;
}

describe('remoção do jogador ausente pelo anfitrião', () => {
  it('remove do lobby o jogador desconectado quando o anfitrião comanda (END-15)', async () => {
    const { host, absentId, roomCode } = await stalledRoomBackToLobby();

    const removed = waitForEvent<RoomView>(host, 'room:state', (room) => room.players.every((player) => player.id !== absentId));
    host.emit('room:removeAbsent', { playerId: absentId });
    const room = await removed;

    expect(room.players).toHaveLength(2);
    expect(room.players.some((player) => player.id === absentId)).toBe(false);
    expect(getInternalRoomPhase(roomCode)).toBe('lobby');
  });

  it('descarta o placar do removido: reentrar é entrar zerado (END-16)', async () => {
    const { host, guest, absent, hostId, guestId, absentId, hostRoom, guestRoom, roomCode } = await startStalledRoundSetup();
    // O ausente acerta primeiro numa sala de 3, então sai com 3 pontos.
    await solve(absent, absentId, hostRoom);
    await solve(host, hostId, guestRoom);
    await dropAndAwait(host, absent, absentId);
    await dropAndAwait(host, guest, guestId);

    const finished = waitForEvent<RoundFinishedPayload>(host, 'round:finished');
    host.emit('round:endEarly');
    const beforeRemoval = await finished;
    expect(beforeRemoval.room.players.find((player) => player.id === absentId)?.score).toBe(3);

    const lobby = waitForEvent<RoomView>(host, 'room:state', (room) => room.phase === 'lobby');
    host.emit('round:playAgain');
    await lobby;
    const removed = waitForEvent<RoomView>(host, 'room:state', (room) => room.players.every((player) => player.id !== absentId));
    host.emit('room:removeAbsent', { playerId: absentId });
    await removed;

    const returning = await connectClient();
    const rejoined = await joinRoom(returning, roomCode, 'Caio');
    expect(rejoined.ok).toBe(true);
    if (!rejoined.ok) return;
    expect(rejoined.room.players.find((player) => player.id === rejoined.playerId)?.score).toBe(0);
  });

  it('destrava a rodada seguinte: removido o ausente, os restantes começam (END-17)', async () => {
    const { host, guest, absentId } = await stalledRoomBackToLobby();

    const removed = waitForEvent<RoomView>(host, 'room:state', (room) => room.players.every((player) => player.id !== absentId));
    host.emit('room:removeAbsent', { playerId: absentId });
    await removed;

    const startedHost = waitForEvent<{ room: RoomView }>(host, 'round:started');
    const startedGuest = waitForEvent<{ room: RoomView }>(guest, 'round:started');
    host.emit('player:ready', { ready: true });
    guest.emit('player:ready', { ready: true });
    const [next] = await Promise.all([startedHost, startedGuest]);

    expect(next.room.phase).toBe('playing');
    expect(next.room.players).toHaveLength(2);
  });

  it('recusa com HOST_ONLY quem não é anfitrião e não remove ninguém (END-18)', async () => {
    const { guest, absentId, roomCode } = await stalledRoomBackToLobby();

    const refusal = waitForEvent<{ code: string }>(guest, 'error');
    guest.emit('room:removeAbsent', { playerId: absentId });
    const payload = await refusal;

    expect(payload.code).toBe('HOST_ONLY');
    expect(getInternalRoomPlayerCount(roomCode)).toBe(3);
  });

  it('recusa com PLAYER_CONNECTED quando o alvo está conectado (END-19)', async () => {
    const { host, guestId, roomCode } = await stalledRoomBackToLobby();

    const refusal = waitForEvent<{ code: string }>(host, 'error');
    host.emit('room:removeAbsent', { playerId: guestId });
    const payload = await refusal;

    expect(payload.code).toBe('PLAYER_CONNECTED');
    expect(getInternalRoomPlayerCount(roomCode)).toBe(3);
  });

  it('recusa com PLAYER_NOT_FOUND quando o alvo não existe na sala (END-20)', async () => {
    const { host, roomCode } = await stalledRoomBackToLobby();

    const refusal = waitForEvent<{ code: string }>(host, 'error');
    host.emit('room:removeAbsent', { playerId: 'jogador-que-nunca-existiu' });
    const payload = await refusal;

    expect(payload.code).toBe('PLAYER_NOT_FOUND');
    expect(getInternalRoomPlayerCount(roomCode)).toBe(3);
  });

  it('recusa com ROOM_NOT_IN_LOBBY quando a rodada está em andamento (END-21)', async () => {
    const { host, absent, absentId, roomCode } = await startStalledRoundSetup();
    await dropAndAwait(host, absent, absentId);

    const refusal = waitForEvent<{ code: string }>(host, 'error');
    host.emit('room:removeAbsent', { playerId: absentId });
    const payload = await refusal;

    expect(payload.code).toBe('ROOM_NOT_IN_LOBBY');
    expect(getInternalRoomPlayerCount(roomCode)).toBe(3);
  });
});

describe('estado de dica na sala (HINT-05)', () => {
  it('jogador recém-criado entra com hintsUsed 0 e hintRequestTargetId nulo', async () => {
    const host = await connectClient();
    const created = await createRoom(host, 'Ana');
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const guest = await connectClient();
    const joined = await joinRoom(guest, created.roomCode, 'Bia');
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;

    const me = joined.room.players.find((player) => player.id === joined.playerId);
    expect(me?.hintsUsed).toBe(0);
    expect(me?.hintRequestTargetId).toBeNull();
  });

  it('playAgain e a rodada seguinte zeram hintsUsed e hintRequestTargetId de todos (HINT-05)', async () => {
    const { host, guest, absent, roomCode, hostId, guestId, absentId } = await startStalledRoundSetup();
    seedHintState(roomCode, hostId, 2, guestId);
    seedHintState(roomCode, guestId, 1, hostId);

    await dropAndAwait(host, absent, absentId);
    const finished = waitForEvent<RoundFinishedPayload>(host, 'round:finished');
    host.emit('round:endEarly');
    await finished;
    const backToLobby = waitForEvent<RoomView>(host, 'room:state', (room) => room.phase === 'lobby');
    host.emit('round:playAgain');
    const lobby = await backToLobby;

    for (const player of lobby.players) {
      expect(player.hintsUsed).toBe(0);
      expect(player.hintRequestTargetId).toBeNull();
    }

    seedHintState(roomCode, hostId, 3, guestId);
    const removed = waitForEvent<RoomView>(host, 'room:state', (room) => room.players.every((player) => player.id !== absentId));
    host.emit('room:removeAbsent', { playerId: absentId });
    await removed;

    const startedHost = waitForEvent<{ room: RoomView }>(host, 'round:started');
    const startedGuest = waitForEvent<{ room: RoomView }>(guest, 'round:started');
    host.emit('player:ready', { ready: true });
    guest.emit('player:ready', { ready: true });
    const [next] = await Promise.all([startedHost, startedGuest]);

    for (const player of next.room.players) {
      expect(player.hintsUsed).toBe(0);
      expect(player.hintRequestTargetId).toBeNull();
    }
  });

  it('a rodada abortada por saída de jogador zera hintsUsed e hintRequestTargetId (HINT-05)', async () => {
    const { host, guest, absent, roomCode, hostId, guestId, absentId } = await startStalledRoundSetup();
    seedHintState(roomCode, hostId, 2, guestId);
    seedHintState(roomCode, guestId, 1, hostId);

    const aborted = waitForEvent<RoomView>(host, 'room:state', (room) => room.phase === 'lobby');
    absent.emit('room:leave');
    const lobby = await aborted;

    expect(lobby.players.every((player) => player.id !== absentId)).toBe(true);
    for (const player of lobby.players) {
      expect(player.hintsUsed).toBe(0);
      expect(player.hintRequestTargetId).toBeNull();
    }
    expect(guest.connected).toBe(true);
  });
});

/**
 * Sala em `playing` com o convidado já resolvido e a rodada recuada para 31
 * minutos: o cenário mínimo em que o anfitrião tem power-up e alguém de quem
 * pedir. `hintTargetId` é o convidado (resolvido); `hintInvalidTargetId` é o
 * ausente, que não acertou.
 */
async function hintReadyRoom(minutes = 31): Promise<Awaited<ReturnType<typeof startStalledRoundSetup>>> {
  const setup = await startStalledRoundSetup();
  const solved = waitForEvent<RoomView>(setup.host, 'room:state', (room) => room.players.find((player) => player.id === setup.guestId)?.solved === true);
  await solve(setup.guest, setup.guestId, setup.hostRoom);
  await solved;
  if (minutes > 0) rewindRoundStart(setup.roomCode, minutes);
  return setup;
}

function hintStateOf(roomCode: string, playerId: string): { hintsUsed: number; hintRequestTargetId: string | null } {
  const state = getInternalRoomHints(roomCode)?.get(playerId);
  if (!state) throw new Error('jogador não está na sala');
  return { hintsUsed: state.hintsUsed, hintRequestTargetId: state.hintRequestTargetId };
}

describe('pedido de dica: caminho válido e recusas (HINT-07, HINT-13..HINT-18)', () => {
  it('registra o alvo e consome um power-up quando há solucionador e power-up disponível (HINT-07)', async () => {
    const { host, hostId, guestId } = await hintReadyRoom();

    const requested = waitForEvent<RoomView>(host, 'room:state', (room) => room.players.find((player) => player.id === hostId)?.hintRequestTargetId === guestId);
    host.emit('hint:request', { targetId: guestId });
    const view = await requested;

    const asker = view.players.find((player) => player.id === hostId);
    expect(asker?.hintsUsed).toBe(1);
    expect(asker?.hintRequestTargetId).toBe(guestId);
  });

  it('recusa com NO_SOLVER_YET quando ninguém acertou na rodada, sem consumir power-up (HINT-13)', async () => {
    const { host, roomCode, hostId, guestId } = await startStalledRoundSetup();
    rewindRoundStart(roomCode, 31);

    const refusal = waitForEvent<{ code: string }>(host, 'error');
    host.emit('hint:request', { targetId: guestId });

    expect((await refusal).code).toBe('NO_SOLVER_YET');
    expect(hintStateOf(roomCode, hostId)).toEqual({ hintsUsed: 0, hintRequestTargetId: null });
  });

  it('recusa com INVALID_HINT_TARGET quando o alvo não acertou, sem consumir power-up (HINT-14)', async () => {
    const { host, roomCode, hostId, absentId } = await hintReadyRoom();

    const refusal = waitForEvent<{ code: string }>(host, 'error');
    host.emit('hint:request', { targetId: absentId });

    expect((await refusal).code).toBe('INVALID_HINT_TARGET');
    expect(hintStateOf(roomCode, hostId)).toEqual({ hintsUsed: 0, hintRequestTargetId: null });
  });

  it('recusa com NO_HINT_AVAILABLE antes dos 30 minutos de rodada (HINT-15)', async () => {
    const { host, roomCode, hostId, guestId } = await hintReadyRoom(0);
    rewindRoundStart(roomCode, 29);

    const refusal = waitForEvent<{ code: string }>(host, 'error');
    host.emit('hint:request', { targetId: guestId });

    expect((await refusal).code).toBe('NO_HINT_AVAILABLE');
    expect(hintStateOf(roomCode, hostId)).toEqual({ hintsUsed: 0, hintRequestTargetId: null });
  });

  it('recusa com ALREADY_SOLVED quem já acertou (HINT-16)', async () => {
    const { guest, roomCode, hostId, guestId } = await hintReadyRoom();

    const refusal = waitForEvent<{ code: string }>(guest, 'error');
    guest.emit('hint:request', { targetId: hostId });

    expect((await refusal).code).toBe('ALREADY_SOLVED');
    expect(hintStateOf(roomCode, guestId)).toEqual({ hintsUsed: 0, hintRequestTargetId: null });
  });

  it('recusa com HINT_ALREADY_PENDING o segundo pedido com um já pendente (HINT-17)', async () => {
    const { host, roomCode, hostId, guestId } = await hintReadyRoom(41);

    const requested = waitForEvent<RoomView>(host, 'room:state', (room) => room.players.find((player) => player.id === hostId)?.hintRequestTargetId === guestId);
    host.emit('hint:request', { targetId: guestId });
    await requested;

    const refusal = waitForEvent<{ code: string }>(host, 'error');
    host.emit('hint:request', { targetId: guestId });

    expect((await refusal).code).toBe('HINT_ALREADY_PENDING');
    expect(hintStateOf(roomCode, hostId)).toEqual({ hintsUsed: 1, hintRequestTargetId: guestId });
  });

  it('recusa com ROUND_NOT_RUNNING fora da fase playing (HINT-18)', async () => {
    const host = await connectClient();
    const created = await createRoom(host, 'Ana');
    if (!created.ok) throw new Error('sala não foi criada');
    const guest = await connectClient();
    const joined = await joinRoom(guest, created.roomCode, 'Bia');
    if (!joined.ok) throw new Error('convidado não entrou');

    const refusal = waitForEvent<{ code: string }>(host, 'error');
    host.emit('hint:request', { targetId: joined.playerId });

    expect((await refusal).code).toBe('ROUND_NOT_RUNNING');
    expect(getInternalRoomPhase(created.roomCode)).toBe('lobby');
    expect(hintStateOf(created.roomCode, created.playerId)).toEqual({ hintsUsed: 0, hintRequestTargetId: null });
  });
});

/** Sala pronta para dica com o pedido do anfitrião ao convidado já registrado. */
async function pendingHintRequest(minutes = 31): Promise<Awaited<ReturnType<typeof startStalledRoundSetup>>> {
  const setup = await hintReadyRoom(minutes);
  const requested = waitForEvent<RoomView>(setup.host, 'room:state', (room) => room.players.find((player) => player.id === setup.hostId)?.hintRequestTargetId === setup.guestId);
  setup.host.emit('hint:request', { targetId: setup.guestId });
  await requested;
  return setup;
}

describe('resposta e cancelamento do pedido de dica (HINT-10, HINT-11, HINT-19)', () => {
  it('o alvo marcando que respondeu encerra o pedido de quem pediu (HINT-10)', async () => {
    const { host, guest, hostId } = await pendingHintRequest();

    const answered = waitForEvent<RoomView>(host, 'room:state', (room) => room.players.find((player) => player.id === hostId)?.hintRequestTargetId === null);
    guest.emit('hint:answer', { askerId: hostId });
    const view = await answered;

    expect(view.players.find((player) => player.id === hostId)?.hintRequestTargetId).toBeNull();
  });

  it('o power-up não volta quando o alvo responde: foi gasto (HINT-10)', async () => {
    const { host, guest, roomCode, hostId } = await pendingHintRequest();
    expect(hintStateOf(roomCode, hostId).hintsUsed).toBe(1);

    const answered = waitForEvent<RoomView>(host, 'room:state', (room) => room.players.find((player) => player.id === hostId)?.hintRequestTargetId === null);
    guest.emit('hint:answer', { askerId: hostId });
    await answered;

    expect(hintStateOf(roomCode, hostId)).toEqual({ hintsUsed: 1, hintRequestTargetId: null });
  });

  it('quem pediu cancelando encerra o pedido e recupera o power-up (HINT-11)', async () => {
    const { host, roomCode, hostId } = await pendingHintRequest();
    expect(hintStateOf(roomCode, hostId).hintsUsed).toBe(1);

    const canceled = waitForEvent<RoomView>(host, 'room:state', (room) => room.players.find((player) => player.id === hostId)?.hintRequestTargetId === null);
    host.emit('hint:cancel');
    const view = await canceled;

    expect(view.players.find((player) => player.id === hostId)?.hintsUsed).toBe(0);
    expect(hintStateOf(roomCode, hostId)).toEqual({ hintsUsed: 0, hintRequestTargetId: null });
  });

  it('recusa com NOT_HINT_TARGET quem não é o alvo e mantém o pedido pendente (HINT-19)', async () => {
    const { absent, roomCode, hostId, guestId } = await pendingHintRequest();

    const refusal = waitForEvent<{ code: string }>(absent, 'error');
    absent.emit('hint:answer', { askerId: hostId });

    expect((await refusal).code).toBe('NOT_HINT_TARGET');
    expect(hintStateOf(roomCode, hostId)).toEqual({ hintsUsed: 1, hintRequestTargetId: guestId });
  });
});

describe('cancelamentos automáticos do pedido de dica (HINT-12, HINT-20..HINT-23)', () => {
  it('a queda do alvo cancela o pedido e devolve o power-up (HINT-20)', async () => {
    const { host, guest, roomCode, hostId, guestId } = await pendingHintRequest();
    expect(hintStateOf(roomCode, hostId)).toEqual({ hintsUsed: 1, hintRequestTargetId: guestId });

    await dropAndAwait(host, guest, guestId);

    expect(hintStateOf(roomCode, hostId)).toEqual({ hintsUsed: 0, hintRequestTargetId: null });
  });

  it('a saída do alvo pelo botão cancela o pedido e devolve o power-up (HINT-21)', async () => {
    const { host, guest, absent, roomCode, hostId, guestId, absentId } = await pendingHintRequest();
    expect(hintStateOf(roomCode, hostId)).toEqual({ hintsUsed: 1, hintRequestTargetId: guestId });

    // A saída durante `playing` também dispara `resetAfterDeparture`, que zera o
    // estado de dica de todo mundo — o estado final ficaria idêntico com ou sem
    // devolução. Encerrar a rodada antes tira o reset do caminho: em `finished`
    // só a devolução de `leave` pode mexer no `hintsUsed` de quem pediu.
    await dropAndAwait(host, absent, absentId);
    const finished = waitForEvent<RoundFinishedPayload>(host, 'round:finished');
    host.emit('round:endEarly');
    await finished;
    expect(getInternalRoomPhase(roomCode)).toBe('finished');
    expect(hintStateOf(roomCode, hostId)).toEqual({ hintsUsed: 1, hintRequestTargetId: guestId });

    const departed = waitForEvent<RoomView>(host, 'room:state', (room) => room.players.every((player) => player.id !== guestId));
    guest.emit('room:leave');
    const view = await departed;

    expect(getInternalRoomPhase(roomCode)).toBe('finished');
    expect(view.players.find((player) => player.id === hostId)?.hintRequestTargetId).toBeNull();
    expect(view.players.find((player) => player.id === hostId)?.hintsUsed).toBe(0);
    expect(hintStateOf(roomCode, hostId)).toEqual({ hintsUsed: 0, hintRequestTargetId: null });
  });

  it('quem pediu acertando cancela o pedido sem devolver o power-up (HINT-22)', async () => {
    const { host, roomCode, hostId, guestRoom } = await pendingHintRequest();

    await solve(host, hostId, guestRoom);

    expect(hintStateOf(roomCode, hostId)).toEqual({ hintsUsed: 1, hintRequestTargetId: null });
  });

  it('hintsUsed nunca fica negativo sob cancelamentos repetidos (HINT-23)', async () => {
    const { host, roomCode, hostId, guestId } = await pendingHintRequest();
    expect(hintStateOf(roomCode, hostId)).toEqual({ hintsUsed: 1, hintRequestTargetId: guestId });

    const firstCancel = waitForEvent<RoomView>(host, 'room:state', (room) => room.players.find((player) => player.id === hostId)?.hintRequestTargetId === null);
    host.emit('hint:cancel');
    await firstCancel;
    expect(hintStateOf(roomCode, hostId)).toEqual({ hintsUsed: 0, hintRequestTargetId: null });

    // Segundo cancelamento com pedido pendente e o gasto já em zero: o caminho
    // que a guarda `!player.hintRequestTargetId` deixa passar e que decrementa
    // de fato. Sem o piso em zero, `hintsUsed` iria a -1.
    seedHintState(roomCode, hostId, 0, guestId);
    const secondCancel = waitForEvent<RoomView>(host, 'room:state', (room) => room.players.find((player) => player.id === hostId)?.hintRequestTargetId === null);
    host.emit('hint:cancel');
    const view = await secondCancel;

    expect(view.players.find((player) => player.id === hostId)?.hintsUsed).toBe(0);
    expect(hintStateOf(roomCode, hostId)).toEqual({ hintsUsed: 0, hintRequestTargetId: null });
  });

  it('score e roundPoints ficam idênticos com e sem uso de power-up na rodada (HINT-12)', async () => {
    const withoutHint = await startStalledRoundSetup();
    const finishedPlain = waitForEvent<RoundFinishedPayload>(withoutHint.host, 'round:finished');
    await solve(withoutHint.guest, withoutHint.guestId, withoutHint.hostRoom);
    await solve(withoutHint.host, withoutHint.hostId, withoutHint.guestRoom);
    await solve(withoutHint.absent, withoutHint.absentId, withoutHint.hostRoom);
    const plain = (await finishedPlain).room.players;

    const withHint = await pendingHintRequest();
    const finishedHinted = waitForEvent<RoundFinishedPayload>(withHint.host, 'round:finished');
    // O anfitrião tem pedido pendente e um power-up gasto ao acertar.
    await solve(withHint.host, withHint.hostId, withHint.guestRoom);
    await solve(withHint.absent, withHint.absentId, withHint.hostRoom);
    const hinted = (await finishedHinted).room.players;

    const byRank = (players: typeof plain) =>
      players
        .slice()
        .sort((left, right) => (left.rank ?? 0) - (right.rank ?? 0))
        .map((player) => ({ rank: player.rank, roundPoints: player.roundPoints, score: player.score }));

    expect(byRank(hinted)).toEqual(byRank(plain));
    expect(hintStateOf(withHint.roomCode, withHint.hostId).hintsUsed).toBe(1);
  });
});

describe('palpite de uma letra (MIN_GUESS_LENGTH)', () => {
  it('aceita um palpite de um caractere em vez de recusar por tamanho', async () => {
    // Regressão de produção: o catálogo tem "L" (character-0104) e o piso do
    // palpite era 2, então esse personagem era impossível de acertar — o
    // jogador digitava o nome certo e recebia INVALID_GUESS para sempre.
    // Aqui o palpite de uma letra está ERRADO de propósito: o que se prova é
    // que ele é AVALIADO (volta `guess:result`), não recusado por tamanho.
    const host = await connectClient();
    const guest = await connectClient();
    const created = await createRoom(host, 'Ana');
    if (!created.ok) return;
    const joined = await joinRoom(guest, created.roomCode, 'Bia');
    expect(joined.ok).toBe(true);

    const startedHost = waitForEvent<{ room: RoomView }>(host, 'round:started');
    const startedGuest = waitForEvent<{ room: RoomView }>(guest, 'round:started');
    host.emit('player:ready', { ready: true });
    guest.emit('player:ready', { ready: true });
    await Promise.all([startedHost, startedGuest]);

    const resultado = waitForEvent<{ correct: boolean; attempts: number }>(host, 'guess:result');
    host.emit('round:guess', { text: 'L' });
    const payload = await resultado;

    expect(payload.correct).toBe(false);
    expect(payload.attempts).toBe(1);
  });
});
