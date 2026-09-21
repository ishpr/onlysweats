import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, Chip, Notice, Row, StateView, T } from "@/components/ui";
import { usePrivateAction } from "@/hooks/use-private-action";
import type { ApiSession } from "@/lib/api";
import {
  FITNESS_PILOT_NOTICE,
  type FitnessPilotConsent,
  type FitnessPilotFeedback,
  type FitnessPilotOutcome,
} from "../../../shared/fitness-outcomes";

export function FitnessPilotPermissions({
  consent,
  aiEnabled,
  session,
  onChanged,
}: {
  consent: FitnessPilotConsent;
  aiEnabled: boolean;
  session: ApiSession;
  onChanged: () => Promise<void>;
}) {
  const action = usePrivateAction(session);
  const [expanded, setExpanded] = useState(false);
  return (
    <Card>
      <T variant="label">Help evaluate exercise drafts</T>
      <T variant="caption" color="textSecondary">
        Optional pilot measurements are {consent.enabled ? "on" : "off"}. This is separate from
        using AI assistance.
      </T>
      <Button
        variant="ghost"
        label={expanded ? "Hide pilot details" : "Review pilot details"}
        onPress={() => setExpanded((value) => !value)}
      />
      {(expanded || consent.enabled) && (
        <>
          {expanded && (
            <T variant="caption" color="textSecondary">
              {FITNESS_PILOT_NOTICE}
            </T>
          )}
          {!aiEnabled && !consent.enabled && (
            <Notice>
              Allow AI assistance first if you want to join the pilot. Manual logging is always
              available.
            </Notice>
          )}
          <Button
            variant="soft"
            label={
              consent.enabled
                ? "Leave pilot and delete measurements"
                : "Allow optional pilot measurements"
            }
            disabled={action.busy || (!consent.enabled && !aiEnabled)}
            onPress={() =>
              void action.run(
                (signal) =>
                  session.request("/fitness/pilot-consent", {
                    method: "PUT",
                    json: { enabled: !consent.enabled },
                    signal,
                  }),
                onChanged,
              )
            }
          />
        </>
      )}
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </Card>
  );
}

export function FitnessPilotResult({
  id,
  ownerId,
  session,
  onDismiss,
}: {
  id: string;
  ownerId: string;
  session: ApiSession;
  onDismiss: () => void;
}) {
  const action = usePrivateAction(session);
  const [helpfulness, setHelpfulness] = useState<FitnessPilotFeedback["helpfulness"] | null>(null);
  const [timeSaved, setTimeSaved] = useState<FitnessPilotFeedback["timeSaved"] | null>(null);
  const query = useQuery({
    queryKey: ["private-fitness", ownerId, "pilot-outcome", id],
    gcTime: 0,
    retry: false,
    queryFn: ({ signal }) =>
      session.request<{ outcome: FitnessPilotOutcome }>(
        `/fitness/logging-sessions/${encodeURIComponent(id)}`,
        { signal },
      ),
  });
  const outcome = query.error ? null : query.data?.outcome;
  return (
    <Card>
      <T variant="heading">Your logging outcome</T>
      <T variant="caption" color="textSecondary">
        Your exercise was saved. Feedback is optional and never changes your exercise.
      </T>
      {(query.isPending || query.error) && (
        <StateView
          loading={query.isPending}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      )}
      {outcome && (
        <>
          {outcome.comparisonRevision !== null && (
            <T variant="caption" color="textSecondary">
              Compared when you saved revision {outcome.comparisonRevision}. Later edits are
              separate.
            </T>
          )}
          {outcome.mode === "linked_draft" ? (
            <T variant="caption" color="textSecondary">
              {outcome.unchangedSuggestedFields ?? 0} suggested fields stayed the same;{" "}
              {outcome.changedSuggestedFields ?? 0} changed before saving;{" "}
              {outcome.filledMissingFields ?? 0} missing fields were filled in.
            </T>
          ) : (
            <T variant="caption" color="textSecondary">
              No draft-to-save comparison is available for this attempt.
            </T>
          )}
          {outcome.elapsedMs !== null && (
            <T variant="caption" color="textSecondary">
              {Math.round(outcome.elapsedMs / 1000)} seconds from starting measurement to saving,
              including pauses and network time. This does not measure time saved or correctness.
            </T>
          )}
          {outcome.feedback ? (
            <Notice>Your feedback has been recorded. Thank you.</Notice>
          ) : (
            outcome.status === "saved" && (
              <>
                <T variant="label">Was the optional draft assistance useful?</T>
                <Row style={{ flexWrap: "wrap" }}>
                  {(
                    [
                      ["helpful", "Helpful"],
                      ["neutral", "Neutral"],
                      ["not_helpful", "Not helpful"],
                      ["unknown", "Not sure / didn’t use"],
                    ] as const
                  ).map(([value, label]) => (
                    <Chip
                      key={value}
                      label={label}
                      selected={helpfulness === value}
                      disabled={action.busy}
                      onPress={() => setHelpfulness(value)}
                    />
                  ))}
                </Row>
                <T variant="label">Did it feel like it saved you time?</T>
                <Row>
                  {(
                    [
                      ["yes", "Yes"],
                      ["no", "No"],
                      ["unsure", "Not sure"],
                    ] as const
                  ).map(([value, label]) => (
                    <Chip
                      key={value}
                      label={label}
                      selected={timeSaved === value}
                      disabled={action.busy}
                      onPress={() => setTimeSaved(value)}
                    />
                  ))}
                </Row>
                <Button
                  label="Send optional feedback"
                  variant="soft"
                  disabled={action.busy || !helpfulness || !timeSaved}
                  onPress={() =>
                    void action.run(
                      (signal) =>
                        session.request(
                          `/fitness/logging-sessions/${encodeURIComponent(id)}/feedback`,
                          {
                            method: "POST",
                            json: { helpfulness, timeSaved },
                            signal,
                          },
                        ),
                      async () => {
                        await query.refetch();
                      },
                    )
                  }
                />
              </>
            )
          )}
        </>
      )}
      {action.error && <Notice tone="danger">{action.error}</Notice>}
      <Button variant="ghost" label="Close outcome" disabled={action.busy} onPress={onDismiss} />
    </Card>
  );
}
