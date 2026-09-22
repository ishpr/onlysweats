import { StyleSheet } from "react-native";

import { Card, Chip, Notice, Row, Screen, StateView, T } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useMe, useUpdateMe } from "@/lib/queries";
import type { Gender } from "@/lib/types";

const GENDERS: { value: Gender; label: string }[] = [
  { value: "woman", label: "Woman" },
  { value: "man", label: "Man" },
  { value: "nonbinary", label: "Non-binary" },
  { value: null, label: "Rather not say" },
];

export default function WomenOnlySettings() {
  const me = useMe();
  const update = useUpdateMe();
  if (!me.data) {
    return (
      <Screen>
        <StateView loading={me.isPending} error={me.error} onRetry={() => void me.refetch()} />
      </Screen>
    );
  }
  return (
    <Screen>
      <Card>
        <T variant="label">How you describe yourself</T>
        <T variant="caption" color="textSecondary">
          Only used to open women-only sessions to women. Never shown to anyone, never used to rank
          or match.
        </T>
        <Row style={styles.wrap}>
          {GENDERS.map((g) => (
            <Chip
              key={g.label}
              label={g.label}
              selected={me.data!.gender === g.value}
              onPress={() => update.mutate({ gender: g.value })}
            />
          ))}
        </Row>
      </Card>
      {update.error && <Notice tone="danger">{update.error.message}</Notice>}
    </Screen>
  );
}

const styles = StyleSheet.create({ wrap: { flexWrap: "wrap", gap: Spacing.one } });
