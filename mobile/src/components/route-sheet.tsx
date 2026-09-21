/**
 * A route that presents as a sheet. The route keeps its URL and params — so links,
 * notifications and every existing `router.push` still work — but what the member sees
 * is the app's glass sheet over the screen they came from, not an iOS page sheet.
 * Register the route with `routeSheetOptions` in app/_layout.tsx.
 */
import { useRouter } from "expo-router";
import { useState } from "react";

import { Sheet, type SheetProps } from "@/components/sheet";

export const routeSheetOptions = {
  presentation: "transparentModal",
  animation: "none",
  headerShown: false,
  // The sheet owns dismissal (and refuses it while there is unsaved input).
  gestureEnabled: false,
} as const;

export function RouteSheet(props: Omit<SheetProps, "visible" | "onClose" | "onClosed">) {
  const router = useRouter();
  const [visible, setVisible] = useState(true);
  return (
    <Sheet
      {...props}
      visible={visible}
      onClose={() => setVisible(false)}
      onClosed={() => (router.canGoBack() ? router.back() : router.replace("/"))}
    />
  );
}
