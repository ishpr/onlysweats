import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, View } from "react-native";

import { Button, Field, Notice, Screen, T } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useAuth } from "@/lib/auth";

export default function SignIn() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError("");
    if (mode === "up" && !name.trim())
      return setError("Add your first name — it’s what your buddy sees.");
    if (!email.trim() || password.length < 8)
      return setError("Email and a password of 8+ characters.");
    setBusy(true);
    try {
      if (mode === "in") await signIn(email.trim(), password);
      else await signUp(name.trim(), email.trim(), password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Screen edges={["top", "bottom"]} contentStyle={styles.content}>
        <View style={styles.hero}>
          <T variant="eyebrow" color="accent">
            SamePace
          </T>
          <T variant="title">Post the workout you’re doing anyway.</T>
          <T color="textSecondary">
            Someone at your level joins. SamePace makes sure you both show up.
          </T>
        </View>

        {mode === "up" && (
          <Field
            label="Name"
            value={name}
            onChangeText={setName}
            autoComplete="name"
            textContentType="name"
          />
        )}
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete={mode === "in" ? "current-password" : "new-password"}
          textContentType={mode === "in" ? "password" : "newPassword"}
          onSubmitEditing={submit}
        />
        {error ? <Notice tone="danger">{error}</Notice> : null}

        <Button
          label={mode === "in" ? "Sign in" : "Create account"}
          loading={busy}
          onPress={submit}
        />
        <Button
          variant="ghost"
          label={mode === "in" ? "New here? Create an account" : "Have an account? Sign in"}
          onPress={() => {
            setError("");
            setMode(mode === "in" ? "up" : "in");
          }}
        />
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { flexGrow: 1, justifyContent: "center" },
  hero: { gap: Spacing.one, marginBottom: Spacing.three },
});
