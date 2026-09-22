/**
 * "Verify first" as a moment, not an error and not a detour: the server said this join or
 * post needs a verified member, so the app says why in one breath and offers the way
 * there. Opened through `useVerifyGate`; one of the app-wide sheets (lib/global-sheets).
 */
import { useRouter } from "expo-router";
import { BadgeCheck } from "lucide-react-native";
import { StyleSheet, View } from "react-native";

import { Sheet } from "@/components/sheet";
import { Button, T } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { registerGlobalSheet } from "@/lib/global-sheets";
import type { VerificationTier } from "@/lib/types";

function VerifyGateSheet({
  visible,
  onClose,
  tier,
}: {
  visible: boolean;
  onClose: () => void;
  tier: VerificationTier;
}) {
  const router = useRouter();
  const theme = useTheme();
  const id = tier === "government_id";
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={id ? "One more check for this one" : "Get verified to do this"}
      footer={
        <>
          <Button
            variant="accent"
            label={id ? "Verify my ID" : "Verify now"}
            onPress={() => {
              onClose();
              router.push({ pathname: "/verify", params: { tier } });
            }}
          />
          <Button variant="ghost" label="Not now" onPress={onClose} />
        </>
      }
    >
      <View style={styles.row}>
        <View style={[styles.icon, { backgroundColor: theme.accentSoft }]}>
          <BadgeCheck size={22} color={theme.accent} />
        </View>
        <T color="textSecondary" style={styles.flex}>
          {id
            ? "Women-only sessions ask for a government ID check as well. It takes a couple of minutes, once."
            : "Public sessions are for verified members: a phone and a selfie check, about a minute, once. SamePace never sees your photo."}
        </T>
      </View>
    </Sheet>
  );
}

registerGlobalSheet("verify-gate", VerifyGateSheet);

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
});
