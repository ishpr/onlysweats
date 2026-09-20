import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef } from "react";

import { api } from "./api";
import type {
  Booking,
  ChatMessage,
  Gender,
  MemberAbilities,
  Me,
  Person,
  PostSessionInput,
  RatingInput,
  Series,
  Session,
  Venue,
} from "./types";

type SessionList = { sessions: Session[]; people: Person[] };
type Mine = { bookings: Booking[]; sessions: Session[]; series: Series[]; people: Person[] };

export const keys = {
  me: ["me"] as const,
  venues: ["venues"] as const,
  sessions: (womenOnly: boolean) => ["sessions", { womenOnly }] as const,
  session: (id: string) => ["session", id] as const,
  invite: (code: string) => ["invite", code] as const,
  mine: ["mine"] as const,
  messages: (bookingId: string) => ["messages", bookingId] as const,
};

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: () => api<Me>("/me") });

export const useVenues = () =>
  useQuery({
    queryKey: keys.venues,
    queryFn: async () => (await api<{ venues: Venue[] }>("/venues")).venues,
    staleTime: Infinity,
  });

export const useSessions = (womenOnly = false) =>
  useQuery({
    queryKey: keys.sessions(womenOnly),
    queryFn: () => api<SessionList>(`/sessions${womenOnly ? "?womenOnly=1" : ""}`),
  });

/** `invite` unlocks an unlisted listing for someone who arrived by link. */
export const useSession = (id: string, invite?: string) =>
  useQuery({
    queryKey: keys.session(id),
    queryFn: () =>
      api<{ session: Session; people: Person[] }>(
        `/sessions/${id}${invite ? `?invite=${encodeURIComponent(invite)}` : ""}`,
      ),
  });

export const useInvite = (code: string) =>
  useQuery({
    queryKey: keys.invite(code),
    queryFn: () => api<{ session: Session; people: Person[] }>(`/invites/${code}`),
    retry: false,
  });

/** Everything I host or booked. Polls while a screen that needs it is open. */
export const useMine = (opts: { live?: boolean } = {}) =>
  useQuery({
    queryKey: keys.mine,
    queryFn: () => api<Mine>("/bookings"),
    refetchInterval: opts.live ? 4000 : false,
  });

export const useMessages = (bookingId: string) =>
  useQuery({
    queryKey: keys.messages(bookingId),
    queryFn: async () =>
      (await api<{ messages: ChatMessage[] }>(`/bookings/${bookingId}/messages`)).messages,
    refetchInterval: 5000,
  });

/**
 * Seats and listings change under us (other people book, hosts approve), and
 * React Query has no notion of a native screen coming back into view — so every
 * time a screen regains focus, mark its data stale and let it refetch.
 */
export function useRefreshOnFocus() {
  const qc = useQueryClient();
  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      // The mount fetch already covers the first focus.
      if (first.current) {
        first.current = false;
        return;
      }
      void qc.invalidateQueries({ refetchType: "active" });
    }, [qc]),
  );
}

/** Any booking change can move seats, pins and threads — refresh the lot. */
function useRefreshAll() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: keys.mine }),
      qc.invalidateQueries({ queryKey: ["sessions"] }),
      qc.invalidateQueries({ queryKey: ["session"] }),
      qc.invalidateQueries({ queryKey: keys.me }),
    ]);
}

export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: {
      name?: string;
      neighborhood?: string;
      gender?: Gender;
      abilities?: MemberAbilities;
    }) => api<Me>("/me", { method: "PATCH", json: patch }),
    onSuccess: (me) => {
      qc.setQueryData(keys.me, me);
      // A new level changes which sessions fit.
      void qc.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}

/** "Same time next week": a completed session becomes a standing slot. */
export function useRepeatWeekly() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: async (bookingId: string) =>
      (await api<{ series: Series }>(`/bookings/${bookingId}/repeat`, { method: "POST" })).series,
    onSuccess: refresh,
  });
}

export function useLeaveSeries() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (seriesId: string) => api(`/series/${seriesId}/leave`, { method: "POST" }),
    onSuccess: refresh,
  });
}

export function usePostSession() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: async (input: PostSessionInput) =>
      (await api<{ session: Session }>("/sessions", { method: "POST", json: input })).session,
    onSuccess: refresh,
  });
}

export function useBookSeat() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: async (v: { sessionId: string; inviteCode?: string }) =>
      (
        await api<{ booking: Booking }>(`/sessions/${v.sessionId}/bookings`, {
          method: "POST",
          json: { inviteCode: v.inviteCode },
        })
      ).booking,
    onSuccess: refresh,
  });
}

type BookingAction = "approve" | "decline" | "cancel";

export function useBookingAction() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: async (v: { bookingId: string; action: BookingAction }) =>
      (await api<{ booking: Booking }>(`/bookings/${v.bookingId}/${v.action}`, { method: "POST" }))
        .booking,
    onSuccess: refresh,
  });
}

export function useCancelSession() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (sessionId: string) => api(`/sessions/${sessionId}/cancel`, { method: "POST" }),
    onSuccess: refresh,
  });
}

export function useGeoCheckIn() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: async (v: { bookingId: string; lat: number; lng: number; accuracyM?: number }) =>
      (
        await api<{ booking: Booking }>(`/bookings/${v.bookingId}/checkin`, {
          method: "POST",
          json: { lat: v.lat, lng: v.lng, accuracyM: v.accuracyM },
        })
      ).booking,
    onSuccess: refresh,
  });
}

export function useCodeCheckIn() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: async (v: { bookingId: string; code: string }) =>
      (
        await api<{ booking: Booking }>(`/bookings/${v.bookingId}/checkin-code`, {
          method: "POST",
          json: { code: v.code },
        })
      ).booking,
    onSuccess: refresh,
  });
}

export function useRevealCode() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (sessionId: string) =>
      api<{ code: string; revealedAt: string }>(`/sessions/${sessionId}/code`, { method: "POST" }),
    onSuccess: refresh,
  });
}

export function useSendMessage(bookingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (text: string) =>
      (
        await api<{ messages: ChatMessage[] }>(`/bookings/${bookingId}/messages`, {
          method: "POST",
          json: { text },
        })
      ).messages,
    onSuccess: (messages) => qc.setQueryData(keys.messages(bookingId), messages),
  });
}

export function useSubmitRating() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: async (v: { bookingId: string; rating: RatingInput }) =>
      (
        await api<{ booking: Booking }>(`/bookings/${v.bookingId}/rating`, {
          method: "POST",
          json: v.rating,
        })
      ).booking,
    onSuccess: refresh,
  });
}
