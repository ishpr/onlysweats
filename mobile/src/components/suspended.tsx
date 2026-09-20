import { useRouter } from "expo-router";
import { Linking, StyleSheet } from "react-native";

import { Button, Notice, Screen, T } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useAuth } from "@/lib/auth";

const SUPPORT = "support@samepace.app";

export function Suspended({ reason }: { reason: string }) {
  const { signOut } = useAuth();
  const router = useRouter();
  return (
    <Screen edges={["top", "bottom"]} contentStyle={styles.content}>
      <T variant="eyebrow" color="accent">
        SamePace
      </T>
      <T variant="title">Your account is paused.</T>
      <T color="textSecondary">
        We paused it after reviewing a report. Your sessions were called off and your seats
        released, at no charge to anyone.
      </T>
      {reason ? <Notice tone="danger">{reason}</Notice> : null}
      <T color="textSecondary">
        If you think we got it wrong, write to us and a person will look again.
      </T>
      <Button
        label={`Email ${SUPPORT}`}
        accessibilityRole="link"
        onPress={() => void Linking.openURL(`mailto:${SUPPORT}?subject=Paused%20account`)}
      />
      <Button variant="ghost" label="Sign out" onPress={() => void signOut()} />
      <Button
        variant="ghost"
        label="Delete account"
        onPress={() => router.push("/delete-account")}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: "center", gap: Spacing.two },
});
