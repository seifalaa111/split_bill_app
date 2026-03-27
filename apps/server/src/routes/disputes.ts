import { FastifyInstance } from "fastify";
import {
  createDispute,
  resolveDispute,
  getDisputeById,
  getSessionDisputes,
  getParticipantDisputes,
} from "../services/dispute-service";
import { handleServiceError } from "./error-handler";

interface DisputeIdParams {
  id: string;
}

interface SessionIdParams {
  id: string;
}

interface ParticipantIdParams {
  id: string;
}

interface CreateDisputeBody {
  session_id: string;
  participant_id: string;
  reason: string;
}

interface ResolveDisputeBody {
  status: "RESOLVED" | "REJECTED";
  resolution_type: "ADJUST" | "REJECT" | "OVERRIDE";
  resolution_note?: string;
  adjusted_total?: number;
}

export async function registerDisputeRoutes(app: FastifyInstance) {
  // POST /api/disputes — Guest raises a dispute
  app.post<{ Body: CreateDisputeBody }>(
    "/api/disputes",
    async (request, reply) => {
      try {
        const dispute = await createDispute({
          sessionId: request.body.session_id,
          participantId: request.body.participant_id,
          reason: request.body.reason,
        });
        return reply.status(201).send({ success: true, data: dispute });
      } catch (error) {
        return handleServiceError(error, reply);
      }
    }
  );

  // GET /api/sessions/:id/disputes — Get all disputes for a session (host view)
  app.get<{ Params: SessionIdParams }>(
    "/api/sessions/:id/disputes",
    async (request, reply) => {
      try {
        const disputes = await getSessionDisputes(request.params.id);
        return reply.send({ success: true, data: disputes });
      } catch (error) {
        return handleServiceError(error, reply);
      }
    }
  );

  // GET /api/disputes/:id — Get a single dispute
  app.get<{ Params: DisputeIdParams }>(
    "/api/disputes/:id",
    async (request, reply) => {
      try {
        const dispute = await getDisputeById(request.params.id);
        return reply.send({ success: true, data: dispute });
      } catch (error) {
        return handleServiceError(error, reply);
      }
    }
  );

  // PATCH /api/disputes/:id — Host resolves a dispute
  app.patch<{ Params: DisputeIdParams; Body: ResolveDisputeBody }>(
    "/api/disputes/:id",
    async (request, reply) => {
      try {
        const dispute = await resolveDispute(request.params.id, {
          status: request.body.status,
          resolutionType: request.body.resolution_type,
          resolutionNote: request.body.resolution_note,
          adjustedTotal: request.body.adjusted_total,
        });
        return reply.send({ success: true, data: dispute });
      } catch (error) {
        return handleServiceError(error, reply);
      }
    }
  );

  // GET /api/participants/:id/disputes — Get disputes for a participant
  app.get<{ Params: ParticipantIdParams }>(
    "/api/participants/:id/disputes",
    async (request, reply) => {
      try {
        const disputes = await getParticipantDisputes(request.params.id);
        return reply.send({ success: true, data: disputes });
      } catch (error) {
        return handleServiceError(error, reply);
      }
    }
  );
}
