/**
 * Settings: the one place that is allowed to be rows and switches. Everything
 * permission-shaped in the app lives here or one tap from here; feature screens keep
 * a single line and a link back.
 */
import { useRouter } from "expo-router";
import {
  BadgeCheck,
  Bell,
  Bot,
  CreditCard,
  Download,
  FileText,
  HeartPulse,
  LifeBuoy,
  Lock,
  LogOut,
  MapPin,
  Palette,
  Search,
  ShieldBan,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import { Linking, StyleSheet } from "react-native";

import { ConfirmSheet } from "@/components/confirm-sheet";
import { ListCard, ListRow, SectionTitle } from "@/components/list";
import { Chip, Row, Screen, StateView, T } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { usePush } from "@/hooks/use-push";
import { type AppearancePref, loadAppearance, saveAppearance } from "@/lib/appearance";
import { useArea } from "@/lib/area";
import { useAuth } from "@/lib/auth";
import { SITE_URL } from "@/lib/config";
import { formatUsd } from "@/lib/format";
import { useMe } from "@/lib/queries";
import type { Verification } from "@/lib/types";

const APPEARANCES: { value: AppearancePref; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export const verificationValue = (v: Verification) =>
  v.governmentId === "approved"
    ? "Verified · ID"
    : v.member === "approved"
      ? "Verified"
      : v.member === "needs_review"
        ? "Being checked"
        : v.available
          ? "Not yet"
          : "Not open yet";

export default function Settings() {
  const router = useRouter();
  const { signOut } = useAuth();
  const me = useMe();
  const push = usePush();
  const { area } = useArea();
  const [appearance, setAppearance] = useState<AppearancePref>("system");
  const [askSignOut, setAskSignOut] = useState(false);
  useEffect(() => {
    void loadAppearance().then(setAppearance);
  }, []);
  const web = (path: string) => () => void Linking.openURL(`${SITE_URL}${path}`);

  if (!me.data) {
    return (
      <Screen>
        <StateView loading={me.isPending} error={me.error} onRetry={() => void me.refetch()} />
      </Screen>
    );
  }
  const p = me.data;
  const membership =
    p.feesCents > 0
      ? `${formatUsd(p.feesCents)} in fees`
      : p.freeSessionsLeft > 0
        ? `${p.freeSessionsLeft} free left`
        : "Free for now";

  return (
    <Screen>
      <SectionTitle>Assistant</SectionTitle>
      <ListCard>
        <ListRow
          icon={Search}
          label="What you’re looking for"
          onPress={() => router.push({ pathname: "/assistant", params: { planning: "1" } })}
        />
        <ListRow icon={Bot} label="Assistant" onPress={() => router.push("/settings/assistant")} />
      </ListCard>

      <SectionTitle>Privacy and AI</SectionTitle>
      <ListCard>
        <ListRow
          icon={ShieldCheck}
          label="What your assistant can use"
          onPress={() => router.push("/settings/privacy")}
        />
        <ListRow icon={HeartPulse} label="Apple Health" onPress={() => router.push("/health")} />
      </ListCard>

      <SectionTitle>Alerts</SectionTitle>
      <ListCard>
        <ListRow
          icon={Bell}
          label="Notifications"
          value={
            push.status === "granted"
              ? "On"
              : push.status === "denied"
                ? "Off in iOS Settings"
                : "Off"
          }
          onPress={() => router.push("/settings/notifications")}
        />
        <ListRow
          icon={MapPin}
          label="Location"
          value={area?.permission === "granted" ? "While using" : "Off"}
          detail="Distances on Find, and check-in at the meeting point."
          onPress={() => void Linking.openSettings()}
        />
      </ListCard>

      <SectionTitle>Safety</SectionTitle>
      <ListCard>
        <ListRow
          icon={BadgeCheck}
          label="Verification"
          value={verificationValue(p.verification)}
          valueTone={p.verification.member === "approved" ? "accent" : "muted"}
          onPress={() => router.push("/settings/verification")}
        />
        <ListRow
          icon={Users}
          label="Women-only sessions"
          value={
            p.gender === "woman"
              ? "Woman"
              : p.gender === "man"
                ? "Man"
                : p.gender === "nonbinary"
                  ? "Non-binary"
                  : "Not set"
          }
          onPress={() => router.push("/settings/women-only")}
        />
        <ListRow icon={ShieldBan} label="Blocked members" onPress={() => router.push("/blocked")} />
      </ListCard>

      <SectionTitle>Membership and fees</SectionTitle>
      <ListCard>
        <ListRow
          icon={CreditCard}
          label="Membership & fees"
          value={membership}
          onPress={() => router.push("/billing")}
        />
      </ListCard>

      <SectionTitle>Your data</SectionTitle>
      <ListCard>
        <ListRow
          icon={Download}
          label="Export Apple Health data"
          onPress={() => router.push("/health")}
        />
        <ListRow
          icon={Download}
          label="Export fitness data"
          onPress={() => router.push("/fitness")}
        />
      </ListCard>

      <SectionTitle>Appearance</SectionTitle>
      <Row style={styles.wrap} accessibilityRole="radiogroup" accessibilityLabel="Appearance">
        {APPEARANCES.map((a) => (
          <Chip
            key={a.value}
            label={a.label}
            selected={appearance === a.value}
            onPress={() => {
              setAppearance(a.value);
              void saveAppearance(a.value);
            }}
          />
        ))}
      </Row>

      <SectionTitle>About</SectionTitle>
      <ListCard>
        <ListRow
          icon={LifeBuoy}
          label="Help and support"
          accessibilityRole="link"
          onPress={web("/support")}
        />
        <ListRow icon={Lock} label="Privacy" accessibilityRole="link" onPress={web("/privacy")} />
        <ListRow icon={FileText} label="Terms" accessibilityRole="link" onPress={web("/terms")} />
        <ListRow
          icon={FileText}
          label="What you agreed to"
          onPress={() => router.push("/settings/agreed")}
        />
        {p.isAdmin ? (
          <ListRow
            icon={ShieldCheck}
            label="Admin queue"
            accessibilityRole="link"
            onPress={web("/admin")}
          />
        ) : null}
      </ListCard>

      <SectionTitle>Account</SectionTitle>
      <ListCard>
        <ListRow
          icon={UserRound}
          label="Change my name"
          value={p.name}
          onPress={() => router.push({ pathname: "/you", params: { rename: "1" } })}
        />
        {__DEV__ ? (
          <ListRow
            icon={Palette}
            label="Design kit (development)"
            onPress={() => router.push("/dev-kit")}
          />
        ) : null}
        <ListRow icon={LogOut} label="Sign out" onPress={() => setAskSignOut(true)} />
        <ListRow
          icon={Trash2}
          label="Delete account"
          danger
          onPress={() => router.push("/delete-account")}
        />
      </ListCard>
      <T variant="caption" color="textFaint">
        To report or block someone, open their session or plan.
      </T>

      <ConfirmSheet
        visible={askSignOut}
        onClose={() => setAskSignOut(false)}
        title="Sign out?"
        body="Your sessions, plans and history stay on your account. Sign back in any time."
        confirm={{ label: "Sign out", onPress: () => void signOut() }}
        cancelLabel="Stay signed in"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flexWrap: "wrap", gap: Spacing.one },
});
