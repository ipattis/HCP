import { createHash } from "node:crypto";
import type { FastifyRequest, FastifyReply } from "fastify";
import { getDb } from "../../db/connection.js";

declare module "fastify" {
  interface FastifyRequest {
    agentId?: string;
    keyId?: string;
  }
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    reply.code(401).send({ error: "Missing or invalid Authorization header" });
    return;
  }

  const token = authHeader.slice(7);
  const hash = hashKey(token);
  const db = getDb();

  const row = db
    .prepare(
      "SELECT key_id, agent_id FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL"
    )
    .get(hash) as { key_id: string; agent_id: string } | undefined;

  if (!row) {
    reply.code(401).send({ error: "Invalid API key" });
    return;
  }

  request.agentId = row.agent_id;
  request.keyId = row.key_id;
}

export function hashApiKey(key: string): string {
  return hashKey(key);
}
