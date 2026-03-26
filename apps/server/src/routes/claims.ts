import { FastifyInstance } from "fastify";
import { claimItem, unclaimItem } from "../services/claim-service";
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
        await unclaimItem(request.params.id);
        return reply.send({ success: true, data: { deleted: true } });
      } catch (error) {
        return handleServiceError(error, reply);
      }
    }
  );
}
