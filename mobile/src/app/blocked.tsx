import { ShieldCheck } from "lucide-react-native";
import { View, StyleSheet } from "react-native";

import {
  Avatar,
  Button,
  Card,
  EmptyState,
  Notice,
  Row,
  Screen,
  StateView,
  T,
} from "@/components/ui";
import { useBlocks, useUnblock } from "@/lib/queries";

export default function Blocked() {
  const blocks = useBlocks();
  const unblock = useUnblock();

  if (!blocks.data) {
    return (
      <Screen>
        <StateView
          loading={blocks.isPending}
          error={blocks.error}
          onRetry={() => void blocks.refetch()}
        />
      </Screen>
    );
  }

  return (
    <Screen onRefresh={() => void blocks.refetch()} refreshing={blocks.isRefetching}>
      <T color="textSecondary">
        You and a blocked member don’t see each other’s sessions, and your agents won’t connect. They aren’t
        told.
      </T>
      {blocks.data.length === 0 && (
        <EmptyState
          icon={ShieldCheck}
          title="Nobody blocked"
          body="To block someone, open their session and choose Report or block."
        />
      )}
      {blocks.data.map((p) => (
        <Card key={p.id}>
          <Row>
            <Avatar initials={p.initials} accent={p.accent} />
            <View style={styles.flex}>
              <T variant="label">{p.name}</T>
            </View>
            <Button
              variant="soft"
              label="Unblock"
              accessibilityLabel={`Unblock ${p.name}`}
              loading={unblock.isPending && unblock.variables === p.id}
              onPress={() => unblock.mutate(p.id)}
            />
          </Row>
        </Card>
      ))}
      {unblock.error && <Notice tone="danger">{unblock.error.message}</Notice>}
    </Screen>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
