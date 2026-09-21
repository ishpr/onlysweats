import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, Switch, View } from "react-native";

import { Button, Card, Chip, Field, Notice, Row, Screen, T } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useBlock, useReport } from "@/lib/queries";
import type { ReportReason } from "@/lib/types";

const REASONS: { value: ReportReason; label: string }[] = [
  { value: "date_framing", label: "Treated it as more than a workout" },
  { value: "harassment", label: "Harassment or unwanted contact" },
  { value: "unsafe", label: "Felt unsafe" },
  { value: "misrepresented", label: "Session wasn’t as described" },
  { value: "fake_or_spam", label: "Fake profile or spam" },
  { value: "other", label: "Something else" },
];

export default function Report() {
  const router = useRouter();
  const theme = useTheme();
  const params = useLocalSearchParams<{
    memberId: string;
    name: string;
    sessionId?: string;
    bookingId?: string;
  }>();
  const name = params.name || "this member";
  const report = useReport();
  const block = useBlock();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [detail, setDetail] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(true);
  const [sent, setSent] = useState(false);

  const blockOnly = () =>
    Alert.alert(
      `Block ${name}?`,
      "You won’t see each other’s sessions or be able to message. Any sessions you have together are cancelled at no cost to you. They aren’t told.",
      [
        { text: "Not now", style: "cancel" },
        {
          text: "Block",
          style: "destructive",
          onPress: () => block.mutate(params.memberId, { onSuccess: () => router.back() }),
        },
      ],
    );

  if (sent) {
    return (
      <Screen contentStyle={styles.done}>
        <T variant="title">Report sent.</T>
        <T color="textSecondary">
          A person at SamePace reads every report, usually within a day.
          {alsoBlock ? ` ${name} is blocked — you won’t see each other again.` : ""} If you’re in
          danger right now, call 911.
        </T>
        <Button label="Done" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <T color="textSecondary">
        Reports go to a person at SamePace, not to {name}. Say what happened in your own words.
      </T>

      <Card>
        <T variant="label">What happened?</T>
        <View style={styles.reasons}>
          {REASONS.map((r) => (
            <Chip
              key={r.value}
              label={r.label}
              selected={reason === r.value}
              onPress={() => setReason(r.value)}
            />
          ))}
        </View>
        <Field
          label="Anything that helps us act on it (optional)"
          value={detail}
          onChangeText={setDetail}
          multiline
          maxLength={2000}
          style={styles.detail}
        />
      </Card>

      <Card>
        <Row>
          <View style={styles.flex}>
            <T variant="label">Also block {name}</T>
            <T variant="caption" color="textSecondary">
              You won’t see each other’s sessions. Any sessions you have together are cancelled at
              no cost to you.
            </T>
          </View>
          <Switch
            accessibilityLabel={`Also block ${name}`}
            value={alsoBlock}
            onValueChange={setAlsoBlock}
            trackColor={{ true: theme.accent, false: theme.backgroundSelected }}
          />
        </Row>
      </Card>

      {(report.error ?? block.error) && (
        <Notice tone="danger">{(report.error ?? block.error)!.message}</Notice>
      )}

      <Button
        variant="danger"
        label="Send report"
        disabled={!reason}
        loading={report.isPending}
        onPress={() =>
          reason &&
          report.mutate(
            {
              reportedId: params.memberId,
              reason,
              detail: detail.trim() || undefined,
              sessionId: params.sessionId || undefined,
              bookingId: params.bookingId || undefined,
              alsoBlock,
            },
            { onSuccess: () => setSent(true) },
          )
        }
      />
      <Button
        variant="ghost"
        label={`Block ${name} without reporting`}
        loading={block.isPending}
        onPress={blockOnly}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  reasons: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.one },
  detail: { minHeight: 96, textAlignVertical: "top" },
  done: { flexGrow: 1, justifyContent: "center", gap: Spacing.two },
});
