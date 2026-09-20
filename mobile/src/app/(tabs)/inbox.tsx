import { Link, useRouter } from "expo-router";
import { MessageCircle } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";

import { Enter } from "@/components/motion";
import { Avatar, Button, Card, EmptyState, Row, Screen, StateView, T } from "@/components/ui";
import { formatWhen } from "@/lib/format";
import { byId } from "@/lib/lookup";
import { useMe, useMine, useNotifications, useRefreshOnFocus } from "@/lib/queries";
import type { BookingStatus } from "@/lib/types";
import { AppHeader } from "@/components/brand";

const STATUS: Record<BookingStatus, string> = {
  pending: "Requested",
  confirmed: "Confirmed",
  declined: "Declined",
  cancelled: "Cancelled",
  late_cancel: "Late cancel · $5",
  covered: "Covered by a substitute",
  completed: "Completed",
  no_show: "No-show · joiner",
  host_no_show: "No-show · poster",
  void: "Nobody came",
};

export default function Inbox() {
  useRefreshOnFocus();
  const me = useMe().data;
  const mine = useMine();
  const router = useRouter();
  const unread = useNotifications().data?.unread ?? 0;
  const sessions = byId(mine.data?.sessions);
  const people = byId(mine.data?.people);
  const threads = [...(mine.data?.bookings ?? [])].sort(
    (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
  );

  return (
    <Screen
      header={<AppHeader />}
      onRefresh={() => void mine.refetch()}
      refreshing={mine.isRefetching}
    >
      <View>
        <T variant="title">Inbox</T>
        <T variant="caption" color="textSecondary">
          Threads live on a booking and expire a day after the session.
        </T>
      </View>
      <Button
        variant="soft"
        label={unread > 0 ? `Activity · ${unread} new` : "Activity"}
        onPress={() => router.push("/activity")}
      />
      {mine.isPending || mine.error ? (
        <StateView
          loading={mine.isPending}
          error={mine.error}
          onRetry={() => void mine.refetch()}
        />
      ) : threads.length === 0 ? (
        <EmptyState
          icon={MessageCircle}
          title="No threads yet"
          body="A thread opens with each seat — yours or someone’s on a session you posted — and closes a day after."
          action={{ label: "Find a session", onPress: () => router.push("/sessions") }}
        />
      ) : (
        threads.map((b, i) => {
          const s = sessions.get(b.sessionId);
          const other = people.get(b.hostId === me?.id ? b.participantId : b.hostId);
          return (
            <Enter key={b.id} index={i}>
              <Link href={{ pathname: "/thread/[id]", params: { id: b.id } }} asChild>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${other?.name}, ${s?.title}, ${STATUS[b.status]}`}
                >
                  <Card>
                    <Row>
                      <Avatar initials={other?.initials ?? "?"} accent={other?.accent} />
                      <View style={styles.flex}>
                        <T variant="label">{other?.name ?? "—"}</T>
                        <T variant="caption" color="textSecondary" numberOfLines={1}>
                          {s?.title} · {s ? formatWhen(s.startAt) : ""}
                        </T>
                      </View>
                      <T
                        variant="caption"
                        color={b.status === "confirmed" ? "accent" : "textSecondary"}
                      >
                        {STATUS[b.status]}
                      </T>
                    </Row>
                  </Card>
                </Pressable>
              </Link>
            </Enter>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
