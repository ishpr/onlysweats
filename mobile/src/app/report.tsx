import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PrivateMember, type PrivateMemberProps } from "@/components/private-member";
import { usePrivateAction } from "@/hooks/use-private-action";
import { Alert, StyleSheet, Switch, View } from "react-native";

import { Button, Card, Chip, Field, Notice, Row, Screen, T } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import type { ReportReason } from "@/lib/types";

const REASONS: { value: ReportReason; label: string }[] = [
  { value: "date_framing", label: "Treated it as more than a workout" },
  { value: "harassment", label: "Harassment or unwanted contact" },
  { value: "unsafe", label: "Felt unsafe" },
  { value: "misrepresented", label: "Session wasn’t as described" },
  { value: "fake_or_spam", label: "Fake profile or spam" },
  { value: "other", label: "Something else" },
];

export default function ReportRoute() {
  return <PrivateMember component={Report} />;
}
function Report({ session }: PrivateMemberProps) {
  const router = useRouter();
  const theme = useTheme();
  const params = useLocalSearchParams<{
    memberId: string;
    name: string;
    sessionId?: string;
    bookingId?: string;
    negotiationId?: string;
  }>();
  const name = params.name || "this member";
  const action = usePrivateAction(session);
  const client = useQueryClient();
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
          onPress: () =>
            void action.run(
              (signal) =>
                session.request("/blocks", {
                  method: "POST",
                  json: { memberId: params.memberId },
                  signal,
                }),
              async () => {
                await client.invalidateQueries();
                router.back();
              },
            ),
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
              disabled={action.busy}
              onPress={() => setReason(r.value)}
            />
          ))}
        </View>
        <Field
          label="Anything that helps us act on it (optional)"
          value={detail}
          editable={!action.busy}
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
            disabled={action.busy}
            onValueChange={setAlsoBlock}
            trackColor={{ true: theme.accent, false: theme.backgroundSelected }}
          />
        </Row>
      </Card>

      {action.error && <Notice tone="danger">{action.error}</Notice>}
      <Button
        variant="danger"
        label="Send report"
        disabled={!reason || action.busy}
        loading={action.busy}
        onPress={() => {
          if (!reason) return;
          void action.run(
            (signal) =>
              session.request("/reports", {
                method: "POST",
                signal,
                json: {
                  reportedId: params.memberId,
                  reason,
                  detail: detail.trim() || undefined,
                  sessionId: params.sessionId || undefined,
                  bookingId: params.bookingId || undefined,
                  negotiationId: params.negotiationId || undefined,
                  alsoBlock,
                },
              }),
            async () => {
              setSent(true);
              await client.invalidateQueries();
            },
          );
        }}
      />
      <Button
        variant="ghost"
        label={`Block ${name} without reporting`}
        disabled={action.busy}
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
