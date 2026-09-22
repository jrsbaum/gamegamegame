import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '../shared/protocol';

export const SERVER_URL: string | undefined = import.meta.env.VITE_SERVER_URL || undefined;

/** O servidor pode estar em outro domínio e hibernando durante o deploy. */
export const serverMayHibernate = Boolean(SERVER_URL);

export async function wakeServer(timeoutMs = 90_000): Promise<boolean> {
  if (!SERVER_URL) return true;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${SERVER_URL}/healthz`, { cache: 'no-store' });
      if (response.ok) return true;
    } catch {
      // O processo ainda pode estar subindo. Continue tentando até o prazo.
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return false;
}

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SERVER_URL, {
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 24,
  reconnectionDelay: 800,
  reconnectionDelayMax: 5_000,
});
