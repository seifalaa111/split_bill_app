"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import { io, Socket } from "socket.io-client";
import { useSessionStore } from "@/store/session-store";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  StateSyncPayload,
  FeedEventPayload,
  ParticipantJoinedPayload,
  ParticipantLeftPayload,
  ParticipantReconnectedPayload,
  ItemClaimedPayload,
  ItemUnclaimedPayload,
  ItemUpdatedPayload,
  ItemDeletedPayload,
  ParticipantCheckoutBroadcastPayload,
  ParticipantSettledPayload,
  ParticipantStatusChangedPayload,
  SessionStatusChangedPayload,
  SessionClosedPayload,
  DisputeRaisedPayload,
  DisputeResolvedPayload,
  NudgeShowPayload,
  ItemReassignedPayload,
  WsAckResponse,
  ClaimCreatePayload,
  ClaimDeletePayload,
  ParticipantCheckoutPayload,
  ParticipantSettlePayload,
  DisputeCreatePayload,
} from "@splitcheck/shared";

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export type ConnectionStatus = "connected" | "disconnected" | "reconnecting";

interface SocketContextValue {
  socket: TypedSocket | null;
  status: ConnectionStatus;
  emitClaimCreate: (payload: ClaimCreatePayload) => Promise<WsAckResponse>;
  emitClaimDelete: (payload: ClaimDeletePayload) => Promise<WsAckResponse>;
  emitCheckout: (payload: ParticipantCheckoutPayload) => Promise<WsAckResponse>;
  emitSettle: (payload: ParticipantSettlePayload) => Promise<WsAckResponse>;
  emitDisputeCreate: (payload: DisputeCreatePayload) => Promise<WsAckResponse>;
  feedEvents: FeedEventPayload[];
  // Phase 3: dispute events for host
  disputeRaisedEvents: DisputeRaisedPayload[];
  // Phase 3: dispute resolution for guest
  lastDisputeResolution: DisputeResolvedPayload | null;
}

const SocketContext = createContext<SocketContextValue>({
  socket: null,
  status: "disconnected",
  emitClaimCreate: () => Promise.resolve({ success: false, error: "Not connected" }),
  emitClaimDelete: () => Promise.resolve({ success: false, error: "Not connected" }),
  emitCheckout: () => Promise.resolve({ success: false, error: "Not connected" }),
  emitSettle: () => Promise.resolve({ success: false, error: "Not connected" }),
  emitDisputeCreate: () => Promise.resolve({ success: false, error: "Not connected" }),
  feedEvents: [],
  disputeRaisedEvents: [],
  lastDisputeResolution: null,
});

export function useSocket() {
  return useContext(SocketContext);
}

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "http://localhost:3001";

interface SocketProviderProps {
  sessionId: string;
  participantId: string;
  children: React.ReactNode;
}

export function SocketProvider({
  sessionId,
  participantId,
  children,
}: SocketProviderProps) {
  const socketRef = useRef<TypedSocket | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [feedEvents, setFeedEvents] = useState<FeedEventPayload[]>([]);
  const [disputeRaisedEvents, setDisputeRaisedEvents] = useState<DisputeRaisedPayload[]>([]);
  const [lastDisputeResolution, setLastDisputeResolution] = useState<DisputeResolvedPayload | null>(null);

  const {
    setSession,
    setItems,
    setParticipants,
    addParticipant,
    updateParticipant,
    showNudge,
    clearNudge,
  } = useSessionStore();

  // Apply state:sync to Zustand store
  const applyStateSync = useCallback(
    (payload: StateSyncPayload) => {
      const sessionWithData = {
        ...payload.session,
        status: payload.session.status as string,
        items: payload.items.map((item) => ({
          ...item,
          claims: payload.claims
            .filter((c) => c.itemId === item.itemId)
            .map((c) => ({
              ...c,
              participantName:
                c.participantName ||
                payload.participants.find(
                  (p) => p.participantId === c.participantId
                )?.displayName ||
                "",
            })),
        })),
        participants: payload.participants.map((p) => ({
          ...p,
          role: p.role as "HOST" | "GUEST",
          status: p.status as string,
        })),
      };
      setSession(sessionWithData as Parameters<typeof setSession>[0]);
    },
    [setSession]
  );

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    if (!sessionId || !participantId) return;

    const socket: TypedSocket = io(WS_URL, {
      query: {
        session_id: sessionId,
        participant_id: participantId,
      },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socketRef.current = socket;

    // ─── Connection Lifecycle ─────────────────────────────

    socket.on("connect", () => {
      setStatus("connected");
    });

    socket.on("disconnect", () => {
      setStatus("reconnecting");
    });

    socket.io.on("reconnect_attempt", () => {
      setStatus("reconnecting");
    });

    socket.io.on("reconnect", () => {
      setStatus("connected");
    });

    socket.io.on("reconnect_failed", () => {
      setStatus("disconnected");
    });

    // ─── Server → Client Events (Phase 1/2) ──────────────

    socket.on("state:sync", (payload: StateSyncPayload) => {
      applyStateSync(payload);
    });

    socket.on("participant:joined", (payload: ParticipantJoinedPayload) => {
      addParticipant({
        participantId: payload.participant_id,
        sessionId,
        displayName: payload.display_name,
        role: payload.role as "HOST" | "GUEST",
        status: "BROWSING",
        subtotal: 0,
        taxShare: 0,
        serviceShare: 0,
        total: 0,
        joinedAt: new Date().toISOString(),
        checkedOutAt: null,
        settledAt: null,
        avatarColor: payload.avatar_color,
      });
    });

    socket.on("participant:left", (_payload: ParticipantLeftPayload) => {
      // Informational — don't remove participant
    });

    socket.on("participant:reconnected", (_payload: ParticipantReconnectedPayload) => {
      // state:sync handles rehydration
    });

    socket.on("item:claimed", (_payload: ItemClaimedPayload) => {
      // state:sync will follow
    });

    socket.on("item:unclaimed", (_payload: ItemUnclaimedPayload) => {
      // state:sync will follow
    });

    socket.on("item:updated", (_payload: ItemUpdatedPayload) => {
      // state:sync will follow
    });

    socket.on("item:deleted", (_payload: ItemDeletedPayload) => {
      // state:sync will follow
    });

    socket.on("participant:checkout", (_payload: ParticipantCheckoutBroadcastPayload) => {
      // state:sync will follow with full updated state
    });

    socket.on("session:closed", (_payload: SessionClosedPayload) => {
      // state:sync will follow
    });

    socket.on("feed:event", (payload: FeedEventPayload) => {
      setFeedEvents((prev) => [...prev, payload]);
    });

    // ─── Server → Client Events (Phase 3) ─────────────────

    socket.on("participant:settled", (_payload: ParticipantSettledPayload) => {
      // state:sync will follow
    });

    socket.on("participant:status_changed", (_payload: ParticipantStatusChangedPayload) => {
      // state:sync will follow
    });

    socket.on("session:status_changed", (_payload: SessionStatusChangedPayload) => {
      // state:sync will follow
    });

    socket.on("dispute:raised", (payload: DisputeRaisedPayload) => {
      setDisputeRaisedEvents((prev) => [...prev, payload]);
    });

    socket.on("dispute:resolved", (payload: DisputeResolvedPayload) => {
      setLastDisputeResolution(payload);
    });

    socket.on("nudge:show", (payload: NudgeShowPayload) => {
      showNudge(payload);
    });

    socket.on("item:reassigned", (_payload: ItemReassignedPayload) => {
      // state:sync will follow
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setStatus("disconnected");
    };
  }, [sessionId, participantId, applyStateSync, addParticipant, updateParticipant, showNudge, clearNudge]);

  // ─── Emit Helpers (with ack) ──────────────────────────────

  const emitClaimCreate = useCallback(
    (payload: ClaimCreatePayload): Promise<WsAckResponse> => {
      return new Promise((resolve) => {
        const socket = socketRef.current;
        if (!socket?.connected) {
          resolve({ success: false, error: "Not connected" });
          return;
        }
        socket.emit("claim:create", payload, (response: WsAckResponse) => {
          resolve(response);
        });
      });
    },
    []
  );

  const emitClaimDelete = useCallback(
    (payload: ClaimDeletePayload): Promise<WsAckResponse> => {
      return new Promise((resolve) => {
        const socket = socketRef.current;
        if (!socket?.connected) {
          resolve({ success: false, error: "Not connected" });
          return;
        }
        socket.emit("claim:delete", payload, (response: WsAckResponse) => {
          resolve(response);
        });
      });
    },
    []
  );

  const emitCheckout = useCallback(
    (payload: ParticipantCheckoutPayload): Promise<WsAckResponse> => {
      return new Promise((resolve) => {
        const socket = socketRef.current;
        if (!socket?.connected) {
          resolve({ success: false, error: "Not connected" });
          return;
        }
        socket.emit("participant:checkout", payload, (response: WsAckResponse) => {
          resolve(response);
        });
      });
    },
    []
  );

  const emitSettle = useCallback(
    (payload: ParticipantSettlePayload): Promise<WsAckResponse> => {
      return new Promise((resolve) => {
        const socket = socketRef.current;
        if (!socket?.connected) {
          resolve({ success: false, error: "Not connected" });
          return;
        }
        socket.emit("participant:settle", payload, (response: WsAckResponse) => {
          resolve(response);
        });
      });
    },
    []
  );

  const emitDisputeCreate = useCallback(
    (payload: DisputeCreatePayload): Promise<WsAckResponse> => {
      return new Promise((resolve) => {
        const socket = socketRef.current;
        if (!socket?.connected) {
          resolve({ success: false, error: "Not connected" });
          return;
        }
        socket.emit("dispute:create", payload, (response: WsAckResponse) => {
          resolve(response);
        });
      });
    },
    []
  );

  const value: SocketContextValue = {
    socket: socketRef.current,
    status,
    emitClaimCreate,
    emitClaimDelete,
    emitCheckout,
    emitSettle,
    emitDisputeCreate,
    feedEvents,
    disputeRaisedEvents,
    lastDisputeResolution,
  };

  return (
    <SocketContext.Provider value={value}>{children}</SocketContext.Provider>
  );
}
