import type { IncomingMessage, Server } from "node:http";
import { URL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import type { AuthService } from "./auth-service.js";
import type { GameService } from "./game-service.js";
import type { Direction } from "./domain.js";

type Client = WebSocket & { playerId?: string };

export function attachWebSocketGateway(server: Server, auth: AuthService, game: GameService): { close: () => Promise<void> } {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Map<string, Client>();

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws") return;
    const token = readToken(request, url);
    void auth.authenticate(token).then((player) => {
      if (!player) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (raw) => {
        wss.emit("connection", raw, request, player.id);
      });
    });
  });

  wss.on("connection", (raw: WebSocket, _request: IncomingMessage, playerId: string) => {
    const client = raw as Client;
    client.playerId = playerId;
    clients.set(playerId, client);
    void game.snapshot(playerId).then((snapshot) => send(client, { type: "hello", snapshot }));

    client.on("message", (data) => {
      void handleMessage(client, data.toString());
    });
    client.on("close", () => {
      if (clients.get(playerId) === client) clients.delete(playerId);
    });
  });

  async function handleMessage(client: Client, raw: string): Promise<void> {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      send(client, { type: "error", code: "invalid_json" });
      return;
    }
    if (!isMoveMessage(message)) {
      send(client, { type: "error", code: "unsupported_message" });
      return;
    }
    try {
      const result = await game.move(client.playerId!, message);
      send(client, { type: "move_ack", ...result });
      broadcastExcept(client.playerId!, { type: "player_moved", playerId: client.playerId, player: result.player });
    } catch (error) {
      send(client, { type: "error", code: error instanceof Error ? error.message : "move_failed" });
    }
  }

  function broadcastExcept(playerId: string, payload: unknown): void {
    const serialized = JSON.stringify(payload);
    for (const [otherId, client] of clients) {
      if (otherId !== playerId && client.readyState === WebSocket.OPEN) client.send(serialized);
    }
  }

  return {
    close: async () => {
      for (const client of clients.values()) client.close();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    }
  };
}

function readToken(request: IncomingMessage, url: URL): string {
  const queryToken = url.searchParams.get("token");
  if (queryToken) return queryToken;
  const authorization = request.headers.authorization;
  return authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
}

function isMoveMessage(value: unknown): value is { type: "move"; actionId: string; direction: Direction } {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return message.type === "move" && typeof message.actionId === "string" && typeof message.direction === "string";
}

function send(client: WebSocket, payload: unknown): void {
  if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(payload));
}
