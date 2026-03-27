import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { redisPub, redisSub } from "../lib/redis";
import { prisma } from "../lib/prisma";
import { claimItem, unclaimItem } from "../services/claim-service";
import { checkoutParticipant } from "../services/calculation-service";
import { getCachedState, buildAndCacheState } from "../services/state-service";
import { pushFeedEvent } from "../services/feed-service";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SocketConnectionQuery,
  WsAckResponse,
  ClaimCreatePayload,
  ClaimDeletePayload,
  ParticipantCheckoutPayload,
} from "@splitcheck/shared";

export type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;
export type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

/** Tracks grace-period timers for disconnected participants */
const disconnectTimers = new Map<string, NodeJS.Timeout>();

/** Global reference so route handlers can broadcast */
let ioInstance: TypedServer | null = null;

export function getIO(): TypedServer {
  if (!ioInstance) {
    throw new Error("Socket.IO not initialized — call setupSocketIO first");
  }
  return ioInstance;
}

function roomName(sessionId: string): string {
  return `session:${sessionId}`;
}

export async function setupSocketIO(httpServer: HttpServer): Promise<TypedServer> {
  const io: TypedServer = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || "http://localhost:3000",
      methods: ["GET", "POST"],
      credentials: true,
    },
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  // Attach Redis adapter for multi-server pub/sub
  io.adapter(createAdapter(redisPub, redisSub));

  ioInstance = io;

  io.on("connection", async (socket: TypedSocket) => {
    const query = socket.handshake.query as unknown as SocketConnectionQuery;
    const { session_id, participant_id } = query;

    if (!session_id || !participant_id) {
      socket.emit("session:closed", {
        session_id: session_id || "",
        reason: "Missing session_id or participant_id",
      });
      socket.disconnect(true);
      return;
    }

    // Validate session + participant exist
    const [session, participant] = await Promise.all([
      prisma.session.findUnique({ where: { sessionId: session_id } }),
      prisma.participant.findUnique({ where: { participantId: participant_id } }),
    ]);

    if (!session || !participant || participant.sessionId !== session_id) {
      socket.emit("session:closed", {
        session_id,
        reason: "Invalid session or participant",
      });
      socket.disconnect(true);
      return;
    }

    if (session.status === "CLOSED") {
      socket.emit("session:closed", {
        session_id,
        reason: "Session is closed",
      });
      socket.disconnect(true);
      return;
    }

    // Store identity on socket for later use
    socket.data = { session_id, participant_id, display_name: participant.displayName };

    // Join the session room
    const room = roomName(session_id);
    await socket.join(room);

    // Clear any pending disconnect timer for this participant
    const timerKey = `${session_id}:${participant_id}`;
    const existingTimer = disconnectTimers.get(timerKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
      disconnectTimers.delete(timerKey);

      // Broadcast reconnection to room
      socket.to(room).emit("participant:reconnected", {
        participant_id,
        display_name: participant.displayName,
      });

      await pushFeedEvent(session_id, {
        type: "participant_reconnected",
        actor_name: participant.displayName,
        item_name: undefined,
        amount: undefined,
        claimant_count: undefined,
      });
    }

    // Push full state to the newly connected client
    try {
      const state = await getCachedState(session_id);
      socket.emit("state:sync", state);
    } catch (err) {
      console.error("[WS] Failed to send state:sync on connect:", err);
    }

    // ─── Event Handlers ────────────────────────────────────────

    socket.on("claim:create", async (payload: ClaimCreatePayload, ack: (response: WsAckResponse) => void) => {
      try {
        const claim = await claimItem(payload.item_id, {
          participantId: payload.participant_id,
          quantity: payload.quantity,
          isShared: payload.is_shared,
        });

        // Rebuild and cache state
        const newState = await buildAndCacheState(session_id);

        // Find updated item for broadcast
        const updatedItem = newState.items.find(
          (i) => i.itemId === payload.item_id
        );
        const claimantName =
          newState.participants.find(
            (p) => p.participantId === payload.participant_id
          )?.displayName ?? "Someone";

        const remainingQty = updatedItem
          ? updatedItem.isShared
            ? 1
            : updatedItem.quantity - updatedItem.claimedQty
          : 0;

        // Broadcast to room
        io.to(room).emit("item:claimed", {
          item_id: payload.item_id,
          item_name: updatedItem?.name ?? "",
          participant_id: payload.participant_id,
          participant_name: claimantName,
          claimed_qty: updatedItem?.claimedQty ?? 0,
          remaining_qty: remainingQty,
        });

        // Push feed event
        await pushFeedEvent(session_id, {
          type: "claim",
          actor_name: claimantName,
          item_name: updatedItem?.name,
          amount: undefined,
          claimant_count: updatedItem?.claimedQty,
        });

        const response: WsAckResponse = {
          success: true,
          data: claim as unknown as Record<string, unknown>,
        };
        ack(response);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to claim item";
        ack({ success: false, error: message });
      }
    });

    socket.on("claim:delete", async (payload: ClaimDeletePayload, ack: (response: WsAckResponse) => void) => {
      try {
        // Get claim details before deleting for the broadcast
        const claimRecord = await prisma.claim.findUnique({
          where: { claimId: payload.claim_id },
          include: {
            item: true,
            participant: true,
          },
        });

        if (!claimRecord) {
          ack({ success: false, error: "Claim not found" });
          return;
        }

        await unclaimItem(payload.claim_id);

        // Rebuild and cache state
        const newState = await buildAndCacheState(session_id);

        const updatedItem = newState.items.find(
          (i) => i.itemId === claimRecord.itemId
        );
        const remainingQty = updatedItem
          ? updatedItem.isShared
            ? 1
            : updatedItem.quantity - updatedItem.claimedQty
          : 0;

        io.to(room).emit("item:unclaimed", {
          item_id: claimRecord.itemId,
          item_name: claimRecord.item.name,
          participant_id: payload.participant_id,
          participant_name: claimRecord.participant.displayName,
          released_qty: claimRecord.quantity,
          remaining_qty: remainingQty,
        });

        await pushFeedEvent(session_id, {
          type: "unclaim",
          actor_name: claimRecord.participant.displayName,
          item_name: claimRecord.item.name,
          amount: undefined,
          claimant_count: undefined,
        });

        ack({ success: true });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to unclaim item";
        ack({ success: false, error: message });
      }
    });

    socket.on(
      "participant:checkout",
      async (payload: ParticipantCheckoutPayload, ack: (response: WsAckResponse) => void) => {
        try {
          const result = await checkoutParticipant(payload.participant_id);

          // Rebuild and cache state
          await buildAndCacheState(session_id);

          io.to(room).emit("participant:checkout", {
            participant_id: payload.participant_id,
            display_name: result.displayName,
            total: result.total,
          });

          await pushFeedEvent(session_id, {
            type: "checkout",
            actor_name: result.displayName,
            item_name: undefined,
            amount: result.total,
            claimant_count: undefined,
          });

          ack({
            success: true,
            data: result as unknown as Record<string, unknown>,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Failed to checkout";
          ack({ success: false, error: message });
        }
      }
    );

    // ─── Disconnect Handling ───────────────────────────────────

    socket.on("disconnect", () => {
      const timerKey = `${session_id}:${participant_id}`;

      // Start 60-second grace period
      const timer = setTimeout(async () => {
        disconnectTimers.delete(timerKey);

        // After grace period, broadcast that participant left
        io.to(room).emit("participant:left", {
          participant_id,
          display_name: participant.displayName,
        });

        await pushFeedEvent(session_id, {
          type: "participant_left",
          actor_name: participant.displayName,
          item_name: undefined,
          amount: undefined,
          claimant_count: undefined,
        });
      }, 60_000);

      disconnectTimers.set(timerKey, timer);
    });
  });

  // ─── 30-second State Consistency Check ──────────────────────

  setInterval(async () => {
    const rooms = io.sockets.adapter.rooms;

    for (const [roomId] of rooms) {
      if (!roomId.startsWith("session:")) continue;

      const sessionId = roomId.replace("session:", "");
      try {
        const state = await buildAndCacheState(sessionId);
        io.to(roomId).emit("state:sync", state);
      } catch (err) {
        // Session may have been deleted, skip
      }
    }
  }, 30_000);

  console.log("[Socket.IO] WebSocket server initialized");

  return io;
}
