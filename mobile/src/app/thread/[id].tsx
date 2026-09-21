import { useLocalSearchParams, useRouter } from "expo-router";
import { Ellipsis } from "lucide-react-native";
import { HeaderHeightContext } from "expo-router/react-navigation";
import { use, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { PrivateMember, type PrivateMemberProps } from "@/components/private-member";
import type { Booking, Session, Person, ChatMessage } from "@/lib/types";
import { Alert, Platform, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { PressScale } from "@/components/motion";
import { Avatar, Backdrop, Button, EmptyState, Row, StateView, T } from "@/components/ui";
import { HitTarget, Radius, Spacing } from "@/constants/theme";
import { useNow } from "@/hooks/use-now";
import { useTheme } from "@/hooks/use-theme";
import { formatTime, formatWhen, inCheckinWindow } from "@/lib/format";
import { byId } from "@/lib/lookup";
import { firstName } from "@/lib/names";
import { useRefreshOnFocus } from "@/lib/queries";

export default function SessionHistoryRoute() {
  return <PrivateMember component={SessionHistory} />;
}

function SessionHistory({ member: me, session: apiSession }: PrivateMemberProps) {
  useRefreshOnFocus();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const now = useNow(15_000);
  const mine = useQuery({
    queryKey: ["private-assistant", me.id, "legacy-bookings"],
    gcTime: 0,
    retry: false,
    queryFn: ({ signal }) =>
      apiSession.request<{ bookings: Booking[]; sessions: Session[]; people: Person[] }>(
        "/bookings",
        { signal },
      ),
  });
  const messages = useQuery({
    queryKey: ["private-assistant", me.id, "legacy-messages", id],
    gcTime: 0,
    retry: false,
    queryFn: async ({ signal }) =>
      (
        await apiSession.request<{ messages: ChatMessage[] }>(
          `/bookings/${encodeURIComponent(id)}/messages`,
          { signal },
        )
      ).messages,
  });
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
        title="This session history isn’t available"
        body="Open Chats to see your agents’ planning conversations."
        action={{ label: "Back", onPress: () => router.back() }}
      />
    );
  }

  const otherName = firstName(other?.name) ?? "your buddy";
  const live = booking.status === "confirmed" && inCheckinWindow(session.startAt, now);
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
      <View style={styles.fill}>
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
            Session history · read only. Previous messages remain attributed to the people who sent
            them. Your agents’ planning conversations are in Chats.
          </T>
          {(messages.isPending || messages.error) && (
            <StateView
              loading={messages.isPending}
              error={messages.error}
              onRetry={() => void messages.refetch()}
            />
          )}
          {!messages.error &&
            (messages.data ?? []).map((m) => {
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

        <View style={styles.action}>
          <Button
            variant="soft"
            label="Open agent conversations"
            onPress={() => router.push("/inbox")}
          />
        </View>
      </View>
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
});
