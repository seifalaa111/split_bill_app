"use client";

import { useMemo } from "react";
import type { FeedEventPayload } from "@splitcheck/shared";

interface FeedItemProps {
  event: FeedEventPayload;
  isNew?: boolean;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function relativeTime(timestamp: number): string {
  const diff = Math.floor((Date.now() - timestamp) / 1000);
  if (diff < 10) return "just now";
  if (diff < 60) return `${diff}s ago`;
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ago`;
}

export function FeedItem({ event, isNew = false }: FeedItemProps) {
  const avatarColor = useMemo(() => {
    // Derive a consistent color from actor name (simple hash)
    const colors = [
      "#FFB3BA", "#BAFFC9", "#BAE1FF", "#FFFFBA", "#E8BAFF",
      "#FFD4BA", "#BAF2FF", "#D4FFBA", "#FFC9DE", "#C9BAFF",
    ];
    let hash = 0;
    for (let i = 0; i < event.actor_name.length; i++) {
      hash = event.actor_name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }, [event.actor_name]);

  const initials = getInitials(event.actor_name);

  return (
    <div
      className={`flex items-start gap-3 py-2 px-1 transition-all duration-300 ${
        isNew ? "animate-slide-in" : ""
      }`}
    >
      {/* Avatar */}
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold"
        style={{ backgroundColor: avatarColor, color: "#1a1a1a" }}
      >
        {initials}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm leading-snug">
          <span className="mr-1">{event.emoji}</span>
          {event.message}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {relativeTime(event.timestamp)}
        </p>
      </div>
    </div>
  );
}
