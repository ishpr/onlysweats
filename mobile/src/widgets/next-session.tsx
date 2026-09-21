/**
 * Home and Lock Screen widget: my next session.
 *
 * A `'widget'` function is serialized and run inside the widget extension, not
 * the app: it can only use `@expo/ui/swift-ui`, takes everything through props,
 * and can't see anything declared outside its own body — colours included.
 */
import { HStack, Image, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  containerBackground,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  padding,
  widgetURL,
} from "@expo/ui/swift-ui/modifiers";
import { createWidget, type WidgetEnvironment } from "expo-widgets";

export type NextSessionProps = {
  /** Empty title = nothing booked. */
  title: string;
  /** "Sat 6:30 PM", already in the cluster's timezone. */
  when: string;
  /** Epoch ms, for the live countdown. 0 when nothing is booked. */
  startAt: number;
  venue: string;
  level: string;
  /** "Hosting" · "Joined" · "Waiting" */
  status: string;
  /** Where a tap goes: `samepace://session/<id>`, or Find when nothing is planned. */
  url: string;
};

const NextSession = (props: NextSessionProps, env: WidgetEnvironment) => {
  "widget";
  // Same two palettes as the app (constants/theme.ts) — repeated here because a
  // widget function can't see anything outside its own body.
  const light = env.colorScheme === "light";
  const ink = light ? "#FFFFFF" : "#050506";
  const text = light ? "#0F1419" : "#F5F5F7";
  const muted = light ? "#536471" : "#A1A1A6";
  const accent = light ? "#0B7A2E" : "#30D158";
  const lock = env.widgetFamily.startsWith("accessory");
  const empty = props.title === "";

  if (env.widgetFamily === "accessoryInline") {
    return (
      <Text modifiers={[widgetURL(props.url)]}>
        {empty ? "SamePace · nothing planned" : `${props.title} · ${props.when}`}
      </Text>
    );
  }

  if (lock) {
    return (
      <VStack alignment="leading" spacing={1} modifiers={[widgetURL(props.url)]}>
        <Text modifiers={[font({ size: 13, weight: "semibold" }), lineLimit(1)]}>
          {empty ? "Nothing planned" : props.title}
        </Text>
        <Text modifiers={[font({ size: 12 }), lineLimit(1)]}>
          {empty ? "Find a buddy for your next workout" : props.when}
        </Text>
        {!empty && <Text modifiers={[font({ size: 12 }), lineLimit(1)]}>{props.venue}</Text>}
      </VStack>
    );
  }

  const header = (
    <HStack spacing={4}>
      <Image systemName="figure.run" size={12} color={accent} />
      <Text modifiers={[font({ size: 11, weight: "semibold" }), foregroundStyle(accent)]}>
        {empty ? "SAMEPACE" : props.status.toUpperCase()}
      </Text>
      <Spacer />
    </HStack>
  );

  if (empty) {
    return (
      <VStack
        alignment="leading"
        spacing={6}
        modifiers={[
          padding({ all: 14 }),
          frame({ maxWidth: 10000, maxHeight: 10000, alignment: "topLeading" }),
          containerBackground(ink, "widget"),
          widgetURL(props.url),
        ]}
      >
        {header}
        <Spacer />
        <Text modifiers={[font({ size: 16, weight: "semibold" }), foregroundStyle(text)]}>
          Nothing planned
        </Text>
        <Text modifiers={[font({ size: 12 }), foregroundStyle(muted), lineLimit(2)]}>
          Find a buddy for your next workout.
        </Text>
      </VStack>
    );
  }

  const wide = env.widgetFamily !== "systemSmall";
  return (
    <VStack
      alignment="leading"
      spacing={4}
      modifiers={[
        padding({ all: 14 }),
        frame({ maxWidth: 10000, maxHeight: 10000, alignment: "topLeading" }),
        containerBackground(ink, "widget"),
        widgetURL(props.url),
      ]}
    >
      {header}
      <Spacer />
      <Text
        modifiers={[
          font({ size: wide ? 19 : 16, weight: "semibold" }),
          foregroundStyle(text),
          lineLimit(2),
        ]}
      >
        {props.title}
      </Text>
      <Text modifiers={[font({ size: 13, weight: "medium" }), foregroundStyle(text), lineLimit(1)]}>
        {props.when}
      </Text>
      <Text modifiers={[font({ size: 12 }), foregroundStyle(muted), lineLimit(1)]}>
        {wide ? `${props.venue} · ${props.level}` : props.venue}
      </Text>
      {wide && (
        <HStack spacing={4}>
          <Text modifiers={[font({ size: 12 }), foregroundStyle(muted)]}>Starts</Text>
          <Text
            date={new Date(props.startAt)}
            dateStyle="relative"
            modifiers={[font({ size: 12, weight: "medium" }), foregroundStyle(accent)]}
          />
        </HStack>
      )}
    </VStack>
  );
};

export default createWidget<NextSessionProps>("NextSession", NextSession);
