import { FastifyInstance } from "fastify";
import { joinSession } from "../services/participant-service";
import { checkoutParticipant } from "../services/calculation-service";
import { buildAndCacheState } from "../services/state-service";
import { pushFeedEvent } from "../services/feed-service";
import { getIO } from "../ws/socket-server";
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

        // Rebuild state cache and broadcast via WebSocket
        try {
          await buildAndCacheState(request.params.id);
          const io = getIO();
          io.to(`session:${request.params.id}`).emit("participant:joined", {
            participant_id: participant.participantId,
            display_name: participant.displayName,
            role: participant.role,
            avatar_color: participant.avatarColor,
          });
          await pushFeedEvent(request.params.id, {
            type: "join",
            actor_name: participant.displayName,
            item_name: undefined,
            amount: undefined,
            claimant_count: undefined,
          });
        } catch {
          // Socket.IO may not be ready
        }

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

        // Rebuild state cache and broadcast via WebSocket
        try {
          await buildAndCacheState(participant.sessionId);
          const io = getIO();
          io.to(`session:${participant.sessionId}`).emit("participant:checkout", {
            participant_id: participant.participantId,
            display_name: participant.displayName,
            total: participant.total,
          });
          await pushFeedEvent(participant.sessionId, {
            type: "checkout",
            actor_name: participant.displayName,
            item_name: undefined,
            amount: participant.total,
            claimant_count: undefined,
          });
        } catch {
          // Socket.IO may not be ready
        }

        return reply.send({ success: true, data: participant });
      } catch (error) {
        return handleServiceError(error, reply);
      }
    }
  );
}
