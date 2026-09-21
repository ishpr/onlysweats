/**
 * A bottom sheet: the app's way of answering one tap with one thing — a control's
 * choices, a confirmation, the detail behind a row — without leaving the screen or
 * stacking another card onto it. (When to use one: docs/design/MASTER-PLAN.md §1.)
 *
 * It rises on a spring and is only as tall as what it holds. With more than half a
 * screen of content it rests at half: pull up (or scroll up) and it fills the screen,
 * pull down and it settles back to half. Pull down again, tap outside, or Close and it
 * leaves — unless it is `dirty` (unsaved input: gestures bounce back, Close asks first)
 * or `locked` (must be answered with one of its buttons). Frosted glass, both themes.
 */
import { BlurView } from "expo-blur";
import { X } from "lucide-react-native";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  AccessibilityInfo,
  Alert,
  findNodeHandle,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { T, withAlpha } from "@/components/ui";
import { HitTarget, Radius, Spacing } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTheme } from "@/hooks/use-theme";
import { haptic } from "@/lib/haptics";

const SPRING = { damping: 26, stiffness: 260, mass: 0.9 } as const;

// The stacking rule, enforced where it can be seen: never a sheet on a sheet.
let open = 0;

export type SheetProps = {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Pinned under the content: the sheet's one primary action. */
  footer?: ReactNode;
  /** Open straight to full height (long content, a form). */
  startFull?: boolean;
  /** Keep what's inside alive while closed — a half-filled form survives a stray swipe. */
  keepMounted?: boolean;
  /** Unsaved input: swipe and tap-outside bounce back; Close and Back ask before leaving. */
  dirty?: boolean;
  /** Asked instead of closing while `dirty`. Default: a native "Discard?" alert. */
  onDiscardRequest?: () => void;
  /** Must be answered: no Close button, no gesture, no Back. Its buttons are the only exit. */
  locked?: boolean;
  /** After the closing animation. A route that *is* a sheet goes back here, not in `onClose`. */
  onClosed?: () => void;
  /** What VoiceOver returns to when the sheet closes — the control that opened it. */
  returnFocusTo?: RefObject<View | null>;
};

export function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  footer,
  startFull = false,
  keepMounted = false,
  dirty = false,
  onDiscardRequest,
  locked = false,
  onClosed,
  returnFocusTo,
}: SheetProps) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const reduced = useReducedMotion();

  // The panel is always full height; `y` slides it down. 0 = full, `half`, `closed`.
  const full = window.height - insets.top - Spacing.one;
  const closed = full;
  // Typing: the footer rides above the keyboard, and the sheet grows by that much — a
  // one-field sheet stays compact; only one that no longer fits takes the whole screen.
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => {
    // iOS reports the keyboard first without its suggestion bar, then again with it:
    // follow every frame change, not just the first "show".
    const show = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillChangeFrame" : "keyboardDidShow",
      (e) => setKeyboard(Math.max(0, window.height - e.endCoordinates.screenY)),
    );
    const hide = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setKeyboard(0),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, [window.height]);
  // Measured, so a short sheet hugs its content and has no full-screen stop to offer.
  // (At large text sizes a "compact" sheet outgrows half a screen and becomes a scrolling
  // large sheet on its own — its footer stays pinned.)
  const [headH, setHeadH] = useState(0);
  const [contentH, setContentH] = useState(0);
  const [footH, setFootH] = useState(0);
  const needed = headH + contentH + footH;
  const halfVisible = Math.round(window.height * 0.56);
  const canFill = needed > (keyboard > 0 ? full - Spacing.six : halfVisible);
  const half = Math.round(full - (canFill || needed === 0 ? halfVisible : needed));

  const y = useSharedValue(closed);
  const start = useSharedValue(closed);
  // Reduce Motion: no travel at all — the panel and the dim cross-fade in place.
  const appear = useSharedValue(reduced ? 0 : 1);
  // Where the sheet is resting (0 = full). Layout follows this; only transforms follow `y`
  // frame by frame — animated layout props are overwritten by React re-renders.
  const [rest, setRest] = useState(closed);
  const atFull = rest === 0;
  // Stay mounted through the closing animation.
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);
  const unmount = () => {
    setMounted(false);
    onClosed?.();
  };

  const settle = (to: number, done?: () => void) => {
    "worklet";
    runOnJS(setRest)(to);
    if (reduced) {
      if (to === closed) {
        appear.set(
          withTiming(0, { duration: 150 }, (finished) => {
            "worklet";
            if (finished) {
              y.set(closed);
              if (done) runOnJS(done)();
            }
          }),
        );
      } else {
        y.set(to);
        appear.set(withTiming(1, { duration: 150 }));
      }
      return;
    }
    y.set(
      withSpring(to, SPRING, (finished) => {
        "worklet";
        if (finished && done) runOnJS(done)();
      }),
    );
  };

  useEffect(() => {
    if (visible) settle(startFull && canFill ? 0 : half);
    else settle(closed, unmount);
    // `settle` is a fresh worklet each render; the values it reads are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, startFull, canFill, half, closed]);

  useEffect(() => {
    if (!visible) return;
    open += 1;
    if (__DEV__ && open > 1) {
      console.warn(`Sheet "${title}" opened over another sheet. One at a time — close, then open.`);
    }
    return () => {
      open -= 1;
    };
  }, [visible, title]);

  // VoiceOver lands on the title, and goes back to whatever opened the sheet.
  const titleRef = useRef<View>(null);
  useEffect(() => {
    if (!visible) return;
    const opener = returnFocusTo;
    const timer = setTimeout(() => {
      const node = findNodeHandle(titleRef.current);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }, 350);
    return () => {
      clearTimeout(timer);
      const node = opener ? findNodeHandle(opener.current) : null;
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    };
  }, [visible, returnFocusTo]);

  useEffect(() => {
    if (visible && keyboard > 0 && canFill) settle(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyboard, visible, canFill]);

  /** Close, Back and the VoiceOver escape all ask here; a dirty sheet asks the member first. */
  const requestClose = () => {
    if (locked) return;
    if (!dirty) return onClose();
    if (onDiscardRequest) return onDiscardRequest();
    Alert.alert("Discard what you’ve entered?", undefined, [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: onClose },
    ]);
  };
  /** A stray swipe or a tap outside never throws work away: the sheet bounces and stays. */
  const refuse = () => {
    haptic.warning();
    const rest = atFull ? 0 : half;
    if (!reduced)
      y.set(withSequence(withTiming(rest + 14, { duration: 90 }), withSpring(rest, SPRING)));
  };
  const guarded = dirty || locked;

  const notch = () => haptic.select();
  const pan = () =>
    Gesture.Pan()
      .onBegin(() => {
        start.set(y.get());
      })
      .onUpdate((e) => {
        // A little give upward; a short sheet only rubber-bands, it has nowhere higher to go.
        const top = canFill ? -24 : half - 24;
        const next = start.get() + e.translationY;
        // A guarded sheet resists being pulled down past its resting place.
        const floor = guarded
          ? Math.max(start.get(), half) + Math.max(0, e.translationY) * 0.15
          : closed;
        y.set(Math.max(top, Math.min(floor, next)));
      })
      .onEnd((e) => {
        const flung = Math.abs(e.velocityY) > 900;
        const down = e.velocityY > 0;
        const from = start.get() < half / 2 ? 0 : half;
        let to: number;
        if (flung) to = down ? (from === 0 ? half : closed) : canFill ? 0 : half;
        else if (canFill && y.get() < half / 2) to = 0;
        else if (y.get() < half + (closed - half) * 0.4) to = half;
        else to = closed;
        if (to === closed && guarded) {
          runOnJS(haptic.warning)();
          settle(from);
        } else if (to === closed) {
          settle(closed);
          runOnJS(onClose)();
        } else {
          if (to !== from) runOnJS(notch)();
          settle(to);
        }
      });
  // Two detectors, two gestures: the header always drags; the content drags only while
  // the sheet rests at half, so an upward pull expands it before anything scrolls.
  const headerDrag = pan();
  const contentDrag = pan().enabled(canFill && !atFull);

  const backdrop = useAnimatedStyle(() => ({
    opacity:
      appear.value * interpolate(y.value, [0, half, closed], [1, 0.7, 0], Extrapolation.CLAMP),
  }));
  const panel = useAnimatedStyle(() => ({
    opacity: appear.value,
    transform: [{ translateY: y.value }],
    // Square off as it meets the top of the screen.
    borderTopLeftRadius: interpolate(
      y.value,
      [0, half],
      [Radius.lg, Radius.xxl],
      Extrapolation.CLAMP,
    ),
    borderTopRightRadius: interpolate(
      y.value,
      [0, half],
      [Radius.lg, Radius.xxl],
      Extrapolation.CLAMP,
    ),
  }));
  // The panel is taller than what shows, so the footer is pinned to the *visible* bottom
  // (it follows the sheet as it moves) and the content stops above it.
  const foot = useAnimatedStyle(() => ({ transform: [{ translateY: -Math.max(0, y.value) }] }));

  if (!mounted && !keepMounted) return null;
  const ios = Platform.OS === "ios";
  const Glass = ios ? BlurView : View;
  return (
    <Modal
      transparent
      visible={mounted}
      statusBarTranslucent
      animationType="none"
      onRequestClose={requestClose}
    >
      <GestureHandlerRootView style={styles.flex}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.dim, backdrop]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={guarded ? refuse : onClose}
            accessible={!locked}
            accessibilityRole="button"
            accessibilityLabel={`Close ${title}`}
          />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          onAccessibilityEscape={requestClose}
          style={[styles.panel, { height: full, borderColor: theme.glassEdge }, panel]}
        >
          <Glass
            {...(ios ? { intensity: 70, tint: scheme } : null)}
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: ios ? withAlpha(theme.background, 0.78) : theme.background },
            ]}
          />
          <GestureDetector gesture={headerDrag}>
            <View style={styles.head} onLayout={(e) => setHeadH(e.nativeEvent.layout.height)}>
              {/* The grabber is a real control: it has a height to adjust, not just a look. */}
              <Pressable
                accessible={canFill}
                accessibilityRole="adjustable"
                accessibilityLabel="Sheet height"
                accessibilityValue={{ text: atFull ? "Full screen" : "Half screen" }}
                accessibilityActions={[
                  { name: "increment", label: "Expand" },
                  { name: "decrement", label: "Collapse" },
                ]}
                onAccessibilityAction={(e) => {
                  if (e.nativeEvent.actionName === "increment") settle(0);
                  if (e.nativeEvent.actionName === "decrement") settle(half);
                }}
                onPress={() => {
                  if (!canFill) return;
                  notch();
                  settle(atFull ? half : 0);
                }}
                hitSlop={{ top: 8, bottom: 12, left: 60, right: 60 }}
                style={styles.grab}
              >
                <View style={[styles.handle, { backgroundColor: withAlpha(theme.text, 0.24) }]} />
              </Pressable>
              <View style={styles.titleRow}>
                <View style={styles.flex} ref={titleRef} accessible accessibilityRole="header">
                  <T variant="heading">{title}</T>
                  {subtitle ? (
                    <T variant="caption" color="textSecondary">
                      {subtitle}
                    </T>
                  ) : null}
                </View>
                {locked ? null : (
                  <Pressable
                    onPress={requestClose}
                    accessibilityRole="button"
                    accessibilityLabel="Close"
                    hitSlop={8}
                    style={[styles.close, { backgroundColor: theme.field }]}
                  >
                    <X size={18} color={theme.textSecondary} />
                  </Pressable>
                )}
              </View>
            </View>
          </GestureDetector>
          <GestureDetector gesture={contentDrag}>
            <View style={[styles.flex, { paddingBottom: Math.min(rest, half) + footH }]}>
              <ScrollView
                style={styles.flex}
                scrollEnabled={atFull || !canFill}
                contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                onContentSizeChange={(_, height) => setContentH(height)}
              >
                {children}
              </ScrollView>
              <Animated.View
                onLayout={(e) => setFootH(e.nativeEvent.layout.height)}
                style={[
                  styles.pinned,
                  foot,
                  footer ? styles.footer : null,
                  {
                    paddingBottom:
                      keyboard > 0
                        ? keyboard + Spacing.two
                        : Math.max(Spacing.three, insets.bottom),
                  },
                ]}
              >
                {footer}
              </Animated.View>
            </View>
          </GestureDetector>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  dim: { backgroundColor: "rgba(5,5,6,0.5)" },
  panel: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    overflow: "hidden",
    shadowColor: "#0F1419",
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -8 },
  },
  head: { paddingBottom: Spacing.two, paddingHorizontal: Spacing.three, gap: Spacing.one },
  grab: { alignSelf: "center", paddingTop: Spacing.one, paddingBottom: Spacing.half },
  handle: { width: 40, height: 5, borderRadius: 3 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  close: {
    width: HitTarget,
    height: HitTarget,
    borderRadius: HitTarget / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  pinned: { position: "absolute", left: 0, right: 0, bottom: 0 },
  content: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.two, gap: Spacing.two },
  footer: { paddingHorizontal: Spacing.three, paddingTop: Spacing.one, gap: Spacing.one },
});
