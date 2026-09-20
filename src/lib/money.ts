import { REPEAT_TAKE, TAKE_RATE } from "./types";

export function formatUsd(cents: number) {
  if (cents === 0) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export function takeRate(paidSessionsTogether: number) {
  return paidSessionsTogether >= 4 ? REPEAT_TAKE : TAKE_RATE;
}

export function hostPayout(priceCents: number, paidSessionsTogether: number) {
  const rate = takeRate(paidSessionsTogether);
  return Math.round(priceCents * (1 - rate));
}

export function cancelPolicyLine(priceCents: number) {
  if (priceCents === 0) {
    return "Free seat. Cancel anytime — a no-show still hits reliability.";
  }
  return `We’ll hold ${formatUsd(priceCents)}. Cancel 12 hours out for a full release. After that, half is captured. No-show captures the seat.`;
}
