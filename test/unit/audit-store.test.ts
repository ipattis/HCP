import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { appendAuditEvent, getAuditTrail } from "../../src/audit/store.js";
import { setDb } from "../../src/db/connection.js";
import { ensureSchema } from "../../src/db/schema.js";
import { generateId } from "../../src/utils/ulid.js";

let db: Database.Database;

function setupTestDb() {
  db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  ensureSchema(db);
  setDb(db);
}

function insertTestCR(): string {
  const id = generateId();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO coordination_requests
     (request_id, agent_id, intent, urgency, state, context_package, timeout_policy, routing_hints, responder_id, submitted_at, updated_at, timeout_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, "test-agent", "APPROVAL", "MEDIUM", "SUBMITTED",
    JSON.stringify({ summary: "Test" }),
    JSON.stringify({ timeout_seconds: 300, fallback: "FAIL" }),
    JSON.stringify({ responder_id: "test-responder", channel: "portal" }),
    "test-responder", now, now, new Date(Date.now() + 300_000).toISOString()
  );
  return id;
}

describe("Audit Store", () => {
  beforeEach(() => setupTestDb());
  afterEach(() => db?.close());

  it("appends an audit event", () => {
    const requestId = insertTestCR();

    const event = appendAuditEvent({
      request_id: requestId,
      event_type: "CR_SUBMITTED",
      actor: "test-agent",
      actor_type: "AGENT",
      payload: { intent: "APPROVAL" },
    });

    expect(event.event_id).toBeTruthy();
    expect(event.request_id).toBe(requestId);
    expect(event.event_type).toBe("CR_SUBMITTED");
    expect(event.payload).toEqual({ intent: "APPROVAL" });
  });

  it("retrieves audit trail filtered by request_id", () => {
    const id1 = insertTestCR();
    const id2 = insertTestCR();

    appendAuditEvent({
      request_id: id1,
      event_type: "CR_SUBMITTED",
      actor: "agent-1",
      actor_type: "AGENT",
    });
    appendAuditEvent({
      request_id: id2,
      event_type: "CR_SUBMITTED",
      actor: "agent-2",
      actor_type: "AGENT",
    });
    appendAuditEvent({
      request_id: id1,
      event_type: "CR_ROUTING",
      actor: "system",
      actor_type: "SYSTEM",
    });

    const trail = getAuditTrail({ request_id: id1 });
    expect(trail).toHaveLength(2);
    expect(trail[0].event_type).toBe("CR_SUBMITTED");
    expect(trail[1].event_type).toBe("CR_ROUTING");
  });

  it("filters by event_type", () => {
    const id = insertTestCR();

    appendAuditEvent({
      request_id: id,
      event_type: "CR_SUBMITTED",
      actor: "agent",
      actor_type: "AGENT",
    });
    appendAuditEvent({
      request_id: id,
      event_type: "CR_ROUTING",
      actor: "system",
      actor_type: "SYSTEM",
    });

    const events = getAuditTrail({ event_type: "CR_ROUTING" });
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("CR_ROUTING");
  });

  it("respects limit and offset", () => {
    const id = insertTestCR();

    for (let i = 0; i < 5; i++) {
      appendAuditEvent({
        request_id: id,
        event_type: "CR_SUBMITTED",
        actor: `agent-${i}`,
        actor_type: "AGENT",
      });
    }

    const page1 = getAuditTrail({ request_id: id, limit: 2, offset: 0 });
    expect(page1).toHaveLength(2);

    const page2 = getAuditTrail({ request_id: id, limit: 2, offset: 2 });
    expect(page2).toHaveLength(2);

    const page3 = getAuditTrail({ request_id: id, limit: 2, offset: 4 });
    expect(page3).toHaveLength(1);
  });
});
