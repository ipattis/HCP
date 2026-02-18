import type { FastifyInstance } from "fastify";
import { getDb } from "../../db/connection.js";
import { generateId } from "../../utils/ulid.js";
import { CreateCRSchema, SubmitResponseSchema } from "../../types/cr.js";
import type { CoordinationRequest } from "../../types/cr.js";
import { appendAuditEvent } from "../../audit/store.js";
import { transitionState, isCancellable } from "../../engine/state-machine.js";
import { routeCR } from "../../engine/manual-router.js";

function parseRow(row: Record<string, unknown>): CoordinationRequest {
  return {
    ...row,
    context_package: JSON.parse(row.context_package as string),
    response_schema: row.response_schema
      ? JSON.parse(row.response_schema as string)
      : null,
    timeout_policy: JSON.parse(row.timeout_policy as string),
    routing_hints: JSON.parse(row.routing_hints as string),
    response_data: row.response_data
      ? JSON.parse(row.response_data as string)
      : null,
  } as CoordinationRequest;
}

export function registerRequestRoutes(app: FastifyInstance): void {
  // Create a new coordination request
  app.post("/v1/requests", async (request, reply) => {
    const parsed = CreateCRSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        details: parsed.error.flatten(),
      });
    }

    const input = parsed.data;
    const db = getDb();

    // Idempotency check
    if (input.idempotency_key) {
      const existing = db
        .prepare(
          "SELECT * FROM coordination_requests WHERE idempotency_key = ?"
        )
        .get(input.idempotency_key) as Record<string, unknown> | undefined;

      if (existing) {
        return reply.code(200).send(parseRow(existing));
      }
    }

    const now = new Date().toISOString();
    const requestId = generateId();
    const timeoutAt = new Date(
      Date.now() + input.timeout_policy.timeout_seconds * 1000
    ).toISOString();

    const cr: CoordinationRequest = {
      request_id: requestId,
      agent_id: request.agentId!,
      intent: input.intent,
      urgency: input.urgency,
      state: "SUBMITTED",
      context_package: input.context_package,
      response_schema: input.response_schema ?? null,
      timeout_policy: input.timeout_policy,
      routing_hints: input.routing_hints,
      trace_id: input.trace_id ?? null,
      idempotency_key: input.idempotency_key ?? null,
      responder_id: input.routing_hints.responder_id,
      response_data: null,
      responded_by: null,
      responded_at: null,
      submitted_at: now,
      updated_at: now,
      timeout_at: timeoutAt,
      delivered_at: null,
    };

    db.prepare(
      `INSERT INTO coordination_requests
       (request_id, agent_id, intent, urgency, state, context_package, response_schema,
        timeout_policy, routing_hints, trace_id, idempotency_key, responder_id,
        response_data, responded_by, responded_at, submitted_at, updated_at, timeout_at, delivered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      cr.request_id,
      cr.agent_id,
      cr.intent,
      cr.urgency,
      cr.state,
      JSON.stringify(cr.context_package),
      cr.response_schema ? JSON.stringify(cr.response_schema) : null,
      JSON.stringify(cr.timeout_policy),
      JSON.stringify(cr.routing_hints),
      cr.trace_id,
      cr.idempotency_key,
      cr.responder_id,
      null,
      null,
      null,
      cr.submitted_at,
      cr.updated_at,
      cr.timeout_at,
      null
    );

    appendAuditEvent({
      request_id: cr.request_id,
      event_type: "CR_SUBMITTED",
      actor: cr.agent_id,
      actor_type: "AGENT",
      payload: { intent: cr.intent, urgency: cr.urgency },
    });

    // Route asynchronously
    routeCR(cr).catch((err) =>
      console.error(`Routing failed for CR ${cr.request_id}:`, err)
    );

    return reply.code(201).send(cr);
  });

  // Get a single CR (auto-transitions RESPONDED -> DELIVERED)
  app.get("/v1/requests/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();

    const row = db
      .prepare("SELECT * FROM coordination_requests WHERE request_id = ?")
      .get(id) as Record<string, unknown> | undefined;

    if (!row) {
      return reply.code(404).send({ error: "Not found" });
    }

    const cr = parseRow(row);

    // Auto-deliver on poll
    if (cr.state === "RESPONDED") {
      try {
        transitionState({
          request_id: cr.request_id,
          from: "RESPONDED",
          to: "DELIVERED",
          actor: request.agentId ?? "system",
          actor_type: request.agentId ? "AGENT" : "SYSTEM",
          additionalUpdates: {
            delivered_at: new Date().toISOString(),
          },
        });
        cr.state = "DELIVERED";
        cr.delivered_at = new Date().toISOString();
      } catch {
        // Concurrent transition — return current state
      }
    }

    return cr;
  });

  // List CRs with filters
  app.get("/v1/requests", async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const db = getDb();

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (query.agent_id) {
      conditions.push("agent_id = ?");
      params.push(query.agent_id);
    }
    if (query.state) {
      conditions.push("state = ?");
      params.push(query.state);
    }
    if (query.intent) {
      conditions.push("intent = ?");
      params.push(query.intent);
    }
    if (query.urgency) {
      conditions.push("urgency = ?");
      params.push(query.urgency);
    }
    if (query.responder_id) {
      conditions.push("responder_id = ?");
      params.push(query.responder_id);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = query.limit ? parseInt(query.limit, 10) : 50;
    const offset = query.offset ? parseInt(query.offset, 10) : 0;

    const rows = db
      .prepare(
        `SELECT * FROM coordination_requests ${where} ORDER BY submitted_at DESC LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as Array<Record<string, unknown>>;

    return { requests: rows.map(parseRow) };
  });

  // Cancel a CR
  app.delete("/v1/requests/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();

    const row = db
      .prepare("SELECT * FROM coordination_requests WHERE request_id = ?")
      .get(id) as Record<string, unknown> | undefined;

    if (!row) {
      return reply.code(404).send({ error: "Not found" });
    }

    const cr = parseRow(row);

    if (!isCancellable(cr.state)) {
      return reply
        .code(409)
        .send({ error: `Cannot cancel CR in state ${cr.state}` });
    }

    transitionState({
      request_id: cr.request_id,
      from: cr.state,
      to: "CANCELLED",
      actor: request.agentId ?? "system",
      actor_type: request.agentId ? "AGENT" : "SYSTEM",
    });

    return { status: "cancelled", request_id: cr.request_id };
  });

  // Submit a response to a CR
  app.post("/v1/requests/:id/respond", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = SubmitResponseSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        details: parsed.error.flatten(),
      });
    }

    const db = getDb();
    const row = db
      .prepare("SELECT * FROM coordination_requests WHERE request_id = ?")
      .get(id) as Record<string, unknown> | undefined;

    if (!row) {
      return reply.code(404).send({ error: "Not found" });
    }

    const cr = parseRow(row);

    if (cr.state !== "PENDING_RESPONSE") {
      return reply
        .code(409)
        .send({ error: `Cannot respond to CR in state ${cr.state}` });
    }

    const now = new Date().toISOString();

    transitionState({
      request_id: cr.request_id,
      from: "PENDING_RESPONSE",
      to: "RESPONDED",
      actor: parsed.data.responded_by,
      actor_type: "HUMAN",
      payload: { response_data: parsed.data.response_data },
      additionalUpdates: {
        response_data: parsed.data.response_data,
        responded_by: parsed.data.responded_by,
        responded_at: now,
      },
    });

    return {
      status: "responded",
      request_id: cr.request_id,
    };
  });
}
