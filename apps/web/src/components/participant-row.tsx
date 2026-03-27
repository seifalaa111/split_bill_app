"use client";

import { Badge } from "@/components/ui/badge";
import { formatEgp } from "@/lib/utils";

interface ParticipantRowProps {
  displayName: string;
  role: string;
  status: string;
  total: number;
}

export function ParticipantRow({
  displayName,
  role,
  status,
  total,
}: ParticipantRowProps) {
  function getStatusBadge() {
    switch (status) {
      case "SETTLED":
        return <Badge variant="gold">Paid ✅</Badge>;
      case "CHECKED_OUT":
        return <Badge variant="success">Checked Out</Badge>;
      case "DISPUTED":
        return <Badge variant="destructive">Disputed ⚠️</Badge>;
      case "REVIEWING":
        return <Badge variant="warning">Reviewing</Badge>;
      case "CLAIMING":
        return <Badge className="border-transparent bg-blue-100 text-blue-800">Claiming</Badge>;
      case "BROWSING":
      default:
        return <Badge variant="secondary">Browsing</Badge>;
    }
  }

  const showTotal =
    status === "CHECKED_OUT" ||
    status === "SETTLED" ||
    status === "DISPUTED" ||
    status === "REVIEWING";

  return (
    <div className="flex items-center justify-between rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <div>
          <p className="text-sm font-medium">
            {displayName}
            {role === "HOST" && (
              <span className="text-xs text-muted-foreground ml-1">(Host)</span>
            )}
          </p>
        </div>
        {getStatusBadge()}
      </div>
      <p className="text-sm font-semibold">
        {showTotal ? formatEgp(total) : "—"}
      </p>
    </div>
  );
}
