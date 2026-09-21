import { useRouter } from "expo-router";
import { Linking, StyleSheet } from "react-native";

import { Lockup } from "@/components/brand";
import { Button, Notice, Screen, T } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useAuth } from "@/lib/auth";

const SUPPORT = "support@samepace.app";

export function Suspended({ reason }: { reason: string }) {
  const { signOut } = useAuth();
  const router = useRouter();
  return (
    <Screen edges={["top", "bottom"]} contentStyle={styles.content}>
      <Lockup />
      <T variant="title">Your account is suspended.</T>
      <T color="textSecondary">
        We suspended it after reviewing a report. Your upcoming sessions were cancelled at no cost
        to anyone.
      </T>
      {reason ? <Notice tone="danger">{reason}</Notice> : null}
      <T color="textSecondary">
        If you think we got it wrong, write to us and a person will look again.
      </T>
      <Button
        label={`Email ${SUPPORT}`}
        accessibilityRole="link"
        onPress={() => void Linking.openURL(`mailto:${SUPPORT}?subject=Suspended%20account`)}
      />
      <Button variant="ghost" label="Sign out" onPress={() => void signOut()} />
      <Button variant="ghost" label="Manage Apple Health data" onPress={() => router.push("/health")} />
      <Button variant="ghost" label="Fitness data and AI permissions" onPress={() => router.push("/fitness")} />
      <Button variant="ghost" label="Manage assistant access" onPress={() => router.push("/assistant")} />
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
