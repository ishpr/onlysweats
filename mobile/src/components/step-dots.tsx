/** Where you are in a short flow. Terms and the welcome steps share one row of dots. */
import { StyleSheet, View } from "react-native";

import { useTheme } from "@/hooks/use-theme";

export function StepDots({ step, total }: { step: number; total: number }) {
  const theme = useTheme();
  return (
    <View accessible accessibilityLabel={`Step ${step + 1} of ${total}`} style={styles.row}>
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={[
            styles.dot,
            { backgroundColor: i <= step ? theme.accent : theme.backgroundSelected },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 6, justifyContent: "center" },
  dot: { width: 28, height: 4, borderRadius: 2 },
});
