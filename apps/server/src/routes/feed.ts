import { FastifyInstance } from "fastify";
import { getFeedHistory } from "../services/feed-service";
import { handleServiceError } from "./error-handler";

interface SessionIdParams {
  id: string;
}

interface FeedQuerystring {
  count?: string;
}

export async function registerFeedRoutes(app: FastifyInstance) {
  // GET /api/sessions/:id/feed — Get activity feed history
  app.get<{ Params: SessionIdParams; Querystring: FeedQuerystring }>(
    "/api/sessions/:id/feed",
    async (request, reply) => {
      try {
        const count = Math.min(
          parseInt(request.query.count || "50", 10) || 50,
          50
        );
        const events = await getFeedHistory(request.params.id, count);
        return reply.send({ success: true, data: events });
      } catch (error) {
        return handleServiceError(error, reply);
      }
    }
  );
}
