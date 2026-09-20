/**
 * Extends app.json with the one piece that depends on a Google Cloud value.
 *
 * Google Sign-In on iOS needs a URL scheme baked into the native build: the iOS
 * OAuth client id, reversed (com.googleusercontent.apps.<id>). Set
 * GOOGLE_IOS_URL_SCHEME when building (EAS env or your shell); without it the
 * Google plugin is left out so Apple-only and Expo Go builds still work.
 */
module.exports = ({ config }) => {
  const iosUrlScheme = process.env.GOOGLE_IOS_URL_SCHEME;
  return {
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      ...(iosUrlScheme ? [["@react-native-google-signin/google-signin", { iosUrlScheme }]] : []),
    ],
  };
};
