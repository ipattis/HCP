import { resolve } from "node:path";
import { homedir } from "node:os";

function envOr(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function resolveDbPath(raw: string): string {
  if (raw.startsWith("~")) {
    return resolve(homedir(), raw.slice(2));
  }
  return resolve(raw);
}

export const config = {
  port: parseInt(envOr("HCP_PORT", "3100"), 10),
  dbPath: resolveDbPath(envOr("HCP_DB_PATH", "~/.hcp/hcp.db")),
  baseUrl: envOr("HCP_BASE_URL", "http://localhost:3100"),
  slackBotToken: process.env["SLACK_BOT_TOKEN"] ?? "",
  timeoutPollIntervalMs: 10_000,
} as const;
