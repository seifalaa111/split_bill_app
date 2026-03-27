/**
 * WebSocket Event Type Definitions
 *
 * All events follow the pattern `entity:action`.
 * Payloads are strictly typed — no `any` types.
 */

// ─── Client → Server Events ───────────────────────────────────────────

export interface ClaimCreatePayload {
  item_id: string;
  participant_id: string;
  quantity: number;
  is_shared: boolean;
}

export interface ClaimDeletePayload {
  claim_id: string;
  participant_id: string;
}

export interface ParticipantCheckoutPayload {
  participant_id: string;
}

export interface ParticipantSettlePayload {
  participant_id: string;
}

export interface DisputeCreatePayload {
  session_id: string;
  participant_id: string;
  reason: string;
}

export interface NudgeDismissPayload {
  nudge_id: string;
}

/** Events the client can emit to the server */
export interface ClientToServerEvents {
  "claim:create": (
    payload: ClaimCreatePayload,
    ack: (response: WsAckResponse) => void
  ) => void;
  "claim:delete": (
    payload: ClaimDeletePayload,
    ack: (response: WsAckResponse) => void
  ) => void;
  "participant:checkout": (
    payload: ParticipantCheckoutPayload,
    ack: (response: WsAckResponse) => void
  ) => void;
  "participant:settle": (
    payload: ParticipantSettlePayload,
    ack: (response: WsAckResponse) => void
  ) => void;
  "dispute:create": (
    payload: DisputeCreatePayload,
    ack: (response: WsAckResponse) => void
  ) => void;
  "nudge:dismiss": (
    payload: NudgeDismissPayload
  ) => void;
}

// ─── Server → Client Events ──────────────────────────────────────────

export interface ParticipantJoinedPayload {
  participant_id: string;
  display_name: string;
  role: string;
  avatar_color: string;
}

export interface ParticipantLeftPayload {
  participant_id: string;
  display_name: string;
}

export interface ParticipantReconnectedPayload {
  participant_id: string;
  display_name: string;
}

export interface ItemClaimedPayload {
  item_id: string;
  item_name: string;
  participant_id: string;
  participant_name: string;
  claimed_qty: number;
  remaining_qty: number;
}

export interface ItemUnclaimedPayload {
  item_id: string;
  item_name: string;
  participant_id: string;
  participant_name: string;
  released_qty: number;
  remaining_qty: number;
}

export interface ItemUpdatedPayload {
  item_id: string;
  changes: Record<string, unknown>;
}

export interface ItemDeletedPayload {
  item_id: string;
  item_name: string;
}

export interface ParticipantCheckoutBroadcastPayload {
  participant_id: string;
  display_name: string;
  total: number;
}

export interface SessionClosedPayload {
  session_id: string;
  reason: string;
}

export interface DisputeRaisedPayload {
  dispute_id: string;
  participant_id: string;
  participant_name: string;
  reason: string;
}

export interface DisputeResolvedPayload {
  dispute_id: string;
  participant_id: string;
  status: string;
  resolution_type: string;
  resolution_note: string | null;
  adjusted_total: number | null;
  rejected: boolean;
}

export interface ParticipantSettledPayload {
  participant_id: string;
  display_name: string;
}

export interface ParticipantStatusChangedPayload {
  participant_id: string;
  old_status: string;
  new_status: string;
}

export interface SessionStatusChangedPayload {
  old_status: string;
  new_status: string;
}

export interface NudgeShowPayload {
  nudge_id: string;
  message: string;
  priority: "low" | "medium" | "high";
}

export interface ItemReassignedPayload {
  item_id: string;
  item_name: string;
  participant_id: string;
  participant_name: string;
  action: "assign" | "split" | "absorb";
  amount_change: number;
}

export interface StateSyncPayload {
  session: SessionSnapshot;
  items: ItemSnapshot[];
  participants: ParticipantSnapshot[];
  claims: ClaimSnapshot[];
}

export interface FeedEventPayload {
  type: FeedEventType;
  actor_name: string;
  message: string;
  emoji: string;
  metadata: Record<string, unknown>;
  timestamp: number;
}

/** Events the server can emit to clients */
export interface ServerToClientEvents {
  "participant:joined": (payload: ParticipantJoinedPayload) => void;
  "participant:left": (payload: ParticipantLeftPayload) => void;
  "participant:reconnected": (payload: ParticipantReconnectedPayload) => void;
  "item:claimed": (payload: ItemClaimedPayload) => void;
  "item:unclaimed": (payload: ItemUnclaimedPayload) => void;
  "item:updated": (payload: ItemUpdatedPayload) => void;
  "item:deleted": (payload: ItemDeletedPayload) => void;
  "participant:checkout": (payload: ParticipantCheckoutBroadcastPayload) => void;
  "participant:settled": (payload: ParticipantSettledPayload) => void;
  "participant:status_changed": (payload: ParticipantStatusChangedPayload) => void;
  "session:status_changed": (payload: SessionStatusChangedPayload) => void;
  "session:closed": (payload: SessionClosedPayload) => void;
  "state:sync": (payload: StateSyncPayload) => void;
  "feed:event": (payload: FeedEventPayload) => void;
  "dispute:raised": (payload: DisputeRaisedPayload) => void;
  "dispute:resolved": (payload: DisputeResolvedPayload) => void;
  "nudge:show": (payload: NudgeShowPayload) => void;
  "item:reassigned": (payload: ItemReassignedPayload) => void;
}

// ─── Ack Response ─────────────────────────────────────────────────────

export interface WsAckResponse {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

// ─── State Snapshots (for state:sync) ────────────────────────────────

export interface SessionSnapshot {
  sessionId: string;
  sessionCode: string;
  billTotal: number;
  billSubtotal: number;
  taxPct: number;
  servicePct: number;
  taxAmount: number;
  serviceAmount: number;
  expectedHeadcount: number;
  status: string;
  createdAt: string;
  expiresAt: string;
  closedAt: string | null;
}

export interface ItemSnapshot {
  itemId: string;
  sessionId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  isShared: boolean;
  claimedQty: number;
  absorbedByHost: boolean;
  createdAt: string;
}

export interface ParticipantSnapshot {
  participantId: string;
  sessionId: string;
  displayName: string;
  role: string;
  status: string;
  subtotal: number;
  taxShare: number;
  serviceShare: number;
  total: number;
  joinedAt: string;
  checkedOutAt: string | null;
  settledAt: string | null;
  avatarColor: string;
}

export interface ClaimSnapshot {
  claimId: string;
  itemId: string;
  participantId: string;
  quantity: number;
  shareFraction: number;
  amount: number;
  createdAt: string;
  participantName: string;
}

// ─── Feed Event Types ────────────────────────────────────────────────

export type FeedEventType =
  | "join"
  | "claim"
  | "unclaim"
  | "checkout"
  | "host_edit"
  | "session_close"
  | "participant_left"
  | "participant_reconnected"
  | "dispute_raised"
  | "dispute_resolved"
  | "dispute_rejected"
  | "settled"
  | "progress_50"
  | "progress_almost"
  | "progress_complete"
  | "all_settled"
  | "item_reassigned"
  | "item_split"
  | "item_absorbed";

// ─── Socket.IO Connection Query ──────────────────────────────────────

export interface SocketConnectionQuery {
  session_id: string;
  participant_id: string;
}

// ─── Avatar Colors ───────────────────────────────────────────────────

export const AVATAR_COLORS = [
  "#FFB3BA",
  "#BAFFC9",
  "#BAE1FF",
  "#FFFFBA",
  "#E8BAFF",
  "#FFD4BA",
  "#BAF2FF",
  "#D4FFBA",
  "#FFC9DE",
  "#C9BAFF",
] as const;

export type AvatarColor = (typeof AVATAR_COLORS)[number];
