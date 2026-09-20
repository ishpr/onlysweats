import { useQuery } from "@tanstack/react-query";
import * as AppleAuthentication from "expo-apple-authentication";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, View } from "react-native";

import { Lockup } from "@/components/brand";
import { Button, Field, Notice, Screen, StateView, T } from "@/components/ui";
import { HitTarget, Radius, Spacing } from "@/constants/theme";
import { fetchAuthConfig } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  appleAvailable,
  googleAvailable,
  signInWithApple,
  signInWithGoogle,
  type SocialResult,
} from "@/lib/social";

/**
 * Sign in with Apple or Google — no passwords to make, lose or reuse. The server
 * says which methods exist; the email form only appears while it still allows
 * passwords (development, or a deployment with no provider configured yet).
 */
export default function SignIn() {
  const { signInWithToken } = useAuth();
  const config = useQuery({ queryKey: ["auth-config"], queryFn: fetchAuthConfig });
  const [appleOk, setAppleOk] = useState(false);
  const [busy, setBusy] = useState<"apple" | "google" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void appleAvailable().then(setAppleOk);
  }, []);

  if (!config.data) {
    return (
      <Screen edges={["top", "bottom"]} scroll={false}>
        <StateView
          loading={config.isPending}
          error={config.error}
          onRetry={() => void config.refetch()}
        />
      </Screen>
    );
  }

  const { apple, google, password } = config.data;
  const showApple = apple && appleOk;
  const showGoogle = Boolean(google) && googleAvailable();

  async function run(provider: "apple" | "google", start: () => Promise<SocialResult>) {
    setError("");
    setBusy(provider);
    try {
      await signInWithToken(await start());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Screen edges={["top", "bottom"]} contentStyle={styles.content}>
        <View style={styles.hero}>
          <Lockup />
          <T variant="title">Post the workout you’re doing anyway.</T>
          <T color="textSecondary">
            Someone at your level joins. SamePace makes sure you both show up.
          </T>
        </View>

        {showApple && (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            // The white button is the one Apple specifies for dark backgrounds.
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
            cornerRadius={Radius.pill}
            style={styles.apple}
            onPress={() => void run("apple", signInWithApple)}
          />
        )}
        {showGoogle && (
          <Button
            variant="soft"
            label="Continue with Google"
            loading={busy === "google"}
            disabled={busy !== null}
            onPress={() => void run("google", () => signInWithGoogle(google!))}
          />
        )}

        {error ? <Notice tone="danger">{error}</Notice> : null}

        {!showApple && !showGoogle && !password && (
          <Notice>Sign-in isn’t available in this build. Update the app and try again.</Notice>
        )}

        {password && <PasswordForm divider={showApple || showGoogle} />}

        <T variant="caption" color="textFaint" style={styles.center}>
          We only get your name and email. We never post anywhere, and nobody can look you up —
          people only see you on a session you posted or joined.
        </T>
      </Screen>
    </KeyboardAvoidingView>
  );
}

/** Development sign-in. The server turns this off in production once a provider exists. */
function PasswordForm({ divider }: { divider: boolean }) {
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
    <View style={styles.form}>
      {divider && (
        <T variant="eyebrow" color="textFaint" style={styles.center}>
          Development sign-in
        </T>
      )}
      {mode === "up" && (
        <Field label="First name" value={name} onChangeText={setName} autoComplete="given-name" />
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
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { flexGrow: 1, justifyContent: "center" },
  hero: { gap: Spacing.one, marginBottom: Spacing.three },
  apple: { height: HitTarget + 8, width: "100%" },
  form: { gap: Spacing.three },
  center: { textAlign: "center" },
});
