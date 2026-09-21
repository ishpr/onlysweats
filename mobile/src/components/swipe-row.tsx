/**
 * Swipe a row left to delete it. The gesture is a shortcut, never the only way: the same
 * action is offered to VoiceOver by name, and screens keep a visible route to it too.
 * Pair with an Undo toast — a swipe should never need an "Are you sure?".
 */
import { Trash2 } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { T } from "@/components/ui";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { haptic } from "@/lib/haptics";

const REVEAL = 88;

export function SwipeRow({
  onDelete,
  deleteLabel = "Delete",
  children,
}: {
  onDelete: () => void;
  deleteLabel?: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  const x = useSharedValue(0);
  const start = useSharedValue(0);
  const remove = () => {
    haptic.warning();
    onDelete();
  };
  const drag = Gesture.Pan()
    // Horizontal intent only, so the list still scrolls.
    .activeOffsetX([-12, 12])
    .failOffsetY([-10, 10])
    .onBegin(() => {
      start.set(x.get());
    })
    .onUpdate((e) => {
      x.set(Math.min(0, Math.max(-REVEAL * 2.2, start.get() + e.translationX)));
    })
    .onEnd((e) => {
      // A long, committed swipe deletes; a short one opens the button.
      if (x.get() < -REVEAL * 1.8 || e.velocityX < -1400) {
        x.set(withTiming(-600, { duration: 180 }, (done) => done && runOnJS(remove)()));
      } else {
        x.set(withSpring(x.get() < -REVEAL / 2 ? -REVEAL : 0, { damping: 24, stiffness: 260 }));
      }
    });
  const row = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const behind = useAnimatedStyle(() => ({ opacity: Math.min(1, -x.value / (REVEAL * 0.6)) }));
  return (
    <View
      accessibilityActions={[{ name: "delete", label: deleteLabel }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === "delete") remove();
      }}
    >
      <Animated.View style={[styles.behind, { backgroundColor: theme.danger }, behind]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={deleteLabel}
          onPress={remove}
          style={styles.button}
        >
          <Trash2 size={20} color={theme.onDanger} />
          <T variant="caption" style={{ color: theme.onDanger }}>
            {deleteLabel}
          </T>
        </Pressable>
      </Animated.View>
      <GestureDetector gesture={drag}>
        <Animated.View style={row}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  behind: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: Radius.xl,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  button: {
    width: REVEAL,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.half,
  },
});
