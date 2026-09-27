import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createApp } from "./http.js";
import { createInMemoryRepositories } from "./in-memory-store.js";
import { createPersistence } from "./persistence.js";

describe("deployment lifecycle", () => {
  it("refuses an ephemeral production database", () => {
    expect(() => createPersistence({ environment: "production", databaseUrl: "" }))
      .toThrow("DATABASE_URL is required in production");
    expect(createPersistence({ environment: "development", databaseUrl: "" }).kind).toBe("memory");
  });

  it("closes an open socket and saves the last acknowledged position before shutdown", async () => {
    const repositories = createInMemoryRepositories();
    const app = createApp({ repositories });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("missing listener");
    const registered = await app.inject({ method: "POST", url: "/api/auth/register", payload: { nick: "shutdown-farmer", password: "test-only-password", credentialsSaved: true } });
    expect(registered.statusCode).toBe(201);
    const { token, player } = registered.json();
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws?token=${token}`);
    try {
      const [hello] = await once(socket, "message");
      expect(JSON.parse(hello.toString()).type).toBe("hello");
      const acknowledged = new Promise<any>((resolve) => socket.on("message", (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === "move_ack") resolve(message);
      }));
      socket.send(JSON.stringify({ type: "move", actionId: "shutdown-move", direction: "right" }));
      const moved = await acknowledged;
      expect(moved.player.position).toEqual({ x: player.position.x + 1, y: player.position.y });
      await app.close();
      expect(socket.readyState).toBe(WebSocket.CLOSED);
      expect((await repositories.players.findById(player.id))?.position).toEqual(moved.player.position);
    } finally {
      socket.terminate();
      await app.close();
    }
  }, 5000);
});
