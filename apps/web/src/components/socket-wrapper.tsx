"use client";

import { useSessionStore } from "@/store/session-store";
import { SocketProvider } from "@/providers/socket-provider";
import { ConnectionBanner } from "@/components/connection-banner";

interface SocketWrapperProps {
  children: React.ReactNode;
}

export function SocketWrapper({ children }: SocketWrapperProps) {
  const session = useSessionStore((s) => s.session);
  const currentParticipant = useSessionStore((s) => s.currentParticipant);

  // If we don't have session/participant IDs yet, just render children without socket
  if (!session?.sessionId || !currentParticipant?.participantId) {
    return <>{children}</>;
  }

  return (
    <SocketProvider
      sessionId={session.sessionId}
      participantId={currentParticipant.participantId}
    >
      <ConnectionBanner />
      {children}
    </SocketProvider>
  );
}
