export type PlanCode = "individual" | "band_10" | "band_20";

export interface PlanDefinition {
  code: PlanCode;
  name: string;
  basePriceCents: number;
  memberLimit: number;
  extraMemberPriceCents: number;
}

export const PLANS: Record<PlanCode, PlanDefinition> = {
  individual: {
    code: "individual",
    name: "Individual",
    basePriceCents: 2990,
    memberLimit: 1,
    extraMemberPriceCents: 1990,
  },
  band_10: {
    code: "band_10",
    name: "Banda 10",
    basePriceCents: 12990,
    memberLimit: 10,
    extraMemberPriceCents: 990,
  },
  band_20: {
    code: "band_20",
    name: "Banda 20",
    basePriceCents: 19990,
    memberLimit: 20,
    extraMemberPriceCents: 890,
  },
};

export const TRIAL_DAYS = 2;
export const GRACE_PERIOD_DAYS = 5;

export function bandMonthlyPriceCents(planCode: PlanCode, activeMemberCount: number): number {
  const plan = PLANS[planCode];
  const extraMembers = Math.max(0, activeMemberCount - plan.memberLimit);
  return plan.basePriceCents + extraMembers * plan.extraMemberPriceCents;
}

export function consolidatedMonthlyPriceCents(
  bands: Array<{ planCode: PlanCode; activeMemberCount: number }>,
): number {
  return bands.reduce((total, band) => total + bandMonthlyPriceCents(band.planCode, band.activeMemberCount), 0);
}

export function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
