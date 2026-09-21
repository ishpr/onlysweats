import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PrivateMember, type PrivateMemberProps } from "@/components/private-member";
import { usePrivateAction } from "@/hooks/use-private-action";
import { StyleSheet, Switch, View } from "react-native";

import { RouteSheet } from "@/components/route-sheet";
import { Button, Card, Chip, Field, Notice, Row, T } from "@/components/ui";
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
  const [blocking, setBlocking] = useState(false);

  const block = () =>
    void action.run(
      (signal) =>
        session.request("/blocks", { method: "POST", json: { memberId: params.memberId }, signal }),
      async () => {
        await client.invalidateQueries();
        router.back();
      },
    );

  const send = () => {
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
  };

  if (sent) {
    return (
      <RouteSheet title="Report sent">
        <T color="textSecondary">
          A person at SamePace reads every report, usually within a day.
          {alsoBlock ? ` ${name} is blocked — you won’t see each other again.` : ""} If you’re in
          danger right now, call 911.
        </T>
      </RouteSheet>
    );
  }

  // Blocking without a report is its own short decision, asked in the same sheet.
  if (blocking) {
    return (
      <RouteSheet
        title={`Block ${name}?`}
        footer={
          <>
            <Button variant="danger" label="Block" loading={action.busy} onPress={block} />
            <Button
              variant="ghost"
              label="Back"
              disabled={action.busy}
              onPress={() => setBlocking(false)}
            />
          </>
        }
      >
        <T color="textSecondary">
          You won’t see each other’s sessions, and your assistants can’t contact each other. Any
          sessions you have together are cancelled at no cost to you. They aren’t told.
        </T>
        {action.error && <Notice tone="danger">{action.error}</Notice>}
      </RouteSheet>
    );
  }

  return (
    <RouteSheet
      title="Report or block"
      subtitle={`Reports go to a person at SamePace, not to ${name}.`}
      startFull
      dirty={reason !== null || detail.trim().length > 0}
      footer={
        <>
          <Button
            variant="danger"
            label="Send report"
            disabled={!reason || action.busy}
            loading={action.busy}
            onPress={send}
          />
          <Button
            variant="ghost"
            label={`Block ${name} without reporting`}
            disabled={action.busy}
            onPress={() => setBlocking(true)}
          />
        </>
      }
    >
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
    </RouteSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  reasons: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.one },
  detail: { minHeight: 96, textAlignVertical: "top" },
});
