import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { Avatar, Button, Card, Chip, Notice, Row, T } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useGiveCredits, useKeepBlockSlots } from "@/lib/queries";
import type { Person, TrainingBlock } from "@/lib/types";

/**
 * What a member is asked once a block reaches its goal date. A finisher gets one
 * more yes/no per buddy — "helped me stick to it?" — built like the five after a
 * session. It only ever adds to someone's count, and nobody is told who said it.
 * Then the weekly slots: start the next block, keep them running, or let them end.
 */
export function BlockEnding({ block, people }: { block: TrainingBlock; people: Person[] }) {
  const router = useRouter();
  const give = useGiveCredits();
  const keep = useKeepBlockSlots();
  const [yes, setYes] = useState<Record<string, boolean>>({});
  const ending = block.ending;
  if (!ending) return null;

  const buddies = ending.creditable
    .map((id) => people.find((p) => p.id === id))
    .filter((p): p is Person => Boolean(p));
  const error = give.error ?? keep.error;

  return (
    <>
      <Notice>
        {block.my.finished
          ? `You finished it: ${block.my.kept} of ${block.my.planned} sessions kept.`
          : `This goal reached its date. You kept ${block.my.kept} of ${block.my.planned} sessions.`}
      </Notice>

      {ending.creditsOpen && buddies.length > 0 && (
        <Card>
          <T variant="label">Who helped you stick to it?</T>
          <T variant="caption" color="textSecondary">
            It adds one to their profile. They’re never told who said it, and leaving someone out
            shows nowhere.
          </T>
          <View style={styles.rows}>
            {buddies.map((p) => (
              <Row key={p.id} style={styles.between}>
                <Row style={styles.flex}>
                  <Avatar initials={p.initials} accent={p.accent} />
                  <T variant="label">{p.name}</T>
                </Row>
                <Row>
                  <Chip
                    label="Yes"
                    selected={Boolean(yes[p.id])}
                    onPress={() => setYes({ ...yes, [p.id]: true })}
                  />
                  <Chip
                    label="No"
                    selected={!yes[p.id]}
                    onPress={() => setYes({ ...yes, [p.id]: false })}
                  />
                </Row>
              </Row>
            ))}
          </View>
          <Button
            variant="accent"
            label="Done"
            loading={give.isPending}
            onPress={() =>
              give.mutate({
                blockId: block.id,
                toIds: buddies.filter((p) => yes[p.id]).map((p) => p.id),
              })
            }
          />
        </Card>
      )}

      {ending.slotsUndecided && (
        <Card>
          <T variant="label">What about the weekly sessions?</T>
          <T variant="caption" color="textSecondary">
            They stopped at the goal date. Anyone in the group can pick them back up for the next
            two weeks — after that they end.
          </T>
          <Button
            variant="accent"
            label="Start the next block"
            onPress={() =>
              router.push({ pathname: "/training-block/new", params: { fromBlockId: block.id } })
            }
          />
          <Button
            variant="soft"
            label="Keep meeting weekly"
            loading={keep.isPending}
            onPress={() => keep.mutate(block.id)}
          />
        </Card>
      )}

      {error && <Notice tone="danger">{error.message}</Notice>}
    </>
  );
}

const styles = StyleSheet.create({
  rows: { gap: Spacing.two },
  between: { justifyContent: "space-between" },
  flex: { flex: 1 },
});
