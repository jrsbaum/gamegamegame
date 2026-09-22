import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '../shared/protocol';

export interface SessionData {
  roomCode: string;
  playerId: string;
  sessionToken: string;
  nickname: string;
}

const SESSION_KEY = 'quem-sou-eu:impostor:session';

export function readSession(): SessionData | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionData>;
    if (!parsed.roomCode || !parsed.playerId || !parsed.sessionToken || !parsed.nickname) return null;
    return {
      roomCode: parsed.roomCode,
      playerId: parsed.playerId,
      sessionToken: parsed.sessionToken,
      nickname: parsed.nickname,
    };
  } catch {
    return null;
  }
}

export function saveSession(session: SessionData): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

export const SERVER_URL: string | undefined = import.meta.env.VITE_SERVER_URL || undefined;

/** O servidor está em outro domínio, então pode estar hibernando. */
export const serverMayHibernate = Boolean(SERVER_URL);

/**
 * Acorda o servidor e resolve quando ele responde.
 *
 * Hosts de plano gratuito hibernam o processo após alguns minutos sem tráfego e
 * levam cerca de um minuto para voltar. Abrir o socket direto nesse estado
 * queima as tentativas de reconexão antes do servidor subir, então o cliente
 * primeiro bate no `/healthz` — que também é o que dispara o despertar — e só
 * conecta depois. Quando a interface e o servidor são a mesma origem, não há
 * nada para acordar.
 */
export async function wakeServer(timeoutMs = 90_000): Promise<boolean> {
  if (!SERVER_URL) return true;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${SERVER_URL}/healthz`, { cache: 'no-store' });
      if (response.ok) return true;
    } catch {
      // Servidor ainda subindo: a requisição falha de imediato enquanto não há
      // ninguém escutando. Espera e tenta de novo até o prazo.
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return false;
}

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SERVER_URL, {
  autoConnect: false,
  reconnection: true,
  // Orçamento largo o bastante para cobrir um cold start de ~1 min: com teto de
  // 5s por tentativa, 24 tentativas dão mais de dois minutos de margem.
  reconnectionAttempts: 24,
  reconnectionDelay: 800,
  reconnectionDelayMax: 5_000,
  auth: readSession() ?? {},
});
