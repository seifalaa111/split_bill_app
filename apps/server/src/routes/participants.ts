import { FastifyInstance } from "fastify";
import { joinSession } from "../services/participant-service";
import { checkoutParticipant } from "../services/calculation-service";
import { handleServiceError } from "./error-handler";

interface SessionIdParams {
  id: string;
}

interface ParticipantIdParams {
  id: string;
}

interface JoinSessionBody {
  displayName: string;
}

export async function registerParticipantRoutes(app: FastifyInstance) {
  // POST /api/sessions/:id/join — Join session
  app.post<{ Params: SessionIdParams; Body: JoinSessionBody }>(
    "/api/sessions/:id/join",
    async (request, reply) => {
      try {
        const participant = await joinSession(
          request.params.id,
          request.body
        );
        return reply.status(201).send({ success: true, data: participant });
      } catch (error) {
        return handleServiceError(error, reply);
      }
    }
  );

  // POST /api/participants/:id/checkout — Checkout
  app.post<{ Params: ParticipantIdParams }>(
    "/api/participants/:id/checkout",
    async (request, reply) => {
      try {
        const participant = await checkoutParticipant(request.params.id);
        return reply.send({ success: true, data: participant });
      } catch (error) {
        return handleServiceError(error, reply);
      }
    }
  );
}
