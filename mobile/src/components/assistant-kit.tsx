/**
 * The assistant's conversational pieces — presentational only, no data or network.
 * Any chat surface (on-device, cloud, or a future one) renders with these so the
 * assistant looks like one thing: bubbles, a typing state, reviewable action cards,
 * a composer, and a two-way switch. See docs/audits/design-handoff-assistant.md.
 */
import { ArrowUp, ChevronDown, ChevronRight, Square, type LucideIcon } from "lucide-react-native";
import { useEffect, useState, type ReactNode } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { AssistantOrb } from "@/components/assistant-hero";
import { AssistantMarkdown } from "@/components/assistant-markdown";
import { PressScale } from "@/components/motion";
import { Button, Card, Row, T, TYPE, withAlpha } from "@/components/ui";
import { HitTarget, Radius, Spacing } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTheme } from "@/hooks/use-theme";

/** Two or three choices in one pill. Use instead of a row of chips for a mode switch. */
export function Segmented<V extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: V; label: string; icon?: LucideIcon }[];
  value: V;
  onChange: (value: V) => void;
  /** What the choice is, for VoiceOver: "Assistant mode". */
  label: string;
}) {
  const theme = useTheme();
  const light = useColorScheme() === "light";
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={[styles.segmented, { backgroundColor: theme.field }]}
    >
      {options.map(({ value: option, label: text, icon: Icon }) => {
        const selected = option === value;
        return (
          <PressScale
            key={option}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={text}
            onPress={() => onChange(option)}
            style={[
              styles.segment,
              // A switch is not a call to action: the chosen side is a quiet raised pill,
              // so the screen's one green button stays the loudest thing on it.
              selected && [
                styles.segmentOn,
                { backgroundColor: light ? theme.background : withAlpha(theme.text, 0.16) },
              ],
            ]}
          >
            {Icon ? <Icon size={15} color={selected ? theme.text : theme.textSecondary} /> : null}
            <T
              variant="label"
              numberOfLines={1}
              style={{ color: selected ? theme.text : theme.textSecondary }}
            >
              {text}
            </T>
          </PressScale>
        );
      })}
    </View>
  );
}

/**
 * One message. The member's words sit right, in the accent's soft tint; the assistant's
 * sit left beside its orb. `source` says which assistant spoke ("On this iPhone", "Cloud").
 */
export function ChatBubble({
  from,
  source,
  children,
  footer,
  leading,
  streaming = false,
}: {
  from: "me" | "assistant";
  source?: string;
  children: ReactNode;
  /** Under the text, inside the bubble: a caption, or action cards. */
  footer?: ReactNode;
  /** A validated plan can lead the response, ahead of its optional explanation. */
  leading?: ReactNode;
  streaming?: boolean;
}) {
  const theme = useTheme();
  const light = useColorScheme() === "light";
  if (from === "me") {
    return (
      <View style={styles.mine}>
        <View style={[styles.bubble, styles.bubbleMine, { backgroundColor: theme.accentSoft }]}>
          <T selectable>{children}</T>
          {footer}
        </View>
      </View>
    );
  }
  return (
    <View style={styles.theirs}>
      <AssistantOrb state="ready" size={36} />
      <View style={styles.flex}>
        {source ? (
          <T variant="eyebrow" color="textFaint" style={styles.source}>
            {source}
          </T>
        ) : null}
        <View
          style={[
            styles.bubble,
            styles.bubbleTheirs,
            {
              backgroundColor: theme.backgroundElement,
              borderColor: light ? theme.glassEdge : theme.border,
            },
          ]}
        >
          {leading}
          {typeof children === "string" ? (
            <AssistantMarkdown text={children} streaming={streaming} />
          ) : (
            children
          )}
          {footer}
        </View>
      </View>
    </View>
  );
}

/** Keep an actionable plan prominent without losing any of the coach's explanation. */
export function CoachNotes({ text }: { text: string }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const Chevron = expanded ? ChevronDown : ChevronRight;
  if (!text) return null;
  return (
    <View style={{ gap: Spacing.half }}>
      <PressScale
        accessibilityRole="button"
        accessibilityLabel="Coach notes"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        style={styles.notesToggle}
      >
        <T variant="label" color="textSecondary" style={styles.flex}>
          Coach notes
        </T>
        <Chevron size={16} color={theme.textFaint} />
      </PressScale>
      {expanded && <AssistantMarkdown text={text} />}
    </View>
  );
}

/** The assistant is composing. Replaces a literal "Thinking…". */
export function TypingDots({ label = "The assistant is replying" }: { label?: string }) {
  return (
    <View
      accessible
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      style={styles.dots}
    >
      {[0, 1, 2].map((index) => (
        <Dot key={index} delay={index * 160} />
      ))}
    </View>
  );
}

function Dot({ delay }: { delay: number }) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const lift = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    lift.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 320 }),
          withTiming(0, { duration: 320 }),
          withTiming(0, { duration: 360 }),
        ),
        -1,
      ),
    );
  }, [delay, lift, reduced]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.35 + 0.65 * lift.value,
    transform: [{ translateY: -3 * lift.value }],
  }));
  return <Animated.View style={[styles.dot, { backgroundColor: theme.textSecondary }, style]} />;
}

/**
 * Something the assistant wants to do, for the member to look at first. It never acts
 * on its own: the primary button is always the member's yes.
 */
export function ActionCard({
  icon: Icon,
  title,
  facts,
  note,
  primary,
  secondary,
  busy,
}: {
  icon: LucideIcon;
  title: string;
  /** Short, scannable: "Tue 6:30 AM", "Katy Trail", "45 min". */
  facts?: string[];
  /** One line on what saying yes does — and what it doesn't. */
  note?: string;
  primary: { label: string; onPress: () => void };
  secondary?: { label: string; onPress: () => void };
  busy?: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.action,
        { borderColor: withAlpha(theme.accent, 0.35), backgroundColor: theme.accentSoft },
      ]}
    >
      <Row style={styles.actionHead}>
        <View style={[styles.actionIcon, { backgroundColor: withAlpha(theme.accent, 0.16) }]}>
          <Icon size={16} color={theme.accent} />
        </View>
        <T variant="label" style={styles.flex}>
          {title}
        </T>
      </Row>
      {facts && facts.length > 0 && (
        <View style={styles.facts}>
          {facts.map((fact) => (
            <View
              key={fact}
              style={[styles.fact, { backgroundColor: theme.chip, borderColor: theme.border }]}
            >
              <T variant="caption">{fact}</T>
            </View>
          ))}
        </View>
      )}
      {note ? (
        <T variant="caption" color="textSecondary">
          {note}
        </T>
      ) : null}
      <Row>
        {secondary ? (
          <Button
            style={styles.flex}
            variant="ghost"
            label={secondary.label}
            onPress={secondary.onPress}
          />
        ) : null}
        <Button
          style={styles.flex}
          variant="accent"
          label={primary.label}
          loading={busy}
          disabled={busy}
          onPress={primary.onPress}
        />
      </Row>
    </View>
  );
}

/** The message box: one glass pill, a round send button that turns into stop. */
export function Composer({
  value,
  onChangeText,
  onSend,
  onStop,
  streaming,
  placeholder = "Ask your assistant",
  disabled,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  onStop?: () => void;
  streaming?: boolean;
  placeholder?: string;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const canSend = !disabled && value.trim().length > 0;
  const stop = Boolean(streaming && onStop);
  return (
    <Card style={styles.composer}>
      <TextInput
        accessibilityLabel={placeholder}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textFaint}
        editable={!disabled}
        multiline
        style={[TYPE.body, styles.input, { color: theme.text }]}
      />
      <PressScale
        accessibilityRole="button"
        accessibilityLabel={stop ? "Stop the reply" : "Send"}
        accessibilityState={{ disabled: !stop && !canSend }}
        disabled={!stop && !canSend}
        onPress={stop ? onStop! : onSend}
        style={[
          styles.send,
          { backgroundColor: stop || canSend ? theme.primary : theme.backgroundSelected },
        ]}
      >
        {stop ? (
          <Square size={14} color={theme.onPrimary} fill={theme.onPrimary} />
        ) : (
          <ArrowUp size={20} color={canSend ? theme.onPrimary : theme.textFaint} />
        )}
      </PressScale>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  segmented: { flexDirection: "row", borderRadius: Radius.pill, padding: 4, gap: 4 },
  segment: {
    flex: 1,
    minHeight: HitTarget - 8,
    borderRadius: Radius.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: Spacing.two,
  },
  segmentOn: {
    shadowColor: "#0F1419",
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  mine: { alignItems: "flex-end" },
  theirs: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.one },
  source: { marginBottom: 2, marginLeft: Spacing.half },
  notesToggle: {
    minHeight: HitTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
  },
  bubble: { maxWidth: "88%", padding: Spacing.two, gap: Spacing.one },
  bubbleMine: {
    borderRadius: Radius.lg,
    borderBottomRightRadius: Radius.sm,
  },
  bubbleTheirs: {
    maxWidth: "100%",
    borderRadius: Radius.lg,
    borderTopLeftRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dots: {
    flexDirection: "row",
    gap: 5,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.half,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  action: { borderRadius: Radius.lg, borderWidth: 1, padding: Spacing.two, gap: Spacing.one },
  actionHead: { alignItems: "center", gap: Spacing.one },
  actionIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  facts: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  fact: {
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: Spacing.one,
    padding: Spacing.one,
    paddingLeft: Spacing.three,
    borderRadius: Radius.xl,
  },
  input: { flex: 1, maxHeight: 120, minHeight: HitTarget - 8, paddingTop: 8, paddingBottom: 8 },
  send: {
    width: HitTarget,
    height: HitTarget,
    borderRadius: HitTarget / 2,
    alignItems: "center",
    justifyContent: "center",
  },
});
