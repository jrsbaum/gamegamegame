import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createApp } from "./http.js";
import { createPersistence } from "./persistence.js";
import { createInMemoryRepositories } from "./in-memory-store.js";
import { GameService } from "./game-service.js";

const testPassword = "a".repeat(8);
const alternateTestPassword = "b".repeat(8);
const apps: Awaited<ReturnType<typeof createApp>>[] = [];

afterEach(async () => {
  while (apps.length) await apps.pop()?.close();
});

describe("LaFarmer server", () => {
  it("uses the in-memory adapter when running tests even if a database URL exists", () => {
    const persistence = createPersistence({ databaseUrl: "postgresql://unused", environment: "test" });
    expect(persistence.kind).toBe("memory");
  });

  it("uses the in-memory adapter when DATABASE_URL is absent", async () => {
    const persistence = createPersistence({ databaseUrl: null, environment: "development" });
    expect(persistence.kind).toBe("memory");
    await persistence.close();
  });

  it("accepts an explicit repository bundle without opening a database", () => {
    const persistence = createPersistence({ repositories: createInMemoryRepositories(), databaseUrl: "postgresql://unused" });
    expect(persistence.kind).toBe("memory");
  });

  it("registers, authenticates and updates the player profile", async () => {
    const app = createApp();
    apps.push(app);
    const register = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { nick: "Lara", password: testPassword, credentialsSaved: true }
    });
    expect(register.statusCode).toBe(201);
    const result = register.json();
    expect(result.player.coins).toBe(1_000);
    expect(result.player.name).toBe("Lara");

    const me = await app.inject({ method: "GET", url: "/api/me", headers: { authorization: `Bearer ${result.token}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json().player.appearance).toEqual({ clothing: "forest", hair: "short" });

    const wallet = await app.inject({ method: "GET", url: "/api/wallet", headers: { authorization: `Bearer ${result.token}` } });
    expect(wallet.statusCode).toBe(200);
    expect(wallet.json().entries).toEqual([expect.objectContaining({ reason: "starting_balance", delta: 1_000, balance: 1_000 })]);

    const profile = await app.inject({
      method: "PATCH",
      url: "/api/player/profile",
      headers: { authorization: `Bearer ${result.token}` },
      payload: { name: "Lara do Vale", clothing: "coral", hair: "long" }
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json().player.appearance).toEqual({ clothing: "coral", hair: "long" });
  });

  it("offers adjacent land and reserves the onboarding choice once", async () => {
    const app = createApp();
    apps.push(app);
    const register = await app.inject({ method: "POST", url: "/api/auth/register", payload: { nick: "Farmer", password: testPassword, credentialsSaved: true } });
    const token = register.json().token as string;
    const options = await app.inject({ method: "GET", url: "/api/world/land-options", headers: { authorization: `Bearer ${token}` } });
    expect(options.statusCode).toBe(200);
    expect(options.json().options).toHaveLength(3);
    const selected = options.json().options[0];
    const profile = await app.inject({
      method: "PATCH",
      url: "/api/player/profile",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Farmer Vale", farmName: "Vale Farmer", specialization: "dinosaurs", plotId: selected.id, clothing: "forest", hair: "short" }
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json().player.farmName).toBe("Vale Farmer");
    expect(profile.json().player.plot.id).toBe(selected.id);
    const secondChoice = await app.inject({
      method: "PATCH",
      url: "/api/player/profile",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Farmer Vale", farmName: "Vale Farmer", specialization: "dinosaurs", plotId: options.json().options[1].id, clothing: "forest", hair: "short" }
    });
    expect(secondChoice.statusCode).toBe(400);
  });

  it("requires the credential-save confirmation and rejects duplicate nicks", async () => {
    const app = createApp();
    apps.push(app);
    const missingAcknowledgement = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { nick: "Lara", password: testPassword, credentialsSaved: false }
    });
    expect(missingAcknowledgement.statusCode).toBe(400);

    const first = await app.inject({ method: "POST", url: "/api/auth/register", payload: { nick: "Lara", password: testPassword, credentialsSaved: true } });
    expect(first.statusCode).toBe(201);
    const duplicate = await app.inject({ method: "POST", url: "/api/auth/register", payload: { nick: "lara", password: alternateTestPassword, credentialsSaved: true } });
    expect(duplicate.statusCode).toBe(409);
  });

  it("authenticates the websocket and applies authoritative idempotent movement", async () => {
    const app = createApp();
    apps.push(app);
    const register = await app.inject({ method: "POST", url: "/api/auth/register", payload: { nick: "Mover", password: testPassword, credentialsSaved: true } });
    const token = register.json().token as string;
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("server did not expose a port");

    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws?token=${token}`);
    const messages: Record<string, any>[] = [];
    socket.on("message", (data) => messages.push(JSON.parse(data.toString())));
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    await waitFor(() => messages.some((message) => message.type === "hello"));
    const hello = messages.find((message) => message.type === "hello");
    if (!hello) throw new Error("missing websocket hello");
    const before = hello.snapshot.player.position.x;
    socket.send(JSON.stringify({ type: "move", actionId: "move-1", direction: "right" }));
    await waitFor(() => messages.some((message) => message.type === "move_ack"));
    const firstAck = messages.find((message) => message.type === "move_ack");
    if (!firstAck) throw new Error("missing websocket move acknowledgement");
    expect(firstAck.player.position.x).toBe(before + 1);
    socket.send(JSON.stringify({ type: "move", actionId: "move-1", direction: "left" }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    const acknowledgements = messages.filter((message) => message.type === "move_ack");
    const lastAck = acknowledgements.at(-1);
    if (!lastAck) throw new Error("missing websocket acknowledgement history");
    expect(lastAck.player.position.x).toBe(before + 1);
    socket.send(JSON.stringify({ type: "move", actionId: "move-2", direction: "right" }));
    await waitFor(() => messages.some((message) => message.type === "move_ack" && message.actionId === "move-2"));
    expect(messages.find((message) => message.type === "move_ack" && message.actionId === "move-2")?.player.position.x).toBe(before + 2);
    socket.send(JSON.stringify({ type: "move", actionId: "move-3", direction: "right" }));
    await waitFor(() => messages.some((message) => message.type === "move_ack" && message.actionId === "move-3"));
    const blockedAck = messages.find((message) => message.type === "move_ack" && message.actionId === "move-3");
    if (!blockedAck) throw new Error("missing blocked movement acknowledgement");
    expect(blockedAck.player.position.x).toBe(before + 2);
    socket.close();
  });

  it("reconnects with a fresh authoritative snapshot after the previous socket closes", async () => {
    const app = createApp();
    apps.push(app);
    const register = await app.inject({ method: "POST", url: "/api/auth/register", payload: { nick: "Reconnect", password: testPassword, credentialsSaved: true } });
    const token = register.json().token as string;
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("server did not expose a port");
    const first = new WebSocket(`ws://127.0.0.1:${address.port}/ws?token=${token}`);
    const firstMessages: Record<string, any>[] = [];
    first.on("message", (data) => firstMessages.push(JSON.parse(data.toString())));
    await openSocket(first);
    await waitFor(() => firstMessages.some((message) => message.type === "hello"));
    const firstHello = firstMessages.find((message) => message.type === "hello");
    if (!firstHello) throw new Error("missing first websocket snapshot");
    const initialX = firstHello.snapshot.player.position.x;
    first.send(JSON.stringify({ type: "move", actionId: "reconnect-move", direction: "right" }));
    await waitFor(() => firstMessages.some((message) => message.type === "move_ack"));
    await closeSocket(first);
    const second = new WebSocket(`ws://127.0.0.1:${address.port}/ws?token=${token}`);
    const secondMessages: Record<string, any>[] = [];
    second.on("message", (data) => secondMessages.push(JSON.parse(data.toString())));
    await openSocket(second);
    await waitFor(() => secondMessages.some((message) => message.type === "hello"));
    const hello = secondMessages.find((message) => message.type === "hello");
    if (!hello) throw new Error("missing reconnect websocket snapshot");
    expect(hello.snapshot.player.position.x).toBe(initialX + 1);
    second.send(JSON.stringify({ type: "snapshot.get" }));
    await waitFor(() => secondMessages.some((message) => message.type === "snapshot"));
    const snapshot = secondMessages.find((message) => message.type === "snapshot");
    if (!snapshot) throw new Error("missing explicit websocket snapshot");
    expect(snapshot.snapshot.player.position.x).toBe(initialX + 1);
    second.close();
  });

  it("keeps online and offline wallet accrual on the same minute boundary", async () => {
    let now = 1_700_000_000_000;
    const repositories = createInMemoryRepositories();
    await repositories.players.insert({ id: "wallet-player", accountId: "wallet-account", name: "Wallet", farmName: "", specialization: null, plot: null, appearance: { clothing: "forest", hair: "short" }, coins: 0, inventory: {}, inventoryQualities: {}, inventoryCapacity: 50, lastActiveAt: now, position: { x: 5, y: 5 } });
    const game = new GameService({ players: repositories.players, farm: repositories.farm, market: repositories.market, wallet: repositories.wallet }, () => now);
    game.markOnlineActivity("wallet-player");
    now += 60_000;
    expect((await game.onlineTick("wallet-player")).coins).toBe(2);
    now += 60_000;
    expect((await game.snapshot("wallet-player")).player.coins).toBe(2);
  });

  it("plants, persists a farm item and completes a player-to-player market trade", async () => {
    const repositories = createInMemoryRepositories();
    const app = createApp({ repositories });
    apps.push(app);
    const seller = await app.inject({ method: "POST", url: "/api/auth/register", payload: { nick: "Seller", password: testPassword, credentialsSaved: true } });
    const buyer = await app.inject({ method: "POST", url: "/api/auth/register", payload: { nick: "Buyer", password: alternateTestPassword, credentialsSaved: true } });
    expect(seller.statusCode).toBe(201);
    expect(buyer.statusCode).toBe(201);
    const sellerPlayer = await repositories.players.findByAccountId(seller.json().player.accountId);
    if (!sellerPlayer) throw new Error("seller player missing");
    await repositories.players.update({ ...sellerPlayer, inventory: { tomato: 2 } });

    const planted = await app.inject({ method: "POST", url: "/api/farm/plant", headers: { authorization: `Bearer ${seller.json().token}` }, payload: { contentId: "tomato", x: 5, y: 5 } });
    expect(planted.statusCode).toBe(201);
    expect(planted.json().item.stageId).toBe("soil");

    const listing = await app.inject({ method: "POST", url: "/api/market/listings", headers: { authorization: `Bearer ${seller.json().token}` }, payload: { contentId: "tomato", quantity: 1, unitPrice: 30 } });
    expect(listing.statusCode).toBe(201);
    const purchase = await app.inject({ method: "POST", url: `/api/market/${listing.json().listing.id}/buy`, headers: { authorization: `Bearer ${buyer.json().token}`, "idempotency-key": "purchase-1" }, payload: {} });
    expect(purchase.statusCode).toBe(200);
    expect(purchase.json().inventory.tomato).toBe(1);
    expect(purchase.json().coins).toBe(970);
    expect((await app.inject({ method: "GET", url: "/api/market" })).json().listings).toHaveLength(0);
  });

  it("applies a market purchase once under retries and concurrent buyers", async () => {
    const repositories = createInMemoryRepositories();
    const app = createApp({ repositories });
    apps.push(app);
    const seller = await app.inject({ method: "POST", url: "/api/auth/register", payload: { nick: "MarketSeller", password: testPassword, credentialsSaved: true } });
    const buyerA = await app.inject({ method: "POST", url: "/api/auth/register", payload: { nick: "MarketBuyerA", password: alternateTestPassword, credentialsSaved: true } });
    const buyerB = await app.inject({ method: "POST", url: "/api/auth/register", payload: { nick: "MarketBuyerB", password: testPassword, credentialsSaved: true } });
    const sellerPlayer = await repositories.players.findByAccountId(seller.json().player.accountId);
    if (!sellerPlayer) throw new Error("seller player missing");
    await repositories.players.update({ ...sellerPlayer, inventory: { tomato: 1 } });
    const listing = await app.inject({ method: "POST", url: "/api/market/listings", headers: { authorization: `Bearer ${seller.json().token}` }, payload: { contentId: "tomato", quantity: 1, unitPrice: 30 } });
    const listingId = listing.json().listing.id as string;
    const [first, second] = await Promise.all([
      app.inject({ method: "POST", url: `/api/market/${listingId}/buy`, headers: { authorization: `Bearer ${buyerA.json().token}`, "idempotency-key": "buyer-a-1" }, payload: {} }),
      app.inject({ method: "POST", url: `/api/market/${listingId}/buy`, headers: { authorization: `Bearer ${buyerB.json().token}`, "idempotency-key": "buyer-b-1" }, payload: {} })
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 404]);
    const winner = first.statusCode === 200 ? first : second;
    const winnerToken = first.statusCode === 200 ? buyerA.json().token : buyerB.json().token;
    expect(winner.json().inventory.tomato).toBe(1);
    const replay = await app.inject({ method: "POST", url: `/api/market/${listingId}/buy`, headers: { authorization: `Bearer ${winnerToken}`, "idempotency-key": first.statusCode === 200 ? "buyer-a-1" : "buyer-b-1" }, payload: {} });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().replayed).toBe(true);
    expect(replay.json().inventory.tomato).toBe(1);
    expect((await repositories.market.listActive())).toHaveLength(0);
  });

  it("adopts an animal through the same catalog-driven farm entity flow", async () => {
    const app = createApp();
    apps.push(app);
    const register = await app.inject({ method: "POST", url: "/api/auth/register", payload: { nick: "Rancher", password: testPassword, credentialsSaved: true } });
    const adopted = await app.inject({ method: "POST", url: "/api/farm/adopt", headers: { authorization: `Bearer ${register.json().token}` }, payload: { contentId: "cow" } });
    expect(adopted.statusCode).toBe(201);
    expect(adopted.json().item.stageId).toBe("baby");
    expect((await app.inject({ method: "GET", url: "/api/me", headers: { authorization: `Bearer ${register.json().token}` } })).json().player.coins).toBe(900);
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > 2_000) throw new Error("timed out waiting for websocket message");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function openSocket(socket: WebSocket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

async function closeSocket(socket: WebSocket): Promise<void> {
  await new Promise<void>((resolve) => {
    socket.once("close", () => resolve());
    socket.close();
  });
}
