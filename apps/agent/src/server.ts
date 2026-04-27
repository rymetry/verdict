import cors from "@fastify/cors";
import Fastify from "fastify";
import { HealthResponseSchema, type HealthResponse } from "@pwqa/shared";

export function buildServer() {
  const server = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info"
    }
  });

  void server.register(cors, {
    origin: true
  });

  server.get("/health", async (): Promise<HealthResponse> => {
    return HealthResponseSchema.parse({
      ok: true,
      service: "playwright-qa-workbench-agent",
      version: "0.1.0",
      timestamp: new Date().toISOString()
    });
  });

  return server;
}

async function main() {
  const server = buildServer();
  const port = Number.parseInt(process.env.PORT ?? "4317", 10);
  const host = process.env.HOST ?? "127.0.0.1";

  await server.listen({ port, host });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
