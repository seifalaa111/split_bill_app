import { describe, it, expect } from "vitest";
import {
  bankersRound,
  calculateLineTotal,
  calculateSharedItemCost,
  calculateClaimAmount,
  calculatePersonalSubtotal,
  calculateSessionTotals,
  splitEqually,
  calculatePersonalTotal,
  calculateRoundingDifference,
  isWithinTolerance,
} from "../calculations";

describe("bankersRound", () => {
  it("rounds normally when not at midpoint", () => {
    expect(bankersRound(2.3, 0)).toBe(2);
    expect(bankersRound(2.7, 0)).toBe(3);
    expect(bankersRound(1.234, 2)).toBe(1.23);
    expect(bankersRound(1.236, 2)).toBe(1.24);
  });

  it("rounds 0.5 to even (banker's rounding)", () => {
    expect(bankersRound(2.5, 0)).toBe(2);
    expect(bankersRound(3.5, 0)).toBe(4);
    expect(bankersRound(4.5, 0)).toBe(4);
    expect(bankersRound(5.5, 0)).toBe(6);
  });

  it("rounds to 2 decimal places correctly", () => {
    expect(bankersRound(2.345, 2)).toBe(2.34);
    expect(bankersRound(2.355, 2)).toBe(2.36);
    expect(bankersRound(2.365, 2)).toBe(2.36);
    expect(bankersRound(2.375, 2)).toBe(2.38);
  });

  it("handles negative numbers", () => {
    expect(bankersRound(-2.5, 0)).toBe(-2);
    expect(bankersRound(-3.5, 0)).toBe(-4);
  });

  it("handles zero", () => {
    expect(bankersRound(0, 2)).toBe(0);
  });
});

describe("calculateLineTotal", () => {
  it("calculates quantity × unit price", () => {
    expect(calculateLineTotal(3, 25)).toBe(75);
    expect(calculateLineTotal(1, 185)).toBe(185);
    expect(calculateLineTotal(2, 12.5)).toBe(25);
  });

  it("handles quantity of 1", () => {
    expect(calculateLineTotal(1, 145)).toBe(145);
  });

  it("handles unit price of 0", () => {
    expect(calculateLineTotal(5, 0)).toBe(0);
  });
});

describe("calculateSharedItemCost", () => {
  it("splits evenly among claimants", () => {
    expect(calculateSharedItemCost(30, 3)).toBe(10);
    expect(calculateSharedItemCost(100, 4)).toBe(25);
  });

  it("handles uneven splits with rounding", () => {
    expect(calculateSharedItemCost(10, 3)).toBe(3.33);
    expect(calculateSharedItemCost(7, 3)).toBe(2.33);
  });

  it("returns full cost for single claimant", () => {
    expect(calculateSharedItemCost(30, 1)).toBe(30);
  });

  it("returns 0 for zero claimants", () => {
    expect(calculateSharedItemCost(30, 0)).toBe(0);
  });
});

describe("calculateClaimAmount", () => {
  it("calculates unit price × quantity", () => {
    expect(calculateClaimAmount(25, 1)).toBe(25);
    expect(calculateClaimAmount(25, 2)).toBe(50);
    expect(calculateClaimAmount(12.33, 3)).toBe(36.99);
  });
});

describe("calculatePersonalSubtotal", () => {
  it("sums all claim amounts", () => {
    expect(calculatePersonalSubtotal([185, 25, 10])).toBe(220);
    expect(calculatePersonalSubtotal([145, 25, 10])).toBe(180);
    expect(calculatePersonalSubtotal([65, 25, 10])).toBe(100);
  });

  it("returns 0 for empty claims", () => {
    expect(calculatePersonalSubtotal([])).toBe(0);
  });

  it("handles single claim", () => {
    expect(calculatePersonalSubtotal([185])).toBe(185);
  });
});

describe("calculateSessionTotals", () => {
  it("calculates tax and service amounts", () => {
    const result = calculateSessionTotals(500, 14, 12);
    expect(result.taxAmount).toBe(70);
    expect(result.serviceAmount).toBe(60);
  });

  it("handles zero percentages", () => {
    const result = calculateSessionTotals(500, 0, 0);
    expect(result.taxAmount).toBe(0);
    expect(result.serviceAmount).toBe(0);
  });

  it("handles non-round percentages", () => {
    const result = calculateSessionTotals(333, 14, 12);
    expect(result.taxAmount).toBe(46.62);
    expect(result.serviceAmount).toBe(39.96);
  });
});

describe("splitEqually", () => {
  it("splits evenly when divisible", () => {
    expect(splitEqually(60, 3)).toEqual([20, 20, 20]);
    expect(splitEqually(100, 4)).toEqual([25, 25, 25, 25]);
  });

  it("assigns remainder to host (index 0)", () => {
    const result = splitEqually(70, 3);
    // 70 / 3 = 23.33 each → distributed = 69.99 → remainder = 0.01
    expect(result[0]).toBe(23.34);
    expect(result[1]).toBe(23.33);
    expect(result[2]).toBe(23.33);
    expect(result.reduce((a, b) => a + b, 0)).toBeCloseTo(70, 2);
  });

  it("handles single participant", () => {
    expect(splitEqually(70, 1)).toEqual([70]);
  });

  it("handles zero amount", () => {
    expect(splitEqually(0, 3)).toEqual([0, 0, 0]);
  });

  it("returns empty array for zero participants", () => {
    expect(splitEqually(70, 0)).toEqual([]);
  });
});

describe("calculatePersonalTotal", () => {
  it("sums subtotal + tax share + service share", () => {
    expect(calculatePersonalTotal(220, 23.33, 20)).toBe(263.33);
    expect(calculatePersonalTotal(180, 23.33, 20)).toBe(223.33);
    expect(calculatePersonalTotal(100, 23.33, 20)).toBe(143.33);
  });

  it("handles zero tax and service", () => {
    expect(calculatePersonalTotal(100, 0, 0)).toBe(100);
  });
});

describe("calculateRoundingDifference", () => {
  it("returns the gap between bill total and sum of personal totals", () => {
    const diff = calculateRoundingDifference(630, [263.33, 223.33, 143.33]);
    expect(diff).toBeCloseTo(0.01, 2);
  });

  it("returns 0 for exact match", () => {
    expect(calculateRoundingDifference(100, [50, 50])).toBe(0);
  });
});

describe("isWithinTolerance", () => {
  it("accepts difference within ± 0.10", () => {
    expect(isWithinTolerance(630, [263.33, 223.33, 143.33])).toBe(true);
  });

  it("rejects difference beyond tolerance", () => {
    expect(isWithinTolerance(630, [260, 220, 140])).toBe(false);
  });

  it("accepts exact match", () => {
    expect(isWithinTolerance(100, [50, 50])).toBe(true);
  });
});

describe("Full Acceptance Test Scenario", () => {
  it("passes the Phase 1 acceptance test", () => {
    // Bill details
    const billSubtotal = 500;
    const taxPct = 14;
    const servicePct = 12;
    const participantCount = 3;

    // Items
    const grilledChicken = calculateLineTotal(1, 185); // 185
    const pastaAlfredo = calculateLineTotal(1, 145);    // 145
    const cocaCola = calculateLineTotal(3, 25);          // 75
    const breadBasket = calculateLineTotal(1, 30);       // 30 (shared)
    const cheesecake = calculateLineTotal(1, 65);        // 65

    expect(grilledChicken).toBe(185);
    expect(pastaAlfredo).toBe(145);
    expect(cocaCola).toBe(75);
    expect(breadBasket).toBe(30);
    expect(cheesecake).toBe(65);

    // Verify subtotal
    const itemSubtotal = grilledChicken + pastaAlfredo + cocaCola + breadBasket + cheesecake;
    expect(itemSubtotal).toBe(500);

    // Session totals
    const { taxAmount, serviceAmount } = calculateSessionTotals(billSubtotal, taxPct, servicePct);
    expect(taxAmount).toBe(70);
    expect(serviceAmount).toBe(60);

    // Shared bread basket cost per person (3 claimants)
    const breadPerPerson = calculateSharedItemCost(breadBasket, 3);
    expect(breadPerPerson).toBe(10);

    // Ahmed claims: Grilled Chicken (185), 1x Coca-Cola (25), shared Bread Basket (10)
    const ahmedSubtotal = calculatePersonalSubtotal([
      calculateClaimAmount(185, 1),
      calculateClaimAmount(25, 1),
      breadPerPerson,
    ]);
    expect(ahmedSubtotal).toBe(220);

    // Salma claims: Pasta Alfredo (145), 1x Coca-Cola (25), shared Bread Basket (10)
    const salmaSubtotal = calculatePersonalSubtotal([
      calculateClaimAmount(145, 1),
      calculateClaimAmount(25, 1),
      breadPerPerson,
    ]);
    expect(salmaSubtotal).toBe(180);

    // Omar claims: Cheesecake (65), 1x Coca-Cola (25), shared Bread Basket (10)
    const omarSubtotal = calculatePersonalSubtotal([
      calculateClaimAmount(65, 1),
      calculateClaimAmount(25, 1),
      breadPerPerson,
    ]);
    expect(omarSubtotal).toBe(100);

    // Verify subtotals sum to bill subtotal
    expect(ahmedSubtotal + salmaSubtotal + omarSubtotal).toBe(500);

    // Tax and service splits (equal, remainder to host at index 0)
    const taxShares = splitEqually(taxAmount, participantCount);
    const serviceShares = splitEqually(serviceAmount, participantCount);

    // Tax: 70 / 3 = 23.33... → host gets remainder
    expect(taxShares[0]).toBe(23.34);
    expect(taxShares[1]).toBe(23.33);
    expect(taxShares[2]).toBe(23.33);

    // Service: 60 / 3 = 20 exactly
    expect(serviceShares[0]).toBe(20);
    expect(serviceShares[1]).toBe(20);
    expect(serviceShares[2]).toBe(20);

    // Personal totals (assuming Ahmed is host = index 0)
    const ahmedTotal = calculatePersonalTotal(ahmedSubtotal, taxShares[0], serviceShares[0]);
    const salmaTotal = calculatePersonalTotal(salmaSubtotal, taxShares[1], serviceShares[1]);
    const omarTotal = calculatePersonalTotal(omarSubtotal, taxShares[2], serviceShares[2]);

    expect(ahmedTotal).toBe(263.34);
    expect(salmaTotal).toBe(223.33);
    expect(omarTotal).toBe(143.33);

    // Verify total
    const billTotal = billSubtotal + taxAmount + serviceAmount; // 630
    expect(billTotal).toBe(630);

    const allTotals = [ahmedTotal, salmaTotal, omarTotal];
    const sumOfTotals = allTotals.reduce((a, b) => a + b, 0);
    expect(sumOfTotals).toBe(630); // Exact match because host absorbed remainder

    // Tolerance check
    expect(isWithinTolerance(billTotal, allTotals)).toBe(true);
  });
});
