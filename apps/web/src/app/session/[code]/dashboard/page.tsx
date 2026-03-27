"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ParticipantRow } from "@/components/participant-row";
import { SocketWrapper } from "@/components/socket-wrapper";
import { ActivityFeedHost } from "@/components/activity-feed-host";
import { useSessionStore } from "@/store/session-store";
import { useSocket } from "@/providers/socket-provider";
import * as api from "@/lib/api";
import { formatEgp } from "@/lib/utils";
import type { Participant, Dispute } from "@splitcheck/shared";

// ─── Sub-components ─────────────────────────────────────────────────

function SessionStatusBadge({ status }: { status: string }) {
  const config: Record<string, { variant: "default" | "success" | "warning" | "destructive" | "secondary" | "gold"; label: string }> = {
    DRAFT:              { variant: "secondary",    label: "Draft" },
    OPEN:               { variant: "success",      label: "Open" },
    PARTIALLY_SETTLED:  { variant: "warning",      label: "Partially Settled" },
    DISPUTED:           { variant: "destructive",  label: "Disputed" },
    SETTLED:            { variant: "gold",         label: "All Settled" },
    CLOSED:             { variant: "secondary",    label: "Closed" },
  };
  const c = config[status] ?? { variant: "secondary" as const, label: status };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

interface DisputePanelProps {
  sessionId: string;
  onResolved: () => void;
}

function DisputePanel({ sessionId, onResolved }: DisputePanelProps) {
  const [disputes, setDisputes] = useState<(Dispute & { participantName: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeDisputeId, setActiveDisputeId] = useState<string | null>(null);
  const [resolutionNote, setResolutionNote] = useState("");
  const [overrideTotal, setOverrideTotal] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState("");

  const { disputeRaisedEvents } = useSocket();

  const loadDisputes = useCallback(async () => {
    const res = await api.getSessionDisputes(sessionId);
    if (res.success && res.data) {
      setDisputes(res.data);
    }
    setLoading(false);
  }, [sessionId]);

  useEffect(() => {
    loadDisputes();
  }, [loadDisputes]);

  // Reload when new disputes come in via WS
  useEffect(() => {
    if (disputeRaisedEvents.length > 0) {
      loadDisputes();
    }
  }, [disputeRaisedEvents.length, loadDisputes]);

  const openDisputes = disputes.filter((d) => d.status === "OPEN");

  async function handleResolve(
    disputeId: string,
    type: "ADJUST" | "REJECT" | "OVERRIDE"
  ) {
    setResolving(true);
    setResolveError("");

    const body: Parameters<typeof api.resolveDispute>[1] = {
      status: type === "REJECT" ? "REJECTED" : "RESOLVED",
      resolution_type: type,
      resolution_note: resolutionNote || undefined,
    };

    if (type === "OVERRIDE" && overrideTotal) {
      body.adjusted_total = parseFloat(overrideTotal);
    }
    if (type === "REJECT" && !resolutionNote.trim()) {
      setResolveError("A reason is required when rejecting");
      setResolving(false);
      return;
    }

    const res = await api.resolveDispute(disputeId, body);
    if (!res.success) {
      setResolveError(res.error || "Failed to resolve");
    } else {
      setActiveDisputeId(null);
      setResolutionNote("");
      setOverrideTotal("");
      await loadDisputes();
      onResolved();
    }
    setResolving(false);
  }

  if (loading) return null;
  if (openDisputes.length === 0 && disputes.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Disputes
        </h2>
        {openDisputes.length > 0 && (
          <Badge variant="destructive" className="text-xs">
            {openDisputes.length}
          </Badge>
        )}
      </div>

      {openDisputes.map((d) => (
        <Card key={d.disputeId} className="border-red-200">
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{d.participantName}</p>
              <Badge variant="destructive" className="text-xs">Open</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              &quot;{d.reason}&quot;
            </p>
            <p className="text-xs text-muted-foreground">
              Original total: {formatEgp(d.originalTotal)}
            </p>

            {activeDisputeId === d.disputeId ? (
              <div className="space-y-3 border-t pt-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Note (required for reject)</Label>
                  <Input
                    placeholder="Explain your decision..."
                    value={resolutionNote}
                    onChange={(e) => setResolutionNote(e.target.value)}
                    maxLength={200}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Override total (for override only)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="e.g. 150.00"
                    value={overrideTotal}
                    onChange={(e) => setOverrideTotal(e.target.value)}
                  />
                </div>
                {resolveError && (
                  <p className="text-xs text-destructive">{resolveError}</p>
                )}
                <div className="flex gap-2 flex-wrap">
                  <Button
                    size="sm"
                    onClick={() => handleResolve(d.disputeId, "ADJUST")}
                    disabled={resolving}
                  >
                    Send Adjusted Total
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleResolve(d.disputeId, "REJECT")}
                    disabled={resolving}
                  >
                    Keep Original
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleResolve(d.disputeId, "OVERRIDE")}
                    disabled={resolving || !overrideTotal}
                  >
                    Set Custom Total
                  </Button>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-full"
                  onClick={() => {
                    setActiveDisputeId(null);
                    setResolutionNote("");
                    setOverrideTotal("");
                    setResolveError("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => setActiveDisputeId(d.disputeId)}
              >
                Resolve
              </Button>
            )}
          </CardContent>
        </Card>
      ))}

      {/* Resolved disputes (collapsed) */}
      {disputes.filter((d) => d.status !== "OPEN").length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground">
            {disputes.filter((d) => d.status !== "OPEN").length} resolved dispute(s)
          </summary>
          <div className="space-y-1 mt-2">
            {disputes
              .filter((d) => d.status !== "OPEN")
              .map((d) => (
                <div key={d.disputeId} className="border rounded p-2">
                  <p className="font-medium">{d.participantName}: &quot;{d.reason}&quot;</p>
                  <p>
                    {d.status === "REJECTED" ? "Rejected" : "Resolved"} via{" "}
                    {d.resolutionType?.toLowerCase()}
                    {d.resolutionNote ? ` — "${d.resolutionNote}"` : ""}
                    {d.adjustedTotal != null ? ` → ${formatEgp(d.adjustedTotal)}` : ""}
                  </p>
                </div>
              ))}
          </div>
        </details>
      )}
    </div>
  );
}

interface ReallocationPanelProps {
  items: { itemId: string; name: string; lineTotal: number; claimedQty: number; quantity: number; isShared: boolean; absorbedByHost: boolean; claims: { participantId: string }[] }[];
  participants: Participant[];
  onAction: () => void;
}

function ReallocationPanel({ items, participants, onAction }: ReallocationPanelProps) {
  const [assignTarget, setAssignTarget] = useState<Record<string, string>>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const unclaimedItems = items.filter((item) => {
    if (item.absorbedByHost) return false;
    if (item.isShared) return item.claims.length === 0;
    return item.claimedQty < item.quantity;
  });

  if (unclaimedItems.length === 0) return null;

  const totalUnclaimed = unclaimedItems.reduce((sum, item) => {
    if (item.isShared) return sum + item.lineTotal;
    const unclaimedQty = item.quantity - item.claimedQty;
    return sum + (item.lineTotal / item.quantity) * unclaimedQty;
  }, 0);

  async function handleAssign(itemId: string) {
    const pid = assignTarget[itemId];
    if (!pid) return;
    setActionLoading(itemId);
    await api.assignItem(itemId, pid);
    setActionLoading(null);
    onAction();
  }

  async function handleSplit(itemId: string) {
    setActionLoading(itemId);
    await api.splitItemEqually(itemId);
    setActionLoading(null);
    onAction();
  }

  async function handleAbsorb(itemId: string) {
    setActionLoading(itemId);
    await api.absorbItem(itemId);
    setActionLoading(null);
    onAction();
  }

  return (
    <div className="space-y-2">
      <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
        <p className="text-sm font-medium text-amber-900">
          ⚠️ {unclaimedItems.length} item{unclaimedItems.length !== 1 ? "s" : ""} unclaimed ({formatEgp(totalUnclaimed)})
        </p>
      </div>

      {unclaimedItems.map((item) => (
        <Card key={item.itemId} className="border-amber-200">
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{item.name}</p>
              <p className="text-sm">{formatEgp(item.lineTotal)}</p>
            </div>

            <div className="flex gap-2 flex-wrap">
              {/* Assign dropdown */}
              <div className="flex gap-1 flex-1 min-w-[140px]">
                <select
                  className="flex-1 rounded border px-2 py-1 text-xs bg-background"
                  value={assignTarget[item.itemId] ?? ""}
                  onChange={(e) =>
                    setAssignTarget((prev) => ({ ...prev, [item.itemId]: e.target.value }))
                  }
                >
                  <option value="">Assign to...</option>
                  {participants.map((p) => (
                    <option key={p.participantId} value={p.participantId}>
                      {p.displayName}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleAssign(item.itemId)}
                  disabled={!assignTarget[item.itemId] || actionLoading === item.itemId}
                >
                  Assign
                </Button>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                className="flex-1"
                onClick={() => handleSplit(item.itemId)}
                disabled={actionLoading === item.itemId}
              >
                Split Among Everyone
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="flex-1"
                onClick={() => handleAbsorb(item.itemId)}
                disabled={actionLoading === item.itemId}
              >
                I&apos;ll Cover This
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Main Dashboard ─────────────────────────────────────────────────

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

  const loadInitial = useCallback(async () => {
    const sessionResult = await api.getSessionByCode(code);
    if (!sessionResult.success || !sessionResult.data) {
      setError(sessionResult.error || "Session not found");
      setInitialLoading(false);
      return;
    }

    setSession(sessionResult.data);

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
    await api.updateSession(session.sessionId, { status: "CLOSED" });
    await loadInitial();
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

  // ─── Stats (expanded for Phase 3 statuses) ──────────────────
  const totalParticipants = participants.length;
  const completedParticipants = participants.filter(
    (p) =>
      p.status === "CHECKED_OUT" ||
      p.status === "SETTLED" ||
      p.status === "DISPUTED"
  );
  const settledParticipants = participants.filter(
    (p) => p.status === "SETTLED"
  );
  const checkoutCount = completedParticipants.length;
  const settledCount = settledParticipants.length;
  const totalClaimed = completedParticipants.reduce(
    (sum, p) => sum + p.total,
    0
  );
  const totalRemaining = session.billTotal - totalClaimed;

  const canClose =
    session.status !== "CLOSED" && session.status !== "DRAFT";

  // Show reallocation when at least 1 person checked out
  const showReallocation =
    session.status === "PARTIALLY_SETTLED" ||
    session.status === "DISPUTED" ||
    session.status === "SETTLED";

  return (
    <div className="flex min-h-screen flex-col items-center justify-start px-4 pt-8 pb-8">
      <div className="w-full max-w-3xl">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_300px] gap-5">
          {/* Left column */}
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

            <Button variant="outline" className="w-full" onClick={handleCopyLink}>
              {copied ? "Copied!" : "Copy Share Link"}
            </Button>

            {/* Session status */}
            <Card>
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Status</span>
                  <SessionStatusBadge status={session.status} />
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
                  <span className="text-sm text-muted-foreground">Settled</span>
                  <span className="text-sm font-semibold">
                    {settledCount} / {totalParticipants}
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
              </CardContent>
            </Card>

            {/* Disputes Panel */}
            {session.sessionId && (
              <DisputePanel
                sessionId={session.sessionId}
                onResolved={loadInitial}
              />
            )}

            {/* Reallocation Panel */}
            {showReallocation && (
              <ReallocationPanel
                items={items.map((item) => ({
                  itemId: item.itemId,
                  name: item.name,
                  lineTotal: item.lineTotal,
                  claimedQty: item.claimedQty,
                  quantity: item.quantity,
                  isShared: item.isShared,
                  absorbedByHost: (item as Record<string, unknown>).absorbedByHost as boolean ?? false,
                  claims: item.claims.map((c) => ({ participantId: c.participantId })),
                }))}
                participants={participants}
                onAction={loadInitial}
              />
            )}

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
              {items.map((item) => {
                const absorbed = (item as Record<string, unknown>).absorbedByHost as boolean;
                return (
                  <div
                    key={item.itemId}
                    className={`rounded-lg border p-3 space-y-1 ${absorbed ? "opacity-60" : ""}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{item.name}</p>
                        {item.isShared && (
                          <Badge variant="secondary" className="text-xs">Shared</Badge>
                        )}
                        {absorbed && (
                          <Badge variant="secondary" className="text-xs">Covered by Host</Badge>
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
                          {item.claims.map((c) => c.participantName).join(", ")}
                        </span>
                      ) : absorbed ? (
                        <span>Host absorbed</span>
                      ) : (
                        <span className="text-yellow-600">Unclaimed</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Close session */}
            {canClose && (
              <Button
                variant="destructive"
                className="w-full"
                onClick={handleCloseSession}
              >
                Close Session
              </Button>
            )}
          </div>

          {/* Right column — Activity Feed */}
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
