/**
 * Where the member is, roughly — so Find can say "Near Uptown" and sort by distance,
 * and the profile's area keeps itself current instead of a made-up default.
 *
 * Coordinates never leave the phone: they sort a list on screen and are reverse-geocoded
 * on the device. The only thing saved to the profile is the area's name.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Location from "expo-location";
import { useEffect, useRef } from "react";

import { useMe, useUpdateMe } from "@/lib/queries";

export type Area = {
  permission: "granted" | "denied" | "undetermined";
  /** "Uptown", or the city when the geocoder knows no neighbourhood. */
  name: string | null;
  city: string | null;
  coords: { lat: number; lng: number } | null;
};

const KEY = ["area"] as const;

async function readArea(): Promise<Area> {
  const { status, canAskAgain } = await Location.getForegroundPermissionsAsync();
  if (status !== "granted") {
    return {
      permission: status === "denied" && !canAskAgain ? "denied" : "undetermined",
      name: null,
      city: null,
      coords: null,
    };
  }
  const position =
    (await Location.getLastKnownPositionAsync({ maxAge: 15 * 60_000, requiredAccuracy: 3000 })) ??
    (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }));
  const coords = { lat: position.coords.latitude, lng: position.coords.longitude };
  // A neighbourhood is enough. If the geocoder is unreachable, distances still work.
  const [place] = await Location.reverseGeocodeAsync({
    latitude: coords.lat,
    longitude: coords.lng,
  }).catch(() => []);
  const city = place?.city ?? place?.subregion ?? null;
  return { permission: "granted", name: place?.district ?? city, city, coords };
}

export function useArea() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: KEY,
    queryFn: readArea,
    staleTime: 10 * 60_000,
    retry: false,
  });
  return {
    area: query.data ?? null,
    /** Shows the system's own permission sheet; the answer is the member's. */
    ask: async () => {
      await Location.requestForegroundPermissionsAsync();
      await client.invalidateQueries({ queryKey: KEY });
    },
  };
}

/** Keeps the profile's area in step with where the member actually is. Mount once. */
export function useKeepAreaCurrent() {
  const { area } = useArea();
  const me = useMe();
  const { mutate } = useUpdateMe();
  const sent = useRef<string | null>(null);
  const name = area?.name ?? null;
  const saved = me.data?.neighborhood ?? null;
  useEffect(() => {
    if (!name || saved === null || name === saved || sent.current === name) return;
    sent.current = name;
    mutate({ neighborhood: name.slice(0, 80) });
  }, [name, saved, mutate]);
}

/** Great-circle distance in miles. */
export function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

export const formatMiles = (miles: number) =>
  miles < 0.1
    ? "Here"
    : miles < 10
      ? `${miles.toFixed(1)} mi away`
      : `${Math.round(miles)} mi away`;
