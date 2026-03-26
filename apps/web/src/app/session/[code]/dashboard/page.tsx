"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ParticipantRow } from "@/components/participant-row";
import * as api from "@/lib/api";
import { formatEgp } from "@/lib/utils";
import type { SessionSummary } from "@splitcheck/shared";

export default function DashboardPage() {
  const router = useRouter();
  const params = useParams();
  const code = params.code as string;

  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const loadSummary = useCallback(async () => {
    // First get the session to find the sessionId from the code
    const sessionResult = await api.getSessionByCode(code);
    if (!sessionResult.success || !sessionResult.data) {
      setError(sessionResult.error || "Session not found");
      setLoading(false);
      return;
    }

    const summaryResult = await api.getSessionSummary(
      sessionResult.data.sessionId
    );
    if (!summaryResult.success || !summaryResult.data) {
      setError(summaryResult.error || "Failed to load summary");
      setLoading(false);
      return;
    }

    setSummary(summaryResult.data);
    setLoading(false);
  }, [code]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  // Poll for updates every 5 seconds (Phase 1 polling — WebSockets in Phase 2)
  useEffect(() => {
    const interval = setInterval(() => {
      loadSummary();
    }, 5000);
    return () => clearInterval(interval);
  }, [loadSummary]);

  function handleCopyLink() {
    const shareUrl = `${window.location.origin}/session/${code}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function handleCloseSession() {
    if (!summary) return;
    const result = await api.updateSession(summary.session.sessionId, {
      status: "CLOSED",
    });
    if (result.success) {
      await loadSummary();
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading dashboard...</p>
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-4 gap-4">
        <p className="text-destructive">{error || "Something went wrong"}</p>
        <Button variant="outline" onClick={() => router.push("/")}>
          Back to Home
        </Button>
      </div>
    );
  }

  const { session, items, participants, totalClaimed, totalRemaining, checkoutCount, roundingDifference } = summary;
  const totalParticipants = participants.length;
  const allCheckedOut = checkoutCount === totalParticipants && totalParticipants > 0;

  return (
    <div className="flex min-h-screen flex-col items-center justify-start px-4 pt-8 pb-8">
      <div className="w-full max-w-sm space-y-5">
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
              <Badge variant={session.status === "OPEN" ? "success" : "secondary"}>
                {session.status}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Bill Total</span>
              <span className="text-sm font-semibold">{formatEgp(session.billTotal)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Subtotal</span>
              <span className="text-sm">{formatEgp(session.billSubtotal)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Tax ({session.taxPct}%)</span>
              <span className="text-sm">{formatEgp(session.taxAmount)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Service ({session.servicePct}%)</span>
              <span className="text-sm">{formatEgp(session.serviceAmount)}</span>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Checkout Progress</span>
              <span className="text-sm font-semibold">
                {checkoutCount} / {totalParticipants}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Total Claimed</span>
              <span className="text-sm font-semibold">{formatEgp(totalClaimed)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Remaining</span>
              <span className="text-sm">{formatEgp(totalRemaining)}</span>
            </div>
            {Math.abs(roundingDifference) > 0 && allCheckedOut && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Rounding Difference</span>
                <Badge variant={Math.abs(roundingDifference) <= 0.10 ? "success" : "destructive"}>
                  {formatEgp(Math.abs(roundingDifference))}
                </Badge>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Participants */}
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Participants ({totalParticipants})
          </h2>
          {participants.length === 0 ? (
            <p className="text-sm text-muted-foreground">No one has joined yet.</p>
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
            <div key={item.itemId} className="rounded-lg border p-3 space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{item.name}</p>
                  {item.isShared && (
                    <Badge variant="secondary" className="text-xs">Shared</Badge>
                  )}
                </div>
                <p className="text-sm">{formatEgp(item.lineTotal)}</p>
              </div>
              <div className="text-xs text-muted-foreground">
                {item.quantity > 1 && `${item.quantity} × ${formatEgp(item.unitPrice)} · `}
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
    </div>
  );
}
