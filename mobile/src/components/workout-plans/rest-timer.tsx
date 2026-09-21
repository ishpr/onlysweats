import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { Button, Card, Row, T } from "@/components/ui";
import { useNow } from "@/hooks/use-now";

/** An optional foreground aid; never infers a set or writes elapsed time as activity. */
export function RestTimer({ seconds }: { seconds: number }) {
  const [remaining, setRemaining] = useState(seconds);
  const [deadline, setDeadline] = useState<number | null>(() => Date.now() + seconds * 1000);
  const now = useNow(1000);
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state !== "active" && deadline !== null) {
        setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
        setDeadline(null);
      }
    });
    return () => listener.remove();
  }, [deadline]);
  const left = deadline === null ? remaining : Math.max(0, Math.ceil((deadline - now) / 1000));
  return (
    <Card>
      <T variant="eyebrow" color="textSecondary">
        Rest timer
      </T>
      <T variant="heading" accessibilityLiveRegion="none">
        {left > 0
          ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`
          : "Rest timer finished"}
      </T>
      <T variant="caption" color="textSecondary">
        Pauses when the app leaves the foreground. This timer does not record activity.
      </T>
      <Row>
        {left > 0 && (
          <Button
            label={deadline === null ? "Resume rest" : "Pause rest"}
            variant="soft"
            onPress={() => {
              if (deadline === null) setDeadline(Date.now() + remaining * 1000);
              else {
                setRemaining(left);
                setDeadline(null);
              }
            }}
          />
        )}
        <Button
          label="Reset rest"
          variant="ghost"
          onPress={() => {
            setRemaining(seconds);
            setDeadline(Date.now() + seconds * 1000);
          }}
        />
        {left > 0 && (
          <Button
            label="Skip rest"
            variant="ghost"
            onPress={() => {
              setRemaining(0);
              setDeadline(null);
            }}
          />
        )}
      </Row>
    </Card>
  );
}
