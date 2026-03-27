import { FastifyInstance } from "fastify";
import {
  addItem,
  updateItem,
  deleteItem,
  getSessionItems,
} from "../services/item-service";
import { buildAndCacheState } from "../services/state-service";
import { pushFeedEvent } from "../services/feed-service";
import { getIO } from "../ws/socket-server";
import { prisma } from "../lib/prisma";
import { handleServiceError } from "./error-handler";

interface SessionIdParams {
  id: string;
}

interface ItemIdParams {
  id: string;
}

interface AddItemBody {
  name: string;
  quantity: number;
  unitPrice: number;
  isShared: boolean;
}

interface UpdateItemBody {
  name?: string;
  quantity?: number;
  unitPrice?: number;
  isShared?: boolean;
}

export async function registerItemRoutes(app: FastifyInstance) {
  // POST /api/sessions/:id/items — Add item to session
  app.post<{ Params: SessionIdParams; Body: AddItemBody }>(
    "/api/sessions/:id/items",
    async (request, reply) => {
      try {
        const item = await addItem(request.params.id, request.body);
        return reply.status(201).send({ success: true, data: item });
      } catch (error) {
        return handleServiceError(error, reply);
      }
    }
  );

  // GET /api/sessions/:id/items — Get all items for session
  app.get<{ Params: SessionIdParams }>(
    "/api/sessions/:id/items",
    async (request, reply) => {
      try {
        const items = await getSessionItems(request.params.id);
        return reply.send({ success: true, data: items });
      } catch (error) {
        return handleServiceError(error, reply);
      }
    }
  );

  // PUT /api/items/:id — Edit item
  app.put<{ Params: ItemIdParams; Body: UpdateItemBody }>(
    "/api/items/:id",
    async (request, reply) => {
      try {
        const item = await updateItem(request.params.id, request.body);

        // Broadcast item update via WebSocket
        try {
          await buildAndCacheState(item.sessionId);
          const io = getIO();
          io.to(`session:${item.sessionId}`).emit("item:updated", {
            item_id: item.itemId,
            changes: request.body as Record<string, unknown>,
          });
          await pushFeedEvent(item.sessionId, {
            type: "host_edit",
            actor_name: "Host",
            item_name: item.name,
            amount: undefined,
            claimant_count: undefined,
          });
        } catch {
          // Socket.IO may not be ready
        }

        return reply.send({ success: true, data: item });
      } catch (error) {
        return handleServiceError(error, reply);
      }
    }
  );

  // DELETE /api/items/:id — Delete item
  app.delete<{ Params: ItemIdParams }>(
    "/api/items/:id",
    async (request, reply) => {
      try {
        // Look up item details before deletion for the broadcast
        const itemRecord = await prisma.billItem.findUnique({
          where: { itemId: request.params.id },
          select: { name: true, sessionId: true },
        });

        await deleteItem(request.params.id);

        // Broadcast item deletion via WebSocket
        if (itemRecord) {
          try {
            await buildAndCacheState(itemRecord.sessionId);
            const io = getIO();
            io.to(`session:${itemRecord.sessionId}`).emit("item:deleted", {
              item_id: request.params.id,
              item_name: itemRecord.name,
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
