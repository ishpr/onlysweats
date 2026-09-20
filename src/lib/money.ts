/** PRD v0.3: nobody pays anybody. The only money is a fee for letting someone down. */
export const LATE_CANCEL_FEE_CENTS = 500;
export const NO_SHOW_FEE_CENTS = 1000;
export const SHOW_UP_CREDIT_CENTS = 500;

export function formatUsd(cents: number) {
  if (cents === 0) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export function cancelPolicyLine() {
  return `Joining costs nothing. Cancel 12 hours ahead at no cost. Inside 12 hours it’s a ${formatUsd(LATE_CANCEL_FEE_CENTS)} fee, waived if a substitute takes your seat. A no-show is ${formatUsd(NO_SHOW_FEE_CENTS)} and a strike.`;
}
