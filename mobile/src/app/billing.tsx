import { useEffect, useState } from "react";
import { Linking, View } from "react-native";
import { Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import { PrivateMember, type PrivateMemberProps } from "@/components/private-member";
import { Button, Card, Field, Notice, Screen, StateView, T } from "@/components/ui";
import { usePrivateAction } from "@/hooks/use-private-action";
import { ApiError, type ApiSession } from "@/lib/api";
import { openHostedBilling } from "@/lib/billing-flow";
import { SITE_URL } from "@/lib/config";
import { formatUsd } from "@/lib/format";
import type { BillingFee, BillingSummary } from "../../../shared/billing";

const MEMBERSHIP: Record<string, string> = {
  none: "No membership",
  active: "Active",
  trialing: "Trial",
  past_due: "Payment needs attention",
  incomplete: "Checkout incomplete",
  incomplete_expired: "Checkout expired",
  unpaid: "Unpaid",
  canceled: "Cancelled",
  paused: "Paused",
};
const PAYMENT: Record<BillingFee["paymentStatus"], string> = {
  unpaid: "Unpaid",
  checkout_open: "Checkout started",
  paid: "Paid",
  refund_pending: "Refund pending",
  refunded: "Refunded",
  failed: "Payment did not finish",
  review_required: "Under review",
};

export default function BillingRoute() {
  return <PrivateMember component={Billing} />;
}
function Billing({ member, session }: PrivateMemberProps) {
  const action = usePrivateAction(session);
  const [returned, setReturned] = useState(false);
  const summary = useQuery({
    queryKey: ["private-billing", member.id],
    gcTime: 0,
    retry: false,
    refetchOnMount: "always",
    queryFn: ({ signal }) => session.request<BillingSummary>("/billing", { signal }),
  });
  useEffect(
    () => () => {
      try {
        WebBrowser.dismissAuthSession();
      } catch {
        /* No active browser on this platform. */
      }
    },
    [],
  );
  const refresh = async () => {
    await summary.refetch();
  };
  const reconcile = () =>
    action.run(
      (signal) => session.request("/billing/refresh", { method: "POST", json: {}, signal }),
      refresh,
    );
  const checkout = (path: string, termsHash?: string) => {
    const requestId = Crypto.randomUUID();
    return action.run(
      (signal) =>
        openHostedBilling({
          session,
          path,
          input: { requestId, termsHash },
          signal,
          openBrowser: (url) => WebBrowser.openAuthSessionAsync(url, "samepace://billing-return"),
        }),
      async () => {
        setReturned(true);
        await refresh();
      },
    );
  };
  const value = summary.error ? null : summary.data;
  return (
    <Screen onRefresh={() => void reconcile()} refreshing={summary.isRefetching || action.busy}>
      <Stack.Screen options={{ title: "Membership & fees" }} />
      <T variant="heading">Membership & fees</T>
      <T color="textSecondary">
        Review the current amount before opening Stripe’s secure payment page. SamePace does not
        receive your card details.
      </T>
      {summary.error instanceof ApiError && summary.error.status === 404 ? (
        <Notice>Membership and fees aren’t open yet. Nothing can be charged.</Notice>
      ) : (
        (summary.isPending || summary.error) && (
          <StateView
            loading={summary.isPending}
            error={summary.error}
            onRetry={() => void refresh()}
          />
        )
      )}
      {returned && (
        <Notice>
          The payment page has closed. Payment and membership status below come from the server;
          processing may take a moment. Refresh if needed.
        </Notice>
      )}
      {value && (
        <>
          {(!value.enabled || !value.configured) && (
            <Notice>
              Payment collection is not available yet. You cannot be charged through this screen
              while it is unavailable.
            </Notice>
          )}
          <Card>
            <T variant="heading">Your membership</T>
            <T variant="label">{MEMBERSHIP[value.membership.status] ?? "Status needs review"}</T>
            <T variant="caption" color="textSecondary">
              {value.freeSessionsLeft} introductory free{" "}
              {value.freeSessionsLeft === 1 ? "session" : "sessions"} remaining.
            </T>
            {value.membership.periodEnd && (
              <T variant="caption" color="textSecondary">
                {value.membership.cancelAtPeriodEnd ? "Scheduled to end" : "Current period ends"}{" "}
                {new Date(value.membership.periodEnd).toLocaleDateString()}.
              </T>
            )}
            {value.creditCents > 0 && (
              <T variant="caption" color="textSecondary">
                {formatUsd(value.creditCents)} in membership credits. Credits do not pay session
                fees.
              </T>
            )}
            <T>{formatUsd(value.monthlyCents)} per month.</T>
            <T variant="caption" color="textSecondary">
              A subscription renews monthly until cancelled. Review the final amount and recurring
              terms in Stripe before paying. Manage or cancel an existing subscription below.
            </T>
            {value.membershipCheckout.reason && <Notice>{value.membershipCheckout.reason}</Notice>}
            {value.membershipCheckout.available && (
              <Button
                label={
                  value.membershipCheckout.resume
                    ? "Resume membership checkout in Stripe"
                    : `Review ${formatUsd(value.monthlyCents)}/month subscription in Stripe`
                }
                disabled={action.busy || summary.isFetching}
                onPress={() =>
                  void checkout("/billing/membership/checkout", value.membershipCheckout.termsHash)
                }
              />
            )}
            {value.portalAvailable && (
              <Button
                variant="soft"
                label="Manage or cancel membership in Stripe"
                disabled={action.busy || summary.isFetching}
                onPress={() => void checkout("/billing/portal")}
              />
            )}
            <Button
              variant="ghost"
              label="Read membership terms"
              accessibilityRole="link"
              onPress={() => void Linking.openURL(`${SITE_URL}/terms`)}
            />
          </Card>
          <T variant="heading">Session fees</T>
          {value.fees.length === 0 && <Notice>No session fees.</Notice>}
          {value.fees.map((fee) => (
            <FeeCard
              key={fee.id}
              fee={fee}
              session={session}
              disabled={action.busy || summary.isFetching}
              onCheckout={() =>
                checkout(`/billing/fees/${encodeURIComponent(fee.id)}/checkout`, fee.termsHash)
              }
              onChanged={refresh}
            />
          ))}
        </>
      )}
      {action.error && <Notice tone="danger">{action.error}</Notice>}
      <Button
        variant="soft"
        label="Refresh payment status"
        disabled={action.busy || summary.isFetching}
        onPress={() => void reconcile()}
      />
    </Screen>
  );
}

function FeeCard({
  fee,
  session,
  disabled,
  onCheckout,
  onChanged,
}: {
  fee: BillingFee;
  session: ApiSession;
  disabled: boolean;
  onCheckout: () => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const action = usePrivateAction(session);
  const [disputing, setDisputing] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <Card>
      <T variant="label">
        {fee.kind === "no_show_fee" ? "No-show fee" : "Late cancellation fee"} ·{" "}
        {formatUsd(fee.amountCents)}
      </T>
      <T variant="caption" color="textSecondary">
        {fee.sessionTitle ?? "Workout session"} · {new Date(fee.createdAt).toLocaleDateString()}
      </T>
      <T variant="caption" color="textSecondary">
        {fee.status === "waived" ? "Waived" : fee.status === "disputed" ? "Disputed" : "Assessed"} ·{" "}
        {PAYMENT[fee.paymentStatus]}
      </T>
      {fee.chargeableAt && fee.status === "assessed" && (
        <T variant="caption" color="textSecondary">
          Eligible for collection from {new Date(fee.chargeableAt).toLocaleString()}.
        </T>
      )}
      {fee.dispute && (
        <>
          <T variant="label">
            Dispute:{" "}
            {fee.dispute.status === "open"
              ? "under review"
              : fee.dispute.status === "upheld"
                ? "fee upheld"
                : "fee waived"}
          </T>
          <T variant="caption" color="textSecondary">
            Your reason: {fee.dispute.reason}
          </T>
          {fee.dispute.resolutionNote && (
            <T variant="caption" color="textSecondary">
              Review note: {fee.dispute.resolutionNote}
            </T>
          )}
        </>
      )}
      {fee.canPay && (
        <Button
          label={
            fee.paymentStatus === "checkout_open"
              ? `Resume ${formatUsd(fee.amountCents)} fee checkout in Stripe`
              : `Review ${formatUsd(fee.amountCents)} fee in Stripe`
          }
          disabled={disabled || action.busy}
          onPress={() => void onCheckout()}
        />
      )}
      {!fee.dispute && fee.status === "assessed" && (
        <Button
          variant="ghost"
          label={disputing ? "Cancel dispute entry" : "Ask for a review of this fee"}
          disabled={disabled || action.busy}
          onPress={() => setDisputing((value) => !value)}
        />
      )}
      {disputing && !fee.dispute && (
        <View style={{ gap: 12 }}>
          <Field
            label="Why should this fee be reviewed? (at least 10 characters)"
            value={reason}
            onChangeText={setReason}
            multiline
            maxLength={1000}
            editable={!disabled && !action.busy}
          />
          <Button
            variant="soft"
            label="Submit fee dispute"
            disabled={disabled || action.busy || reason.trim().length < 10}
            onPress={() =>
              void action.run(
                (signal) =>
                  session.request(`/billing/fees/${encodeURIComponent(fee.id)}/dispute`, {
                    method: "POST",
                    json: { reason: reason.trim() },
                    signal,
                  }),
                async () => {
                  setDisputing(false);
                  setReason("");
                  await onChanged();
                },
              )
            }
          />
        </View>
      )}
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </Card>
  );
}
