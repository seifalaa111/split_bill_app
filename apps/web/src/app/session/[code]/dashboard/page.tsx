"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ParticipantRow } from "@/components/participant-row";
import { SocketWrapper } from "@/components/socket-wrapper";
import { ActivityFeedHost } from "@/components/activity-feed-host";
import { useSessionStore } from "@/store/session-store";
import * as api from "@/lib/api";
import { formatEgp } from "@/lib/utils";
import type { SessionSummary, Participant } from "@splitcheck/shared";

function DashboardContent() {
  const router = useRouter();
  const params = useParams();
  const code = params.code as string;

  const {
    session,
    items,
    participants,
    setSession,
    setCurrentParticipant,
  } = useSessionStore();

  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  // Initial load — set session + host participant so SocketWrapper connects
  const loadInitial = useCallback(async () => {
    const sessionResult = await api.getSessionByCode(code);
    if (!sessionResult.success || !sessionResult.data) {
      setError(sessionResult.error || "Session not found");
      setInitialLoading(false);
      return;
    }

    setSession(sessionResult.data);

    // Find host participant and set as current so WebSocket connects
    const host = sessionResult.data.participants?.find(
      (p: Participant) => p.role === "HOST"
    );
    if (host) {
      setCurrentParticipant(host);
    }

    setInitialLoading(false);
  }, [code, setSession, setCurrentParticipant]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  function handleCopyLink() {
    const shareUrl = `${window.location.origin}/session/${code}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function handleCloseSession() {
    if (!session) return;
    const result = await api.updateSession(session.sessionId, {
      status: "CLOSED",
    });
    if (result.success) {
      // state:sync from WebSocket will update everything
      // But also reload just in case
      await loadInitial();
    }
  }

  if (initialLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading dashboard...</p>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-4 gap-4">
        <p className="text-destructive">{error || "Something went wrong"}</p>
        <Button variant="outline" onClick={() => router.push("/")}>
          Back to Home
        </Button>
      </div>
    );
  }

  // Compute dashboard stats from real-time Zustand store
  const totalParticipants = participants.length;
  const checkedOutParticipants = participants.filter(
    (p) => p.status === "CHECKED_OUT"
  );
  const checkoutCount = checkedOutParticipants.length;
  const totalClaimed = checkedOutParticipants.reduce(
    (sum, p) => sum + p.total,
    0
  );
  const totalRemaining = session.billTotal - totalClaimed;
  const allCheckedOut =
    checkoutCount === totalParticipants && totalParticipants > 0;

  return (
    <div className="flex min-h-screen flex-col items-center justify-start px-4 pt-8 pb-8">
      <div className="w-full max-w-3xl">
        {/* Mobile: single column. Desktop: two columns */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_300px] gap-5">
          {/* Left column — dashboard content */}
          <div className="space-y-5">
            {/* Header */}
            <div className="text-center space-y-1">
              <h1 className="text-2xl font-bold">Host Dashboard</h1>
              <div className="inline-block rounded-lg bg-muted px-3 py-1">
                <p className="font-mono text-lg tracking-widest font-bold">
                  {code}
                </p>
              </div>
            </div>

            {/* Share button */}
            <Button
              variant="outline"
              className="w-full"
              onClick={handleCopyLink}
            >
              {copied ? "Copied!" : "Copy Share Link"}
            </Button>

            {/* Session status */}
            <Card>
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Status</span>
                  <Badge
                    variant={
                      session.status === "OPEN" ? "success" : "secondary"
                    }
                  >
                    {session.status}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Bill Total
                  </span>
                  <span className="text-sm font-semibold">
                    {formatEgp(session.billTotal)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Subtotal
                  </span>
                  <span className="text-sm">
                    {formatEgp(session.billSubtotal)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Tax ({session.taxPct}%)
                  </span>
                  <span className="text-sm">
                    {formatEgp(session.taxAmount)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Service ({session.servicePct}%)
                  </span>
                  <span className="text-sm">
                    {formatEgp(session.serviceAmount)}
                  </span>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Checkout Progress
                  </span>
                  <span className="text-sm font-semibold">
                    {checkoutCount} / {totalParticipants}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Total Claimed
                  </span>
                  <span className="text-sm font-semibold">
                    {formatEgp(totalClaimed)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Remaining
                  </span>
                  <span className="text-sm">
                    {formatEgp(totalRemaining)}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Participants */}
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Participants ({totalParticipants})
              </h2>
              {participants.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No one has joined yet.
                </p>
              ) : (
                participants.map((p) => (
                  <ParticipantRow
                    key={p.participantId}
                    displayName={p.displayName}
                    role={p.role}
                    status={p.status}
                    total={p.total}
                  />
                ))
              )}
            </div>

            {/* Items */}
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Items ({items.length})
              </h2>
              {items.map((item) => (
                <div
                  key={item.itemId}
                  className="rounded-lg border p-3 space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{item.name}</p>
                      {item.isShared && (
                        <Badge variant="secondary" className="text-xs">
                          Shared
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm">{formatEgp(item.lineTotal)}</p>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {item.quantity > 1 &&
                      `${item.quantity} × ${formatEgp(item.unitPrice)} · `}
                    {item.claims.length > 0 ? (
                      <span>
                        Claimed by:{" "}
                        {item.claims
                          .map((c) => c.participantName)
                          .join(", ")}
                      </span>
                    ) : (
                      <span className="text-yellow-600">Unclaimed</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Close session */}
            {session.status === "OPEN" && (
              <Button
                variant="destructive"
                className="w-full"
                onClick={handleCloseSession}
              >
                Close Session
              </Button>
            )}
          </div>

          {/* Right column — Activity Feed (desktop: always visible, mobile: below) */}
          <div className="md:sticky md:top-4 md:self-start">
            <ActivityFeedHost />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <SocketWrapper>
      <DashboardContent />
    </SocketWrapper>
  );
}
