import { Bell, BellOff } from "lucide-react-native";
import { Linking } from "react-native";

import { ListCard } from "@/components/list";
import { SettingRow, StatusHero } from "@/components/settings-kit";
import { Button, Screen, StateView, T } from "@/components/ui";
import { usePush } from "@/hooks/use-push";
import { useMe, useUpdateMe } from "@/lib/queries";
import type { NotifyPrefs } from "@/lib/types";

const KINDS: { key: keyof NotifyPrefs; label: string; hint: string }[] = [
  {
    key: "sessions",
    label: "Sessions",
    hint: "Someone joins, a plan is ready, a session changes.",
  },
  { key: "messages", label: "Messages", hint: "A buddy writes to you." },
  { key: "reminders", label: "Reminders", hint: "The evening before, and an hour before." },
  { key: "substitutes", label: "Fill-in spots", hint: "A spot opens in a session at your level." },
];

export default function NotificationSettingsScreen() {
  const push = usePush();
  const me = useMe();
  const update = useUpdateMe();
  if (!me.data) {
    return (
      <Screen>
        <StateView loading={me.isPending} error={me.error} onRetry={() => void me.refetch()} />
      </Screen>
    );
  }
  const on = push.status === "granted" && push.registration !== "failed";
  return (
    <Screen
      footer={
        push.status === "undetermined" ? (
          <Button
            variant="accent"
            label="Turn on notifications"
            loading={push.busy}
            onPress={() => void push.enable()}
          />
        ) : push.status === "denied" ? (
          <Button
            variant="accent"
            label="Open iOS Settings"
            onPress={() => void Linking.openSettings()}
          />
        ) : push.registration === "failed" ? (
          <Button
            variant="accent"
            label="Try again"
            loading={push.busy}
            onPress={() => void push.enable()}
          />
        ) : undefined
      }
    >
      <StatusHero
        icon={on ? Bell : BellOff}
        tone={on ? "good" : push.status === "denied" ? "attention" : "quiet"}
        eyebrow={
          on ? "On for this phone" : push.status === "denied" ? "Off in iOS Settings" : "Off"
        }
        title={
          on
            ? "You’ll hear when something needs you"
            : push.status === "unavailable"
              ? "Not available on this device"
              : "Nothing reaches you yet"
        }
        detail={
          on
            ? push.registration === "registered"
              ? "Connected on this phone."
              : "Permission is on. Connecting this phone…"
            : push.status === "denied"
              ? "SamePace is switched off in your phone’s notification settings."
              : "Everything still shows under the bell on Home."
        }
      />
      <ListCard>
        {KINDS.map((k) => (
          <SettingRow
            key={k.key}
            label={k.label}
            detail={k.hint}
            value={me.data!.notify[k.key]}
            onValueChange={(value) => update.mutate({ notify: { [k.key]: value } })}
          />
        ))}
      </ListCard>
      <T variant="caption" color="textFaint">
        Fees, strikes and anything about your account are always sent.
      </T>
    </Screen>
  );
}
