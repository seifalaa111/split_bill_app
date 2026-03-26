"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSessionStore } from "@/store/session-store";
import * as api from "@/lib/api";

export default function SessionPage() {
  const router = useRouter();
  const params = useParams();
  const code = (params.code as string).toUpperCase();

  const { session, setSession, setCurrentParticipant } = useSessionStore();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [joining, setJoining] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function loadSession() {
      setLoading(true);
      const result = await api.getSessionByCode(code);
      if (!result.success || !result.data) {
        setError(result.error || "Session not found");
        setLoading(false);
        return;
      }
      setSession(result.data);
      setLoading(false);
    }
    loadSession();
  }, [code, setSession]);

  async function handleJoin() {
    if (!session) return;

    const name = displayName.trim();
    if (!name) {
      setError("Display name is required");
      return;
    }
    if (name.length > 30) {
      setError("Name must be 30 characters or less");
      return;
    }

    setJoining(true);
    setError("");

    const result = await api.joinSession(session.sessionId, {
      displayName: name,
    });

    if (!result.success || !result.data) {
      setError(result.error || "Failed to join session");
      setJoining(false);
      return;
    }

    setCurrentParticipant(result.data);
    router.push(`/session/${code}/claim`);
  }

  function handleCopyCode() {
    const shareUrl = `${window.location.origin}/session/${code}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading session...</p>
      </div>
    );
  }

  if (error && !session) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-4 gap-4">
        <p className="text-destructive">{error}</p>
        <Button variant="outline" onClick={() => router.push("/")}>
          Back to Home
        </Button>
      </div>
    );
  }

  if (!session) return null;

  // If session is DRAFT, the host hasn't finished adding items yet
  if (session.status === "DRAFT") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-4 gap-4">
        <p className="text-muted-foreground">
          This session is still being set up by the host.
        </p>
        <Button variant="outline" onClick={() => router.push("/")}>
          Back to Home
        </Button>
      </div>
    );
  }

  // If session is CLOSED
  if (session.status === "CLOSED") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-4 gap-4">
        <p className="text-muted-foreground">This session has ended.</p>
        <Button variant="outline" onClick={() => router.push("/")}>
          Back to Home
        </Button>
      </div>
    );
  }

  // Session is OPEN — show join form for guests
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold">Join Session</h1>
          <div className="inline-block rounded-lg bg-muted px-4 py-2">
            <p className="font-mono text-2xl tracking-widest font-bold">
              {code}
            </p>
          </div>
        </div>

        {/* Share link section */}
        <div className="space-y-2">
          <Button
            variant="outline"
            className="w-full"
            onClick={handleCopyCode}
          >
            {copied ? "Copied!" : "Copy Share Link"}
          </Button>
        </div>

        <Separator />

        {/* Join form */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Enter your name to join</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="displayName">Display Name</Label>
              <Input
                id="displayName"
                placeholder="e.g. Salma"
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  setError("");
                }}
                onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                maxLength={30}
                autoFocus
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button
              className="w-full"
              onClick={handleJoin}
              disabled={joining || !displayName.trim()}
            >
              {joining ? "Joining..." : "Join"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Separator() {
  return <div className="h-px w-full bg-border" />;
}
