"use client";

import { create } from "zustand";
import type {
  Session,
  BillItem,
  Participant,
  Claim,
  BillItemWithClaims,
} from "@splitcheck/shared";

interface SessionState {
  // Session data
  session: (Session & { items?: BillItemWithClaims[]; participants?: Participant[] }) | null;
  items: BillItemWithClaims[];
  participants: Participant[];
  currentParticipant: Participant | null;

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
  reset: () => void;
}

const initialState = {
  session: null,
  items: [],
  participants: [],
  currentParticipant: null,
};

export const useSessionStore = create<SessionState>((set) => ({
  ...initialState,

  setSession: (session) =>
    set({
      session,
      items: session.items ?? [],
      participants: session.participants ?? [],
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
    set((state) => ({
      participants: [...state.participants, participant],
    })),

  updateParticipant: (participant) =>
    set((state) => ({
      participants: state.participants.map((p) =>
        p.participantId === participant.participantId ? participant : p
      ),
      currentParticipant:
        state.currentParticipant?.participantId === participant.participantId
          ? participant
          : state.currentParticipant,
    })),

  reset: () => set(initialState),
}));
