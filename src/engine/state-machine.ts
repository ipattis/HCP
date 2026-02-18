import type { State } from "../types/common.js";
import { getDb } from "../db/connection.js";
import { appendAuditEvent } from "../audit/store.js";
import { emitSSE } from "../utils/sse.js";

const VALID_TRANSITIONS: Record<string, string[]> = {
  SUBMITTED: ["ROUTING", "CANCELLED"],
  ROUTING: ["PENDING_RESPONSE", "ESCALATED", "CANCELLED"],
  PENDING_RESPONSE: ["RESPONDED", "ESCALATED", "TIMED_OUT", "CANCELLED"],
  RESPONDED: ["DELIVERED"],
  DELIVERED: [],
  ESCALATED: ["ROUTING", "TIMED_OUT", "CANCELLED"],
  TIMED_OUT: [],
  CANCELLED: [],
};

const CANCELLABLE_STATES = new Set([
  "SUBMITTED",
  "ROUTING",
  "PENDING_RESPONSE",
  "ESCALATED",
]);

export function canTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isCancellable(state: string): boolean {
  return CANCELLABLE_STATES.has(state);
}

export function transitionState(params: {
  request_id: string;
  from: string;
  to: string;
  actor: string;
  actor_type: string;
  payload?: Record<string, unknown>;
  additionalUpdates?: Record<string, unknown>;
}): void {
  if (!canTransition(params.from, params.to)) {
    throw new Error(
      `Invalid state transition: ${params.from} -> ${params.to}`
    );
  }

  const db = getDb();
  const now = new Date().toISOString();

  let setClauses = "state = ?, updated_at = ?";
  const updateParams: unknown[] = [params.to, now];

  if (params.additionalUpdates) {
    for (const [key, value] of Object.entries(params.additionalUpdates)) {
      setClauses += `, ${key} = ?`;
      updateParams.push(
        typeof value === "object" && value !== null
          ? JSON.stringify(value)
          : value
      );
    }
  }

  updateParams.push(params.request_id, params.from);

  const result = db
    .prepare(
      `UPDATE coordination_requests SET ${setClauses} WHERE request_id = ? AND state = ?`
    )
    .run(...updateParams);

  if (result.changes === 0) {
    throw new Error(
      `Failed to transition CR ${params.request_id}: state may have changed concurrently`
    );
  }

  const eventType = `CR_${params.to}`;
  appendAuditEvent({
    request_id: params.request_id,
    event_type: eventType,
    actor: params.actor,
    actor_type: params.actor_type,
    payload: params.payload,
  });

  // Broadcast state change via SSE
  const updatedRow = db
    .prepare("SELECT * FROM coordination_requests WHERE request_id = ?")
    .get(params.request_id) as { agent_id: string } | undefined;

  if (updatedRow) {
    emitSSE({
      event: "state_change",
      data: {
        request_id: params.request_id,
        state: params.to,
        agent_id: updatedRow.agent_id,
      },
    });
  }
}
