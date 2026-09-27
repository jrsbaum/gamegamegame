import { createApp } from "./http.js";

const port = Number(process.env.PORT ?? 3338);
const host = process.env.HOST ?? "0.0.0.0";
const app = createApp({ logger: true });

if (process.env.NODE_ENV !== "test") {
  const shutdown = async () => {
    try {
      await app.close();
    } catch (error) {
      app.log.error(error, "Failed to shut down the server");
      process.exitCode = 1;
    }
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  app.listen({ port, host }).then(() => {
    app.log.info(`La Farmer 2 server listening on ${host}:${port}`);
  }).catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
}

export { createApp } from "./http.js";
