import { FastifyInstance } from "fastify";
import { claimItem, unclaimItem } from "../services/claim-service";
import { buildAndCacheState } from "../services/state-service";
import { pushFeedEvent } from "../services/feed-service";
import { getIO } from "../ws/socket-server";
import { prisma } from "../lib/prisma";
import { handleServiceError } from "./error-handler";

interface ItemIdParams {
  id: string;
}

interface ClaimIdParams {
  id: string;
}

interface ClaimItemBody {
  participantId: string;
  quantity: number;
  isShared: boolean;
}

export async function registerClaimRoutes(app: FastifyInstance) {
  // POST /api/items/:id/claim — Claim an item
  app.post<{ Params: ItemIdParams; Body: ClaimItemBody }>(
    "/api/items/:id/claim",
    async (request, reply) => {
      try {
        const claim = await claimItem(request.params.id, request.body);

        // Broadcast via WebSocket
        try {
          const item = await prisma.billItem.findUnique({
            where: { itemId: request.params.id },
            select: { name: true, sessionId: true, quantity: true, claimedQty: true, isShared: true },
          });
          const participant = await prisma.participant.findUnique({
            where: { participantId: request.body.participantId },
            select: { displayName: true },
          });

          if (item && participant) {
            await buildAndCacheState(item.sessionId);
            const io = getIO();
            const remainingQty = item.isShared ? 1 : item.quantity - item.claimedQty;
            io.to(`session:${item.sessionId}`).emit("item:claimed", {
              item_id: request.params.id,
              item_name: item.name,
              participant_id: request.body.participantId,
              participant_name: participant.displayName,
              claimed_qty: item.claimedQty,
              remaining_qty: remainingQty,
            });
            await pushFeedEvent(item.sessionId, {
              type: "claim",
              actor_name: participant.displayName,
              item_name: item.name,
              amount: undefined,
              claimant_count: item.claimedQty,
            });
          }
        } catch {
          // Socket.IO may not be ready
        }

        return reply.status(201).send({ success: true, data: claim });
      } catch (error) {
        return handleServiceError(error, reply);
      }
    }
  );

  // DELETE /api/claims/:id — Unclaim
  app.delete<{ Params: ClaimIdParams }>(
    "/api/claims/:id",
    async (request, reply) => {
      try {
        // Look up claim details before deletion for broadcast
        const claimRecord = await prisma.claim.findUnique({
          where: { claimId: request.params.id },
          include: { item: true, participant: true },
        });

        await unclaimItem(request.params.id);

        // Broadcast via WebSocket
        if (claimRecord) {
          try {
            await buildAndCacheState(claimRecord.item.sessionId);
            const updatedItem = await prisma.billItem.findUnique({
              where: { itemId: claimRecord.itemId },
              select: { quantity: true, claimedQty: true, isShared: true },
            });
            const io = getIO();
            const remainingQty = updatedItem
              ? updatedItem.isShared ? 1 : updatedItem.quantity - updatedItem.claimedQty
              : 0;
            io.to(`session:${claimRecord.item.sessionId}`).emit("item:unclaimed", {
              item_id: claimRecord.itemId,
              item_name: claimRecord.item.name,
              participant_id: claimRecord.participantId,
              participant_name: claimRecord.participant.displayName,
              released_qty: claimRecord.quantity,
              remaining_qty: remainingQty,
            });
            await pushFeedEvent(claimRecord.item.sessionId, {
              type: "unclaim",
              actor_name: claimRecord.participant.displayName,
              item_name: claimRecord.item.name,
              amount: undefined,
              claimant_count: undefined,
            });
          } catch {
            // Socket.IO may not be ready
          }
        }

        return reply.send({ success: true, data: { deleted: true } });
      } catch (error) {
        return handleServiceError(error, reply);
      }
    }
  );
}
