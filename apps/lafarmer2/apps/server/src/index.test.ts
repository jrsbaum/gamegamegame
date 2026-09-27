import { isWorldTileWalkable, PLAYER_SPAWN } from "@lafarmer2/content";
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

describe("La Farmer 2 server", () => {
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
    expect(options.json().options).toHaveLength(5);
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
    const beforeY = hello.snapshot.player.position.y;
    expect(before).toBe(PLAYER_SPAWN.x);
    expect(beforeY).toBe(PLAYER_SPAWN.y);
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
    socket.send(JSON.stringify({ type: "move", actionId: "move-sprint", direction: "down", sprint: true }));
    await waitFor(() => messages.some((message) => message.type === "move_ack" && message.actionId === "move-sprint"));
    expect(messages.find((message) => message.type === "move_ack" && message.actionId === "move-sprint")?.player.position.y).toBe(beforeY + 2);
    let blockedX = before + 2;
    let guard = 0;
    while (guard < 40) {
      const actionId = `move-east-${guard}`;
      socket.send(JSON.stringify({ type: "move", actionId, direction: "right" }));
      await waitFor(() => messages.some((message) => message.type === "move_ack" && message.actionId === actionId));
      const ack = messages.find((message) => message.type === "move_ack" && message.actionId === actionId);
      if (!ack) throw new Error("missing eastbound acknowledgement");
      if (ack.player.position.x === blockedX) break;
      blockedX = ack.player.position.x;
      guard += 1;
    }
    expect(blockedX).toBeGreaterThan(before + 8);
    expect(isWorldTileWalkable(blockedX + 1, beforeY + 2)).toBe(false);
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
    await repositories.players.insert({ id: "wallet-player", accountId: "wallet-account", name: "Wallet", farmName: "", specialization: null, plot: null, homeRegionId: null, currentRegionId: null, appearance: { clothing: "forest", hair: "short" }, coins: 0, inventory: {}, inventoryQualities: {}, inventoryCapacity: 50, lastActiveAt: now, position: { x: 5, y: 5 } });
    const game = new GameService({ players: repositories.players, farm: repositories.farm, structures: repositories.structures, market: repositories.market, wallet: repositories.wallet }, () => now);
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
    await repositories.players.update({ ...sellerPlayer, inventory: { tomato: 2, "tomato-seed": 1 } });
    const sellerOptions = (await app.inject({ method: "GET", url: "/api/world/land-options", headers: { authorization: `Bearer ${seller.json().token}` } })).json().options;
    await app.inject({ method: "PATCH", url: "/api/player/profile", headers: { authorization: `Bearer ${seller.json().token}` }, payload: { name: "Seller", farmName: "Seller Farm", specialization: "vegetables", plotId: sellerOptions[0].id, clothing: "forest", hair: "short" } });

    const planted = await app.inject({ method: "POST", url: "/api/farm/plant", headers: { authorization: `Bearer ${seller.json().token}` }, payload: { contentId: "tomato", x: PLAYER_SPAWN.x + 1, y: PLAYER_SPAWN.y } });
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
    const token = register.json().token as string;
    const option = (await app.inject({ method: "GET", url: "/api/world/land-options", headers: { authorization: `Bearer ${token}` } })).json().options[0];
    await app.inject({ method: "PATCH", url: "/api/player/profile", headers: { authorization: `Bearer ${token}` }, payload: { name: "Rancher", farmName: "Rancher Farm", specialization: "dinosaurs", plotId: option.id, clothing: "forest", hair: "short" } });
    const built = await app.inject({ method: "POST", url: "/api/farm/structures", headers: { authorization: `Bearer ${token}` }, payload: { type: "dinosaur_enclosure", x: 12, y: 12 } });
    expect(built.statusCode).toBe(201);
    const origin = await app.inject({ method: "POST", url: "/api/shop/origin/dinosaur-fossil/buy", headers: { authorization: `Bearer ${token}` }, payload: {} });
    expect(origin.statusCode).toBe(200);
    const adopted = await app.inject({ method: "POST", url: "/api/farm/adopt", headers: { authorization: `Bearer ${token}` }, payload: { contentId: "dinosaur", x: 16, y: 15 } });
    expect(adopted.statusCode).toBe(201);
    expect(adopted.json().item.stageId).toBe("fossil");
    expect((await app.inject({ method: "GET", url: "/api/me", headers: { authorization: `Bearer ${token}` } })).json().player.coins).toBe(320);
  });

  it("sells feed, requires an animal pen for a cow and still requires an enclosure for a dinosaur", async () => {
    const app = createApp();
    apps.push(app);
    const register = await app.inject({ method: "POST", url: "/api/auth/register", payload: { nick: "Vaqueira", password: testPassword, credentialsSaved: true } });
    const token = register.json().token as string;
    const option = (await app.inject({ method: "GET", url: "/api/world/land-options", headers: { authorization: `Bearer ${token}` } })).json().options[0];
    await app.inject({ method: "PATCH", url: "/api/player/profile", headers: { authorization: `Bearer ${token}` }, payload: { name: "Vaqueira", farmName: "Curral Alto", specialization: "dinosaurs", plotId: option.id, clothing: "forest", hair: "short" } });
    const shop = await app.inject({ method: "GET", url: "/api/shop/origin", headers: { authorization: `Bearer ${token}` } });
    expect(shop.json().offers.some((offer: { itemId: string }) => offer.itemId === "feed")).toBe(true);
    const feed = await app.inject({ method: "POST", url: "/api/shop/origin/dinosaur-feed/buy", headers: { authorization: `Bearer ${token}` }, payload: {} });
    expect(feed.statusCode).toBe(200);
    const withoutPen = await app.inject({ method: "POST", url: "/api/farm/adopt", headers: { authorization: `Bearer ${token}` }, payload: { contentId: "cow", x: 16, y: 15 } });
    expect(withoutPen.statusCode).toBe(400);
    expect(withoutPen.json().error).toBe("structure_required");
    const pen = await app.inject({ method: "POST", url: "/api/farm/structures", headers: { authorization: `Bearer ${token}` }, payload: { type: "animal_pen", x: 12, y: 12 } });
    expect(pen.statusCode).toBe(201);
    const cow = await app.inject({ method: "POST", url: "/api/farm/adopt", headers: { authorization: `Bearer ${token}` }, payload: { contentId: "cow", x: 16, y: 15 } });
    expect(cow.statusCode).toBe(201);
    expect(cow.json().item.contentId).toBe("cow");
    const dinoWithoutEnclosure = await app.inject({ method: "POST", url: "/api/farm/adopt", headers: { authorization: `Bearer ${token}` }, payload: { contentId: "dinosaur", x: 16, y: 15 } });
    expect(dinoWithoutEnclosure.json().error).toBe("structure_required");
  });

  it("keeps a profile saved during a live session after the player moves", async () => {
    const repositories = createInMemoryRepositories();
    const app = createApp({ repositories });
    apps.push(app);
    const register = await app.inject({ method: "POST", url: "/api/auth/register", payload: { nick: "Perfil", password: testPassword, credentialsSaved: true } });
    const token = register.json().token as string;
    const playerId = register.json().player.id as string;
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("server did not expose a port");
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws?token=${token}`);
    const messages: Record<string, any>[] = [];
    socket.on("message", (data) => messages.push(JSON.parse(data.toString())));
    await openSocket(socket);
    await waitFor(() => messages.some((message) => message.type === "hello"));
    const option = (await app.inject({ method: "GET", url: "/api/world/land-options", headers: { authorization: `Bearer ${token}` } })).json().options[0];
    const profile = await app.inject({
      method: "PATCH",
      url: "/api/player/profile",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Perfil Vale", farmName: "Sítio do Perfil", specialization: "vegetables", plotId: option.id, clothing: "coral", hair: "long" }
    });
    expect(profile.statusCode).toBe(200);
    socket.send(JSON.stringify({ type: "move", actionId: "profile-move", direction: "right" }));
    await waitFor(() => messages.some((message) => message.type === "move_ack" && message.actionId === "profile-move"));
    await new Promise((resolve) => setTimeout(resolve, 400));
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { authorization: `Bearer ${token}` } });
    expect(me.json().player.farmName).toBe("Sítio do Perfil");
    expect(me.json().player.specialization).toBe("vegetables");
    expect(me.json().player.homeRegionId).toBe(option.id);
    expect(me.json().player.appearance).toEqual({ clothing: "coral", hair: "long" });
    const stored = await repositories.players.findById(playerId);
    expect(stored?.farmName).toBe("Sítio do Perfil");
    expect(stored?.appearance).toEqual({ clothing: "coral", hair: "long" });
    socket.close();
  });

  it("writes the latest position when the socket closes before the move debounce", async () => {
    const repositories = createInMemoryRepositories();
    const app = createApp({ repositories });
    apps.push(app);
    const register = await app.inject({ method: "POST", url: "/api/auth/register", payload: { nick: "Passo", password: testPassword, credentialsSaved: true } });
    const token = register.json().token as string;
    const playerId = register.json().player.id as string;
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("server did not expose a port");
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws?token=${token}`);
    const messages: Record<string, any>[] = [];
    socket.on("message", (data) => messages.push(JSON.parse(data.toString())));
    await openSocket(socket);
    await waitFor(() => messages.some((message) => message.type === "hello"));
    const hello = messages.find((message) => message.type === "hello");
    if (!hello) throw new Error("missing websocket hello");
    const origin = hello.snapshot.player.position.x as number;
    socket.send(JSON.stringify({ type: "move", actionId: "flush-move", direction: "right" }));
    await waitFor(() => messages.some((message) => message.type === "move_ack"));
    await closeSocket(socket);
    const started = Date.now();
    let storedX = origin;
    while (Date.now() - started < 200) {
      storedX = (await repositories.players.findById(playerId))?.position.x ?? origin;
      if (storedX === origin + 1) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(storedX).toBe(origin + 1);
  });

  it("lets two neighbours see each other and shares a structure built during the visit", async () => {
    const repositories = createInMemoryRepositories();
    const app = createApp({ repositories });
    apps.push(app);
    const hostRegister = await app.inject({ method: "POST", url: "/api/auth/register", payload: { nick: "Anfitriao", password: testPassword, credentialsSaved: true } });
    const guestRegister = await app.inject({ method: "POST", url: "/api/auth/register", payload: { nick: "Visita", password: alternateTestPassword, credentialsSaved: true } });
    const hostToken = hostRegister.json().token as string;
    const guestToken = guestRegister.json().token as string;
    const hostBefore = await repositories.players.findByAccountId(hostRegister.json().player.accountId);
    const guestBefore = await repositories.players.findByAccountId(guestRegister.json().player.accountId);
    if (!hostBefore || !guestBefore) throw new Error("players missing");
    await repositories.players.update({ ...hostBefore, position: { x: 42, y: 54 } });
    await repositories.players.update({ ...guestBefore, position: { x: 40, y: 4 } });
    const hostOptions = (await app.inject({ method: "GET", url: "/api/world/land-options", headers: { authorization: `Bearer ${hostToken}` } })).json().options as Array<{ id: string }>;
    expect(hostOptions.some((option) => option.id === "region-north")).toBe(true);
    await app.inject({
      method: "PATCH",
      url: "/api/player/profile",
      headers: { authorization: `Bearer ${hostToken}` },
      payload: { name: "Anfitriao", farmName: "Casa Norte", specialization: "vegetables", plotId: "region-north", clothing: "forest", hair: "short" }
    });
    const guestOptions = (await app.inject({ method: "GET", url: "/api/world/land-options", headers: { authorization: `Bearer ${guestToken}` } })).json().options as Array<{ id: string }>;
    expect(guestOptions.some((option) => option.id === "region-center")).toBe(true);
    await app.inject({
      method: "PATCH",
      url: "/api/player/profile",
      headers: { authorization: `Bearer ${guestToken}` },
      payload: { name: "Visita", farmName: "Casa da Visita", specialization: "vegetables", plotId: "region-center", clothing: "river", hair: "long" }
    });
    const host = await repositories.players.findById(hostBefore.id);
    const guest = await repositories.players.findById(guestBefore.id);
    if (!host || !guest) throw new Error("players missing");
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("server did not expose a port");
    const hostSocket = new WebSocket(`ws://127.0.0.1:${address.port}/ws?token=${hostToken}`);
    const guestSocket = new WebSocket(`ws://127.0.0.1:${address.port}/ws?token=${guestToken}`);
    const hostMessages: Record<string, any>[] = [];
    const guestMessages: Record<string, any>[] = [];
    hostSocket.on("message", (data) => hostMessages.push(JSON.parse(data.toString())));
    guestSocket.on("message", (data) => guestMessages.push(JSON.parse(data.toString())));
    await openSocket(hostSocket);
    await openSocket(guestSocket);
    await waitFor(() => hostMessages.some((message) => message.type === "hello") && guestMessages.some((message) => message.type === "hello"));
    guestSocket.send(JSON.stringify({ type: "world.region.enter", payload: { regionId: "region-north" } }));
    await waitFor(() => guestMessages.some((message) => message.type === "world.region.entered"));
    await waitFor(() => hostMessages.some((message) => message.type === "player_region_changed"));
    const entered = guestMessages.find((message) => message.type === "world.region.entered");
    if (!entered) throw new Error("missing region entry");
    expect(entered.player.currentRegionId).toBe("region-north");
    expect(isWorldTileWalkable(entered.player.position.x, entered.player.position.y)).toBe(true);
    expect(entered.player.position).not.toEqual({ x: 40, y: 56 });
    await waitFor(() => guestMessages.some((message) => message.type === "snapshot" && message.snapshot.players.some((player: { id: string }) => player.id === host.id)));
    const regionChanged = hostMessages.find((message) => message.type === "player_region_changed");
    if (!regionChanged) throw new Error("missing region change");
    expect(regionChanged.player.id).toBe(guest.id);
    hostSocket.send(JSON.stringify({ type: "farm.structure.build", payload: { type: "house", x: 46, y: 52 } }));
    await waitFor(() => guestMessages.some((message) => message.type === "region.sync" && message.structures?.some((structure: { type: string }) => structure.type === "house")));
    const sync = guestMessages.find((message) => message.type === "region.sync");
    if (!sync) throw new Error("missing region sync");
    expect(sync.regionId).toBe("region-north");
    const storedGuest = await repositories.players.findById(guest.id);
    expect(storedGuest?.currentRegionId).toBe("region-north");
    expect(isWorldTileWalkable(storedGuest?.position.x ?? -1, storedGuest?.position.y ?? -1)).toBe(true);
    hostSocket.close();
    guestSocket.close();
  });

  it("refuses a step into a neighbour structure", async () => {
    const repositories = createInMemoryRepositories();
    const game = new GameService({ players: repositories.players, farm: repositories.farm, structures: repositories.structures, market: repositories.market, wallet: repositories.wallet });
    const visitor = { id: "visitor", accountId: "visitor-account", name: "Visita", farmName: "Visita", specialization: "vegetables" as const, plot: null, homeRegionId: "region-center", currentRegionId: "region-center", appearance: { clothing: "forest" as const, hair: "short" as const }, coins: 0, inventory: {}, inventoryQualities: {}, inventoryCapacity: 50, lastActiveAt: 0, position: { x: 21, y: 12 } };
    await repositories.players.insert(visitor);
    await repositories.players.insert({ ...visitor, id: "host", accountId: "host-account", name: "Dono" });
    await repositories.structures.insert({ id: "pen", ownerId: "host", regionId: "region-center", type: "field", footprint: [[22, 12], [26, 12], [26, 15], [22, 15]], capacity: 0, cost: 100, state: "built", position: { x: 24, y: 13 } });
    const blocked = await game.move("visitor", { actionId: "into-pen", direction: "right" });
    expect(blocked.player.position).toEqual({ x: 21, y: 12 });
    const free = await game.move("visitor", { actionId: "away-pen", direction: "left" });
    expect(free.player.position).toEqual({ x: 20, y: 12 });
  });

  it("reports health for the isolated service", async () => {
    const app = createApp();
    apps.push(app);
    const health = await app.inject({ method: "GET", url: "/healthz" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: "ok", service: "lafarmer2-server" });
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
  if (socket.readyState === WebSocket.OPEN) return;
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
