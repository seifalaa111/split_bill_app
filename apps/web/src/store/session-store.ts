"use client";

import { create } from "zustand";
import type {
  Session,
  BillItem,
  Participant,
  Claim,
  BillItemWithClaims,
  NudgePayload,
} from "@splitcheck/shared";

interface SessionState {
  // Session data
  session: (Session & { items?: BillItemWithClaims[]; participants?: Participant[] }) | null;
  items: BillItemWithClaims[];
  participants: Participant[];
  currentParticipant: Participant | null;

  // Phase 3: Nudges
  activeNudge: NudgePayload | null;
  dismissedNudges: Set<string>;

  // Actions
  setSession: (session: Session & { items?: BillItemWithClaims[]; participants?: Participant[] }) => void;
  setItems: (items: BillItemWithClaims[]) => void;
  setParticipants: (participants: Participant[]) => void;
  setCurrentParticipant: (participant: Participant | null) => void;
  addItem: (item: BillItem) => void;
  removeItem: (itemId: string) => void;
  updateItem: (item: BillItem) => void;
  addParticipant: (participant: Participant) => void;
  updateParticipant: (participant: Participant) => void;

  // Optimistic updates
  optimisticClaim: (itemId: string, participantId: string, quantity: number, isShared: boolean) => void;
  rollbackClaim: (itemId: string, participantId: string) => void;
  optimisticUnclaim: (claimId: string, itemId: string) => void;

  // Nudge actions
  showNudge: (nudge: NudgePayload) => void;
  dismissNudge: (nudgeId: string) => void;
  clearNudge: () => void;

  reset: () => void;
}

const initialState = {
  session: null,
  items: [],
  participants: [],
  currentParticipant: null,
  activeNudge: null,
  dismissedNudges: new Set<string>(),
};

export const useSessionStore = create<SessionState>((set) => ({
  ...initialState,

  setSession: (session) =>
    set((state) => {
      // Preserve currentParticipant if it exists in the new participant list
      let updatedCurrentParticipant = state.currentParticipant;
      if (updatedCurrentParticipant && session.participants) {
        const found = session.participants.find(
          (p) => p.participantId === updatedCurrentParticipant!.participantId
        );
        if (found) {
          updatedCurrentParticipant = found;
        }
      }

      return {
        session,
        items: session.items ?? [],
        participants: session.participants ?? [],
        currentParticipant: updatedCurrentParticipant,
      };
    }),

  setItems: (items) => set({ items }),

  setParticipants: (participants) => set({ participants }),

  setCurrentParticipant: (participant) =>
    set({ currentParticipant: participant }),

  addItem: (item) =>
    set((state) => ({
      items: [...state.items, { ...item, claims: [] }],
    })),

  removeItem: (itemId) =>
    set((state) => ({
      items: state.items.filter((i) => i.itemId !== itemId),
    })),

  updateItem: (item) =>
    set((state) => ({
      items: state.items.map((i) =>
        i.itemId === item.itemId ? { ...item, claims: i.claims } : i
      ),
    })),

  addParticipant: (participant) =>
    set((state) => {
      const exists = state.participants.some(
        (p) => p.participantId === participant.participantId
      );
      if (exists) return state;
      return {
        participants: [...state.participants, participant],
      };
    }),

  updateParticipant: (participant) =>
    set((state) => ({
      participants: state.participants.map((p) =>
        p.participantId === participant.participantId
          ? { ...p, ...participant }
          : p
      ),
      currentParticipant:
        state.currentParticipant?.participantId === participant.participantId
          ? { ...state.currentParticipant, ...participant }
          : state.currentParticipant,
    })),

  optimisticClaim: (itemId, participantId, quantity, isShared) =>
    set((state) => {
      const items = state.items.map((item) => {
        if (item.itemId !== itemId) return item;

        const tempClaim = {
          claimId: `temp-${Date.now()}`,
          itemId,
          participantId,
          quantity: isShared ? 1 : quantity,
          shareFraction: 1,
          amount: 0,
          createdAt: new Date().toISOString(),
          participantName: state.currentParticipant?.displayName ?? "",
        };

        return {
          ...item,
          claims: [...item.claims, tempClaim],
          claimedQty: item.claimedQty + (isShared ? 1 : quantity),
        };
      });

      return { items };
    }),

  rollbackClaim: (itemId, participantId) =>
    set((state) => {
      const items = state.items.map((item) => {
        if (item.itemId !== itemId) return item;

        const removedClaim = item.claims.find(
          (c) => c.participantId === participantId && c.claimId.startsWith("temp-")
        );
        if (!removedClaim) return item;

        return {
          ...item,
          claims: item.claims.filter((c) => c !== removedClaim),
          claimedQty: Math.max(0, item.claimedQty - removedClaim.quantity),
        };
      });

      return { items };
    }),

  optimisticUnclaim: (claimId, itemId) =>
    set((state) => {
      const items = state.items.map((item) => {
        if (item.itemId !== itemId) return item;

        const claim = item.claims.find((c) => c.claimId === claimId);
        if (!claim) return item;

        return {
          ...item,
          claims: item.claims.filter((c) => c.claimId !== claimId),
          claimedQty: Math.max(0, item.claimedQty - claim.quantity),
        };
      });

      return { items };
    }),

  // Nudge actions
  showNudge: (nudge) =>
    set((state) => {
      if (state.dismissedNudges.has(nudge.nudge_id)) {
        return state; // Already dismissed — don't show again
      }
      return { activeNudge: nudge };
    }),

  dismissNudge: (nudgeId) =>
    set((state) => {
      const newDismissed = new Set(state.dismissedNudges);
      newDismissed.add(nudgeId);
      return {
        activeNudge:
          state.activeNudge?.nudge_id === nudgeId ? null : state.activeNudge,
        dismissedNudges: newDismissed,
      };
    }),

  clearNudge: () => set({ activeNudge: null }),

  reset: () => set(initialState),
}));
