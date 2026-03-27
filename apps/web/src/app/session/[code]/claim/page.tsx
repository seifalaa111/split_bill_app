"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useSessionStore } from "@/store/session-store";
import { useSocket } from "@/providers/socket-provider";
import { SocketWrapper } from "@/components/socket-wrapper";
import { ActivityFeedGuest } from "@/components/activity-feed-guest";
import { NudgeBanner } from "@/components/nudge-banner";
import { ItemCard } from "@/components/item-card";
import * as api from "@/lib/api";
import { formatEgp } from "@/lib/utils";
import {
  calculatePersonalSubtotal,
  splitEqually,
  calculatePersonalTotal,
} from "@splitcheck/shared";

function ClaimPageContent() {
  const router = useRouter();
  const params = useParams();
  const code = params.code as string;

  const {
    session,
    items,
    setSession,
    setItems,
    currentParticipant,
    optimisticClaim,
    rollbackClaim,
    optimisticUnclaim,
  } = useSessionStore();

  const { status, emitClaimCreate, emitClaimDelete } = useSocket();

  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState("");

  const loadSession = useCallback(async () => {
    const result = await api.getSessionByCode(code);
    if (result.success && result.data) {
      setSession(result.data);
      setItems(result.data.items ?? []);
    }
    setPageLoading(false);
  }, [code, setSession, setItems]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  // Redirect if no participant set
  useEffect(() => {
    if (!pageLoading && !currentParticipant) {
      router.push(`/session/${code}`);
    }
  }, [pageLoading, currentParticipant, code, router]);

  async function handleClaim(
    itemId: string,
    quantity: number,
    isShared: boolean
  ) {
    if (!currentParticipant) return;
    setError("");

    // Optimistic update
    optimisticClaim(itemId, currentParticipant.participantId, quantity, isShared);

    // Try WebSocket first
    if (status === "connected") {
      const result = await emitClaimCreate({
        item_id: itemId,
        participant_id: currentParticipant.participantId,
        quantity,
        is_shared: isShared,
      });

      if (!result.success) {
        // Rollback optimistic update
        rollbackClaim(itemId, currentParticipant.participantId);
        setError(result.error || "This item was just claimed by someone else");
        return;
      }
      // state:sync from server will reconcile the full state
      return;
    }

    // REST fallback
    setLoading(true);
    const result = await api.claimItem(itemId, {
      participantId: currentParticipant.participantId,
      quantity,
      isShared,
    });

    if (!result.success) {
      rollbackClaim(itemId, currentParticipant.participantId);
      setError(result.error || "Failed to claim item");
      setLoading(false);
      return;
    }

    await loadSession();
    setLoading(false);
  }

  async function handleUnclaim(claimId: string) {
    if (!currentParticipant) return;
    setError("");

    // Find the item this claim belongs to
    const item = items.find((i) => i.claims.some((c) => c.claimId === claimId));
    if (!item) return;

    // Optimistic update
    optimisticUnclaim(claimId, item.itemId);

    // Try WebSocket first
    if (status === "connected") {
      const result = await emitClaimDelete({
        claim_id: claimId,
        participant_id: currentParticipant.participantId,
      });

      if (!result.success) {
        // Reload to fix state
        await loadSession();
        setError(result.error || "Failed to unclaim item");
        return;
      }
      return;
    }

    // REST fallback
    setLoading(true);
    const result = await api.unclaimItem(claimId);
    if (!result.success) {
      await loadSession();
      setError(result.error || "Failed to unclaim item");
      setLoading(false);
      return;
    }

    await loadSession();
    setLoading(false);
  }

  if (pageLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading items...</p>
      </div>
    );
  }

  if (!session || !currentParticipant) return null;

  // Calculate running personal total
  const myClaims = items.flatMap((item) =>
    item.claims.filter(
      (c) => c.participantId === currentParticipant.participantId
    )
  );
  const mySubtotal = calculatePersonalSubtotal(
    myClaims.map((c) => c.amount)
  );

  const participantCount = session.participants?.length ?? 1;
  const taxShares = splitEqually(session.taxAmount, participantCount);
  const serviceShares = splitEqually(session.serviceAmount, participantCount);

  const sortedParticipants = [...(session.participants ?? [])].sort((a, b) => {
    if (a.role === "HOST") return -1;
    if (b.role === "HOST") return 1;
    return new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime();
  });
  const myIndex = sortedParticipants.findIndex(
    (p) => p.participantId === currentParticipant.participantId
  );

  const myTaxShare = taxShares[myIndex] ?? 0;
  const myServiceShare = serviceShares[myIndex] ?? 0;
  const myTotal = calculatePersonalTotal(mySubtotal, myTaxShare, myServiceShare);

  const hasAnyClaims = myClaims.length > 0;

  return (
    <div className="flex min-h-screen flex-col items-center justify-start px-4 pt-8 pb-36">
      <div className="w-full max-w-sm space-y-4">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold">Claim Your Items</h1>
          <p className="text-sm text-muted-foreground">
            Tap items you had — {currentParticipant.displayName}
          </p>
        </div>

        {/* Nudge Banner */}
        <NudgeBanner />

        {/* Activity Feed */}
        <ActivityFeedGuest />

        {error && <p className="text-sm text-destructive">{error}</p>}

        {/* Item list */}
        <div className="space-y-2">
          {items.map((item) => (
            <ItemCard
              key={item.itemId}
              item={item}
              participantId={currentParticipant.participantId}
              onClaim={handleClaim}
              onUnclaim={handleUnclaim}
              loading={loading}
            />
          ))}
        </div>
      </div>

      {/* Fixed bottom bar with running total */}
      <div className="fixed bottom-0 left-0 right-0 border-t bg-background p-4 space-y-2">
        <div className="mx-auto max-w-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">Your Total</span>
            <span className="text-lg font-bold">{formatEgp(myTotal)}</span>
          </div>
          <Button
            className="w-full h-12 text-base"
            onClick={() => router.push(`/session/${code}/checkout`)}
            disabled={!hasAnyClaims}
          >
            {hasAnyClaims ? "Checkout" : "Claim at least 1 item"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function ClaimPage() {
  return (
    <SocketWrapper>
      <ClaimPageContent />
    </SocketWrapper>
  );
}
