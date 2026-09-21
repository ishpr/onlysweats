import { HStack, Image, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  activityBackgroundTint,
  font,
  foregroundStyle,
  lineLimit,
  monospacedDigit,
  padding,
} from "@expo/ui/swift-ui/modifiers";
import { createLiveActivity, type LiveActivityEnvironment } from "expo-widgets";
import type { WorkoutSurfaceProps } from "@/lib/intelligence/workout-surface";

const ActiveWorkout = (props: WorkoutSurfaceProps, env: LiveActivityEnvironment) => {
  "widget";
  const accent = env.isLuminanceReduced ? "#F5F5F7" : "#30D158";
  const text = "#F5F5F7";
  const muted = "#A1A1A6";
  const stale = env.isStale === true;
  const label = stale
    ? "Open SamePace to refresh"
    : props.state === "paused"
      ? "Paused"
      : "Workout in progress";
  const icon = props.state === "paused" ? "pause.circle" : "figure.run";
  const metrics = (
    <HStack spacing={14}>
      <Text
        modifiers={[
          font({ size: 20, weight: "semibold" }),
          monospacedDigit(),
          foregroundStyle(text),
        ]}
      >
        {props.elapsedLabel}
      </Text>
      <Spacer />
      {!stale && props.heartRateLabel && (
        <Text modifiers={[font({ size: 15 }), foregroundStyle(text)]}>{props.heartRateLabel}</Text>
      )}
      {!stale && props.distanceLabel && (
        <Text modifiers={[font({ size: 15 }), foregroundStyle(text)]}>{props.distanceLabel}</Text>
      )}
    </HStack>
  );
  return {
    banner: (
      <VStack
        alignment="leading"
        spacing={7}
        modifiers={[padding({ all: 16 }), activityBackgroundTint("#050506")]}
      >
        <Text modifiers={[font({ size: 12, weight: "semibold" }), foregroundStyle(accent)]}>
          {label}
        </Text>
        <Text
          modifiers={[font({ size: 17, weight: "semibold" }), foregroundStyle(text), lineLimit(1)]}
        >
          {props.title}
        </Text>
        {metrics}
        <Text modifiers={[font({ size: 11 }), foregroundStyle(muted)]}>
          {stale
            ? "Last received elapsed time; current readings unavailable."
            : "From your active Watch workout."}
        </Text>
      </VStack>
    ),
    compactLeading: (
      <Image systemName={stale ? "arrow.clockwise" : icon} size={14} color={accent} />
    ),
    compactTrailing: (
      <Text
        modifiers={[
          font({ size: 12, weight: "semibold" }),
          monospacedDigit(),
          foregroundStyle(accent),
        ]}
      >
        {stale ? "Open" : props.elapsedLabel}
      </Text>
    ),
    minimal: <Image systemName={stale ? "arrow.clockwise" : icon} size={13} color={accent} />,
    expandedLeading: (
      <Text
        modifiers={[font({ size: 13, weight: "semibold" }), foregroundStyle(accent), lineLimit(1)]}
      >
        {props.title}
      </Text>
    ),
    expandedTrailing: (
      <Text modifiers={[font({ size: 12 }), foregroundStyle(muted)]}>
        {stale ? "Refresh" : props.state === "paused" ? "Paused" : "Active"}
      </Text>
    ),
    expandedBottom: (
      <VStack alignment="leading" spacing={4} modifiers={[padding({ all: 6 })]}>
        {metrics}
        <Text modifiers={[font({ size: 11 }), foregroundStyle(muted)]}>{label}</Text>
      </VStack>
    ),
  };
};

export default createLiveActivity<WorkoutSurfaceProps>("ActiveWorkout", ActiveWorkout);
