import { FastifyInstance } from "fastify";
import {
  assignItem,
  splitItemEqually,
  absorbItem,
} from "../services/reallocation-service";
import { handleServiceError } from "./error-handler";

interface ItemIdParams {
  id: string;
}

interface AssignItemBody {
  participant_id: string;
}

export async function registerReallocationRoutes(app: FastifyInstance) {
  // POST /api/items/:id/assign — Assign unclaimed item to specific guest
  app.post<{ Params: ItemIdParams; Body: AssignItemBody }>(
    "/api/items/:id/assign",
    async (request, reply) => {
      try {
        const result = await assignItem(
          request.params.id,
          request.body.participant_id
        );
        return reply.send({ success: true, data: result });
      } catch (error) {
        return handleServiceError(error, reply);
      }
    }
  );

  // POST /api/items/:id/split-equally — Split unclaimed item among all
  app.post<{ Params: ItemIdParams }>(
    "/api/items/:id/split-equally",
    async (request, reply) => {
      try {
        const result = await splitItemEqually(request.params.id);
        return reply.send({ success: true, data: result });
      } catch (error) {
        return handleServiceError(error, reply);
      }
    }
  );

  // POST /api/items/:id/absorb — Host absorbs unclaimed item
  app.post<{ Params: ItemIdParams }>(
    "/api/items/:id/absorb",
    async (request, reply) => {
      try {
        const result = await absorbItem(request.params.id);
        return reply.send({ success: true, data: result });
      } catch (error) {
        return handleServiceError(error, reply);
      }
    }
  );
}
