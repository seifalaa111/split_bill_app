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
  SessionClosedPayload,
  WsAckResponse,
  ClaimCreatePayload,
  ClaimDeletePayload,
  ParticipantCheckoutPayload,
} from "@splitcheck/shared";

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export type ConnectionStatus = "connected" | "disconnected" | "reconnecting";

interface SocketContextValue {
  socket: TypedSocket | null;
  status: ConnectionStatus;
  emitClaimCreate: (
    payload: ClaimCreatePayload
  ) => Promise<WsAckResponse>;
  emitClaimDelete: (
    payload: ClaimDeletePayload
  ) => Promise<WsAckResponse>;
  emitCheckout: (
    payload: ParticipantCheckoutPayload
  ) => Promise<WsAckResponse>;
  feedEvents: FeedEventPayload[];
}

const SocketContext = createContext<SocketContextValue>({
  socket: null,
  status: "disconnected",
  emitClaimCreate: () => Promise.resolve({ success: false, error: "Not connected" }),
  emitClaimDelete: () => Promise.resolve({ success: false, error: "Not connected" }),
  emitCheckout: () => Promise.resolve({ success: false, error: "Not connected" }),
  feedEvents: [],
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

  const {
    setSession,
    setItems,
    setParticipants,
    addParticipant,
    updateParticipant,
  } = useSessionStore();

  // Apply state:sync to Zustand store
  const applyStateSync = useCallback(
    (payload: StateSyncPayload) => {
      // Build the session object with items and participants attached
      const sessionWithData = {
        ...payload.session,
        status: payload.session.status as "DRAFT" | "OPEN" | "CLOSED",
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
          status: p.status as "BROWSING" | "CLAIMING" | "CHECKED_OUT",
        })),
      };
      setSession(sessionWithData);
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

    // ─── Server → Client Events ──────────────────────────

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
        avatarColor: payload.avatar_color,
      });
    });

    socket.on("participant:left", (_payload: ParticipantLeftPayload) => {
      // Don't remove — just informational for the feed
    });

    socket.on("participant:reconnected", (_payload: ParticipantReconnectedPayload) => {
      // Informational — state:sync handles rehydration
    });

    socket.on("item:claimed", (_payload: ItemClaimedPayload) => {
      // state:sync will follow with full state — no partial update needed
      // But we could do an optimistic partial update here if we wanted snappier UI
    });

    socket.on("item:unclaimed", (_payload: ItemUnclaimedPayload) => {
      // Same as above — state:sync will handle it
    });

    socket.on("item:updated", (_payload: ItemUpdatedPayload) => {
      // state:sync will follow
    });

    socket.on("item:deleted", (_payload: ItemDeletedPayload) => {
      // state:sync will follow
    });

    socket.on("participant:checkout", (payload: ParticipantCheckoutBroadcastPayload) => {
      updateParticipant({
        participantId: payload.participant_id,
        sessionId,
        displayName: payload.display_name,
        role: "GUEST",
        status: "CHECKED_OUT",
        subtotal: 0,
        taxShare: 0,
        serviceShare: 0,
        total: payload.total,
        joinedAt: "",
        checkedOutAt: new Date().toISOString(),
        avatarColor: "",
      });
    });

    socket.on("session:closed", (_payload: SessionClosedPayload) => {
      // Could show a modal or redirect
    });

    socket.on("feed:event", (payload: FeedEventPayload) => {
      setFeedEvents((prev) => [...prev, payload]);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setStatus("disconnected");
    };
  }, [sessionId, participantId, applyStateSync, addParticipant, updateParticipant]);

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

  const value: SocketContextValue = {
    socket: socketRef.current,
    status,
    emitClaimCreate,
    emitClaimDelete,
    emitCheckout,
    feedEvents,
  };

  return (
    <SocketContext.Provider value={value}>{children}</SocketContext.Provider>
  );
}
