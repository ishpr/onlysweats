import {
  Outfit_400Regular,
  Outfit_500Medium,
  Outfit_600SemiBold,
  Outfit_700Bold,
  useFonts,
} from "@expo-google-fonts/outfit";
import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
  focusManager,
} from "@tanstack/react-query";
import { DarkTheme, DefaultTheme, type Href, Stack, ThemeProvider, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { Appearance, AppState, Pressable, Text } from "react-native";

import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTheme } from "@/hooks/use-theme";
import { ApiError } from "@/lib/api";
import { AuthProvider, useAuth } from "@/lib/auth";
import { AnimatedSplash } from "@/components/animated-splash";
import { haptic } from "@/lib/haptics";
import { onNotificationOpened, syncPush } from "@/lib/push";

SplashScreen.preventAutoHideAsync();
// No native cross-fade: the in-app mark is already exactly where the still one was.
SplashScreen.setOptions({ fade: false });
// Native chrome (keyboard, alerts, share sheet) follows the pinned dark scheme too.
Appearance.setColorScheme("dark");

// React Query's window-focus refetch, mapped to the app returning to the foreground.
AppState.addEventListener("change", (state) => focusManager.setFocused(state === "active"));

export default function RootLayout() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        // How a server decision feels: each mutation names its own success, and a
        // refusal always lands the same way.
        mutationCache: new MutationCache({
          onSuccess: (_data, _vars, _ctx, mutation) => {
            const kind = mutation.meta?.haptic;
            if (kind === "success") haptic.success();
            else if (kind === "warning") haptic.warning();
          },
          onError: () => haptic.error(),
        }),
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            // A rule rejection (4xx) won't change on retry; a dropped connection might.
            retry: (count, err) => count < 2 && !(err instanceof ApiError && err.status >= 400),
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Routes />
      </AuthProvider>
    </QueryClientProvider>
  );
}

function CloseButton() {
  const router = useRouter();
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Close"
      hitSlop={12}
      onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
      style={{ minHeight: 44, minWidth: 44, justifyContent: "center" }}
    >
      <Text style={{ color: theme.text, fontFamily: "Outfit_500Medium", fontSize: 16 }}>Close</Text>
    </Pressable>
  );
}

function Routes() {
  const { signedIn } = useAuth();
  const dark = useColorScheme() === "dark";
  const theme = useTheme();

  const [fontsReady, fontError] = useFonts({
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
  });
  // A font that fails to load falls back to the system face — never block on it.
  const ready = signedIn !== null && (fontsReady || Boolean(fontError));

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  // The native splash hands over to an identical mark that then animates.
  const [splashDone, setSplashDone] = useState(false);
  const endSplash = useCallback(() => setSplashDone(true), []);

  // Signed in: keep this device's push token fresh (never prompts), and open the
  // screen a tapped notification points at — including the tap that launched us.
  const router = useRouter();
  useEffect(() => {
    if (!ready || !signedIn) return;
    void syncPush();
    return onNotificationOpened((route) => router.push(route as Href));
  }, [ready, signedIn, router]);

  // Keychain read / fonts in flight — the splash screen is still up.
  if (!ready || signedIn === null) return null;
  const splash = splashDone ? null : <AnimatedSplash onDone={endSplash} />;

  const base = dark ? DarkTheme : DefaultTheme;
  return (
    <ThemeProvider
      value={{
        ...base,
        colors: {
          ...base.colors,
          background: theme.background,
          card: theme.background,
          text: theme.text,
          border: theme.border,
          primary: theme.accent,
        },
      }}
    >
      <StatusBar style={dark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShadowVisible: false,
          headerBackButtonDisplayMode: "minimal",
          headerTintColor: theme.text,
          headerTitleStyle: { fontFamily: "Outfit_600SemiBold" },
          headerStyle: { backgroundColor: theme.background },
        }}
      >
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="session/[id]" options={{ title: "" }} />
          <Stack.Screen name="thread/[id]" options={{ title: "Thread" }} />
          <Stack.Screen
            name="live/[id]"
            options={{
              title: "Live session",
              presentation: "fullScreenModal",
              // A full-screen modal has no swipe-to-dismiss on iOS — give it a way out.
              headerLeft: () => <CloseButton />,
            }}
          />
          <Stack.Screen name="post" options={{ title: "Post a session", presentation: "modal" }} />
          <Stack.Screen name="invite/[code]" options={{ title: "Invite" }} />
          <Stack.Screen name="training-block/[id]" options={{ title: "" }} />
          <Stack.Screen
            name="training-block/new"
            options={{ title: "Training block", presentation: "modal" }}
          />
          <Stack.Screen
            name="report"
            options={{ title: "Report or block", presentation: "modal" }}
          />
          <Stack.Screen name="blocked" options={{ title: "Blocked members" }} />
          <Stack.Screen name="activity" options={{ title: "Activity" }} />
          <Stack.Screen name="delete-account" options={{ title: "Delete account" }} />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
      {splash}
    </ThemeProvider>
  );
}
