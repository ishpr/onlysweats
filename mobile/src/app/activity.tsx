import { type Href, useRouter } from "expo-router";
import { Bell } from "lucide-react-native";
import { useEffect } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Enter } from "@/components/motion";
import { Card, EmptyState, Row, Screen, StateView, T } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { formatWhen } from "@/lib/format";
import { useMarkNotificationsRead, useNotifications } from "@/lib/queries";

/** Everything SamePace told me, newest first — the same list with push on or off. */
export default function Activity() {
  const router = useRouter();
  const theme = useTheme();
  const list = useNotifications();
  const { mutate: markRead } = useMarkNotificationsRead();
  const unread = list.data?.unread ?? 0;

  // Seeing the list is reading it.
  useEffect(() => {
    if (unread > 0) markRead();
  }, [unread, markRead]);

  if (!list.data) {
    return (
      <Screen>
        <StateView
          loading={list.isPending}
          error={list.error}
          onRetry={() => void list.refetch()}
        />
      </Screen>
    );
  }

  return (
    <Screen onRefresh={() => void list.refetch()} refreshing={list.isRefetching}>
      {list.data.notifications.length === 0 && (
        <EmptyState
          icon={Bell}
          title="Nothing yet"
          body="Agent planning updates and session changes appear here, whether or not notifications are on."
        />
      )}
      {list.data.notifications.map((n, i) => (
        <Enter key={n.id} index={i}>
          <Pressable
            accessibilityRole={n.url ? "button" : "text"}
            accessibilityLabel={`${n.title}. ${n.body}`}
            disabled={!n.url}
            onPress={() => n.url && router.push(n.url as Href)}
          >
            <Card>
              <Row style={styles.top}>
                {!n.read && <View style={[styles.dot, { backgroundColor: theme.accent }]} />}
                <View style={styles.flex}>
                  <T variant="label">{n.title}</T>
                  <T variant="caption" color="textSecondary">
                    {n.body}
                  </T>
                  <T variant="caption" color="textFaint">
                    {formatWhen(n.createdAt)}
                  </T>
                </View>
              </Row>
            </Card>
          </Pressable>
        </Enter>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  top: { alignItems: "flex-start" },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 8 },
});
