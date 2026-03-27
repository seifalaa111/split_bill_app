"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckoutSummary } from "@/components/checkout-summary";
import { NudgeBanner } from "@/components/nudge-banner";
import { SocketWrapper } from "@/components/socket-wrapper";
import { useSessionStore } from "@/store/session-store";
import { useSocket } from "@/providers/socket-provider";
import * as api from "@/lib/api";
import { formatEgp } from "@/lib/utils";
import {
  calculatePersonalSubtotal,
  splitEqually,
  calculatePersonalTotal,
  MAX_DISPUTES_PER_PARTICIPANT,
} from "@splitcheck/shared";

const DISPUTE_SUGGESTIONS = [
  "I didn't eat this item",
  "The price is wrong",
  "I shared this with someone",
  "Other",
];

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

  const { status, emitCheckout, emitSettle, emitDisputeCreate, lastDisputeResolution } = useSocket();

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

  // Dispute state
  const [showDisputeForm, setShowDisputeForm] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeSubmitting, setDisputeSubmitting] = useState(false);
  const [disputeSubmitted, setDisputeSubmitted] = useState(false);
  const [disputeCount, setDisputeCount] = useState(0);
  const [disputeError, setDisputeError] = useState("");

  // Settlement state
  const [showSettleConfirm, setShowSettleConfirm] = useState(false);
  const [settleLoading, setSettleLoading] = useState(false);

  // Dispute resolution received from host
  const [resolutionMessage, setResolutionMessage] = useState("");

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

  // Load dispute count for this participant
  useEffect(() => {
    if (currentParticipant && session) {
      api.getParticipantDisputes(currentParticipant.participantId).then((res) => {
        if (res.success && res.data) {
          setDisputeCount(res.data.length);
        }
      });
    }
  }, [currentParticipant, session]);

  // Handle dispute resolution from host (via WebSocket)
  useEffect(() => {
    if (lastDisputeResolution && currentParticipant) {
      if (lastDisputeResolution.participant_id === currentParticipant.participantId) {
        setDisputeSubmitted(false);
        if (lastDisputeResolution.rejected) {
          setResolutionMessage(
            `The host reviewed your dispute: ${lastDisputeResolution.resolution_note || "Original total confirmed."}. You can accept this total or dispute again.`
          );
        } else {
          setResolutionMessage(
            `The host has updated your total${lastDisputeResolution.adjusted_total ? ` to ${formatEgp(lastDisputeResolution.adjusted_total)}` : ""}.`
          );
        }
        setDisputeCount((prev) => prev); // Count was already incremented server-side
        loadSession(); // Reload to get updated data
      }
    }
  }, [lastDisputeResolution, currentParticipant, loadSession]);

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

  const pStatus = currentParticipant.status;
  const canDispute =
    (pStatus === "REVIEWING" || pStatus === "CHECKED_OUT") &&
    disputeCount < MAX_DISPUTES_PER_PARTICIPANT;

  // ─── SETTLED State ────────────────────────────────────────
  if (pStatus === "SETTLED") {
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
              {currentParticipant.displayName}, you paid
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
          <Button variant="outline" className="w-full" onClick={() => router.push("/")}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  // ─── DISPUTED State (waiting for host) ────────────────────
  if (pStatus === "DISPUTED" || disputeSubmitted) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-6 text-center">
          <div className="space-y-2">
            <div className="text-4xl">⏳</div>
            <h1 className="text-2xl font-bold">Dispute Submitted</h1>
            <p className="text-muted-foreground">
              Waiting for the host to review your dispute.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ─── CHECKED_OUT State (can settle or dispute) ────────────
  if (pStatus === "CHECKED_OUT" || confirmed) {
    const data = checkedOutData || {
      subtotal: currentParticipant.subtotal,
      taxShare: currentParticipant.taxShare,
      serviceShare: currentParticipant.serviceShare,
      total: currentParticipant.total,
    };

    return (
      <div className="flex min-h-screen flex-col items-center justify-start px-4 pt-8 pb-28">
        <div className="w-full max-w-sm space-y-6">
          <NudgeBanner />

          {resolutionMessage && (
            <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
              {resolutionMessage}
              <button
                className="block mt-1 text-xs underline"
                onClick={() => setResolutionMessage("")}
              >
                Dismiss
              </button>
            </div>
          )}

          <div className="text-center space-y-2">
            <div className="text-4xl">✅</div>
            <h1 className="text-2xl font-bold">Checked Out</h1>
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

          {/* Settlement Confirmation */}
          {showSettleConfirm ? (
            <Card>
              <CardContent className="pt-4 space-y-3 text-center">
                <p className="text-sm font-medium">
                  Confirm that you&apos;ve paid {formatEgp(data.total)}?
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setShowSettleConfirm(false)}
                    disabled={settleLoading}
                  >
                    Not Yet
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={handleSettle}
                    disabled={settleLoading}
                  >
                    {settleLoading ? "..." : "Yes, I've Paid"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Button
              className="w-full h-12 text-base bg-amber-500 hover:bg-amber-600 text-white"
              onClick={() => setShowSettleConfirm(true)}
            >
              I&apos;ve Paid 💰
            </Button>
          )}

          {/* Dispute Button */}
          {canDispute && !showDisputeForm && (
            <button
              className="w-full text-sm text-muted-foreground underline hover:text-foreground transition-colors"
              onClick={() => setShowDisputeForm(true)}
            >
              Something doesn&apos;t look right
            </button>
          )}

          {disputeCount >= MAX_DISPUTES_PER_PARTICIPANT && (
            <p className="text-xs text-muted-foreground text-center">
              You&apos;ve reached the dispute limit. Contact the host directly.
            </p>
          )}

          {/* Dispute Form */}
          {showDisputeForm && renderDisputeForm()}
        </div>
      </div>
    );
  }

  // ─── REVIEWING / Pre-checkout State ───────────────────────

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

  async function handleSettle() {
    setSettleLoading(true);

    if (status === "connected") {
      const result = await emitSettle({
        participant_id: currentParticipant!.participantId,
      });

      if (!result.success) {
        setError(result.error || "Failed to settle");
      }
      setSettleLoading(false);
      setShowSettleConfirm(false);
      return;
    }

    // REST fallback
    const result = await api.settleParticipant(currentParticipant!.participantId);
    if (!result.success) {
      setError(result.error || "Failed to settle");
    }
    setSettleLoading(false);
    setShowSettleConfirm(false);
  }

  async function handleSubmitDispute() {
    if (!disputeReason.trim()) {
      setDisputeError("Please enter a reason");
      return;
    }

    setDisputeSubmitting(true);
    setDisputeError("");

    if (status === "connected") {
      const result = await emitDisputeCreate({
        session_id: session!.sessionId,
        participant_id: currentParticipant!.participantId,
        reason: disputeReason.trim(),
      });

      if (!result.success) {
        setDisputeError(result.error || "Failed to submit dispute");
        setDisputeSubmitting(false);
        return;
      }
    } else {
      const result = await api.createDispute({
        session_id: session!.sessionId,
        participant_id: currentParticipant!.participantId,
        reason: disputeReason.trim(),
      });

      if (!result.success) {
        setDisputeError(result.error || "Failed to submit dispute");
        setDisputeSubmitting(false);
        return;
      }
    }

    setDisputeSubmitted(true);
    setDisputeSubmitting(false);
    setShowDisputeForm(false);
    setDisputeReason("");
    setDisputeCount((prev) => prev + 1);
  }

  function renderDisputeForm() {
    return (
      <Card>
        <CardContent className="pt-4 space-y-3">
          <Label className="text-sm font-medium">What&apos;s the issue?</Label>
          <div className="flex flex-wrap gap-2">
            {DISPUTE_SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                className={`text-xs rounded-full border px-3 py-1.5 transition-colors ${
                  disputeReason === suggestion
                    ? "bg-primary text-primary-foreground border-primary"
                    : "hover:bg-muted"
                }`}
                onClick={() => setDisputeReason(suggestion === "Other" ? "" : suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
          <Input
            placeholder="Describe the issue..."
            value={disputeReason}
            onChange={(e) => setDisputeReason(e.target.value)}
            maxLength={200}
          />
          <p className="text-xs text-muted-foreground text-right">
            {disputeReason.length}/200
          </p>
          {disputeError && (
            <p className="text-xs text-destructive">{disputeError}</p>
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                setShowDisputeForm(false);
                setDisputeReason("");
                setDisputeError("");
              }}
              disabled={disputeSubmitting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={handleSubmitDispute}
              disabled={disputeSubmitting || !disputeReason.trim()}
            >
              {disputeSubmitting ? "Submitting..." : "Submit Dispute"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-start px-4 pt-8 pb-28">
      <div className="w-full max-w-sm space-y-6">
        <NudgeBanner />

        {resolutionMessage && (
          <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
            {resolutionMessage}
            <button
              className="block mt-1 text-xs underline"
              onClick={() => setResolutionMessage("")}
            >
              Dismiss
            </button>
          </div>
        )}

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

        {/* Dispute Button (pre-checkout) */}
        {canDispute && !showDisputeForm && (
          <button
            className="w-full text-sm text-muted-foreground underline hover:text-foreground transition-colors"
            onClick={() => setShowDisputeForm(true)}
          >
            Something doesn&apos;t look right
          </button>
        )}

        {showDisputeForm && renderDisputeForm()}

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
