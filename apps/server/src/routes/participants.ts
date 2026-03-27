import { FastifyInstance } from "fastify";
import { joinSession } from "../services/participant-service";
import { checkoutParticipant } from "../services/calculation-service";
import { buildAndCacheState } from "../services/state-service";
import { pushFeedEvent } from "../services/feed-service";
import {
  transitionParticipant,
  evaluateCheckoutProgress,
} from "../services/state-machine-service";
import { getIO } from "../ws/socket-server";
import { handleServiceError } from "./error-handler";
import { prisma } from "../lib/prisma";
import { ParticipantStatus } from "@splitcheck/shared";

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

  // POST /api/participants/:id/checkout — Checkout (REST fallback)
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

          // Evaluate checkout progress milestones
          await evaluateCheckoutProgress(participant.sessionId);

          // Evaluate nudges
          try {
            const { evaluateCheckoutNudges } = await import("../services/nudge-service");
            await evaluateCheckoutNudges(participant.sessionId);
          } catch {
            // Nudge service may not be loaded
          }
        } catch {
          // Socket.IO may not be ready
        }

        return reply.send({ success: true, data: participant });
      } catch (error) {
        return handleServiceError(error, reply);
      }
    }
  );

  // POST /api/participants/:id/settle — Settlement (REST fallback)
  app.post<{ Params: ParticipantIdParams }>(
    "/api/participants/:id/settle",
    async (request, reply) => {
      try {
        const p = await prisma.participant.findUnique({
          where: { participantId: request.params.id },
        });

        if (!p) {
          return reply.status(404).send({ success: false, error: "Participant not found" });
        }

        // Transition to SETTLED via state machine
        await transitionParticipant(
          request.params.id,
          ParticipantStatus.SETTLED
        );

        // Rebuild state and broadcast
        try {
          await buildAndCacheState(p.sessionId);
          const io = getIO();
          io.to(`session:${p.sessionId}`).emit("participant:settled", {
            participant_id: request.params.id,
            display_name: p.displayName,
          });
          await pushFeedEvent(p.sessionId, {
            type: "settled",
            actor_name: p.displayName,
            item_name: undefined,
            amount: undefined,
            claimant_count: undefined,
          });
        } catch {
          // Socket.IO may not be ready
        }

        return reply.send({ success: true });
      } catch (error) {
        return handleServiceError(error, reply);
      }
    }
  );
}
