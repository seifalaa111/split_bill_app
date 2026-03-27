"use client";

import { useEffect, useRef } from "react";
import { useSocket } from "@/providers/socket-provider";
import { FeedItem } from "@/components/feed-item";

const MAX_EVENTS = 50;

export function ActivityFeedHost() {
  const { feedEvents } = useSocket();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new events
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [feedEvents.length]);

  const displayedEvents = feedEvents.slice(-MAX_EVENTS);

  return (
    <div className="rounded-lg border bg-card flex flex-col h-full">
      <div className="px-3 py-2 border-b">
        <h3 className="text-sm font-semibold">Activity Feed</h3>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-1"
        style={{ maxHeight: "400px" }}
      >
        {displayedEvents.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No activity yet. Waiting for guests...
          </p>
        ) : (
          displayedEvents.map((event, index) => (
            <FeedItem
              key={`${event.timestamp}-${index}`}
              event={event}
              isNew={index === displayedEvents.length - 1}
            />
          ))
        )}
      </div>
    </div>
  );
}
