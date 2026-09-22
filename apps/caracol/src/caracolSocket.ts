import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '../shared/protocol';
import { SERVER_URL } from './socket';

/** Socket separado para que uma sessão antiga de sala não capture o Caracol. */
export const caracolSocket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SERVER_URL, {
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 24,
  reconnectionDelay: 800,
  reconnectionDelayMax: 5_000,
});
