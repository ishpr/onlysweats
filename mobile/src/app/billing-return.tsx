import { useEffect, useState } from "react";
import { Redirect, useRouter } from "expo-router";
import { PrivateMember, type PrivateMemberProps } from "@/components/private-member";
import { Button, Notice, Screen, StateView, T } from "@/components/ui";

/** Query parameters never prove payment; refresh only the signed-in owner's account. */
export default function BillingReturnRoute() {
  return <PrivateMember component={BillingReturn} />;
}
function BillingReturn({ session }: PrivateMemberProps) {
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void session
      .request("/billing/refresh", { method: "POST", json: {}, signal: controller.signal })
      .then(() => {
        if (!controller.signal.aborted && session.isCurrent()) setDone(true);
      })
      .catch(() => {
        if (!controller.signal.aborted && session.isCurrent()) setError(true);
      });
    return () => controller.abort();
  }, [session, attempt]);
  if (done) return <Redirect href="/billing" />;
  return (
    <Screen>
      <T variant="heading">Checking your payment status</T>
      {error ? (
        <>
          <Notice>
            We could not refresh Stripe’s status yet. You can retry or view the status last received
            by SamePace.
          </Notice>
          <Button
            label="Try payment refresh again"
            onPress={() => {
              setError(false);
              setAttempt((value) => value + 1);
            }}
          />
          <Button
            label="View membership & fees"
            variant="soft"
            onPress={() => router.replace("/billing")}
          />
        </>
      ) : (
        <StateView loading />
      )}
    </Screen>
  );
}
