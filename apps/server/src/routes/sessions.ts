import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  createSession,
  getSessionByCode,
  getSessionById,
  updateSessionStatus,
} from "../services/session-service";
import { createHostParticipant } from "../services/participant-service";
import { getSessionSummary } from "../services/calculation-service";
import { buildAndCacheState } from "../services/state-service";
import { cachePremiumThreshold, pushFeedEvent } from "../services/feed-service";
import { getIO } from "../ws/socket-server";
import { handleServiceError } from "./error-handler";
import { getSessionItems } from "../services/item-service";

interface CreateSessionBody {
  billTotal: number;
  taxPct: number;
  servicePct: number;
  expectedHeadcount: number;
}

interface GetSessionByCodeParams {
  code: string;
}

interface SessionIdParams {
  id: string;
}

interface UpdateSessionBody {
  status?: string;
  hostDisplayName?: string;
}

export async function registerSessionRoutes(app: FastifyInstance) {
  // POST /api/sessions — Create session
  app.post<{ Body: CreateSessionBody }>(
    "/api/sessions",
    async (request, reply) => {
      try {
        const session = await createSession(request.body);
        return reply.status(201).send({ success: true, data: session });
      } catch (error) {
        return handleServiceError(error, reply);
      }
    }
  );

  // GET /api/sessions/:code — Get session by join code
  app.get<{ Params: GetSessionByCodeParams }>(
    "/api/sessions/:code",
    async (request, reply) => {
      try {
        const session = await getSessionByCode(request.params.code);
        return reply.send({ success: true, data: session });
      } catch (error) {
        return handleServiceError(error, reply);
      }
    }
  );

  // PATCH /api/sessions/:id — Update session (status, etc.)
  app.patch<{ Params: SessionIdParams; Body: UpdateSessionBody }>(
    "/api/sessions/:id",
    async (request, reply) => {
      try {
        const { status, hostDisplayName } = request.body;

        if (!status) {
          return reply
            .status(400)
            .send({ success: false, error: "Status is required" });
        }

        const session = await updateSessionStatus(request.params.id, status);

        // If transitioning to OPEN, create host participant + cache premium threshold
        if (status === "OPEN" && hostDisplayName) {
          await createHostParticipant(request.params.id, hostDisplayName);

          // Cache premium item threshold for feed messages
          const items = await getSessionItems(request.params.id);
          const unitPrices = items.map((i: { unitPrice: number }) => i.unitPrice);
          await cachePremiumThreshold(request.params.id, unitPrices);

          // Build initial state cache
          await buildAndCacheState(request.params.id);
        }

        // State machine handles WS broadcast + feed for session transitions

        return reply.send({ success: true, data: session });
      } catch (error) {
        return handleServiceError(error, reply);
      }
    }
  );

  // GET /api/sessions/:id/summary — Get session summary
  app.get<{ Params: SessionIdParams }>(
    "/api/sessions/:id/summary",
    async (request, reply) => {
      try {
        const summary = await getSessionSummary(request.params.id);
        return reply.send({ success: true, data: summary });
      } catch (error) {
        return handleServiceError(error, reply);
      }
    }
  );
}
