import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { createDefaultAppearance, CONTENT_CATALOG, isClothing, isHairStyle } from "@lafarmer/content";
import { z } from "zod";
import { AuthError, AuthService, PASSWORD_MIN_LENGTH } from "./auth-service.js";
import { GameError, GameService } from "./game-service.js";
import type { RepositoryBundle } from "./repositories.js";
import { createPersistence } from "./persistence.js";
import { attachWebSocketGateway } from "./websocket-gateway.js";

const registerSchema = z.object({ nick: z.string(), password: z.string(), credentialsSaved: z.literal(true) });
const loginSchema = z.object({ nick: z.string(), password: z.string() });
const profileSchema = z.object({
  name: z.string(),
  clothing: z.string().refine(isClothing),
  hair: z.string().refine(isHairStyle)
});

export type ServerOptions = {
  repositories?: RepositoryBundle;
  logger?: boolean;
  databaseUrl?: string;
  environment?: string;
};

export function createApp(options: ServerOptions = {}): FastifyInstance {
  const persistence = createPersistence({
    repositories: options.repositories,
    databaseUrl: options.databaseUrl,
    environment: options.environment
  });
  const auth = new AuthService(persistence.repositories);
  const game = new GameService(persistence.repositories.players);
  const app = Fastify({ logger: options.logger ?? false });
  app.addHook('onRequest', async (request, reply) => {
    const allowedOrigin = process.env.CORS_ORIGIN ?? request.headers.origin ?? '';
    if (allowedOrigin) reply.header('access-control-allow-origin', allowedOrigin);
    reply.header('access-control-allow-headers', 'content-type, authorization');
    reply.header('access-control-allow-methods', 'GET,POST,PATCH,OPTIONS');
    if (request.method === 'OPTIONS') return reply.code(204).send();
  });
  const websocket = attachWebSocketGateway(app.server, auth, game);

  app.addHook("onReady", async () => persistence.initialize());
  app.addHook("onClose", async () => websocket.close());
  app.addHook("onClose", async () => persistence.close());

  app.get("/healthz", async () => ({ status: "ok", service: "lafarmer-server" }));
  app.get("/api/catalog", async () => ({ items: CONTENT_CATALOG }));

  app.post("/api/auth/register", async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_registration", passwordMinLength: PASSWORD_MIN_LENGTH });
    try {
      return reply.code(201).send(await auth.register(parsed.data));
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  app.post("/api/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_login" });
    try {
      return reply.send(await auth.login(parsed.data));
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  app.get("/api/me", async (request, reply) => {
    const player = await authenticatedPlayer(request, auth);
    if (!player) return reply.code(401).send({ error: "unauthorized" });
    return reply.send({ player });
  });

  app.get("/api/world/snapshot", async (request, reply) => {
    const player = await authenticatedPlayer(request, auth);
    if (!player) return reply.code(401).send({ error: "unauthorized" });
    try {
      return reply.send(await game.snapshot(player.id));
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  app.patch("/api/player/profile", async (request, reply) => {
    const player = await authenticatedPlayer(request, auth);
    if (!player) return reply.code(401).send({ error: "unauthorized" });
    const parsed = profileSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_profile" });
    try {
      return reply.send({ player: await auth.updateProfile(player.id, parsed.data) });
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  return app;
}

async function authenticatedPlayer(request: FastifyRequest, auth: AuthService) {
  const authorization = request.headers.authorization;
  const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  return auth.authenticate(token);
}

function sendDomainError(reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }, error: unknown) {
  if (error instanceof AuthError) {
    const status = error.code === "invalid_credentials" ? 401 : error.code === "nick_taken" ? 409 : 400;
    return reply.code(status).send({ error: error.code });
  }
  if (error instanceof GameError) return reply.code(error.code === "player_not_found" ? 404 : 400).send({ error: error.code });
  return reply.code(500).send({ error: "internal_error" });
}

export { createDefaultAppearance };
