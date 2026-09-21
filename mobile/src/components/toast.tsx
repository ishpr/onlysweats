/**
 * A receipt, and a way back. "Workout deleted · Undo" beats "Are you sure?" every time
 * the thing can be undone. One toast at a time, above the tab bar, read out politely.
 */
import { BlurView } from "expo-blur";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AccessibilityInfo, Platform, Pressable, StyleSheet, View } from "react-native";
import Animated, {
  FadeInDown,
  FadeOutDown,
  useReducedMotion,
  FadeIn,
  FadeOut,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FullWindowOverlay } from "react-native-screens";

import { tabBarHeight } from "@/components/composer-dock";
import { T } from "@/components/ui";
import { HitTarget, Radius, Spacing } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTheme } from "@/hooks/use-theme";
import { haptic } from "@/lib/haptics";

export type ToastOptions = {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Milliseconds on screen. Longer by default when there is something to undo. */
  duration?: number;
};

const ToastContext = createContext<{ show: (toast: ToastOptions) => void } | null>(null);

/** `const toast = useToast(); toast.show({ message: "Log deleted", actionLabel: "Undo", onAction })` */
export function useToast() {
  const value = use(ToastContext);
  if (!value) throw new Error("useToast needs <ToastProvider> above it.");
  return value;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<(ToastOptions & { id: number }) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const next = useRef(0);
  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setToast(null);
  }, []);
  const show = useCallback(
    (options: ToastOptions) => {
      if (timer.current) clearTimeout(timer.current);
      next.current += 1;
      setToast({ ...options, id: next.current });
      AccessibilityInfo.announceForAccessibility(
        options.actionLabel
          ? `${options.message}. ${options.actionLabel} available.`
          : options.message,
      );
      timer.current = setTimeout(dismiss, options.duration ?? (options.actionLabel ? 5000 : 3000));
    },
    [dismiss],
  );
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const value = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext value={value}>
      {children}
      {/* Above every native screen — a modal route would otherwise cover a root-level toast. */}
      {toast ? (
        <Overlay>
          <ToastView key={toast.id} toast={toast} onDismiss={dismiss} />
        </Overlay>
      ) : null}
    </ToastContext>
  );
}

/** iOS: a window-level layer that passes touches through. Elsewhere screens aren't native modals. */
function Overlay({ children }: { children: ReactNode }) {
  if (Platform.OS !== "ios") return <>{children}</>;
  return (
    <FullWindowOverlay>
      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        {children}
      </View>
    </FullWindowOverlay>
  );
}

function ToastView({ toast, onDismiss }: { toast: ToastOptions; onDismiss: () => void }) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const ios = Platform.OS === "ios";
  const Glass = ios ? BlurView : View;
  return (
    <Animated.View
      entering={reduced ? FadeIn.duration(150) : FadeInDown.springify().damping(22)}
      exiting={reduced ? FadeOut.duration(120) : FadeOutDown.duration(160)}
      pointerEvents="box-none"
      style={[styles.wrap, { bottom: tabBarHeight(insets.bottom) + Spacing.two }]}
    >
      <Glass
        {...(ios ? { intensity: 70, tint: scheme === "light" ? "dark" : "light" } : null)}
        accessibilityLiveRegion="polite"
        // Inverted, so it reads on any page in either theme.
        style={[styles.toast, { backgroundColor: ios ? "rgba(15,20,25,0.78)" : theme.text }]}
      >
        <T variant="label" style={[styles.flex, styles.text]} numberOfLines={2}>
          {toast.message}
        </T>
        {toast.actionLabel ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={toast.actionLabel}
            hitSlop={8}
            onPress={() => {
              haptic.tap();
              toast.onAction?.();
              onDismiss();
            }}
            style={styles.action}
          >
            <T variant="label" style={styles.actionText}>
              {toast.actionLabel}
            </T>
          </Pressable>
        ) : null}
      </Glass>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wrap: { position: "absolute", left: Spacing.three, right: Spacing.three, alignItems: "center" },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    minHeight: HitTarget + 8,
    maxWidth: 520,
    alignSelf: "stretch",
    paddingLeft: Spacing.three,
    paddingRight: Spacing.one,
    borderRadius: Radius.lg,
    overflow: "hidden",
  },
  text: { color: "#FFFFFF" },
  action: {
    minHeight: HitTarget,
    minWidth: HitTarget,
    paddingHorizontal: Spacing.two,
    justifyContent: "center",
  },
  actionText: { color: "#7CF29A" },
});
