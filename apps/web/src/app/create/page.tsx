"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useSessionStore } from "@/store/session-store";
import * as api from "@/lib/api";
import { formatEgp } from "@/lib/utils";
import type { BillItem } from "@splitcheck/shared";

type Step = "setup" | "items";

interface ItemFormData {
  name: string;
  quantity: string;
  unitPrice: string;
  isShared: boolean;
}

const emptyItemForm: ItemFormData = {
  name: "",
  quantity: "1",
  unitPrice: "",
  isShared: false,
};

export default function CreatePage() {
  const router = useRouter();
  const { setSession, items, addItem, removeItem } = useSessionStore();

  const [step, setStep] = useState<Step>("setup");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Session setup form
  const [billTotal, setBillTotal] = useState("");
  const [taxPct, setTaxPct] = useState("14");
  const [servicePct, setServicePct] = useState("12");
  const [expectedHeadcount, setExpectedHeadcount] = useState("3");
  const [hostName, setHostName] = useState("");

  // Item form
  const [itemForm, setItemForm] = useState<ItemFormData>(emptyItemForm);
  const [itemError, setItemError] = useState("");

  // Session ID (set after creation)
  const [sessionId, setSessionId] = useState("");
  const [sessionCode, setSessionCode] = useState("");
  const [declaredBillTotal, setDeclaredBillTotal] = useState(0);

  async function handleCreateSession() {
    setError("");
    const billTotalNum = parseFloat(billTotal);
    const taxPctNum = parseFloat(taxPct);
    const servicePctNum = parseFloat(servicePct);
    const headcountNum = parseInt(expectedHeadcount);

    if (!billTotalNum || billTotalNum <= 0) {
      setError("Bill total must be greater than 0");
      return;
    }
    if (isNaN(taxPctNum) || taxPctNum < 0 || taxPctNum > 100) {
      setError("Tax % must be between 0 and 100");
      return;
    }
    if (isNaN(servicePctNum) || servicePctNum < 0 || servicePctNum > 100) {
      setError("Service % must be between 0 and 100");
      return;
    }
    if (!headcountNum || headcountNum < 2) {
      setError("Expected headcount must be at least 2");
      return;
    }
    if (!hostName.trim()) {
      setError("Your name is required");
      return;
    }

    setLoading(true);
    const result = await api.createSession({
      billTotal: billTotalNum,
      taxPct: taxPctNum,
      servicePct: servicePctNum,
      expectedHeadcount: headcountNum,
    });

    if (!result.success || !result.data) {
      setError(result.error || "Failed to create session");
      setLoading(false);
      return;
    }

    setSessionId(result.data.sessionId);
    setSessionCode(result.data.sessionCode);
    setDeclaredBillTotal(billTotalNum);
    setSession(result.data);
    setStep("items");
    setLoading(false);
  }

  async function handleAddItem() {
    setItemError("");
    const name = itemForm.name.trim();
    const quantity = parseInt(itemForm.quantity);
    const unitPrice = parseFloat(itemForm.unitPrice);

    if (!name) {
      setItemError("Item name is required");
      return;
    }
    if (!quantity || quantity < 1) {
      setItemError("Quantity must be at least 1");
      return;
    }
    if (isNaN(unitPrice) || unitPrice < 0) {
      setItemError("Unit price must be 0 or greater");
      return;
    }

    setLoading(true);
    const result = await api.addItem(sessionId, {
      name,
      quantity,
      unitPrice,
      isShared: itemForm.isShared,
    });

    if (!result.success || !result.data) {
      setItemError(result.error || "Failed to add item");
      setLoading(false);
      return;
    }

    addItem(result.data);
    setItemForm(emptyItemForm);
    setLoading(false);
  }

  async function handleDeleteItem(itemId: string) {
    const result = await api.deleteItem(itemId);
    if (result.success) {
      removeItem(itemId);
    }
  }

  async function handleFinishAndShare() {
    if (items.length === 0) {
      setError("Add at least one item before sharing");
      return;
    }

    setLoading(true);
    setError("");

    const result = await api.updateSession(sessionId, {
      status: "OPEN",
      hostDisplayName: hostName.trim(),
    });

    if (!result.success) {
      setError(result.error || "Failed to open session");
      setLoading(false);
      return;
    }

    router.push(`/session/${sessionCode}/dashboard`);
  }

  const runningSubtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const subtotalDiff = declaredBillTotal - runningSubtotal;

  if (step === "setup") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-start px-4 pt-12">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center space-y-1">
            <h1 className="text-2xl font-bold">New Split</h1>
            <p className="text-sm text-muted-foreground">Enter bill details</p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="hostName">Your Name</Label>
              <Input
                id="hostName"
                placeholder="e.g. Ahmed"
                value={hostName}
                onChange={(e) => setHostName(e.target.value)}
                maxLength={30}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="billTotal">Bill Total (EGP)</Label>
              <Input
                id="billTotal"
                type="number"
                placeholder="0.00"
                step="0.01"
                min="0.01"
                value={billTotal}
                onChange={(e) => setBillTotal(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                The total on your receipt including tax and service
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="taxPct">Tax %</Label>
                <Input
                  id="taxPct"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={taxPct}
                  onChange={(e) => setTaxPct(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="servicePct">Service %</Label>
                <Input
                  id="servicePct"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={servicePct}
                  onChange={(e) => setServicePct(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="headcount">Expected Headcount</Label>
              <Input
                id="headcount"
                type="number"
                min="2"
                value={expectedHeadcount}
                onChange={(e) => setExpectedHeadcount(e.target.value)}
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button
              className="w-full h-11"
              onClick={handleCreateSession}
              disabled={loading}
            >
              {loading ? "Creating..." : "Continue"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Step: items
  return (
    <div className="flex min-h-screen flex-col items-center justify-start px-4 pt-8 pb-32">
      <div className="w-full max-w-sm space-y-5">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold">Add Items</h1>
          <p className="text-sm text-muted-foreground">
            Enter each item from the bill
          </p>
        </div>

        {/* Subtotal indicator */}
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <p className="text-sm text-muted-foreground">Running Subtotal</p>
            <p className="text-lg font-semibold">{formatEgp(runningSubtotal)}</p>
          </div>
          <div className="text-right">
            {Math.abs(subtotalDiff) < 0.01 ? (
              <Badge variant="success">Matches</Badge>
            ) : subtotalDiff > 0 ? (
              <Badge variant="warning">{formatEgp(subtotalDiff)} remaining</Badge>
            ) : (
              <Badge variant="destructive">{formatEgp(Math.abs(subtotalDiff))} over</Badge>
            )}
          </div>
        </div>

        {/* Add item form */}
        <Card>
          <CardContent className="pt-4 space-y-3">
            <Input
              placeholder="Item name (e.g. Grilled Chicken)"
              value={itemForm.name}
              onChange={(e) =>
                setItemForm({ ...itemForm, name: e.target.value })
              }
              maxLength={60}
            />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Quantity</Label>
                <Input
                  type="number"
                  min="1"
                  value={itemForm.quantity}
                  onChange={(e) =>
                    setItemForm({ ...itemForm, quantity: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Unit Price (EGP)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={itemForm.unitPrice}
                  onChange={(e) =>
                    setItemForm({ ...itemForm, unitPrice: e.target.value })
                  }
                />
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={itemForm.isShared}
                onChange={(e) =>
                  setItemForm({ ...itemForm, isShared: e.target.checked })
                }
                className="h-4 w-4 rounded border-input"
              />
              <span className="text-sm">Shared item (split among claimants)</span>
            </label>
            {itemError && (
              <p className="text-sm text-destructive">{itemError}</p>
            )}
            <Button
              className="w-full"
              variant="secondary"
              onClick={handleAddItem}
              disabled={loading}
            >
              {loading ? "Adding..." : "Add Item"}
            </Button>
          </CardContent>
        </Card>

        {/* Item list */}
        {items.length > 0 && (
          <div className="space-y-2">
            {items.map((item) => (
              <div
                key={item.itemId}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{item.name}</p>
                    {item.isShared && (
                      <Badge variant="secondary" className="text-xs">
                        Shared
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {item.quantity} × {formatEgp(item.unitPrice)} = {formatEgp(item.lineTotal)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive shrink-0 ml-2"
                  onClick={() => handleDeleteItem(item.itemId)}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      {/* Fixed bottom bar */}
      <div className="fixed bottom-0 left-0 right-0 border-t bg-background p-4">
        <div className="mx-auto max-w-sm">
          <Button
            className="w-full h-12 text-base"
            onClick={handleFinishAndShare}
            disabled={loading || items.length === 0}
          >
            {loading ? "Sharing..." : "Done — Share Session"}
          </Button>
        </div>
      </div>
    </div>
  );
}
