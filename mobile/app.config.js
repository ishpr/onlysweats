/**
 * Registers the local HealthKit plugin and optional Google sign-in configuration.
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
      ["expo-build-properties", { ios: { enableSceneSupport: true } }],
      "./plugins/with-healthkit",
      "./plugins/with-intelligence",
      "./plugins/with-watch",
      "expo-sharing",
      ["expo-image-picker", {
        photosPermission: "Choose a workout plan photo to turn into a private, editable draft on this iPhone.",
        cameraPermission: "Photograph a workout plan to review its exercises before saving a log.",
        microphonePermission: false,
      }],
      ...(iosUrlScheme ? [["@react-native-google-signin/google-signin", { iosUrlScheme }]] : []),
    ],
  };
};
