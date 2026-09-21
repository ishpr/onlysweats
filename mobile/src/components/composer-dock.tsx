/**
 * The message box, pinned: it sits just above the tab bar (or the home indicator), and
 * rides up with the keyboard. Glass like the tab bar, so the thread scrolls under it.
 */
import { BlurView } from "expo-blur";
import { useEffect, useState } from "react";
import { Keyboard, Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Spacing } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTheme } from "@/hooks/use-theme";
import { useDockedComposer } from "@/lib/composer-slot";

/** Tab bar: 8 top + 48 targets + the tucked-in bottom inset (see (tabs)/_layout). */
export const tabBarHeight = (bottomInset: number) =>
  Spacing.one + 48 + Math.max(Spacing.one, bottomInset - 18);

export function ComposerDock({
  aboveTabBar,
  onHeight,
}: {
  aboveTabBar: boolean;
  /** So the thread can pad itself clear of the dock. 0 while nothing is docked. */
  onHeight: (height: number) => void;
}) {
  const composer = useDockedComposer();
  const theme = useTheme();
  const scheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      (e) => setKeyboard(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setKeyboard(0),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  useEffect(() => {
    if (!composer) onHeight(0);
  }, [composer, onHeight]);
  if (!composer) return null;
  const ios = Platform.OS === "ios";
  const Bar = ios ? BlurView : View;
  const resting = aboveTabBar ? tabBarHeight(insets.bottom) : Math.max(Spacing.one, insets.bottom);
  return (
    <Bar
      {...(ios ? { intensity: 45, tint: scheme } : null)}
      onLayout={(e) => onHeight(e.nativeEvent.layout.height)}
      style={[
        styles.dock,
        {
          bottom: keyboard > 0 ? keyboard : resting,
          backgroundColor: ios ? theme.glass : theme.background,
          borderTopColor: theme.glassEdge,
        },
      ]}
    >
      {composer}
    </Bar>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: "absolute",
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderTopWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
});
