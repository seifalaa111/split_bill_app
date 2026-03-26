import { FastifyInstance } from "fastify";
import {
  addItem,
  updateItem,
  deleteItem,
  getSessionItems,
} from "../services/item-service";
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
        await deleteItem(request.params.id);
        return reply.send({ success: true, data: { deleted: true } });
      } catch (error) {
        return handleServiceError(error, reply);
      }
    }
  );
}
