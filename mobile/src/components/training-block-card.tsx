import { useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { Badge, Card, Row, T } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { formatDate, formatWhen } from "@/lib/format";
import { ACTIVITIES, type TrainingBlock, type Venue } from "@/lib/types";

/**
 * A block in discovery: the goal, the weekly slots, the level and the seats — like
 * a session card, it shows the workout and never a face (PRD v0.3 §8).
 */
export function TrainingBlockCard({
  block,
  venues,
}: {
  block: TrainingBlock;
  venues: Map<string, Venue>;
}) {
  const router = useRouter();
  const seats = `${block.seatsLeft} seat${block.seatsLeft === 1 ? "" : "s"}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Training block: ${block.goalLabel}, ${block.weeks} weeks, ${seats} open`}
      onPress={() => router.push({ pathname: "/training-block/[id]", params: { id: block.id } })}
      style={styles.card}
    >
      <Card style={styles.fill}>
        <T variant="eyebrow" color="stand">
          {ACTIVITIES[block.activity].label} · {block.weeks} weeks
        </T>
        <T variant="label">{block.goalLabel}</T>
        <View>
          {block.slots.map((slot) => (
            <T key={slot.seriesId} variant="caption" color="textSecondary" numberOfLines={1}>
              {slot.nextStartAt ? formatWhen(slot.nextStartAt) : slot.title} ·{" "}
              {venues.get(slot.venueId)?.name}
            </T>
          ))}
        </View>
        <T variant="caption" color="textSecondary" numberOfLines={1}>
          {block.slots[0]?.abilityLabel}
        </T>
        <Row style={styles.wrap}>
          <Badge label={`${seats} · until ${formatDate(block.goalDate)}`} />
          {block.womenOnly && <Badge label="Women-only" />}
          {block.joinMode === "approve" && <Badge label="Members approve" />}
        </Row>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { width: 288 },
  fill: { flex: 1 },
  wrap: { flexWrap: "wrap", gap: Spacing.one },
});
