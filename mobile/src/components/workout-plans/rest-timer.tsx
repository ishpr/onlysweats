import { useEffect, useState } from "react";
import { Button, Card, Row, T } from "@/components/ui";
import { formatTimerSeconds } from "@/lib/workout-plans/workout-timer";
import { useWorkoutTimer } from "./use-workout-timer";

/** An optional foreground aid; never infers a set or writes elapsed time as activity. */
export function RestTimer({
  seconds,
  disabled = false,
  isCurrent = () => true,
}: {
  seconds: number;
  disabled?: boolean;
  isCurrent?: () => boolean;
}) {
  const timer = useWorkoutTimer({ autoStart: true, disabled, isCurrent });
  const [skipped, setSkipped] = useState(false);
  const left = skipped ? 0 : Math.max(0, seconds - timer.elapsedSeconds);
  useEffect(() => {
    if (left === 0 && timer.running) timer.pause();
  }, [left, timer]);
  return (
    <Card>
      <T variant="eyebrow" color="textSecondary">
        Rest timer
      </T>
      <T variant="heading" accessibilityLiveRegion="none">
        {left > 0 ? formatTimerSeconds(left) : "Rest timer finished"}
      </T>
      <T variant="caption" color="textSecondary">
        Pauses when you leave this screen or app. This timer does not record activity.
      </T>
      <Row style={{ flexWrap: "wrap" }}>
        {left > 0 && (
          <Button
            label={timer.running ? "Pause rest" : "Resume rest"}
            variant="soft"
            disabled={disabled}
            onPress={() => {
              if (timer.running) timer.pause();
              else timer.start();
            }}
          />
        )}
        <Button
          label="Reset rest"
          variant="ghost"
          disabled={disabled}
          onPress={() => {
            setSkipped(false);
            timer.reset();
            timer.start();
          }}
        />
        {left > 0 && (
          <Button
            label="Skip rest"
            variant="ghost"
            disabled={disabled}
            onPress={() => {
              timer.pause();
              setSkipped(true);
            }}
          />
        )}
      </Row>
    </Card>
  );
}
