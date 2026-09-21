import {
  createContext,
  use,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Linking, StyleSheet, View } from "react-native";
import {
  Bot,
  FileText,
  HeartPulse,
  Lock,
  ScrollText,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useGlobalSearchParams, usePathname, useRouter, type Href } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { welcomeKey } from "@/app/welcome";
import { PaceMark } from "@/components/brand";
import { StepDots } from "@/components/step-dots";
import { ListCard, ListRow } from "@/components/list";
import { Appear } from "@/components/motion";
import { Button, Card, Notice, Screen, StateView, T } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { usePrivateAction } from "@/hooks/use-private-action";
import { useTheme } from "@/hooks/use-theme";
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

/**
 * The gist of the coaching notice, for reading in ten seconds. The notice itself — the
 * text that is actually agreed to — stays one tap away, word for word.
 */
const POINTS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Bot,
    title: "Your assistant uses cloud AI",
    body: "Your chats with it, your plans and the workout results you enter may be sent to our cloud AI provider when that helps answer you. Kept for up to 30 days, or until you clear them.",
  },
  {
    icon: HeartPulse,
    title: "Apple Health stays your call",
    body: "Workout summaries are only used if you separately allow Apple Health — and you can switch that off at any time.",
  },
  {
    icon: ShieldCheck,
    title: "Nothing happens without you",
    body: "Saving workouts, booking, sharing and payments always ask first. Your private records never go to buddies or their assistants.",
  },
  {
    icon: TriangleAlert,
    title: "AI can be wrong",
    body: "Suggestions are a starting point, not medical advice. Plans are targets; what you enter is your record.",
  },
];

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: "center" },
  hero: { gap: Spacing.one, paddingTop: Spacing.four },
  points: { gap: Spacing.three },
  point: { flexDirection: "row", gap: Spacing.two },
  pointIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  footer: { gap: Spacing.one },
  deciding: { flex: 1, alignItems: "center", justifyContent: "center" },
});

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
  const theme = useTheme();
  const [showNotice, setShowNotice] = useState(false);
  // A new account meets this as the first step of getting started, not as a wall.
  const ownerId = terms.data?.ownerId;
  const [isNew, setIsNew] = useState(false);
  useEffect(() => {
    if (!ownerId) return;
    let alive = true;
    void SecureStore.getItemAsync(welcomeKey(ownerId))
      .then((seen) => {
        if (alive) setIsNew(!seen);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [ownerId]);
  const needsAnswer = Boolean(terms.data && !terms.error && !terms.data.accepted);
  // Until the server (or a saved receipt) says an answer is needed, this is only a pause —
  // a member who already agreed must never see the terms again on the way in.
  const deciding = !needsAnswer && !terms.error;
  const review = deciding ? (
    <Screen edges={["top", "bottom"]} scroll={false} contentStyle={styles.deciding}>
      <PaceMark size={56} />
    </Screen>
  ) : (
    <Screen
      edges={["top", "bottom"]}
      footer={
        needsAnswer ? (
          <View style={styles.footer}>
            <T variant="caption" color="textSecondary" style={styles.center}>
              By continuing you accept the Terms of Service and acknowledge the Privacy Policy,
              including the AI processing described in the full notice.
            </T>
            <Button
              label="Agree and continue"
              variant="accent"
              loading={action.busy}
              onPress={accept}
            />
            <Button label="Not now — sign me out" variant="ghost" onPress={() => void signOut()} />
          </View>
        ) : undefined
      }
    >
      {isNew && needsAnswer ? <StepDots step={0} total={4} /> : null}
      <Appear style={styles.hero}>
        <PaceMark size={44} />
        <T variant="title">Before you start</T>
        <T color="textSecondary">
          SamePace comes with an AI assistant. Here’s what that means for you, in four lines.
        </T>
      </Appear>
      {(terms.isPending || terms.error) && (
        <StateView
          loading={terms.isPending}
          error={terms.error}
          onRetry={() => void terms.refetch()}
        />
      )}
      {needsAnswer && (
        <Card style={styles.points}>
          {POINTS.map(({ icon: Icon, title, body }) => (
            <View key={title} style={styles.point}>
              <View style={[styles.pointIcon, { backgroundColor: theme.accentSoft }]}>
                <Icon size={18} color={theme.accent} />
              </View>
              <View style={styles.flex}>
                <T variant="label">{title}</T>
                <T variant="caption" color="textSecondary">
                  {body}
                </T>
              </View>
            </View>
          ))}
        </Card>
      )}
      <ListCard>
        {needsAnswer ? (
          <ListRow
            icon={ScrollText}
            label="Read the full notice"
            expanded={showNotice}
            onPress={() => setShowNotice((value) => !value)}
          >
            <T variant="caption" color="textSecondary" selectable>
              {APP_TERMS_COACHING_NOTICE}
            </T>
          </ListRow>
        ) : null}
        <ListRow
          icon={FileText}
          label="Terms of Service"
          accessibilityRole="link"
          onPress={() => void Linking.openURL(`${SITE_URL}/terms`)}
        />
        <ListRow
          icon={Lock}
          label="Privacy Policy"
          accessibilityRole="link"
          onPress={() => void Linking.openURL(`${SITE_URL}/privacy`)}
        />
      </ListCard>
      {action.error && <Notice tone="danger">{action.error}</Notice>}
      {!needsAnswer && <Button label="Sign out" variant="soft" onPress={() => void signOut()} />}
      <ListCard>
        <ListRow
          icon={Trash2}
          label="Delete my account"
          danger
          onPress={() => router.push("/delete-account")}
        />
      </ListCard>
    </Screen>
  );
  return <TermsContext value={{ allowed, review }}>{children}</TermsContext>;
}
