import {
  createContext,
  use,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Linking, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useGlobalSearchParams, usePathname, useRouter, type Href } from "expo-router";
import { Button, Card, Notice, Screen, StateView, T } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { usePrivateAction } from "@/hooks/use-private-action";
import { ApiError, captureApiSession } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { SITE_URL } from "@/lib/config";
import { appTermsReceipt, requestAppTerms } from "@/lib/app-terms";
import {
  confirmTermsAcceptance,
  permitsAppAccess,
  readAppTermsStatus,
} from "@/lib/app-terms-store";
import {
  APP_TERMS_COACHING_NOTICE,
  APP_TERMS_VERSION,
  type AppTermsStatus,
} from "../../../shared/app-terms";

const TermsContext = createContext<{ allowed: boolean; review: ReactNode } | null>(null);
export function useAppTermsAccepted() {
  return use(TermsContext)?.allowed ?? false;
}
export function AppTermsReview() {
  return use(TermsContext)?.review ?? null;
}

/** Re-key every in-memory permission, action and pending request for the exact auth session. */
export function AppTermsProvider({
  signedIn,
  children,
}: {
  signedIn: boolean;
  children: ReactNode;
}) {
  const generation = useSyncExternalStore(
    appTermsReceipt.subscribe,
    appTermsReceipt.generation,
    appTermsReceipt.generation,
  );
  return signedIn ? (
    <SignedInTerms key={generation} generation={generation}>
      {children}
    </SignedInTerms>
  ) : (
    children
  );
}

function SignedInTerms({ generation, children }: { generation: number; children: ReactNode }) {
  const [session] = useState(captureApiSession);
  if (!session)
    return (
      <TermsContext value={{ allowed: false, review: <MissingSession /> }}>{children}</TermsContext>
    );
  return (
    <TermsState generation={generation} session={session}>
      {children}
    </TermsState>
  );
}
function MissingSession() {
  const { signOut } = useAuth();
  return (
    <Screen edges={["top", "bottom"]}>
      <Notice>Sign in again to confirm your SamePace terms.</Notice>
      <Button label="Sign out" variant="soft" onPress={() => void signOut()} />
    </Screen>
  );
}

function TermsState({
  generation,
  session,
  children,
}: {
  generation: number;
  session: NonNullable<ReturnType<typeof captureApiSession>>;
  children: ReactNode;
}) {
  const { signOut } = useAuth();
  const client = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  // Keep an incoming invite/session in memory while protected routes are unavailable.
  const [pendingRoute] = useState<Href | null>(() =>
    ["/", "/sign-in", "/app-terms", "/delete-account"].includes(pathname)
      ? null
      : ({ pathname, params } as Href),
  );
  const [receipt, setReceipt] = useState<AppTermsStatus | null>(null);
  const action = usePrivateAction(session);
  const queryKey = ["private-app-terms", generation];
  useEffect(() => {
    let alive = true;
    void appTermsReceipt
      .load()
      .then((value) => {
        if (alive && session.isCurrent()) setReceipt(value);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [session]);
  const terms = useQuery({
    queryKey,
    gcTime: 0,
    staleTime: 60_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const result = readAppTermsStatus(await requestAppTerms(session, { signal }));
      if (result.accepted)
        void appTermsReceipt.remember(result, session.isCurrent).catch(() => undefined);
      else void appTermsReceipt.forget().catch(() => undefined);
      return result;
    },
  });
  const connectionFailure =
    terms.error instanceof ApiError &&
    (terms.error.status === 0 || terms.error.status === 429 || terms.error.status >= 500);
  const allowed = permitsAppAccess({
    currentSession: session.isCurrent(),
    live: terms.data ?? null,
    receipt,
    failure: terms.error ? (connectionFailure ? "connection" : "denied") : "none",
  });
  useEffect(() => {
    if (allowed && pendingRoute && pathname === "/app-terms") router.replace(pendingRoute);
  }, [allowed, pendingRoute, pathname, router]);
  const accept = () => {
    if (!terms.data || terms.error || terms.data.accepted || !session.isCurrent()) return;
    void action.run(
      async (signal) => {
        await client.cancelQueries({ queryKey, exact: true });
        const status = await confirmTermsAcceptance(
          (method) =>
            requestAppTerms(session, {
              method,
              ...(method === "PUT" ? { json: { version: APP_TERMS_VERSION } } : {}),
              signal,
            }),
          () => session.isCurrent() && !signal.aborted,
        );
        void appTermsReceipt.remember(status, session.isCurrent).catch(() => undefined);
        return status;
      },
      async (status) => {
        await client.cancelQueries({ queryKey, exact: true });
        if (!session.isCurrent()) return;
        client.removeQueries({ queryKey: ["private-assistant-chat"] });
        client.setQueryData(queryKey, status);
      },
    );
  };
  const review = (
    <Screen edges={["top", "bottom"]}>
      <View style={{ gap: Spacing.three }}>
        <T variant="title">Welcome to SamePace</T>
        <T>Review how SamePace works before continuing.</T>
        {(terms.isPending || terms.error) && (
          <StateView
            loading={terms.isPending}
            error={terms.error}
            onRetry={() => void terms.refetch()}
          />
        )}
        {terms.data && !terms.error && !terms.data.accepted && (
          <>
            <Card>
              <T variant="label">Coaching is part of SamePace</T>
              <T>{APP_TERMS_COACHING_NOTICE}</T>
            </Card>
            <T variant="caption" color="textSecondary">
              By choosing Agree and continue, you accept the Terms of Service and acknowledge the
              Privacy Policy, including the AI processing described above.
            </T>
          </>
        )}
        <Button
          label="Read Terms of Service"
          variant="ghost"
          onPress={() => void Linking.openURL(`${SITE_URL}/terms`)}
        />
        <Button
          label="Read Privacy Policy"
          variant="ghost"
          onPress={() => void Linking.openURL(`${SITE_URL}/privacy`)}
        />
        {action.error && <Notice tone="danger">{action.error}</Notice>}
        {terms.data && !terms.error && !terms.data.accepted && (
          <Button label="Agree and continue" loading={action.busy} onPress={accept} />
        )}
        <Button label="Decline and sign out" variant="soft" onPress={() => void signOut()} />
        <Button
          label="Delete my account"
          variant="ghost"
          onPress={() => router.push("/delete-account")}
        />
      </View>
    </Screen>
  );
  return <TermsContext value={{ allowed, review }}>{children}</TermsContext>;
}
