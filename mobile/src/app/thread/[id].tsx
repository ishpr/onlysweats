import { Link, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ReportLink } from "@/components/report-link";
import { Button, Chip, Notice, StateView, T } from "@/components/ui";
import { HitTarget, Radius, Spacing } from "@/constants/theme";
import { useNow } from "@/hooks/use-now";
import { useTheme } from "@/hooks/use-theme";
import { formatWhen, inCheckinWindow } from "@/lib/format";
import { byId } from "@/lib/lookup";
import { useMe, useMessages, useMine, useSendMessage } from "@/lib/queries";

const SMART = [
  "On my way — eight minutes out.",
  "I’ll be at the trailhead pin.",
  "Holding the slot. See you there.",
];

export default function Thread() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const now = useNow(15_000);
  const me = useMe().data;
  const mine = useMine();
  const messages = useMessages(id);
  const send = useSendMessage(id);
  const [text, setText] = useState("");
  const scroller = useRef<ScrollView>(null);

  const booking = mine.data?.bookings.find((b) => b.id === id);
  const session = byId(mine.data?.sessions).get(booking?.sessionId ?? "");
  const other = byId(mine.data?.people).get(
    (booking?.hostId === me?.id ? booking?.participantId : booking?.hostId) ?? "",
  );

  if (!booking || !session) {
    return <StateView loading={mine.isPending} error={mine.error} empty="Thread closed." />;
  }

  const submit = (body: string) => {
    if (!body.trim()) return;
    send.mutate(body, { onSuccess: () => setText("") });
  };
  const live = booking.status === "confirmed" && inCheckinWindow(session.startAt, now);

  return (
    <SafeAreaView edges={["bottom"]} style={[styles.fill, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={96}
      >
        <View style={styles.head}>
          <T variant="label">{other?.name ?? "—"}</T>
          <T variant="caption" color="textSecondary">
            {session.title} · {formatWhen(session.startAt)}
          </T>
          <T variant="caption" color="textFaint">
            Nobody charges for a SamePace session. Threads close a day after the session.
          </T>
          {other && (
            <ReportLink
              memberId={other.id}
              name={other.name}
              sessionId={session.id}
              bookingId={booking.id}
            />
          )}
          {live ? (
            <Link href={{ pathname: "/live/[id]", params: { id: booking.id } }} asChild>
              <Button variant="accent" label="Check-in is open" />
            </Link>
          ) : (
            <Link href={{ pathname: "/session/[id]", params: { id: session.id } }} asChild>
              <Button variant="soft" label="Listing and pin" />
            </Link>
          )}
        </View>

        <ScrollView
          ref={scroller}
          style={styles.fill}
          contentContainerStyle={styles.messages}
          onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}
        >
          {(messages.data ?? []).map((m) => {
            const mineMsg = m.fromId === me?.id;
            return (
              <View
                key={m.id}
                style={[
                  styles.bubble,
                  mineMsg
                    ? { alignSelf: "flex-end", backgroundColor: theme.accent }
                    : { alignSelf: "flex-start", backgroundColor: theme.backgroundElement },
                ]}
              >
                <T color={mineMsg ? "onAccent" : "text"}>{m.text}</T>
              </View>
            );
          })}
        </ScrollView>

        {send.error && <Notice tone="danger">{send.error.message}</Notice>}
        {booking.chatOpen ? (
          <View style={styles.composer}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.smart}
            >
              {SMART.map((s) => (
                <Chip key={s} label={s} selected={false} onPress={() => submit(s)} />
              ))}
            </ScrollView>
            <View style={styles.inputRow}>
              <TextInput
                accessibilityLabel="Message"
                value={text}
                onChangeText={setText}
                placeholder="Message"
                placeholderTextColor={theme.textFaint}
                onSubmitEditing={() => submit(text)}
                returnKeyType="send"
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.backgroundElement,
                    color: theme.text,
                    borderColor: theme.border,
                  },
                ]}
              />
              <Button
                label="Send"
                loading={send.isPending}
                disabled={!text.trim()}
                onPress={() => submit(text)}
              />
            </View>
          </View>
        ) : (
          <View style={styles.composer}>
            <T variant="caption" color="textSecondary">
              This thread is closed.
            </T>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  head: { padding: Spacing.three, gap: Spacing.half },
  messages: { padding: Spacing.three, gap: Spacing.one },
  bubble: {
    maxWidth: "82%",
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  composer: { padding: Spacing.three, gap: Spacing.two },
  smart: { gap: Spacing.one },
  inputRow: { flexDirection: "row", gap: Spacing.one, alignItems: "center" },
  input: {
    flex: 1,
    minHeight: HitTarget + 4,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
});
