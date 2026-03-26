"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatEgp } from "@/lib/utils";
import type { BillItemWithClaims } from "@splitcheck/shared";

interface ItemCardProps {
  item: BillItemWithClaims;
  participantId: string;
  onClaim: (itemId: string, quantity: number, isShared: boolean) => Promise<void>;
  onUnclaim: (claimId: string) => Promise<void>;
  loading: boolean;
}

export function ItemCard({
  item,
  participantId,
  onClaim,
  onUnclaim,
  loading,
}: ItemCardProps) {
  const [selectedQty, setSelectedQty] = useState(1);

  const myClaim = item.claims.find((c) => c.participantId === participantId);
  const isClaimed = !!myClaim;
  const totalClaimed = item.claims.reduce((sum, c) => sum + c.quantity, 0);
  const availableQty = item.isShared ? 1 : item.quantity - totalClaimed + (myClaim?.quantity ?? 0);
  const claimantCount = item.claims.length;

  async function handleClaim() {
    await onClaim(item.itemId, item.isShared ? 1 : selectedQty, item.isShared);
  }

  async function handleUnclaim() {
    if (myClaim) {
      await onUnclaim(myClaim.claimId);
    }
  }

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium">{item.name}</p>
            {item.isShared && (
              <Badge variant="secondary" className="text-xs">
                Shared
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {item.isShared ? (
              <>
                {formatEgp(item.lineTotal)} total
                {claimantCount > 0 && (
                  <> · {formatEgp(item.lineTotal / claimantCount)} each ({claimantCount} sharing)</>
                )}
              </>
            ) : (
              <>
                {formatEgp(item.unitPrice)} each · {totalClaimed}/{item.quantity} claimed
              </>
            )}
          </p>
        </div>
        <p className="text-sm font-semibold shrink-0 ml-2">
          {formatEgp(item.isShared ? item.lineTotal : item.unitPrice)}
        </p>
      </div>

      {isClaimed ? (
        <div className="flex items-center justify-between">
          <Badge variant="success">
            Claimed{!item.isShared && myClaim.quantity > 1 ? ` (×${myClaim.quantity})` : ""}
            {item.isShared ? ` · ${formatEgp(myClaim.amount)}` : ` · ${formatEgp(myClaim.amount)}`}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={handleUnclaim}
            disabled={loading}
          >
            Remove
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {!item.isShared && item.quantity > 1 && availableQty > 0 && (
            <select
              value={selectedQty}
              onChange={(e) => setSelectedQty(parseInt(e.target.value))}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              {Array.from({ length: availableQty }, (_, i) => i + 1).map(
                (qty) => (
                  <option key={qty} value={qty}>
                    {qty}
                  </option>
                )
              )}
            </select>
          )}
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={handleClaim}
            disabled={loading || (!item.isShared && availableQty <= 0)}
          >
            {item.isShared ? "Share this item" : availableQty <= 0 ? "Fully claimed" : "Claim"}
          </Button>
        </div>
      )}
    </div>
  );
}
