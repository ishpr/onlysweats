import { useState } from "react";
import { Button, Card, Row, T } from "@/components/ui";
import { formatTimerSeconds } from "@/lib/workout-plans/workout-timer";
import { useWorkoutTimer } from "./use-workout-timer";

export function ExerciseTimer({
  targetSeconds,
  autoStart,
  disabled,
  isCurrent,
  onUseDuration,
}: {
  targetSeconds: number;
  autoStart: boolean;
  disabled: boolean;
  isCurrent: () => boolean;
  onUseDuration: (seconds: number) => void;
}) {
  const timer = useWorkoutTimer({ autoStart, disabled, isCurrent });
  const [used, setUsed] = useState(false);
  const remaining = Math.max(0, targetSeconds - timer.elapsedSeconds);
  return (
    <Card>
      <T variant="eyebrow" color="textSecondary">
        Exercise timer
      </T>
      <T variant="heading" accessibilityLiveRegion="none">
        {formatTimerSeconds(timer.elapsedSeconds)} elapsed
      </T>
      <T color="textSecondary">
        {remaining > 0
          ? `${formatTimerSeconds(remaining)} to planned target`
          : "Planned time reached. Pause when you are done."}
      </T>
      <Row style={{ flexWrap: "wrap" }}>
        <Button
          label={
            timer.running ? "Pause timer" : timer.elapsedSeconds ? "Resume timer" : "Start timer"
          }
          variant="soft"
          disabled={disabled}
          onPress={() => {
            setUsed(false);
            if (timer.running) timer.pause();
            else timer.start();
          }}
        />
        <Button
          label="Reset timer"
          variant="ghost"
          disabled={disabled}
          onPress={() => {
            timer.reset();
            setUsed(false);
          }}
        />
      </Row>
      <T variant="caption" color="textSecondary">
        Pauses when you leave this screen or app. Review elapsed time before saving.
      </T>
      {!timer.running && timer.elapsedSeconds > 0 && (
        <Button
          label={`Use ${formatTimerSeconds(timer.elapsedSeconds)} as my duration`}
          variant="soft"
          disabled={disabled}
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
