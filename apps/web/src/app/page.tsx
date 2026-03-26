"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function LandingPage() {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState("");
  const [showJoinInput, setShowJoinInput] = useState(false);
  const [joinError, setJoinError] = useState("");

  function handleJoinCodeChange(value: string) {
    const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    setJoinCode(cleaned);
    setJoinError("");
  }

  function handleJoinSubmit() {
    if (joinCode.length !== 6) {
      setJoinError("Code must be exactly 6 characters");
      return;
    }
    router.push(`/session/${joinCode}`);
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">SplitCheck</h1>
          <p className="text-muted-foreground">
            Protect the Vibe. Split the Bill.
          </p>
        </div>

        <div className="space-y-3">
          <Button
            className="w-full h-12 text-base"
            onClick={() => router.push("/create")}
          >
            New Split
          </Button>

          {!showJoinInput ? (
            <Button
              variant="outline"
              className="w-full h-12 text-base"
              onClick={() => setShowJoinInput(true)}
            >
              Join a Split
            </Button>
          ) : (
            <Card>
              <CardContent className="pt-4 space-y-3">
                <Input
                  placeholder="Enter 6-digit code"
                  value={joinCode}
                  onChange={(e) => handleJoinCodeChange(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleJoinSubmit()}
                  maxLength={6}
                  className="text-center text-lg tracking-widest font-mono uppercase"
                  autoFocus
                />
                {joinError && (
                  <p className="text-sm text-destructive">{joinError}</p>
                )}
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    className="flex-1"
                    onClick={() => {
                      setShowJoinInput(false);
                      setJoinCode("");
                      setJoinError("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={handleJoinSubmit}
                    disabled={joinCode.length !== 6}
                  >
                    Join
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
