/**
 * Live Activity for a session inside its check-in window: Lock Screen banner and
 * the Dynamic Island. Same isolation rules as a widget — props in, layout out.
 */
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

export type LiveSessionProps = {
  title: string;
  venue: string;
  /** The other person's first name. */
  other: string;
  /** Epoch ms. */
  startAt: number;
  /** Epoch ms — when check-in closes (start + 25 min). */
  closesAt: number;
  meIn: boolean;
  themIn: boolean;
};

const LiveSession = (props: LiveSessionProps, env: LiveActivityEnvironment) => {
  "widget";
  const text = "#F5F5F7";
  const muted = "#A1A1A6";
  const accent = env.isLuminanceReduced ? "#F5F5F7" : "#30D158";
  const blue = env.isLuminanceReduced ? "#F5F5F7" : "#64D2FF";
  const done = props.meIn && props.themIn;
  const started = Date.now() >= props.startAt;
  // Count down to the start, then to the moment check-in closes.
  const target = new Date(started ? props.closesAt : props.startAt);
  const headline = done
    ? "Both checked in"
    : props.meIn
      ? `Waiting for ${props.other}`
      : started
        ? "Check in before it closes"
        : "Check-in is open";

  const timer = (size: number) => (
    <Text
      date={target}
      dateStyle="timer"
      modifiers={[font({ size, weight: "semibold" }), monospacedDigit(), foregroundStyle(accent)]}
    />
  );
  const who = (label: string, on: boolean, color: string) => (
    <HStack spacing={4}>
      <Image
        systemName={on ? "checkmark.circle.fill" : "circle.dotted"}
        size={14}
        color={on ? color : muted}
      />
      <Text modifiers={[font({ size: 13, weight: "medium" }), foregroundStyle(on ? text : muted)]}>
        {label}
      </Text>
    </HStack>
  );

  return {
    banner: (
      <VStack
        alignment="leading"
        spacing={8}
        modifiers={[padding({ all: 16 }), activityBackgroundTint("#050506")]}
      >
        <HStack spacing={6}>
          <Image systemName="figure.run" size={14} color={accent} />
          <Text modifiers={[font({ size: 12, weight: "semibold" }), foregroundStyle(accent)]}>
            {headline.toUpperCase()}
          </Text>
          <Spacer />
          {!done && timer(15)}
        </HStack>
        <Text
          modifiers={[font({ size: 17, weight: "semibold" }), foregroundStyle(text), lineLimit(1)]}
        >
          {props.title}
        </Text>
        <HStack spacing={14}>
          {who("You", props.meIn, accent)}
          {who(props.other, props.themIn, blue)}
          <Spacer />
          <Text modifiers={[font({ size: 12 }), foregroundStyle(muted), lineLimit(1)]}>
            {props.venue}
          </Text>
        </HStack>
      </VStack>
    ),
    compactLeading: (
      <Image systemName={done ? "checkmark.circle.fill" : "figure.run"} size={14} color={accent} />
    ),
    compactTrailing: done ? (
      <Text modifiers={[font({ size: 13, weight: "semibold" }), foregroundStyle(accent)]}>
        Done
      </Text>
    ) : (
      timer(13)
    ),
    minimal: (
      <Image systemName={done ? "checkmark.circle.fill" : "figure.run"} size={13} color={accent} />
    ),
    expandedLeading: (
      <VStack alignment="leading" spacing={2} modifiers={[padding({ leading: 6, top: 4 })]}>
        {who("You", props.meIn, accent)}
        {who(props.other, props.themIn, blue)}
      </VStack>
    ),
    expandedTrailing: (
      <VStack alignment="trailing" spacing={0} modifiers={[padding({ trailing: 6, top: 4 })]}>
        {done ? <Image systemName="checkmark.circle.fill" size={22} color={accent} /> : timer(20)}
        <Text modifiers={[font({ size: 11 }), foregroundStyle(muted)]}>
          {done ? "done" : started ? "to check in" : "to start"}
        </Text>
      </VStack>
    ),
    expandedBottom: (
      <VStack alignment="leading" spacing={2} modifiers={[padding({ horizontal: 6, bottom: 6 })]}>
        <Text
          modifiers={[font({ size: 15, weight: "semibold" }), foregroundStyle(text), lineLimit(1)]}
        >
          {props.title}
        </Text>
        <Text modifiers={[font({ size: 12 }), foregroundStyle(muted), lineLimit(1)]}>
          {headline} · {props.venue}
        </Text>
      </VStack>
    ),
  };
};

export default createLiveActivity<LiveSessionProps>("LiveSession", LiveSession);
