"use client";

import { useSocket, ConnectionStatus } from "@/providers/socket-provider";

export function ConnectionBanner() {
  const { status } = useSocket();

  if (status === "connected") return null;

  const config: Record<
    Exclude<ConnectionStatus, "connected">,
    { message: string; bg: string }
  > = {
    reconnecting: {
      message: "Reconnecting...",
      bg: "bg-yellow-500",
    },
    disconnected: {
      message: "Connection lost. Your claims are saved.",
      bg: "bg-red-500",
    },
  };

  const { message, bg } = config[status];

  return (
    <div
      className={`fixed top-0 left-0 right-0 z-50 px-4 py-2 text-center text-sm font-medium text-white ${bg} transition-all duration-300`}
    >
      {message}
    </div>
  );
}
