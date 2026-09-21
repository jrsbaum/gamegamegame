export interface PlayerProfile {
  nick: string;
  name: string;
  outfit: 'forest' | 'coral' | 'river';
  hair: 'short' | 'long';
}

export type ServerPlayer = {
  id: string;
  name: string;
  coins: number;
  appearance: { clothing: PlayerProfile['outfit']; hair: PlayerProfile['hair'] };
};

export type AuthResult = { token: string; player: ServerPlayer; credentials: { nick: string } };

const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://127.0.0.1:3337' : window.location.origin);

async function api<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'request_failed');
  return body as T;
}

export function register(nick: string, password: string): Promise<AuthResult> {
  return api<AuthResult>('/api/auth/register', { method: 'POST', body: JSON.stringify({ nick, password, credentialsSaved: true }) });
}

export function login(nick: string, password: string): Promise<AuthResult> {
  return api<AuthResult>('/api/auth/login', { method: 'POST', body: JSON.stringify({ nick, password }) });
}

export function updateProfile(token: string, profile: Pick<PlayerProfile, 'name' | 'outfit' | 'hair'>): Promise<{ player: ServerPlayer }> {
  return api<{ player: ServerPlayer }>('/api/player/profile', { method: 'PATCH', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ name: profile.name, clothing: profile.outfit, hair: profile.hair }) });
}

export type RealtimeStatus = 'offline-demo' | 'connecting' | 'connected';
type MessageHandler = (message: Record<string, unknown>) => void;

export class RealtimeClient {
  readonly url: string;
  status: RealtimeStatus = 'offline-demo';
  private socket: WebSocket | undefined;
  private handlers = new Set<MessageHandler>();

  constructor(url = import.meta.env.VITE_WS_URL || (import.meta.env.DEV ? 'ws://127.0.0.1:3337/ws' : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`)) { this.url = url; }

  async connect(token: string): Promise<RealtimeStatus> {
    if (!this.url || !token) { this.status = 'offline-demo'; return this.status; }
    this.status = 'connecting';
    return new Promise((resolve) => {
      let settled = false;
      const finish = (status: RealtimeStatus) => { if (settled) return; settled = true; this.status = status; resolve(status); };
      try {
        this.socket = new WebSocket(`${this.url}?token=${encodeURIComponent(token)}`);
        this.socket.addEventListener('open', () => finish('connected'));
        this.socket.addEventListener('error', () => finish('offline-demo'));
        this.socket.addEventListener('close', () => { this.status = 'offline-demo'; });
        this.socket.addEventListener('message', (event) => {
          try { const message = JSON.parse(String(event.data)) as Record<string, unknown>; this.handlers.forEach((handler) => handler(message)); } catch { /* authoritative server owns the protocol */ }
        });
        window.setTimeout(() => finish('offline-demo'), 1600);
      } catch { finish('offline-demo'); }
    });
  }

  onMessage(handler: MessageHandler): () => void { this.handlers.add(handler); return () => this.handlers.delete(handler); }
  send(type: string, payload: Record<string, unknown> = {}): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify({ type, payload })); return true;
  }
  move(direction: 'up' | 'down' | 'left' | 'right'): boolean {
    const actionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return this.send('move', { actionId, direction });
  }
  close(): void { this.socket?.close(); this.socket = undefined; }
}
