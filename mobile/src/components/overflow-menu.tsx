/**
 * The inline tier: a few one-line actions about the thing beside the button, in a small
 * glass menu anchored to it. No dimmed page, no sheet. Destructive items still confirm
 * (with a ConfirmSheet) after the menu has closed — never on top of it.
 */
import { BlurView } from "expo-blur";
import { Check, Ellipsis, type LucideIcon } from "lucide-react-native";
import { useRef, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, { FadeIn, FadeOut, useReducedMotion, ZoomIn } from "react-native-reanimated";

import { T, withAlpha } from "@/components/ui";
import { HitTarget, Radius, Spacing } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTheme } from "@/hooks/use-theme";
import { haptic } from "@/lib/haptics";

export type MenuItem = {
  icon?: LucideIcon;
  label: string;
  checked?: boolean;
  danger?: boolean;
  onPress: () => void;
};

const WIDTH = 248;

export function OverflowMenu({
  items,
  accessibilityLabel,
  icon: Trigger = Ellipsis,
}: {
  items: MenuItem[];
  /** What the menu is about: "Session options". */
  accessibilityLabel: string;
  icon?: LucideIcon;
}) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const window = useWindowDimensions();
  const reduced = useReducedMotion();
  const trigger = useRef<View>(null);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);

  const open = () => {
    haptic.tap();
    trigger.current?.measureInWindow((x, y, width, height) => {
      // Below the button and right-aligned to it; above it when there's no room below.
      const menuHeight = items.length * HitTarget + Spacing.two;
      const below = y + height + 6;
      const top =
        below + menuHeight > window.height - 40 ? Math.max(40, y - menuHeight - 6) : below;
      setAnchor({ top, right: Math.max(Spacing.two, window.width - (x + width)) });
    });
  };
  const close = () => setAnchor(null);

  const ios = Platform.OS === "ios";
  const Glass = ios ? BlurView : View;
  return (
    <>
      <Pressable
        ref={trigger}
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ expanded: anchor !== null }}
        style={[styles.trigger, { backgroundColor: theme.field }]}
      >
        <Trigger size={20} color={theme.text} />
      </Pressable>
      <Modal transparent visible={anchor !== null} animationType="none" onRequestClose={close}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel="Close menu"
        />
        {anchor && (
          <Animated.View
            entering={
              reduced
                ? FadeIn.duration(120)
                : ZoomIn.duration(140).withInitialValues({ transform: [{ scale: 0.92 }] })
            }
            exiting={FadeOut.duration(100)}
            accessibilityRole="menu"
            accessibilityViewIsModal
            onAccessibilityEscape={close}
            style={[styles.menu, anchor, { borderColor: theme.glassEdge }]}
          >
            <Glass
              {...(ios ? { intensity: 70, tint: scheme } : null)}
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: ios ? withAlpha(theme.background, 0.8) : theme.background },
              ]}
            />
            {items.map(({ icon: Icon, label, checked, danger, onPress }, index) => (
              <Pressable
                key={label}
                accessibilityRole="menuitem"
                accessibilityLabel={label}
                accessibilityState={checked === undefined ? undefined : { checked }}
                onPress={() => {
                  close();
                  onPress();
                }}
                style={({ pressed }) => [
                  styles.item,
                  index > 0 && {
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: theme.border,
                  },
                  pressed && { backgroundColor: theme.backgroundSelected },
                ]}
              >
                {Icon ? (
                  <Icon size={18} color={danger ? theme.danger : theme.textSecondary} />
                ) : null}
                <T variant="label" style={[styles.flex, danger && { color: theme.danger }]}>
                  {label}
                </T>
                {checked ? <Check size={18} color={theme.accent} /> : null}
              </Pressable>
            ))}
          </Animated.View>
        )}
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  trigger: {
    width: HitTarget,
    height: HitTarget,
    borderRadius: HitTarget / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  menu: {
    position: "absolute",
    width: WIDTH,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    shadowColor: "#0F1419",
    shadowOpacity: 0.2,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  item: {
    minHeight: HitTarget + 4,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
});
