export type BillingFee = {
  id: string;
  kind: "late_cancel_fee" | "no_show_fee";
  amountCents: number;
  status: "assessed" | "disputed" | "waived";
  paymentStatus:
    | "unpaid"
    | "checkout_open"
    | "paid"
    | "refund_pending"
    | "refunded"
    | "failed"
    | "review_required";
  chargeableAt: string | null;
  createdAt: string;
  sessionTitle: string | null;
  bookingId: string | null;
  canPay: boolean;
  termsHash: string;
  dispute: {
    id: string;
    status: "open" | "waived" | "upheld";
    reason: string;
    resolutionNote: string | null;
  } | null;
};
export type BillingSummary = {
  enabled: boolean;
  configured: boolean;
  clusterReady: boolean;
  enforced: boolean;
  monthlyCents: 1200;
  currency: "USD";
  freeSessionsLeft: number;
  membership: {
    status: string;
    active: boolean;
    periodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  };
  membershipCheckout: {
    available: boolean;
    resume: boolean;
    termsHash: string;
    reason: string | null;
  };
  portalAvailable: boolean;
  /** Membership-only credits still awaiting export to Stripe, plus available balance. */
  creditCents: number;
  fees: BillingFee[];
};
export type BillingDispute = {
  id: string;
  profileId: string;
  feeId: string;
  amountCents: number;
  status: "open" | "waived" | "upheld";
  reason: string;
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
};
