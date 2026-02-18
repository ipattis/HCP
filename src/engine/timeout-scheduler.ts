import { getDb } from "../db/connection.js";
import { transitionState } from "./state-machine.js";
import { routeCR } from "./manual-router.js";
import type { CoordinationRequest } from "../types/cr.js";

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

async function processExpiredCRs(): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();

  const expiredRows = db
    .prepare(
      `SELECT * FROM coordination_requests
       WHERE state IN ('PENDING_RESPONSE', 'ESCALATED')
       AND timeout_at <= ?`
    )
    .all(now) as Array<Record<string, unknown>>;

  for (const row of expiredRows) {
    const cr = parseRow(row);
    const fallback = cr.timeout_policy.fallback;

    try {
      switch (fallback) {
        case "AUTO_APPROVE":
          transitionState({
            request_id: cr.request_id,
            from: cr.state,
            to: "RESPONDED",
            actor: "system",
            actor_type: "SYSTEM",
            payload: { fallback, auto: true },
            additionalUpdates: {
              response_data: { decision: "approved", auto: true },
              responded_by: "system:auto_approve",
              responded_at: now,
            },
          });
          break;

        case "AUTO_REJECT":
          transitionState({
            request_id: cr.request_id,
            from: cr.state,
            to: "RESPONDED",
            actor: "system",
            actor_type: "SYSTEM",
            payload: { fallback, auto: true },
            additionalUpdates: {
              response_data: { decision: "rejected", auto: true },
              responded_by: "system:auto_reject",
              responded_at: now,
            },
          });
          break;

        case "ESCALATE": {
          const escalationResponderId =
            cr.timeout_policy.escalation_responder_id;
          if (!escalationResponderId) {
            // No escalation target — time out instead
            transitionState({
              request_id: cr.request_id,
              from: cr.state,
              to: "TIMED_OUT",
              actor: "system",
              actor_type: "SYSTEM",
              payload: { fallback, reason: "no_escalation_target" },
            });
            break;
          }

          transitionState({
            request_id: cr.request_id,
            from: cr.state,
            to: "ESCALATED",
            actor: "system",
            actor_type: "SYSTEM",
            payload: { fallback, escalation_responder_id: escalationResponderId },
            additionalUpdates: {
              responder_id: escalationResponderId,
              timeout_at: new Date(
                Date.now() + cr.timeout_policy.timeout_seconds * 1000
              ).toISOString(),
            },
          });

          // Re-route with new responder
          const updatedCr = { ...cr, responder_id: escalationResponderId };
          // Transition from ESCALATED -> ROUTING -> PENDING_RESPONSE
          transitionState({
            request_id: cr.request_id,
            from: "ESCALATED",
            to: "ROUTING",
            actor: "system",
            actor_type: "SYSTEM",
            payload: { responder_id: escalationResponderId },
          });
          transitionState({
            request_id: cr.request_id,
            from: "ROUTING",
            to: "PENDING_RESPONSE",
            actor: "system",
            actor_type: "SYSTEM",
            payload: { responder_id: escalationResponderId },
          });
          break;
        }

        default:
          // BLOCK, FAIL, SKIP all result in TIMED_OUT
          transitionState({
            request_id: cr.request_id,
            from: cr.state,
            to: "TIMED_OUT",
            actor: "system",
            actor_type: "SYSTEM",
            payload: { fallback },
          });
          break;
      }
    } catch (err) {
      console.error(
        `Failed to process timeout for CR ${cr.request_id}:`,
        err
      );
    }
  }
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startTimeoutScheduler(intervalMs: number): void {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    processExpiredCRs().catch((err) =>
      console.error("Timeout scheduler error:", err)
    );
  }, intervalMs);
}

export function stopTimeoutScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
