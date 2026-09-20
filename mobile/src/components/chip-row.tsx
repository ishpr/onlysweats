import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { T } from "@/components/ui";
import { Spacing } from "@/constants/theme";

/** A labelled row of chips that scrolls sideways — every picker in a form. */
export function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <T variant="caption" color="textSecondary">
        {label}
      </T>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.one },
  chips: { gap: Spacing.one, paddingRight: Spacing.three },
});
