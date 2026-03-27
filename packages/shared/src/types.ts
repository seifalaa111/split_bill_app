import {
  SessionStatus,
  ParticipantRole,
  ParticipantStatus,
  DisputeStatus,
  ResolutionType,
  NudgePriority,
} from "./constants";

export interface Session {
  sessionId: string;
  sessionCode: string;
  billTotal: number;
  billSubtotal: number;
  taxPct: number;
  servicePct: number;
  taxAmount: number;
  serviceAmount: number;
  expectedHeadcount: number;
  status: SessionStatus;
  createdAt: string;
  expiresAt: string;
  closedAt: string | null;
}

export interface BillItem {
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

export interface Participant {
  participantId: string;
  sessionId: string;
  displayName: string;
  role: ParticipantRole;
  status: ParticipantStatus;
  subtotal: number;
  taxShare: number;
  serviceShare: number;
  total: number;
  joinedAt: string;
  checkedOutAt: string | null;
  settledAt: string | null;
  avatarColor: string;
}

export interface Claim {
  claimId: string;
  itemId: string;
  participantId: string;
  quantity: number;
  shareFraction: number;
  amount: number;
  createdAt: string;
}

// ─── Dispute Types ──────────────────────────────────────────────────

export interface Dispute {
  disputeId: string;
  sessionId: string;
  participantId: string;
  reason: string;
  status: DisputeStatus;
  resolutionNote: string | null;
  resolutionType: ResolutionType | null;
  originalTotal: number;
  adjustedTotal: number | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface CreateDisputeRequest {
  session_id: string;
  participant_id: string;
  reason: string;
}

export interface ResolveDisputeRequest {
  status: "RESOLVED" | "REJECTED";
  resolution_type: ResolutionType;
  resolution_note?: string;
  adjusted_total?: number;
}

// ─── Nudge Types ────────────────────────────────────────────────────

export interface NudgePayload {
  nudge_id: string;
  message: string;
  priority: NudgePriority;
}

// ─── Reallocation Types ─────────────────────────────────────────────

export interface AssignItemRequest {
  participant_id: string;
}

// ─── API Types ──────────────────────────────────────────────────────

export interface CreateSessionRequest {
  billTotal: number;
  taxPct: number;
  servicePct: number;
  expectedHeadcount: number;
}

export interface AddItemRequest {
  name: string;
  quantity: number;
  unitPrice: number;
  isShared: boolean;
}

export interface UpdateItemRequest {
  name?: string;
  quantity?: number;
  unitPrice?: number;
  isShared?: boolean;
}

export interface JoinSessionRequest {
  displayName: string;
}

export interface ClaimItemRequest {
  participantId: string;
  quantity: number;
  isShared: boolean;
}

export interface UpdateSessionRequest {
  status?: SessionStatus;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface SessionSummary {
  session: Session;
  items: BillItemWithClaims[];
  participants: Participant[];
  totalClaimed: number;
  totalRemaining: number;
  checkoutCount: number;
  roundingDifference: number;
}

export interface BillItemWithClaims extends BillItem {
  claims: ClaimWithParticipant[];
}

export interface ClaimWithParticipant extends Claim {
  participantName: string;
}
