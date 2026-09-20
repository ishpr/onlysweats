/**
 * Getting an identity token from Apple or Google. The token goes to our server,
 * which verifies it — nothing here is trusted on its own.
 *
 * Google's SDK is a native module that doesn't exist in Expo Go, so it is loaded
 * lazily and its absence just hides the button.
 */
import * as AppleAuthentication from "expo-apple-authentication";
import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";

export type IdToken = {
  token: string;
  nonce?: string;
  /** Apple only sends the name the first time someone authorizes the app. */
  user?: { name?: { firstName?: string; lastName?: string }; email?: string };
};

/** `null` = the person backed out. Not an error. */
export type SocialResult = {
  provider: "apple" | "google";
  idToken: IdToken;
  /** Apple's one-time code: lets the server revoke access if the account is deleted. */
  authorizationCode?: string;
} | null;

export type GoogleConfig = { webClientId: string; iosClientId: string | null };

export const appleAvailable = () =>
  Platform.OS === "ios"
    ? AppleAuthentication.isAvailableAsync().catch(() => false)
    : Promise.resolve(false);

export async function signInWithApple(): Promise<SocialResult> {
  // The nonce ties this token to this attempt; the server checks it came back.
  const nonce = Crypto.randomUUID();
  try {
    const cred = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce,
    });
    if (!cred.identityToken) throw new Error("Apple didn’t return a sign-in token.");
    const firstName = cred.fullName?.givenName ?? undefined;
    const lastName = cred.fullName?.familyName ?? undefined;
    return {
      provider: "apple",
      idToken: {
        token: cred.identityToken,
        nonce,
        user: {
          ...(firstName || lastName ? { name: { firstName, lastName } } : {}),
          ...(cred.email ? { email: cred.email } : {}),
        },
      },
      authorizationCode: cred.authorizationCode ?? undefined,
    };
  } catch (err) {
    if ((err as { code?: string }).code === "ERR_REQUEST_CANCELED") return null;
    throw err;
  }
}

type GoogleModule = typeof import("@react-native-google-signin/google-signin");

function loadGoogle(): GoogleModule | null {
  // Expo Go has no Google native module, and merely requiring it logs a red error.
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional native module
    return require("@react-native-google-signin/google-signin") as GoogleModule;
  } catch {
    return null;
  }
}

/** False in Expo Go, and on iOS builds made without GOOGLE_IOS_URL_SCHEME. */
export const googleAvailable = () => loadGoogle() !== null;

export async function signInWithGoogle(config: GoogleConfig): Promise<SocialResult> {
  const google = loadGoogle();
  if (!google) throw new Error("Google sign-in isn’t part of this build.");
  const { GoogleSignin, isSuccessResponse, isErrorWithCode, statusCodes } = google;
  GoogleSignin.configure({
    webClientId: config.webClientId,
    ...(config.iosClientId ? { iosClientId: config.iosClientId } : {}),
  });
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const res = await GoogleSignin.signIn();
    if (!isSuccessResponse(res)) return null;
    if (!res.data.idToken) throw new Error("Google didn’t return a sign-in token.");
    return { provider: "google", idToken: { token: res.data.idToken } };
  } catch (err) {
    if (isErrorWithCode(err) && err.code === statusCodes.SIGN_IN_CANCELLED) return null;
    throw err;
  }
}

/** Forget the Google account on this device, so the next sign-in shows the chooser. */
export async function signOutOfGoogle(opts: { revoke?: boolean } = {}) {
  const google = loadGoogle();
  if (!google) return;
  try {
    // Deleting the account also withdraws the app's access to the Google account.
    if (opts.revoke) await google.GoogleSignin.revokeAccess();
    await google.GoogleSignin.signOut();
  } catch {
    /* not signed in with Google, or never configured in this session */
  }
}
