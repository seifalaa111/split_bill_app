"use client";

import { useSessionStore } from "@/store/session-store";

const priorityStyles = {
  low: "bg-muted text-muted-foreground text-sm",
  medium: "bg-amber-50 text-amber-900 border border-amber-200 text-sm",
  high: "bg-blue-50 text-blue-900 border border-blue-200 text-base animate-pulse-subtle",
};

export function NudgeBanner() {
  const { activeNudge, dismissNudge } = useSessionStore();

  if (!activeNudge) return null;

  const style = priorityStyles[activeNudge.priority] ?? priorityStyles.low;

  return (
    <div
      className={`relative w-full rounded-lg px-4 py-2.5 transition-all duration-300 ${style}`}
    >
      <p className="pr-6">{activeNudge.message}</p>
      <button
        onClick={() => dismissNudge(activeNudge.nudge_id)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-current opacity-50 hover:opacity-100 transition-opacity p-1"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
