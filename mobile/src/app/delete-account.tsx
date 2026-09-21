import { useState } from "react";
import { Alert, StyleSheet, View } from "react-native";

import { Button, Card, Field, Notice, Screen, T } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useAuth } from "@/lib/auth";
import { useDeleteAccount } from "@/lib/queries";

const WORD = "DELETE";

const GOES = [
  "Your sign-in, name, neighborhood, level and everything else on your profile.",
  "Sessions you posted or joined — cancelled at no cost to anyone.",
  "Your weekly sessions and goals, your messages and your block list.",
];

export default function DeleteAccount() {
  const { signOut } = useAuth();
  const remove = useDeleteAccount();
  const [typed, setTyped] = useState("");

  const confirm = () =>
    Alert.alert("Delete your account?", "This can’t be undone.", [
      { text: "Keep my account", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () =>
          remove.mutate(undefined, { onSuccess: () => void signOut({ accountDeleted: true }) }),
      },
    ]);

  return (
    <Screen>
      <T color="textSecondary">
        Deleting is immediate and permanent. You don’t need to cancel anything first.
      </T>

      <Card>
        <T variant="label">What’s deleted</T>
        <View style={styles.list}>
          {GOES.map((line) => (
            <T key={line} variant="caption" color="textSecondary">
              • {line}
            </T>
          ))}
        </View>
      </Card>

      <Card>
        <T variant="label">What’s kept</T>
        <T variant="caption" color="textSecondary">
          The people you trained with keep their own history: that a session happened, who showed
          up, and any fee or safety report tied to it. It’s shown against “Deleted member”, never
          your name.
        </T>
      </Card>

      <Field
        label={`Type ${WORD} to confirm`}
        value={typed}
        onChangeText={setTyped}
        autoCapitalize="characters"
        autoCorrect={false}
      />
      {remove.error && <Notice tone="danger">{remove.error.message}</Notice>}
      <Button
        variant="danger"
        label="Delete my account"
        disabled={typed.trim().toUpperCase() !== WORD}
        loading={remove.isPending}
        onPress={confirm}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({ list: { gap: Spacing.one } });
