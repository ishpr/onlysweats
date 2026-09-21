import { useEffect } from "react";
import { Button, Card, Notice, Row, T } from "@/components/ui";
import { formatTimerSeconds } from "@/lib/workout-plans/workout-timer";
import { useWorkoutTimer, type TimerPersistence } from "./use-workout-timer";

/** An optional elapsed-time aid; never writes a completed exercise. */
export function RestTimer({
  seconds,
  disabled = false,
  isCurrent = () => true,
  scope,
  persistence,
  onSkip,
}: {
  scope: string;
  persistence?: TimerPersistence;
  onSkip: () => void;
  seconds: number;
  disabled?: boolean;
  isCurrent?: () => boolean;
}) {
  const timer = useWorkoutTimer({ scope, autoStart: true, disabled, isCurrent, persistence });
  const left = timer.elapsedSeconds === null ? null : Math.max(0, seconds - timer.elapsedSeconds);
  const blocked = disabled || timer.busy;
  useEffect(() => {
    if (left === 0 && timer.running && !blocked && !timer.error) timer.pause();
  }, [left, timer, blocked]);
  return (
    <Card>
      <T variant="eyebrow" color="textSecondary">
        Rest timer
      </T>
      <T variant="heading" accessibilityLiveRegion="none">
        {left === null
          ? "Time unavailable"
          : left > 0
            ? formatTimerSeconds(left)
            : "Rest timer finished"}
      </T>
      <T variant="caption" color="textSecondary">
        {timer.durable
          ? "Keeps time while locked. Reopen this workout to resume."
          : "Keeps time while this screen stays open. Reopening recovery is unavailable on this device."}
      </T>
      {timer.error && <Notice tone="danger">{timer.error}</Notice>}
      {timer.reviewReason && (
        <Notice>
          The clock changed or this timer could not be recovered. Reset it to begin a new rest
          period.
        </Notice>
      )}
      <Row style={{ flexWrap: "wrap" }}>
        {left !== null && left > 0 && (
          <Button
            label={timer.running ? "Pause rest" : "Resume rest"}
            variant="soft"
            disabled={blocked || !!timer.reviewReason}
            onPress={() => {
              if (timer.running) timer.pause();
              else timer.start();
            }}
          />
        )}
        <Button label="Reset rest" variant="ghost" disabled={blocked} onPress={timer.restart} />
        {left !== 0 && (
          <Button label="Skip rest" variant="ghost" disabled={blocked} onPress={onSkip} />
        )}
      </Row>
    </Card>
  );
}
