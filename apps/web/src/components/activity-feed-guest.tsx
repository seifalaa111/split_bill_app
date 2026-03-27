"use client";

import { useState, useEffect, useRef } from "react";
import { useSocket } from "@/providers/socket-provider";
import { FeedItem } from "@/components/feed-item";
import { Badge } from "@/components/ui/badge";

const COLLAPSED_COUNT = 3;
const EXPANDED_COUNT = 20;

export function ActivityFeedGuest() {
  const { feedEvents } = useSocket();
  const [expanded, setExpanded] = useState(false);
  const [lastSeenCount, setLastSeenCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const newCount = feedEvents.length - lastSeenCount;

  // When expanded, mark all as seen
  useEffect(() => {
    if (expanded) {
      setLastSeenCount(feedEvents.length);
    }
  }, [expanded, feedEvents.length]);

  // Auto-scroll to bottom when new events arrive and panel is expanded
  useEffect(() => {
    if (expanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [feedEvents.length, expanded]);

  const displayedEvents = expanded
    ? feedEvents.slice(-EXPANDED_COUNT)
    : feedEvents.slice(-COLLAPSED_COUNT);

  if (feedEvents.length === 0) return null;

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      {/* Toggle header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium hover:bg-muted/50 transition-colors"
      >
        <span className="flex items-center gap-2">
          Activity
          {!expanded && newCount > 0 && (
            <Badge variant="destructive" className="text-xs px-1.5 py-0">
              {newCount}
            </Badge>
          )}
        </span>
        <span className="text-muted-foreground text-xs">
          {expanded ? "Collapse" : "Show more"}
        </span>
      </button>

      {/* Feed content */}
      <div
        ref={scrollRef}
        className="px-3 pb-2 transition-all duration-300 ease-in-out overflow-y-auto"
        style={{
          maxHeight: expanded ? "320px" : "160px",
        }}
      >
        {displayedEvents.map((event, index) => (
          <FeedItem
            key={`${event.timestamp}-${index}`}
            event={event}
            isNew={index === displayedEvents.length - 1 && feedEvents.length > lastSeenCount}
          />
        ))}
      </div>
    </div>
  );
}
