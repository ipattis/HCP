import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { canTransition, transitionState } from "../../src/engine/state-machine.js";
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

function insertTestCR(state: string = "SUBMITTED") {
  const id = generateId();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO coordination_requests
     (request_id, agent_id, intent, urgency, state, context_package, timeout_policy, routing_hints, responder_id, submitted_at, updated_at, timeout_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    "test-agent",
    "APPROVAL",
    "MEDIUM",
    state,
    JSON.stringify({ summary: "Test" }),
    JSON.stringify({ timeout_seconds: 300, fallback: "FAIL" }),
    JSON.stringify({ responder_id: "test-responder", channel: "portal" }),
    "test-responder",
    now,
    now,
    new Date(Date.now() + 300_000).toISOString()
  );
  return id;
}

describe("canTransition", () => {
  it("allows valid transitions", () => {
    expect(canTransition("SUBMITTED", "ROUTING")).toBe(true);
    expect(canTransition("ROUTING", "PENDING_RESPONSE")).toBe(true);
    expect(canTransition("PENDING_RESPONSE", "RESPONDED")).toBe(true);
    expect(canTransition("RESPONDED", "DELIVERED")).toBe(true);
  });

  it("rejects invalid transitions", () => {
    expect(canTransition("SUBMITTED", "DELIVERED")).toBe(false);
    expect(canTransition("DELIVERED", "SUBMITTED")).toBe(false);
    expect(canTransition("TIMED_OUT", "RESPONDED")).toBe(false);
    expect(canTransition("CANCELLED", "ROUTING")).toBe(false);
  });

  it("allows cancellation from active states", () => {
    expect(canTransition("SUBMITTED", "CANCELLED")).toBe(true);
    expect(canTransition("ROUTING", "CANCELLED")).toBe(true);
    expect(canTransition("PENDING_RESPONSE", "CANCELLED")).toBe(true);
  });

  it("allows timeout from PENDING_RESPONSE", () => {
    expect(canTransition("PENDING_RESPONSE", "TIMED_OUT")).toBe(true);
  });
});

describe("transitionState", () => {
  beforeEach(() => {
    setupTestDb();
  });

  afterEach(() => {
    db?.close();
  });

  it("transitions state and writes audit event", () => {
    const id = insertTestCR("SUBMITTED");

    transitionState({
      request_id: id,
      from: "SUBMITTED",
      to: "ROUTING",
      actor: "system",
      actor_type: "SYSTEM",
    });

    const row = db
      .prepare("SELECT state FROM coordination_requests WHERE request_id = ?")
      .get(id) as { state: string };
    expect(row.state).toBe("ROUTING");

    const events = db
      .prepare("SELECT * FROM audit_events WHERE request_id = ?")
      .all(id) as Array<{ event_type: string }>;
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("CR_ROUTING");
  });

  it("throws on invalid transition", () => {
    const id = insertTestCR("SUBMITTED");

    expect(() =>
      transitionState({
        request_id: id,
        from: "SUBMITTED",
        to: "DELIVERED",
        actor: "system",
        actor_type: "SYSTEM",
      })
    ).toThrow("Invalid state transition");
  });

  it("throws on concurrent state change", () => {
    const id = insertTestCR("ROUTING"); // Actual state is ROUTING

    expect(() =>
      transitionState({
        request_id: id,
        from: "SUBMITTED", // But we think it's SUBMITTED
        to: "ROUTING",
        actor: "system",
        actor_type: "SYSTEM",
      })
    ).toThrow("Failed to transition");
  });

  it("applies additional updates", () => {
    const id = insertTestCR("PENDING_RESPONSE");
    const now = new Date().toISOString();

    transitionState({
      request_id: id,
      from: "PENDING_RESPONSE",
      to: "RESPONDED",
      actor: "test-user",
      actor_type: "HUMAN",
      additionalUpdates: {
        response_data: { decision: "approved" },
        responded_by: "test-user",
        responded_at: now,
      },
    });

    const row = db
      .prepare("SELECT state, response_data, responded_by FROM coordination_requests WHERE request_id = ?")
      .get(id) as { state: string; response_data: string; responded_by: string };

    expect(row.state).toBe("RESPONDED");
    expect(JSON.parse(row.response_data)).toEqual({ decision: "approved" });
    expect(row.responded_by).toBe("test-user");
  });
});
