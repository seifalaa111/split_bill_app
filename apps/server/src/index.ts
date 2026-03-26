import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerSessionRoutes } from "./routes/sessions";
import { registerItemRoutes } from "./routes/items";
import { registerClaimRoutes } from "./routes/claims";
import { registerParticipantRoutes } from "./routes/participants";

const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || "0.0.0.0";

async function buildServer() {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === "production" ? "warn" : "info",
    },
  });

  // CORS — allow Next.js frontend
  await app.register(cors, {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    credentials: true,
  });

  // Health check
  app.get("/health", async () => {
    return { status: "ok", timestamp: new Date().toISOString() };
  });

  // Register all route modules
  await registerSessionRoutes(app);
  await registerItemRoutes(app);
  await registerClaimRoutes(app);
  await registerParticipantRoutes(app);

  return app;
}

async function start() {
  const app = await buildServer();

  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`SplitCheck API running on http://${HOST}:${PORT}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

start();

export { buildServer };
