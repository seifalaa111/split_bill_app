import type {
  ApiResponse,
  Session,
  BillItem,
  Participant,
  Claim,
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
