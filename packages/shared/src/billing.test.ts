import { describe, expect, it } from "vitest";

import { bandMonthlyPriceCents, consolidatedMonthlyPriceCents } from "./billing.js";

describe("billing", () => {
  it("individual sem extras", () => {
    expect(bandMonthlyPriceCents("individual", 1)).toBe(2990);
  });

  it("individual com membros extras", () => {
    expect(bandMonthlyPriceCents("individual", 3)).toBe(2990 + 2 * 1990);
  });

  it("band_10 só cobra extra acima de 10", () => {
    expect(bandMonthlyPriceCents("band_10", 10)).toBe(12990);
    expect(bandMonthlyPriceCents("band_10", 12)).toBe(12990 + 2 * 990);
  });

  it("fatura consolidada do owner", () => {
    const total = consolidatedMonthlyPriceCents([
      { planCode: "individual", activeMemberCount: 2 },
      { planCode: "band_10", activeMemberCount: 11 },
    ]);
    expect(total).toBe(2990 + 1990 + 12990 + 990);
  });
});
