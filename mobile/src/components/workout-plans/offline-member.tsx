import { useEffect, useState, type ComponentType } from "react";
import { Redirect } from "expo-router";
import { AppState } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { captureApiSession, ApiError, type ApiSession } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { offlineWorkouts, boundedWorkoutRequest } from "@/lib/workout-plans/offline";
import { Notice, Screen, StateView } from "@/components/ui";

export type OfflineWorkoutMemberProps = {
  member: { id: string };
  session: ApiSession;
  offlineIdentity: boolean;
  offlineStorageAvailable: boolean;
};
export const isConnectionFailure = (error: unknown) =>
  error instanceof ApiError && (error.status === 0 || error.status === 429 || error.status >= 500);

/** Only already-opened workout routes can use this short-lived, exact-token identity. */
export function OfflineWorkoutMember({
  component,
}: {
  component: ComponentType<OfflineWorkoutMemberProps>;
}) {
  const { signedIn } = useAuth();
  if (!signedIn) return signedIn === false ? <Redirect href="/sign-in" /> : null;
  return <Captured component={component} />;
}
function Captured({
  component: Component,
}: {
  component: ComponentType<OfflineWorkoutMemberProps>;
}) {
  const [session] = useState(captureApiSession);
  const [owner, setOwner] = useState<string | null>(null);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<Error | null>(null);
  const identity = useQuery({
    queryKey: ["offline-workout-identity"],
    gcTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      const member = await boundedWorkoutRequest<{ id: string }>(session!, "/me", { signal });
      try {
        await offlineWorkouts.verifyOwner(member.id, session!.isCurrent);
        return { ...member, storageAvailable: true };
      } catch {
        return { ...member, storageAvailable: false };
      }
    },
    enabled: !!session,
  });
  useEffect(() => {
    if (!session || identity.isPending) return;
    let live = true;
    void (async () => {
      if (identity.error && !isConnectionFailure(identity.error)) {
        // A failed access check hides cached views. Only actual auth revocation
        // (401, handled by the auth provider) clears all pending device records.
        throw identity.error;
      }
      if (!identity.error && identity.data && !identity.data.storageAvailable) {
        if (live && session.isCurrent()) {
          setOwner(identity.data.id);
          setStorageAvailable(false);
          setReady(true);
          setFailure(null);
        }
        return;
      }
      const id = await offlineWorkouts.owner(session.isCurrent);
      if (live && session.isCurrent()) {
        setOwner(id);
        setStorageAvailable(true);
        setReady(true);
        setFailure(null);
      }
    })().catch((error) => {
      if (live && session.isCurrent()) {
        setOwner(null);
        setReady(true);
        setFailure(
          error instanceof Error ? error : new Error("Protected workout storage is unavailable."),
        );
      }
    });
    return () => {
      live = false;
    };
  }, [identity.data, identity.dataUpdatedAt, identity.error, identity.isPending, session]);
  const refetchIdentity = identity.refetch;
  useEffect(() => {
    if (!session || !storageAvailable || !owner) return;
    const check = () => {
      void offlineWorkouts
        .owner(session.isCurrent)
        .then((id) => {
          if (session.isCurrent() && !id) {
            setOwner(null);
            setReady(true);
            void refetchIdentity();
          }
        })
        .catch(() => {
          if (session.isCurrent()) setOwner(null);
        });
    };
    const timer = setInterval(check, 30_000);
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") check();
    });
    return () => {
      clearInterval(timer);
      listener.remove();
    };
  }, [session, storageAvailable, owner, refetchIdentity]);
  if (!session)
    return (
      <Screen>
        <Notice>Sign in again to open your workouts.</Notice>
      </Screen>
    );
  if (!ready || !owner)
    return (
      <Screen>
        <StateView
          loading={!ready}
          error={failure ?? identity.error}
          onRetry={() => void identity.refetch()}
        />
        {ready && !owner && (
          <Notice>
            Connect to verify your account and open your saved workouts. Offline access expires
            after 24 hours.
          </Notice>
        )}
      </Screen>
    );
  return (
    <Component
      key={owner}
      member={{ id: owner }}
      session={session}
      offlineIdentity={!!identity.error}
      offlineStorageAvailable={storageAvailable}
    />
  );
}
