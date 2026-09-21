/**
 * Pace UI primitives. Every screen composes these; nothing here hardcodes a
 * colour — it all resolves through `useTheme()`. Touch targets are ≥44pt and
 * every pressable has a role and a label.
 */
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type ScrollViewProps,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type ViewStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  Fonts,
  HitTarget,
  MaxContentWidth,
  Radius,
  Spacing,
  type ThemeColor,
} from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

import { Appear, PressScale, Skeleton } from "./motion";

// ── Text ─────────────────────────────────────────────────────────────────────

type Variant = "title" | "heading" | "body" | "label" | "caption" | "eyebrow" | "mono";

export const TYPE: Record<Variant, object> = {
  title: { fontFamily: Fonts.semibold, fontSize: 34, lineHeight: 38, letterSpacing: -0.8 },
  heading: { fontFamily: Fonts.semibold, fontSize: 20, lineHeight: 26, letterSpacing: -0.4 },
  body: { fontFamily: Fonts.regular, fontSize: 16, lineHeight: 24 },
  label: { fontFamily: Fonts.medium, fontSize: 15, lineHeight: 22, letterSpacing: -0.2 },
  caption: { fontFamily: Fonts.regular, fontSize: 13, lineHeight: 20 },
  eyebrow: {
    fontFamily: Fonts.medium,
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 1.7,
    textTransform: "uppercase",
  },
  mono: {
    fontFamily: Fonts.semibold,
    fontSize: 30,
    lineHeight: 38,
    letterSpacing: 10,
    fontVariant: ["tabular-nums"],
  },
};

export function T({
  variant = "body",
  color = "text",
  style,
  ...rest
}: TextProps & { variant?: Variant; color?: ThemeColor }) {
  const theme = useTheme();
  return <Text style={[{ color: theme[color] }, TYPE[variant], style]} {...rest} />;
}

// ── Layout ───────────────────────────────────────────────────────────────────

/** The web body's soft colour wash: stand-blue from the top, a hint of move. */
function Backdrop() {
  const theme = useTheme();
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={[withAlpha(theme.stand, 0.1), "transparent"]}
        style={styles.glowTop}
      />
      <LinearGradient
        colors={[withAlpha(theme.move, 0.06), "transparent"]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0.3, y: 0.6 }}
        style={styles.glowTop}
      />
    </View>
  );
}

export function withAlpha(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export function Screen({
  children,
  scroll = true,
  onRefresh,
  refreshing = false,
  edges = ["top"],
  contentStyle,
  header,
  footer,
  ...rest
}: ScrollViewProps & {
  children: ReactNode;
  /** Pinned above the scroll area (app header, live banner). */
  header?: ReactNode;
  /** Pinned below it: the one action this screen exists for, always in reach. */
  footer?: ReactNode;
  scroll?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  edges?: ("top" | "bottom")[];
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const inner = [styles.content, contentStyle];
  // The spinner belongs to a pull, and only a pull. Queries also refetch when a tab
  // regains focus; tying the control to that made it stick open and shove the page
  // down. A pull shows for at least a beat, then for as long as the refetch runs.
  const [pulled, setPulled] = useState(false);
  const stillRefreshing = useRef(refreshing);
  useEffect(() => {
    stillRefreshing.current = refreshing;
  }, [refreshing]);
  useEffect(() => {
    if (!pulled) return;
    let poll: ReturnType<typeof setInterval> | undefined;
    const beat = setTimeout(() => {
      poll = setInterval(() => {
        if (!stillRefreshing.current) setPulled(false);
      }, 200);
    }, 700);
    return () => {
      clearTimeout(beat);
      if (poll) clearInterval(poll);
    };
  }, [pulled]);
  return (
    <SafeAreaView edges={edges} style={[styles.fill, { backgroundColor: theme.background }]}>
      <Backdrop />
      {header}
      {scroll ? (
        <ScrollView
          contentContainerStyle={inner}
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={pulled}
                onRefresh={() => {
                  setPulled(true);
                  onRefresh();
                }}
                tintColor={theme.textSecondary}
              />
            ) : undefined
          }
          {...rest}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.fill, inner]}>{children}</View>
      )}
      {footer ? (
        <View
          style={[
            styles.footer,
            { backgroundColor: theme.background, borderTopColor: theme.border },
          ]}
        >
          {footer}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

// ── Controls ─────────────────────────────────────────────────────────────────

type ButtonVariant = "primary" | "accent" | "soft" | "ghost" | "danger";

export function Button({
  label,
  variant = "primary",
  loading = false,
  disabled,
  style,
  ...rest
}: Omit<PressableProps, "children" | "style"> & {
  label: string;
  variant?: ButtonVariant;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const palette: Record<ButtonVariant, { bg: string; fg: string }> = {
    primary: { bg: theme.text, fg: theme.background },
    accent: { bg: theme.accent, fg: theme.onAccent },
    soft: { bg: theme.backgroundSelected, fg: theme.text },
    ghost: { bg: "transparent", fg: theme.text },
    danger: { bg: theme.danger, fg: theme.onDanger },
  };
  const { bg, fg } = palette[variant];
  const off = disabled || loading;
  return (
    <PressScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off, busy: loading }}
      disabled={off}
      // The dimming for "off" sits on an inner view: the press animation owns opacity here.
      style={[styles.button, { backgroundColor: bg }, style]}
      {...rest}
    >
      <View style={off ? styles.dim : undefined}>
        {loading ? (
          <ActivityIndicator color={fg} />
        ) : (
          <Text style={[TYPE.label, { color: fg }]}>{label}</Text>
        )}
      </View>
    </PressScale>
  );
}

export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <PressScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      feedback="select"
      scaleTo={0.95}
      hitSlop={4}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? theme.text : theme.backgroundElement,
          borderColor: selected ? theme.text : theme.border,
        },
      ]}
    >
      <Text
        style={[
          TYPE.caption,
          { fontFamily: Fonts.medium, color: selected ? theme.background : theme.textSecondary },
        ]}
      >
        {label}
      </Text>
    </PressScale>
  );
}

export function Field({ label, style, ...rest }: TextInputProps & { label: string }) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <T variant="caption" color="textSecondary">
        {label}
      </T>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.textFaint}
        selectionColor={theme.stand}
        style={[
          styles.input,
          TYPE.body,
          {
            backgroundColor: theme.backgroundElement,
            borderColor: theme.border,
            color: theme.text,
          },
          rest.multiline && styles.inputMultiline,
          style,
        ]}
        {...rest}
      />
    </View>
  );
}

// ── Bits ─────────────────────────────────────────────────────────────────────

export function Avatar({
  initials,
  accent = "exercise",
  size = 44,
}: {
  initials: string;
  accent?: "move" | "exercise" | "stand" | "fg";
  size?: number;
}) {
  const theme = useTheme();
  const ring = accent === "fg" ? theme.textSecondary : theme[accent];
  return (
    <View
      accessible={false}
      style={[
        styles.avatar,
        { width: size, height: size, borderColor: ring, backgroundColor: theme.backgroundSelected },
      ]}
    >
      <Text style={{ color: theme.text, fontFamily: Fonts.semibold, fontSize: size * 0.34 }}>
        {initials}
      </Text>
    </View>
  );
}

export function Badge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "accent" | "move";
}) {
  const theme = useTheme();
  const bg =
    tone === "accent" ? theme.accentSoft : tone === "move" ? theme.move : theme.backgroundSelected;
  const fg =
    tone === "accent" ? theme.accent : tone === "move" ? theme.onDanger : theme.textSecondary;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text
        style={{
          color: fg,
          fontFamily: Fonts.medium,
          fontSize: 11,
          lineHeight: 16,
          letterSpacing: 0.3,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

export function Notice({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "danger";
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole={tone === "danger" ? "alert" : undefined}
      style={[styles.notice, { backgroundColor: theme.backgroundSelected }]}
    >
      <T variant="caption" color={tone === "danger" ? "danger" : "textSecondary"}>
        {children}
      </T>
    </View>
  );
}

type IconType = (props: { size?: number; color?: string; strokeWidth?: number }) => ReactNode;

/**
 * Nothing here yet — said plainly, with the one thing to do about it. An empty
 * screen is the first thing a new member sees, so it always points somewhere.
 */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  secondary,
}: {
  icon?: IconType;
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void };
  secondary?: { label: string; onPress: () => void };
}) {
  const theme = useTheme();
  return (
    <Appear style={styles.state}>
      {Icon && (
        <View
          style={[
            styles.emptyIcon,
            { backgroundColor: theme.backgroundElement, borderColor: theme.border },
          ]}
        >
          <Icon size={26} color={theme.textSecondary} strokeWidth={1.75} />
        </View>
      )}
      <View style={styles.emptyText}>
        <T variant="heading" style={styles.center}>
          {title}
        </T>
        {body ? (
          <T color="textSecondary" style={styles.center}>
            {body}
          </T>
        ) : null}
      </View>
      {action && <Button label={action.label} variant="accent" onPress={action.onPress} />}
      {secondary && <Button label={secondary.label} variant="ghost" onPress={secondary.onPress} />}
    </Appear>
  );
}

/** Loading / error / empty states for a query. */
export function StateView({
  loading,
  error,
  onRetry,
  empty,
  rows = 3,
}: {
  loading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  empty?: string;
  /** How many placeholder cards to show while loading. */
  rows?: number;
}) {
  if (loading) return <Skeleton rows={rows} />;
  if (error) {
    return (
      <EmptyState
        title="That didn’t load"
        body={error.message}
        action={onRetry ? { label: "Try again", onPress: onRetry } : undefined}
      />
    );
  }
  return <EmptyState title={empty ?? "Nothing here yet."} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  glowTop: { position: "absolute", top: 0, left: 0, right: 0, height: 420 },
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.six * 2,
    gap: Spacing.three,
  },
  footer: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.one,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  card: {
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  button: {
    minHeight: HitTarget + 4,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.four,
    alignItems: "center",
    justifyContent: "center",
  },
  chip: {
    minHeight: HitTarget,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    alignItems: "center",
    justifyContent: "center",
  },
  field: { gap: Spacing.half },
  input: {
    minHeight: HitTarget + 4,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  inputMultiline: { minHeight: 96, textAlignVertical: "top" },
  avatar: {
    borderRadius: Radius.pill,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: { borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: Spacing.half },
  notice: { borderRadius: Radius.md, padding: Spacing.three },
  state: {
    flex: 1,
    minHeight: 240,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.three,
    padding: Spacing.four,
  },
  center: { textAlign: "center" },
  dim: { opacity: 0.45 },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: { gap: Spacing.one, maxWidth: 320 },
});
