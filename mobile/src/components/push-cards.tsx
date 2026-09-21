import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";
import { Linking, StyleSheet, Switch, View } from "react-native";

import { Button, Card, Row, T } from "@/components/ui";
import { usePush } from "@/hooks/use-push";
import { useTheme } from "@/hooks/use-theme";
import { useUpdateMe } from "@/lib/queries";
import type { Me, NotifyPrefs } from "@/lib/types";

const KINDS: { key: keyof NotifyPrefs; label: string; hint: string }[] = [
  {
    key: "sessions",
    label: "Sessions",
    hint: "Someone joins, asks, cancels, or a session is called off.",
  },
  { key: "messages", label: "Messages", hint: "A new message in one of your threads." },
  { key: "reminders", label: "Reminders", hint: "An hour before, and when check-in opens." },
  {
    key: "substitutes",
    label: "Open seats",
    hint: "A seat at your level opens on a standing slot.",
  },
];

/** You tab: turn push on, and choose which kinds. */
export function NotificationSettings({ me }: { me: Me }) {
  const theme = useTheme();
  const push = usePush();
  const update = useUpdateMe();

  return (
    <Card>
      <T variant="label">Notifications</T>
      {push.registration === "failed" && <RegistrationRetry push={push} />}
      {push.status === "granted" && push.registration !== "failed" && (
        <T variant="caption" color="textSecondary">
          {push.registration === "registered"
            ? "Notifications are connected on this phone."
            : "Permission is on. Connecting this phone for notifications…"}
        </T>
      )}
      {push.status === "unavailable" && (
        <T variant="caption" color="textSecondary">
          Push isn’t available on this device. Everything still shows up under Inbox → Activity.
        </T>
      )}
      {push.status === "undetermined" && (
        <>
          <T variant="caption" color="textSecondary">
            Off on this phone. Turn them on to hear when someone joins or messages you.
          </T>
          <Button
            label="Turn on notifications"
            loading={push.busy}
            onPress={() => void push.enable()}
          />
        </>
      )}
      {push.status === "denied" && (
        <>
          <T variant="caption" color="textSecondary">
            Notifications are switched off for SamePace in your phone’s Settings.
          </T>
          <Button
            variant="soft"
            label="Open Settings"
            onPress={() => void Linking.openSettings()}
          />
        </>
      )}
      {KINDS.map((k) => (
        <Row key={k.key}>
          <View style={styles.flex}>
            <T>{k.label}</T>
            <T variant="caption" color="textSecondary">
              {k.hint}
            </T>
          </View>
          <Switch
            accessibilityLabel={`${k.label} notifications`}
            value={me.notify[k.key]}
            onValueChange={(on) => update.mutate({ notify: { [k.key]: on } })}
            trackColor={{ true: theme.accent, false: theme.backgroundSelected }}
          />
        </Row>
      ))}
      <T variant="caption" color="textFaint">
        Fees, strikes and anything about your account are always sent.
      </T>
    </Card>
  );
}

const DISMISSED_KEY = "samepace.push-prompt-dismissed";

/**
 * Today tab: asks once, in our own words, before the system prompt — and only
 * after there's something to be notified about.
 */
export function PushPrompt() {
  const push = usePush();
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    SecureStore.getItemAsync(DISMISSED_KEY)
      .then((v) => setDismissed(v === "1"))
      .catch(() => setDismissed(false));
  }, []);

  if (push.registration === "failed") {
    return (
      <Card>
        <RegistrationRetry push={push} />
      </Card>
    );
  }
  if (push.status !== "undetermined" || dismissed !== false) return null;
  const dismiss = () => {
    setDismissed(true);
    void SecureStore.setItemAsync(DISMISSED_KEY, "1").catch(() => undefined);
  };

  return (
    <Card>
      <T variant="label">Know the moment someone joins</T>
      <T variant="caption" color="textSecondary">
        We’ll tell you when someone takes your seat, messages you, or a session is called off — plus
        a reminder an hour before. No marketing, ever.
      </T>
      <Row>
        <Button style={styles.flex} variant="soft" label="Not now" onPress={dismiss} />
        <Button
          style={styles.flex}
          variant="accent"
          label="Turn on"
          loading={push.busy}
          onPress={() => void push.enable()}
        />
      </Row>
    </Card>
  );
}

function RegistrationRetry({ push }: { push: ReturnType<typeof usePush> }) {
  return (
    <>
      <T variant="label">Notifications need attention</T>
      <T variant="caption" color="textSecondary">
        {push.status === "granted"
          ? "Permission is on, but this phone isn’t connected for notifications yet."
          : "We couldn’t connect notifications on this phone."}{" "}
        {push.error} Everything still appears in Inbox → Activity.
      </T>
      <Button
        variant="soft"
        label="Retry notifications"
        loading={push.busy}
        onPress={() => void push.retry()}
      />
    </>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
