import type { FastifyInstance } from "fastify";
import { getAuditTrail } from "../../audit/store.js";

export function registerAuditRoutes(app: FastifyInstance): void {
  app.get("/v1/audit", async (request) => {
    const query = request.query as Record<string, string | undefined>;

    const events = getAuditTrail({
      request_id: query.request_id,
      event_type: query.event_type,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      offset: query.offset ? parseInt(query.offset, 10) : undefined,
    });

    return { events };
  });
}
