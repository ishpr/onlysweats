/**
 * Sign in with Apple + Google for the native app (server-only).
 *
 * The app gets an identity token from the OS (Apple) or Google's SDK and posts it
 * to `/api/auth/sign-in/social`; Better Auth verifies the signature, issuer,
 * audience and nonce. That flow needs no client secret — only the identifiers the
 * tokens are issued for, which are public values:
 *
 *   APPLE_BUNDLE_ID        the app's bundle id, e.g. app.samepace
 *   GOOGLE_WEB_CLIENT_ID   OAuth "Web application" client id (Android tokens'
 *                          audience, and what the app requests tokens for)
 *   GOOGLE_IOS_CLIENT_ID   OAuth "iOS" client id (iOS tokens' audience)
 *
 * A provider is on exactly when its identifier is set.
 */
const env = (key: string): string | undefined => process.env[key]?.trim() || undefined;

const isProduction = process.env.VERCEL_ENV === "production";

/** Expo Go signs Apple tokens for its own bundle id — accepted outside production only. */
const EXPO_GO_BUNDLE_ID = "host.exp.Exponent";

const appleBundleId = env("APPLE_BUNDLE_ID");
const googleWebClientId = env("GOOGLE_WEB_CLIENT_ID");
const googleIosClientId = env("GOOGLE_IOS_CLIENT_ID");
const googleClientIds = [googleWebClientId, googleIosClientId].filter((v): v is string => Boolean(v));

export const socialProviders = {
  ...(appleBundleId
    ? {
        apple: {
          clientId: appleBundleId,
          appBundleIdentifier: appleBundleId,
          audience: isProduction ? [appleBundleId] : [appleBundleId, EXPO_GO_BUNDLE_ID],
        },
      }
    : {}),
  ...(googleClientIds.length > 0 ? { google: { clientId: googleClientIds } } : {}),
};

export const socialProviderIds = Object.keys(socialProviders);

/**
 * Passwords are a development convenience, not a product feature. They stay on
 * until a real provider is configured (so a fresh deployment is still usable),
 * then turn off in production. `AUTH_EMAIL_PASSWORD=on|off` overrides either way.
 */
export function passwordSignInEnabled(): boolean {
  const override = env("AUTH_EMAIL_PASSWORD");
  if (override === "on") return true;
  if (override === "off") return false;
  return !(isProduction && socialProviderIds.length > 0);
}

/** What the app needs to draw its sign-in screen. Public values only. */
export function authConfig() {
  return {
    apple: Boolean(appleBundleId),
    google: googleWebClientId
      ? { webClientId: googleWebClientId, iosClientId: googleIosClientId ?? null }
      : null,
    password: passwordSignInEnabled(),
  };
}
