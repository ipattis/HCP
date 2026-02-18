import { createServer } from "./api/server.js";
import { getDb, closeDb } from "./db/connection.js";
import { ensureSchema } from "./db/schema.js";
import { config } from "./config.js";
import {
  startTimeoutScheduler,
  stopTimeoutScheduler,
} from "./engine/timeout-scheduler.js";

async function main() {
  // Initialize database
  const db = getDb();
  ensureSchema(db);
  console.log(`Database initialized at ${config.dbPath}`);

  // Start server
  const app = await createServer();
  await app.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`HCP server listening on port ${config.port}`);
  console.log(`Portal: ${config.baseUrl}/portal/`);

  // Start timeout scheduler
  startTimeoutScheduler(config.timeoutPollIntervalMs);
  console.log("Timeout scheduler started");

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down...");
    stopTimeoutScheduler();
    await app.close();
    closeDb();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
