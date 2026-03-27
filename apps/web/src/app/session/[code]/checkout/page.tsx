"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckoutSummary } from "@/components/checkout-summary";
import { SocketWrapper } from "@/components/socket-wrapper";
import { useSessionStore } from "@/store/session-store";
import { useSocket } from "@/providers/socket-provider";
import * as api from "@/lib/api";
import { formatEgp } from "@/lib/utils";
import {
  calculatePersonalSubtotal,
  splitEqually,
  calculatePersonalTotal,
} from "@splitcheck/shared";

function CheckoutPageContent() {
  const router = useRouter();
  const params = useParams();
  const code = params.code as string;

  const {
    session,
    items,
    setSession,
    setItems,
    currentParticipant,
    updateParticipant,
  } = useSessionStore();

  const { status, emitCheckout } = useSocket();

  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [checkedOutData, setCheckedOutData] = useState<{
    subtotal: number;
    taxShare: number;
    serviceShare: number;
    total: number;
  } | null>(null);

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

  useEffect(() => {
    if (!pageLoading && !currentParticipant) {
      router.push(`/session/${code}`);
    }
  }, [pageLoading, currentParticipant, code, router]);

  if (pageLoading || !session || !currentParticipant) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading checkout...</p>
      </div>
    );
  }

  // Already checked out
  if (currentParticipant.status === "CHECKED_OUT" || confirmed) {
    const data = checkedOutData || {
      subtotal: currentParticipant.subtotal,
      taxShare: currentParticipant.taxShare,
      serviceShare: currentParticipant.serviceShare,
      total: currentParticipant.total,
    };

    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-6 text-center">
          <div className="space-y-2">
            <div className="text-4xl">✅</div>
            <h1 className="text-2xl font-bold">You&apos;re All Set!</h1>
            <p className="text-muted-foreground">
              {currentParticipant.displayName}, you owe
            </p>
            <p className="text-4xl font-bold">{formatEgp(data.total)}</p>
          </div>

          <Card>
            <CardContent className="pt-4">
              <CheckoutSummary
                claimedItems={getClaimedItems()}
                subtotal={data.subtotal}
                taxShare={data.taxShare}
                serviceShare={data.serviceShare}
                total={data.total}
              />
            </CardContent>
          </Card>

          <Button
            variant="outline"
            className="w-full"
            onClick={() => router.push("/")}
          >
            Done
          </Button>
        </div>
      </div>
    );
  }

  // Calculate preview totals
  const myClaims = items.flatMap((item) =>
    item.claims
      .filter((c) => c.participantId === currentParticipant.participantId)
      .map((c) => ({ ...c, itemName: item.name, isShared: item.isShared }))
  );

  if (myClaims.length === 0) {
    router.push(`/session/${code}/claim`);
    return null;
  }

  const mySubtotal = calculatePersonalSubtotal(myClaims.map((c) => c.amount));
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

  function getClaimedItems() {
    return items.flatMap((item) =>
      item.claims
        .filter((c) => c.participantId === currentParticipant!.participantId)
        .map((c) => ({
          name: item.name,
          amount: c.amount,
          isShared: item.isShared,
          quantity: c.quantity,
        }))
    );
  }

  async function handleConfirmCheckout() {
    setLoading(true);
    setError("");

    // Try WebSocket first
    if (status === "connected") {
      const result = await emitCheckout({
        participant_id: currentParticipant!.participantId,
      });

      if (!result.success) {
        setError(result.error || "Failed to checkout");
        setLoading(false);
        return;
      }

      const data = result.data as {
        subtotal: number;
        taxShare: number;
        serviceShare: number;
        total: number;
      } | undefined;

      if (data) {
        setCheckedOutData({
          subtotal: data.subtotal,
          taxShare: data.taxShare,
          serviceShare: data.serviceShare,
          total: data.total,
        });
      }
      setConfirmed(true);
      setLoading(false);
      return;
    }

    // REST fallback
    const result = await api.checkoutParticipant(
      currentParticipant!.participantId
    );

    if (!result.success || !result.data) {
      setError(result.error || "Failed to checkout");
      setLoading(false);
      return;
    }

    updateParticipant(result.data);
    setCheckedOutData({
      subtotal: result.data.subtotal,
      taxShare: result.data.taxShare,
      serviceShare: result.data.serviceShare,
      total: result.data.total,
    });
    setConfirmed(true);
    setLoading(false);
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-start px-4 pt-8 pb-28">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold">Review & Checkout</h1>
          <p className="text-sm text-muted-foreground">
            Confirm your items, {currentParticipant.displayName}
          </p>
        </div>

        <Card>
          <CardContent className="pt-4">
            <CheckoutSummary
              claimedItems={getClaimedItems()}
              subtotal={mySubtotal}
              taxShare={myTaxShare}
              serviceShare={myServiceShare}
              total={myTotal}
            />
          </CardContent>
        </Card>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button
          variant="ghost"
          className="w-full"
          onClick={() => router.push(`/session/${code}/claim`)}
        >
          ← Back to Items
        </Button>
      </div>

      {/* Fixed bottom bar */}
      <div className="fixed bottom-0 left-0 right-0 border-t bg-background p-4">
        <div className="mx-auto max-w-sm">
          <Button
            className="w-full h-12 text-base"
            onClick={handleConfirmCheckout}
            disabled={loading}
          >
            {loading ? "Processing..." : `Confirm Checkout — ${formatEgp(myTotal)}`}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <SocketWrapper>
      <CheckoutPageContent />
    </SocketWrapper>
  );
}
