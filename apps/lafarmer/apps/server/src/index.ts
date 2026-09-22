import { createApp } from "./http.js";

const port = Number(process.env.PORT ?? 3337);
const host = process.env.HOST ?? "0.0.0.0";
const app = createApp({ logger: true });

if (process.env.NODE_ENV !== "test") {
  app.listen({ port, host }).then(() => {
    app.log.info(`LaFarmer server listening on ${host}:${port}`);
  }).catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
}

export { createApp } from "./http.js";
