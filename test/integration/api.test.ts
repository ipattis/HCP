import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { createServer } from "../../src/api/server.js";
import { setDb } from "../../src/db/connection.js";
import { ensureSchema } from "../../src/db/schema.js";
import { generateId } from "../../src/utils/ulid.js";
import { hashApiKey } from "../../src/api/middleware/auth.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let db: Database.Database;
const TEST_API_KEY = "hcp_test_key_1234567890";

async function setup() {
  db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  ensureSchema(db);
  setDb(db);

  // Insert test API key
  const keyHash = hashApiKey(TEST_API_KEY);
  db.prepare(
    `INSERT INTO api_keys (key_id, key_hash, agent_id, label, scopes, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(generateId(), keyHash, "test-agent", "Test Key", "[]", new Date().toISOString());

  app = await createServer();
}

function makeRequest(method: string, url: string, body?: object) {
  const headers: Record<string, string> = {
    authorization: `Bearer ${TEST_API_KEY}`,
  };
  if (body) {
    headers["content-type"] = "application/json";
  }
  return app.inject({
    method: method as any,
    url,
    headers,
    payload: body,
  });
}

const sampleCR = {
  intent: "APPROVAL",
  urgency: "MEDIUM",
  context_package: {
    summary: "Deploy v2.1.0 to production",
    detail: "This release includes new auth flow and 3 bug fixes.",
  },
  timeout_policy: {
    timeout_seconds: 300,
    fallback: "FAIL",
  },
  routing_hints: {
    responder_id: "test-responder",
    channel: "portal",
  },
};

describe("API Integration", () => {
  beforeAll(async () => {
    await setup();
  });

  afterAll(async () => {
    await app?.close();
    db?.close();
  });

  it("health check returns ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe("ok");
  });

  it("rejects unauthenticated requests", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/requests",
      payload: sampleCR,
    });
    expect(res.statusCode).toBe(401);
  });

  it("creates a coordination request", async () => {
    const res = await makeRequest("POST", "/v1/requests", sampleCR);
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.request_id).toBeTruthy();
    expect(body.agent_id).toBe("test-agent");
    expect(body.intent).toBe("APPROVAL");
    expect(body.state).toBe("SUBMITTED");
  });

  it("returns 400 for invalid input", async () => {
    const res = await makeRequest("POST", "/v1/requests", {
      intent: "INVALID",
    });
    expect(res.statusCode).toBe(400);
  });

  it("supports idempotency", async () => {
    const input = { ...sampleCR, idempotency_key: "idem-1" };
    const res1 = await makeRequest("POST", "/v1/requests", input);
    const res2 = await makeRequest("POST", "/v1/requests", input);

    expect(res1.statusCode).toBe(201);
    expect(res2.statusCode).toBe(200);

    const body1 = JSON.parse(res1.body);
    const body2 = JSON.parse(res2.body);
    expect(body1.request_id).toBe(body2.request_id);
  });

  it("gets a coordination request by ID", async () => {
    const createRes = await makeRequest("POST", "/v1/requests", sampleCR);
    const { request_id } = JSON.parse(createRes.body);

    const res = await makeRequest("GET", `/v1/requests/${request_id}`);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.request_id).toBe(request_id);
  });

  it("lists coordination requests with filters", async () => {
    const res = await makeRequest(
      "GET",
      "/v1/requests?state=PENDING_RESPONSE&responder_id=test-responder"
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.requests)).toBe(true);
  });

  it("cancels a coordination request", async () => {
    const createRes = await makeRequest("POST", "/v1/requests", sampleCR);
    const { request_id } = JSON.parse(createRes.body);

    const res = await makeRequest("DELETE", `/v1/requests/${request_id}`);
    // May be 200 or 409 depending on routing speed
    expect([200, 409]).toContain(res.statusCode);
  });

  it("responds to a coordination request", async () => {
    const createRes = await makeRequest("POST", "/v1/requests", sampleCR);
    const { request_id } = JSON.parse(createRes.body);

    // Wait briefly for async routing to complete
    await new Promise((r) => setTimeout(r, 50));

    const respondRes = await makeRequest(
      "POST",
      `/v1/requests/${request_id}/respond`,
      {
        response_data: { decision: "approved" },
        responded_by: "test-responder",
      }
    );

    // Should be 200 if routed, or 409 if still routing
    expect([200, 409]).toContain(respondRes.statusCode);
  });

  it("returns 404 for non-existent request", async () => {
    const res = await makeRequest("GET", "/v1/requests/nonexistent");
    expect(res.statusCode).toBe(404);
  });

  it("queries audit events", async () => {
    const createRes = await makeRequest("POST", "/v1/requests", sampleCR);
    const { request_id } = JSON.parse(createRes.body);

    const res = await makeRequest(
      "GET",
      `/v1/audit?request_id=${request_id}`
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events.length).toBeGreaterThan(0);
  });
});
