import { getDb } from "../db/connection.js";
import { generateId } from "../utils/ulid.js";
import type { AuditEvent, ActorType } from "../types/audit.js";

export function appendAuditEvent(params: {
  request_id: string;
  event_type: string;
  actor: string;
  actor_type: string;
  payload?: Record<string, unknown>;
}): AuditEvent {
  const db = getDb();
  const event: AuditEvent = {
    event_id: generateId(),
    request_id: params.request_id,
    event_type: params.event_type,
    actor: params.actor,
    actor_type: params.actor_type,
    payload: params.payload ?? {},
    created_at: new Date().toISOString(),
  };

  db.prepare(
    `INSERT INTO audit_events (event_id, request_id, event_type, actor, actor_type, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    event.event_id,
    event.request_id,
    event.event_type,
    event.actor,
    event.actor_type,
    JSON.stringify(event.payload),
    event.created_at
  );

  return event;
}

export function getAuditTrail(filters: {
  request_id?: string;
  event_type?: string;
  limit?: number;
  offset?: number;
}): AuditEvent[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.request_id) {
    conditions.push("request_id = ?");
    params.push(filters.request_id);
  }
  if (filters.event_type) {
    conditions.push("event_type = ?");
    params.push(filters.event_type);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filters.limit ?? 100;
  const offset = filters.offset ?? 0;

  const rows = db
    .prepare(
      `SELECT * FROM audit_events ${where} ORDER BY created_at ASC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as Array<{
    event_id: string;
    request_id: string;
    event_type: string;
    actor: string;
    actor_type: string;
    payload: string;
    created_at: string;
  }>;

  return rows.map((row) => ({
    ...row,
    payload: JSON.parse(row.payload),
  }));
}
