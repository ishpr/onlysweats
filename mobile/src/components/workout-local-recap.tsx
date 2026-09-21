import { useEffect, useMemo, useState } from "react";
import { Button, Card, Notice, T } from "@/components/ui";
import type { ApiSession } from "@/lib/api";
import { createAssistantRun } from "@/lib/assistant/run";
import {
  summarizeWorkout,
  intelligenceReason,
  type WorkoutRecapInput,
  type LocalTextResult,
} from "@/lib/intelligence";

/** Parent keys this view by the complete authorized snapshot, not just workout revision. */
export function WorkoutLocalRecap({
  session,
  summary,
}: {
  session: ApiSession;
  summary: WorkoutRecapInput;
}) {
  const runner = useMemo(() => createAssistantRun(session.isCurrent), [session]);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => runner.cancel(), [runner]);
  const generate = () => {
    if (!session.isCurrent() || runner.busy) return;
    setBusy(true);
    setText(null);
    setError(null);
    void runner.start<LocalTextResult>(
      async (signal, publish) => {
        publish(await summarizeWorkout(summary, { signal }));
      },
      (result) => {
        if (result.status === "available") setText(result.text);
        else setError(intelligenceReason(result.reason));
      },
      () => setError("The recap could not finish. Your recorded facts remain available above."),
      () => setBusy(false),
    );
  };
  return (
    <Card>
      <T variant="heading">A private recap</T>
      <T color="textSecondary">
        Turn the facts above into a short recap on this iPhone. This does not send them to a cloud
        model or another member.
      </T>
      {text && (
        <>
          <T selectable>{text}</T>
          <T variant="caption" color="textSecondary">
            AI wording based on the supplied records. Check it against the measurements above.
          </T>
        </>
      )}
      {error && <Notice>{error}</Notice>}
      {busy ? (
        <Button
          label="Stop recap"
          variant="soft"
          onPress={() => {
            runner.cancel();
            setBusy(false);
          }}
        />
      ) : (
        <Button
          label={text ? "Refresh recap on this iPhone" : "Summarize on this iPhone"}
          variant="soft"
          onPress={generate}
        />
      )}
    </Card>
  );
}
