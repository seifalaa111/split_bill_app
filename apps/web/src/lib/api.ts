import type {
  ApiResponse,
  Session,
  BillItem,
  Participant,
  Claim,
  Dispute,
  CreateSessionRequest,
  AddItemRequest,
  UpdateItemRequest,
  JoinSessionRequest,
  ClaimItemRequest,
  UpdateSessionRequest,
  SessionSummary,
  BillItemWithClaims,
} from "@splitcheck/shared";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<ApiResponse<T>> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
    },
    ...options,
  });

  const data: ApiResponse<T> = await response.json();
  return data;
}

// Sessions
export async function createSession(
  input: CreateSessionRequest
): Promise<ApiResponse<Session>> {
  return apiFetch<Session>("/api/sessions", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getSessionByCode(
  code: string
): Promise<ApiResponse<Session & { items: BillItemWithClaims[]; participants: Participant[] }>> {
  return apiFetch(`/api/sessions/${code}`);
}

export async function updateSession(
  sessionId: string,
  input: UpdateSessionRequest & { hostDisplayName?: string }
): Promise<ApiResponse<Session>> {
  return apiFetch<Session>(`/api/sessions/${sessionId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function getSessionSummary(
  sessionId: string
): Promise<ApiResponse<SessionSummary>> {
  return apiFetch<SessionSummary>(`/api/sessions/${sessionId}/summary`);
}

// Items
export async function addItem(
  sessionId: string,
  input: AddItemRequest
): Promise<ApiResponse<BillItem>> {
  return apiFetch<BillItem>(`/api/sessions/${sessionId}/items`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getSessionItems(
  sessionId: string
): Promise<ApiResponse<BillItemWithClaims[]>> {
  return apiFetch<BillItemWithClaims[]>(`/api/sessions/${sessionId}/items`);
}

export async function updateItem(
  itemId: string,
  input: UpdateItemRequest
): Promise<ApiResponse<BillItem>> {
  return apiFetch<BillItem>(`/api/items/${itemId}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function deleteItem(
  itemId: string
): Promise<ApiResponse<{ deleted: boolean }>> {
  return apiFetch<{ deleted: boolean }>(`/api/items/${itemId}`, {
    method: "DELETE",
  });
}

// Participants
export async function joinSession(
  sessionId: string,
  input: JoinSessionRequest
): Promise<ApiResponse<Participant>> {
  return apiFetch<Participant>(`/api/sessions/${sessionId}/join`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// Claims
export async function claimItem(
  itemId: string,
  input: ClaimItemRequest
): Promise<ApiResponse<Claim>> {
  return apiFetch<Claim>(`/api/items/${itemId}/claim`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function unclaimItem(
  claimId: string
): Promise<ApiResponse<{ deleted: boolean }>> {
  return apiFetch<{ deleted: boolean }>(`/api/claims/${claimId}`, {
    method: "DELETE",
  });
}

// Checkout
export async function checkoutParticipant(
  participantId: string
): Promise<ApiResponse<Participant>> {
  return apiFetch<Participant>(`/api/participants/${participantId}/checkout`, {
    method: "POST",
  });
}

// Settlement
export async function settleParticipant(
  participantId: string
): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch(`/api/participants/${participantId}/settle`, {
    method: "POST",
  });
}

// Disputes
export async function createDispute(input: {
  session_id: string;
  participant_id: string;
  reason: string;
}): Promise<ApiResponse<Dispute>> {
  return apiFetch<Dispute>("/api/disputes", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getSessionDisputes(
  sessionId: string
): Promise<ApiResponse<(Dispute & { participantName: string })[]>> {
  return apiFetch(`/api/sessions/${sessionId}/disputes`);
}

export async function getParticipantDisputes(
  participantId: string
): Promise<ApiResponse<Dispute[]>> {
  return apiFetch(`/api/participants/${participantId}/disputes`);
}

export async function resolveDispute(
  disputeId: string,
  input: {
    status: "RESOLVED" | "REJECTED";
    resolution_type: "ADJUST" | "REJECT" | "OVERRIDE";
    resolution_note?: string;
    adjusted_total?: number;
  }
): Promise<ApiResponse<Dispute>> {
  return apiFetch<Dispute>(`/api/disputes/${disputeId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

// Reallocation
export async function assignItem(
  itemId: string,
  participantId: string
): Promise<ApiResponse<{ item_name: string; assigned_to: string; amount: number }>> {
  return apiFetch(`/api/items/${itemId}/assign`, {
    method: "POST",
    body: JSON.stringify({ participant_id: participantId }),
  });
}

export async function splitItemEqually(
  itemId: string
): Promise<ApiResponse<{ item_name: string; per_person: number; total_cost: number }>> {
  return apiFetch(`/api/items/${itemId}/split-equally`, {
    method: "POST",
  });
}

export async function absorbItem(
  itemId: string
): Promise<ApiResponse<{ item_name: string; absorbed: boolean }>> {
  return apiFetch(`/api/items/${itemId}/absorb`, {
    method: "POST",
  });
}
