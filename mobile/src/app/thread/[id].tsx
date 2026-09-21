import { useLocalSearchParams, useRouter } from "expo-router";
import { Ellipsis } from "lucide-react-native";
import { HeaderHeightContext } from "expo-router/react-navigation";
import { use, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { PressScale } from "@/components/motion";
import {
  Avatar,
  Backdrop,
  Button,
  Chip,
  EmptyState,
  Notice,
  Row,
  StateView,
  T,
} from "@/components/ui";
import { Fonts, HitTarget, Radius, Spacing } from "@/constants/theme";
import { useNow } from "@/hooks/use-now";
import { useTheme } from "@/hooks/use-theme";
import { formatTime, formatWhen, inCheckinWindow } from "@/lib/format";
import { byId } from "@/lib/lookup";
import { firstName } from "@/lib/names";
import { useMe, useMessages, useMine, useRefreshOnFocus, useSendMessage } from "@/lib/queries";

/** Filled into the box, never sent on a tap: nobody should "say" something by accident. */
const QUICK = [
  "On my way.",
  "Running 5 minutes late.",
  "I’m here — where are you?",
  "See you there!",
];

/**
 * The server notes a join, a request and a weekly repeat as messages stored under
 * the host's name. Nobody typed them, so they're shown as plain notes, not bubbles.
 */
function systemNote(text: string, host: string): string | null {
  if (text.startsWith("You’re in.")) return "Joined. The meeting point is on the session page.";
  if (text.startsWith("Request received.")) return `Request sent. ${host} will approve or decline.`;
  if (text.startsWith("Same time next week.")) return "This repeats next week, same time.";
  return null;
}

export default function Chat() {
  useRefreshOnFocus();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const now = useNow(15_000);
  const me = useMe().data;
  const mine = useMine();
  const messages = useMessages(id);
  const send = useSendMessage(id);
  const [text, setText] = useState("");
  const scroller = useRef<ScrollView>(null);
  const headerHeight = (use(HeaderHeightContext) ?? 0) * (Platform.OS === "ios" ? 1 : 0);

  const booking = mine.data?.bookings.find((b) => b.id === id);
  const session = byId(mine.data?.sessions).get(booking?.sessionId ?? "");
  const people = byId(mine.data?.people);
  const other = people.get(
    (booking?.hostId === me?.id ? booking?.participantId : booking?.hostId) ?? "",
  );

  if (!booking || !session) {
    return mine.isPending || mine.error ? (
      <StateView loading={mine.isPending} error={mine.error} />
    ) : (
      <EmptyState
        title="This chat isn’t available anymore"
        body="Chats close a day after the session."
        action={{ label: "Back", onPress: () => router.back() }}
      />
    );
  }

  const otherName = firstName(other?.name) ?? "your buddy";
  const hostName = firstName(people.get(booking.hostId)?.name) ?? "The host";
  const live = booking.status === "confirmed" && inCheckinWindow(session.startAt, now);
  const submit = () => {
    if (!text.trim()) return;
    send.mutate(text, { onSuccess: () => setText("") });
  };
  // Back to the session if it's under us, rather than stacking a second copy of it.
  const toSession = () =>
    router.dismissTo({ pathname: "/session/[id]", params: { id: session.id } });
  const more = () =>
    other &&
    Alert.alert(otherName, undefined, [
      {
        text: `Report or block ${otherName}`,
        style: "destructive",
        onPress: () =>
          router.push({
            pathname: "/report",
            params: {
              memberId: other.id,
              name: otherName,
              sessionId: session.id,
              bookingId: booking.id,
            },
          }),
      },
      { text: "Cancel", style: "cancel" },
    ]);

  return (
    <SafeAreaView
      edges={["bottom"]}
      style={[styles.fill, { backgroundColor: theme.background, paddingTop: headerHeight }]}
    >
      <Backdrop />
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={96}
      >
        <Row style={[styles.head, { borderBottomColor: theme.border }]}>
          <PressScale
            accessibilityRole="button"
            accessibilityLabel={`${otherName}. ${session.title}, ${formatWhen(session.startAt)}. Opens the session.`}
            onPress={toSession}
            scaleTo={0.99}
            style={styles.who}
          >
            <Avatar initials={other?.initials ?? "?"} accent={other?.accent} />
            <View style={styles.fill}>
              <T variant="label">{otherName}</T>
              <T variant="caption" color="textSecondary" numberOfLines={1}>
                {formatWhen(session.startAt)} · {session.title}
              </T>
            </View>
          </PressScale>
          <PressScale
            accessibilityRole="button"
            accessibilityLabel={`More about ${otherName}: report or block`}
            onPress={more}
            style={styles.more}
            hitSlop={6}
          >
            <Ellipsis size={20} color={theme.textSecondary} />
          </PressScale>
        </Row>

        {(live || booking.status === "completed") && (
          <View style={styles.action}>
            <Button
              variant="accent"
              label={live ? "Check in now" : booking.ratedByMe ? "See how it went" : "How was it?"}
              onPress={() => router.push({ pathname: "/live/[id]", params: { id: booking.id } })}
            />
          </View>
        )}

        <ScrollView
          ref={scroller}
          style={styles.fill}
          contentContainerStyle={styles.messages}
          onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}
        >
          <T variant="caption" color="textFaint" style={styles.center}>
            This chat closes a day after the session. SamePace is free — please report anyone who
            asks for money.
          </T>
          {(messages.data ?? []).map((m) => {
            const note = systemNote(m.text, hostName);
            if (note) {
              return (
                <T key={m.id} variant="caption" color="textSecondary" style={styles.center}>
                  {note}
                </T>
              );
            }
            const mineMsg = m.fromId === me?.id;
            return (
              <View
                key={m.id}
                accessible
                accessibilityLabel={`${mineMsg ? "You" : otherName}, ${formatTime(m.createdAt)}: ${m.text}`}
                style={mineMsg ? styles.right : styles.left}
              >
                <View
                  style={[
                    styles.bubble,
                    { backgroundColor: mineMsg ? theme.accent : theme.backgroundElement },
                  ]}
                >
                  <T color={mineMsg ? "onAccent" : "text"}>{m.text}</T>
                </View>
                <T variant="caption" color="textFaint" style={styles.time}>
                  {formatTime(m.createdAt)}
                </T>
              </View>
            );
          })}
        </ScrollView>

        {send.error && <Notice tone="danger">{send.error.message}</Notice>}
        {booking.chatOpen ? (
          <View style={styles.composer}>
            {!text && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.quick}
                keyboardShouldPersistTaps="handled"
              >
                {QUICK.map((q) => (
                  <Chip key={q} label={q} selected={false} onPress={() => setText(q)} />
                ))}
              </ScrollView>
            )}
            <View style={styles.inputRow}>
              <TextInput
                accessibilityLabel={`Message ${otherName}`}
                value={text}
                onChangeText={setText}
                placeholder={`Message ${otherName}`}
                placeholderTextColor={theme.textFaint}
                multiline
                maxLength={2000}
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.field,
                    color: theme.text,
                    borderColor: theme.border,
                  },
                ]}
              />
              <Button
                variant="accent"
                label="Send"
                loading={send.isPending}
                disabled={!text.trim()}
                onPress={submit}
              />
            </View>
          </View>
        ) : (
          <View style={styles.composer}>
            <T variant="caption" color="textSecondary" style={styles.center}>
              This chat is closed — chats close a day after the session.
            </T>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  head: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  who: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    minHeight: HitTarget,
  },
  more: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  action: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two },
  messages: { padding: Spacing.three, gap: Spacing.two },
  center: { textAlign: "center" },
  left: { alignSelf: "flex-start", maxWidth: "82%", gap: 2 },
  right: { alignSelf: "flex-end", maxWidth: "82%", gap: 2, alignItems: "flex-end" },
  bubble: {
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  time: { fontSize: 11, lineHeight: 14, paddingHorizontal: Spacing.half },
  composer: { padding: Spacing.three, gap: Spacing.two },
  quick: { gap: Spacing.one },
  inputRow: { flexDirection: "row", gap: Spacing.one, alignItems: "flex-end" },
  input: {
    flex: 1,
    minHeight: HitTarget + 4,
    maxHeight: 120,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
    fontSize: 16,
    fontFamily: Fonts.regular,
  },
});
