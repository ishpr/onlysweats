/** Synthetic, stateful provider for money-flow tests. Never contacts Stripe. */
import type {
  BillingConfig,
  BillingProvider,
  ProviderCheckout,
  ProviderInvoice,
} from "./provider.server.ts";
export const testConfig: BillingConfig = {
  enabled: true,
  clusterReady: true,
  enforced: false,
  secretKey: "sk_test_synthetic",
  webhookSecret: "whsec_synthetic",
  priceId: "price_membership",
  portalConfigurationId: "bpc_test",
  returnUrl: "https://samepace.example/billing-return",
  livemode: false,
  configured: true,
};
export class FakeStripe implements BillingProvider {
  customers = new Map<string, string>();
  sessions = new Map<string, ProviderCheckout>();
  memberships = new Map<string, Awaited<ReturnType<BillingProvider["membership"]>>>();
  payments = new Map<string, Awaited<ReturnType<BillingProvider["payment"]>>>();
  invoices = new Map<string, ProviderInvoice>();
  refunds = new Map<string, { id: string; status: string; paymentIntentId: string }>();
  credits = new Map<string, string>();
  deleted = new Set<string>();
  raceOnExpire = new Set<string>();
  priceAmount = 1200;
  loseCheckoutResponse = false;
  loseCustomerResponse = false;
  failDelete = false;
  loseDeleteResponse = false;
  failRefund = false;
  refundState = "succeeded";
  creations = 0;
  refundCalls = 0;
  customerCalls = 0;
  async price() {
    return {
      active: true,
      currency: "usd",
      amount: this.priceAmount,
      interval: "month",
      intervalCount: 1,
      livemode: false,
    };
  }
  async createCustomer(account: string) {
    if (!this.customers.has(account)) {
      this.customerCalls++;
      this.customers.set(account, `cus_${this.customerCalls}`);
    }
    if (this.loseCustomerResponse) {
      this.loseCustomerResponse = false;
      throw new Error("lost customer response");
    }
    return this.customers.get(account)!;
  }
  async findCustomer(account: string) {
    const id = this.customers.get(account);
    return id && !this.deleted.has(id) ? id : null;
  }
  async createCheckout(input: Parameters<BillingProvider["createCheckout"]>[0]) {
    let session = [...this.sessions.values()].find((s) => s.operationId === input.id);
    if (!session) {
      this.creations++;
      const id = `cs_test_${this.creations}`;
      session = {
        id,
        customerId: input.customerId,
        operationId: input.id,
        accountId: input.accountId,
        status: "open",
        paymentStatus: "unpaid",
        url: `https://checkout.stripe.com/c/pay/${id}`,
        amountTotal: input.amountCents,
        currency: "usd",
        paymentIntentId: null,
        subscriptionId: null,
        livemode: false,
      };
      this.sessions.set(id, session);
    }
    if (this.loseCheckoutResponse) {
      this.loseCheckoutResponse = false;
      throw new Error("lost checkout response");
    }
    return { ...session };
  }
  async checkout(id: string) {
    const s = this.sessions.get(id);
    if (!s) throw new Error("No synthetic checkout");
    return { ...s };
  }
  async findCheckout(
    customerId: string,
    operationId: string,
    _createdAfter?: number,
    customerDeleted = false,
  ) {
    const s = [...this.sessions.values()].find(
      (s) => (customerDeleted || s.customerId === customerId) && s.operationId === operationId,
    );
    return s ? { ...s } : null;
  }
  async expireCheckout(id: string) {
    if (this.raceOnExpire.delete(id)) {
      this.pay(id);
      throw new Error("Payment won expiry race");
    }
    const s = this.sessions.get(id)!;
    if (s.status === "open") s.status = "expired";
  }
  async portal() {
    return "https://billing.stripe.com/p/session/test";
  }
  async membership(customerId: string) {
    return (
      this.memberships.get(customerId) ?? {
        status: "none",
        subscriptionId: null,
        periodEnd: null,
        cancelAtPeriodEnd: false,
        creditCents: 0,
      }
    );
  }
  async invoice(id: string) {
    const i = this.invoices.get(id);
    if (!i) throw new Error("No synthetic invoice");
    return { ...i };
  }
  async payment(id: string) {
    const p = this.payments.get(id);
    if (!p) throw new Error("No synthetic payment");
    return { ...p };
  }
  async refund(paymentIntentId: string, amount: number, key: string) {
    if (this.failRefund) throw new Error("Synthetic refund endpoint unavailable");
    const prior = this.refunds.get(key);
    if (prior) return prior;
    this.refundCalls++;
    const result = { id: `re_${this.refundCalls}`, status: this.refundState, paymentIntentId };
    this.refunds.set(key, result);
    if (result.status === "succeeded") this.payments.get(paymentIntentId)!.refunded += amount;
    return result;
  }
  async refundStatus(id: string) {
    return [...this.refunds.values()].find((r) => r.id === id)!;
  }
  async paymentReference(_type: string, objectId: string) {
    return [...this.refunds.values()].find((r) => r.id === objectId)?.paymentIntentId ?? objectId;
  }
  async credit(customerId: string, ledgerId: string, amount: number) {
    if (!this.credits.has(ledgerId)) {
      this.credits.set(ledgerId, `cbtxn_${this.credits.size + 1}`);
      const member = await this.membership(customerId);
      this.memberships.set(customerId, { ...member, creditCents: member.creditCents + amount });
    }
    return this.credits.get(ledgerId)!;
  }
  async deleteCustomer(customerId: string) {
    if (this.failDelete) throw new Error("provider unavailable");
    this.deleted.add(customerId);
    for (const session of this.sessions.values())
      if (session.customerId === customerId) session.customerId = null;
    for (const payment of this.payments.values())
      if (payment.customerId === customerId) payment.customerId = null;
    this.memberships.set(customerId, {
      status: "canceled",
      subscriptionId: null,
      periodEnd: null,
      cancelAtPeriodEnd: false,
      creditCents: 0,
    });
    if (this.loseDeleteResponse) {
      this.loseDeleteResponse = false;
      throw new Error("Synthetic customer deletion response lost");
    }
  }
  pay(id: string) {
    const s = this.sessions.get(id)!;
    s.status = "complete";
    s.paymentStatus = "paid";
    s.url = null;
    s.paymentIntentId = `pi_${id}`;
    this.payments.set(s.paymentIntentId, {
      customerId: s.customerId,
      status: "succeeded",
      amount: s.amountTotal!,
      currency: "usd",
      refunded: 0,
      disputed: false,
    });
  }
}
