import { useState } from "react";
import { Button, Card, Notice, Row, T } from "@/components/ui";
import { formatTimerSeconds } from "@/lib/workout-plans/workout-timer";
import { useWorkoutTimer, type TimerPersistence } from "./use-workout-timer";

export function ExerciseTimer({
  targetSeconds,
  autoStart,
  disabled,
  isCurrent,
  onUseDuration,
  scope,
  persistence,
}: {
  scope: string;
  persistence?: TimerPersistence;
  targetSeconds: number;
  autoStart: boolean;
  disabled: boolean;
  isCurrent: () => boolean;
  onUseDuration: (seconds: number) => void;
}) {
  const timer = useWorkoutTimer({ scope, autoStart, disabled, isCurrent, persistence });
  const [used, setUsed] = useState(false);
  const remaining =
    timer.elapsedSeconds === null ? null : Math.max(0, targetSeconds - timer.elapsedSeconds);
  const blocked = disabled || timer.busy;
  return (
    <Card>
      <T variant="eyebrow" color="textSecondary">
        Exercise timer
      </T>
      <T variant="heading" accessibilityLiveRegion="none">
        {timer.elapsedSeconds === null
          ? "Time unavailable"
          : `${formatTimerSeconds(timer.elapsedSeconds)} elapsed`}
      </T>
      <T color="textSecondary">
        {remaining === null
          ? "Reset the timer or enter your actual duration below."
          : remaining > 0
            ? `${formatTimerSeconds(remaining)} to planned target`
            : "Planned time reached. Pause when you are done."}
      </T>
      <Row style={{ flexWrap: "wrap" }}>
        <Button
          label={
            timer.running ? "Pause timer" : timer.elapsedSeconds ? "Resume timer" : "Start timer"
          }
          variant="soft"
          disabled={blocked || !!timer.reviewReason}
          onPress={() => {
            setUsed(false);
            if (timer.running) timer.pause();
            else timer.start();
          }}
        />
        <Button
          label="Reset timer"
          variant="ghost"
          disabled={blocked}
          onPress={() => {
            timer.reset();
            setUsed(false);
          }}
        />
      </Row>
      <T variant="caption" color="textSecondary">
        {timer.durable
          ? "Keeps time while locked. Reopen this workout to resume. Review elapsed time before saving."
          : "Keeps time while this screen stays open, including in the background. This device cannot save the timer across reopening."}
      </T>
      {timer.busy && (
        <T variant="caption" color="textSecondary">
          Saving timer…
        </T>
      )}
      {timer.error && <Notice tone="danger">{timer.error}</Notice>}
      {timer.reviewReason && (
        <Notice>
          The clock changed or the timer could not be recovered reliably. No duration has been
          recorded.
        </Notice>
      )}
      {!timer.running && timer.elapsedSeconds !== null && timer.elapsedSeconds > 0 && (
        <Button
          label={`Use ${formatTimerSeconds(timer.elapsedSeconds)} as my duration`}
          variant="soft"
          disabled={blocked}
          onPress={() => {
            const seconds = timer.confirmedDuration();
            if (seconds === null || !isCurrent()) return;
            onUseDuration(seconds);
            setUsed(true);
          }}
        />
      )}
      {used && (
        <T variant="caption" color="textSecondary">
          Duration added below. Review your actual values, then save the completed set.
        </T>
      )}
    </Card>
  );
}
