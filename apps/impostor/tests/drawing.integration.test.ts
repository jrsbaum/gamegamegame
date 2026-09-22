import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as createClient, type Socket } from 'socket.io-client';
import { Server } from 'socket.io';
import type {
  ClientToServerEvents,
  GameErrorPayload,
  InterServerEvents,
  RoomActionResult,
  RoomView,
  ServerToClientEvents,
  SocketData,
} from '../shared/protocol';
import { createGameManager } from '../server/game';

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let httpServer: HttpServer;
let ioServer: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
let address = '';
const clients: TestSocket[] = [];

function waitForEvent<T>(socket: TestSocket, event: keyof ServerToClientEvents, predicate?: (payload: T) => boolean): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(event as never, listener as never);
      reject(new Error(`Timeout esperando ${String(event)}`));
    }, 4_000);
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
  clients.push(client);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout conectando cliente')), 4_000);
    client.once('connect', () => {
      clearTimeout(timeout);
      resolve(client);
    });
    client.once('connect_error', reject);
    client.connect();
  });
}

function createRoom(client: TestSocket, nickname: string): Promise<RoomActionResult> {
  return new Promise((resolve) => client.emit('room:create', { nickname, mode: 'draw-impostor' }, resolve));
}

function joinRoom(client: TestSocket, code: string, nickname: string): Promise<RoomActionResult> {
  return new Promise((resolve) => client.emit('room:join', { code, nickname }, resolve));
}

beforeAll(async () => {
  httpServer = createServer();
  ioServer = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(httpServer, { cors: { origin: true } });
  const manager = createGameManager(ioServer, 1, 200);
  ioServer.on('connection', (socket) => manager.bindSocket(socket));
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const serverAddress = httpServer.address() as AddressInfo;
  address = `http://127.0.0.1:${serverAddress.port}`;
});

afterAll(async () => {
  clients.forEach((client) => client.disconnect());
  await new Promise<void>((resolve) => ioServer.close(() => resolve()));
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

describe('modo Quem é o impostor', () => {
  it('protege a palavra, sincroniza o mural e dá uma única chance de acusação', async () => {
    const playerA = await connectClient();
    const playerB = await connectClient();
    const playerC = await connectClient();
    const created = await createRoom(playerA, 'Ana');
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const joinedB = await joinRoom(playerB, created.roomCode, 'Bia');
    const joinedC = await joinRoom(playerC, created.roomCode, 'Caio');
    expect(joinedB.ok).toBe(true);
    expect(joinedC.ok).toBe(true);
    if (!joinedB.ok || !joinedC.ok) return;

    const startedA = waitForEvent<{ room: RoomView }>(playerA, 'round:started');
    const startedB = waitForEvent<{ room: RoomView }>(playerB, 'round:started');
    const startedC = waitForEvent<{ room: RoomView }>(playerC, 'round:started');
    playerA.emit('player:ready', { ready: true });
    playerB.emit('player:ready', { ready: true });
    playerC.emit('player:ready', { ready: true });
    const [roundA, roundB, roundC] = await Promise.all([startedA, startedB, startedC]);
    const rounds = [roundA.room, roundB.room, roundC.room];
    const impostorRoom = rounds.find((room) => room.you.drawRole === 'impostor')!;
    const drawerRoom = rounds.find((room) => room.you.drawRole === 'drawer')!;
    expect(impostorRoom.draw?.word).toBeUndefined();
    expect(drawerRoom.draw?.word?.name).toBeTruthy();
    expect(JSON.stringify(impostorRoom)).not.toContain(drawerRoom.draw!.word!.name);
    expect(impostorRoom.mode).toBe('draw-impostor');

    const playerById = new Map([[created.playerId, playerA], [joinedB.playerId, playerB], [joinedC.playerId, playerC]]);
    const currentTurnId = drawerRoom.draw?.currentTurnPlayerId ?? '';
    const currentTurnClient = playerById.get(currentTurnId)!;
    const wrapped = waitForEvent<RoomView>(playerA, 'room:state', (payload) => payload.phase === 'playing' && payload.draw?.phase === 'drawing' && payload.draw.currentTurnPlayerId === currentTurnId);
    const stroke = waitForEvent<{ id: string; points: Array<{ x: number; y: number }> }>(currentTurnClient, 'draw:stroke');
    currentTurnClient.emit('draw:stroke', { points: [{ x: 0.1, y: 0.1 }, { x: 0.7, y: 0.6 }] });
    expect((await stroke).points).toHaveLength(2);

    await wrapped;
    const drawerClient = playerById.get(drawerRoom.you.id)!;
    const otherDrawerId = drawerRoom.players.find((player) => player.id !== drawerRoom.you.id && player.id !== impostorRoom.you.id)?.id ?? '';
    expect(otherDrawerId).toBeTruthy();
    const result = waitForEvent<{ correct: boolean; eliminated: boolean; message: string }>(drawerClient, 'draw:accusation:result');
    drawerClient.emit('draw:accuse', { targetPlayerId: otherDrawerId });
    const accusation = await result;
    expect(accusation.correct).toBe(false);
    expect(accusation.eliminated).toBe(true);
    expect(JSON.stringify(accusation)).not.toContain(otherDrawerId);

    const error = waitForEvent<GameErrorPayload>(drawerClient, 'error');
    drawerClient.emit('draw:accuse', { targetPlayerId: otherDrawerId });
    expect((await error).code).toBe('ACCUSATION_UNAVAILABLE');
  });

  it('aceita vez sem limite, avanço manual e encerramento pelo anfitrião', async () => {
    const playerA = await connectClient();
    const playerB = await connectClient();
    const created = await new Promise<RoomActionResult>((resolve) => playerA.emit('room:create', { nickname: 'Duda', mode: 'draw-impostor', drawTurnMs: null }, resolve));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const joined = await joinRoom(playerB, created.roomCode, 'Eli');
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;

    const startedA = waitForEvent<{ room: RoomView }>(playerA, 'round:started');
    const startedB = waitForEvent<{ room: RoomView }>(playerB, 'round:started');
    playerA.emit('player:ready', { ready: true });
    playerB.emit('player:ready', { ready: true });
    const [roundA, roundB] = await Promise.all([startedA, startedB]);
    expect(roundA.room.drawTurnMs).toBeNull();
    expect(roundA.room.draw?.turnEndsAt).toBeNull();

    let latestRoom = roundA.room;
    const onRoomState = (nextRoom: RoomView): void => { latestRoom = nextRoom; };
    playerA.on('room:state', onRoomState);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(latestRoom.draw?.phase).toBe('drawing');
    expect(latestRoom.draw?.currentTurnPlayerId).toBe(roundB.room.draw?.currentTurnPlayerId);

    const playerById = new Map([[created.playerId, playerA], [joined.playerId, playerB]]);
    const firstTurnId = latestRoom.draw?.currentTurnPlayerId ?? '';
    const firstTurnClient = playerById.get(firstTurnId)!;
    const nextTurn = waitForEvent<RoomView>(playerA, 'room:state', (room) => room.draw?.phase === 'drawing' && room.draw.currentTurnPlayerId !== firstTurnId);
    firstTurnClient.emit('draw:pass');
    const nextRoom = await nextTurn;
    const secondTurnClient = playerById.get(nextRoom.draw?.currentTurnPlayerId ?? '')!;
    const wrapped = waitForEvent<RoomView>(playerA, 'room:state', (room) => room.draw?.phase === 'drawing' && room.draw.currentTurnPlayerId === firstTurnId);
    secondTurnClient.emit('draw:pass');
    await wrapped;

    const finished = waitForEvent<{ room: RoomView }>(playerA, 'round:finished');
    playerA.emit('draw:end');
    const result = await finished;
    expect(result.room.phase).toBe('finished');
    expect(result.room.draw?.outcome?.reason).toBe('host-ended');
    playerA.off('room:state', onRoomState);
  });
});
