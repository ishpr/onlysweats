import { useQuery } from "@tanstack/react-query";
import * as AppleAuthentication from "expo-apple-authentication";
import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { Lockup } from "@/components/brand";
import { Appear, PressScale } from "@/components/motion";
import { Notice, Screen, StateView, T, TYPE } from "@/components/ui";
import { HitTarget, Radius, Spacing } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTheme } from "@/hooks/use-theme";
import { ApiError, fetchAuthConfig } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { SITE_URL } from "@/lib/config";
import {
  appleAvailable,
  googleAvailable,
  signInWithApple,
  signInWithGoogle,
  type SocialResult,
} from "@/lib/social";

/**
 * Sign in with Apple or Google — no passwords to make, lose or reuse. The server
 * says which of the two it accepts; the device says which it can do.
 */
export default function SignIn({
  hasInvite = false,
  hasPendingLink = false,
}: {
  hasInvite?: boolean;
  hasPendingLink?: boolean;
}) {
  const theme = useTheme();
  const scheme = useColorScheme();
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
          rows={1}
        />
      </Screen>
    );
  }

  const { apple, google } = config.data;
  const showApple = apple && appleOk;
  const showGoogle = Boolean(google) && googleAvailable();

  async function run(provider: "apple" | "google", start: () => Promise<SocialResult>) {
    setError("");
    setBusy(provider);
    try {
      await signInWithToken(await start());
    } catch (err) {
      // Never show a native exception to a member. Our own API's messages are already
      // written for people; anything from the platform's sign-in sheet is not.
      const other = provider === "apple" ? "Google" : "Apple";
      setError(
        err instanceof ApiError && err.status > 0
          ? err.message
          : `${provider === "apple" ? "Apple" : "Google"} sign-in didn’t go through. Try again${
              showApple && showGoogle ? `, or continue with ${other}` : ""
            }.`,
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen edges={["top", "bottom"]} scroll={false} contentStyle={styles.content}>
      <Appear style={styles.hero}>
        <Lockup />
        <T variant="title" style={styles.headline}>
          A workout buddy at your level who shows up.
        </T>
        <T color="textSecondary">
          Join a session near you, or post the one you’re already doing. You both check in when you
          get there — so people turn up.
        </T>
      </Appear>

      <View style={styles.actions}>
        {(hasInvite || hasPendingLink) && (
          <Notice>
            {hasInvite
              ? "Sign in to open your invite. We’ll bring you back to it here."
              : "Sign in to continue where this link takes you."}
          </Notice>
        )}
        {error ? <Notice tone="danger">{error}</Notice> : null}

        {showApple && (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            // Apple's own rule: the white button on dark backgrounds, the outlined white
            // one on light. Never the black slab on a white page.
            buttonStyle={
              scheme === "dark"
                ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                : AppleAuthentication.AppleAuthenticationButtonStyle.WHITE_OUTLINE
            }
            cornerRadius={Radius.pill}
            style={styles.provider}
            onPress={() => void run("apple", signInWithApple)}
          />
        )}
        {showGoogle && (
          <PressScale
            accessibilityRole="button"
            accessibilityLabel="Continue with Google"
            accessibilityState={{ disabled: busy !== null, busy: busy === "google" }}
            disabled={busy !== null}
            onPress={() => void run("google", () => signInWithGoogle(google!))}
            style={[
              styles.provider,
              styles.google,
              { backgroundColor: theme.chip, borderColor: theme.border },
            ]}
          >
            {busy === "google" ? (
              <ActivityIndicator color={theme.text} />
            ) : (
              <>
                <GoogleG />
                <T style={[TYPE.label, styles.googleLabel]}>Continue with Google</T>
              </>
            )}
          </PressScale>
        )}

        {!showApple && !showGoogle && (
          <Notice>Sign-in isn’t available in this build. Update the app and try again.</Notice>
        )}

        <T variant="caption" color="textFaint" style={styles.center}>
          Sign-in shares your name and email. Before using SamePace, you’ll review and accept the{" "}
          <T
            variant="caption"
            color="textSecondary"
            accessibilityRole="link"
            onPress={() => void Linking.openURL(`${SITE_URL}/terms`)}
          >
            Terms
          </T>{" "}
          and{" "}
          <T
            variant="caption"
            color="textSecondary"
            accessibilityRole="link"
            onPress={() => void Linking.openURL(`${SITE_URL}/privacy`)}
          >
            Privacy Policy
          </T>
          .
        </T>
      </View>
    </Screen>
  );
}

/** Google's "G", in Google's colours, as their sign-in branding asks. */
function GoogleG() {
  return (
    <Svg width={18} height={18} viewBox="0 0 48 48" accessible={false}>
      <Path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <Path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <Path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <Path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: "space-between", paddingBottom: Spacing.four },
  hero: { flex: 1, justifyContent: "center", gap: Spacing.two },
  headline: { marginTop: Spacing.three },
  actions: { gap: Spacing.two },
  provider: { height: HitTarget + 8, width: "100%" },
  google: {
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
  },
  googleLabel: { fontSize: 17 },
  center: { textAlign: "center", marginTop: Spacing.one },
});
