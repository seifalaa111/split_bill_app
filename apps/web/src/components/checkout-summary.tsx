"use client";

import { Separator } from "@/components/ui/separator";
import { formatEgp } from "@/lib/utils";

interface CheckoutSummaryProps {
  claimedItems: { name: string; amount: number; isShared: boolean; quantity: number }[];
  subtotal: number;
  taxShare: number;
  serviceShare: number;
  total: number;
}

export function CheckoutSummary({
  claimedItems,
  subtotal,
  taxShare,
  serviceShare,
  total,
}: CheckoutSummaryProps) {
  return (
    <div className="space-y-3">
      {/* Itemized list */}
      <div className="space-y-2">
        {claimedItems.map((item, index) => (
          <div key={index} className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {item.name}
              {item.quantity > 1 && !item.isShared ? ` ×${item.quantity}` : ""}
              {item.isShared ? " (shared)" : ""}
            </span>
            <span>{formatEgp(item.amount)}</span>
          </div>
        ))}
      </div>

      <Separator />

      {/* Subtotal */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Subtotal</span>
        <span>{formatEgp(subtotal)}</span>
      </div>

      {/* Tax */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Tax Share</span>
        <span>{formatEgp(taxShare)}</span>
      </div>

      {/* Service */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Service Share</span>
        <span>{formatEgp(serviceShare)}</span>
      </div>

      <Separator />

      {/* Grand total */}
      <div className="flex items-center justify-between">
        <span className="text-base font-semibold">You Owe</span>
        <span className="text-xl font-bold">{formatEgp(total)}</span>
      </div>
    </div>
  );
}
