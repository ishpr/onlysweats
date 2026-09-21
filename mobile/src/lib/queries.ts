import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef } from "react";

import { api } from "./api";
import type {
  AppNotification,
  BlockSlotInput,
  Booking,
  ChatMessage,
  Gender,
  GoalKind,
  MemberAbilities,
  Me,
  NotifyPrefs,
  Person,
  PostBlockInput,
  PostSessionInput,
  RatingInput,
  ReportInput,
  Series,
  Session,
  TrainingBlock,
  Venue,
} from "./types";

type SessionList = { sessions: Session[]; people: Person[] };
type Mine = {
  bookings: Booking[];
  sessions: Session[];
  series: Series[];
  trainingBlocks: TrainingBlock[];
  people: Person[];
};

export const keys = {
  me: ["me"] as const,
  venues: ["venues"] as const,
  sessions: (womenOnly: boolean) => ["sessions", { womenOnly }] as const,
  session: (id: string) => ["session", id] as const,
  invite: (code: string) => ["invite", code] as const,
  mine: ["mine"] as const,
  messages: (bookingId: string) => ["messages", bookingId] as const,
  blocks: ["blocks"] as const,
  notifications: ["notifications"] as const,
  trainingBlock: (id: string) => ["training-block", id] as const,
  publicTrainingBlocks: ["training-blocks"] as const,
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

/** An invite link opens an unlisted session — or an unlisted training block. */
type Invite = { session: Session; people: Person[] } | { trainingBlockId: string };
export const useInvite = (code: string) =>
  useQuery({
    queryKey: keys.invite(code),
    queryFn: () => api<Invite>(`/invites/${code}`),
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
      qc.invalidateQueries({ queryKey: ["training-block"] }),
      qc.invalidateQueries({ queryKey: keys.publicTrainingBlocks }),
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
      notify?: Partial<NotifyPrefs>;
    }) => api<Me>("/me", { method: "PATCH", json: patch }),
    onSuccess: (me) => {
      qc.setQueryData(keys.me, me);
      // A new level changes which sessions fit.
      void qc.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}

// ── Activity ─────────────────────────────────────────────────────────────────

/** Everything SamePace told me — the same list whether or not push is on. */
export const useNotifications = () =>
  useQuery({
    queryKey: keys.notifications,
    queryFn: () => api<{ notifications: AppNotification[]; unread: number }>("/notifications"),
    refetchInterval: 60_000,
  });

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("/notifications/read", { method: "POST", json: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.notifications }),
  });
}

// ── Safety + account ─────────────────────────────────────────────────────────

export const useBlocks = () =>
  useQuery({
    queryKey: keys.blocks,
    queryFn: async () => (await api<{ people: Person[] }>("/blocks")).people,
  });

/** Blocking releases any seat the two of you share, so everything refreshes. */
export function useBlock() {
  const qc = useQueryClient();
  const refresh = useRefreshAll();
  return useMutation({
    meta: { haptic: "warning" },
    mutationFn: (memberId: string) => api("/blocks", { method: "POST", json: { memberId } }),
    onSuccess: () => Promise.all([refresh(), qc.invalidateQueries({ queryKey: keys.blocks })]),
  });
}

export function useUnblock() {
  const qc = useQueryClient();
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (memberId: string) =>
      api(`/blocks/${encodeURIComponent(memberId)}`, { method: "DELETE" }),
    onSuccess: () => Promise.all([refresh(), qc.invalidateQueries({ queryKey: keys.blocks })]),
  });
}

export function useReport() {
  const qc = useQueryClient();
  const refresh = useRefreshAll();
  return useMutation({
    meta: { haptic: "success" },
    mutationFn: (input: ReportInput) =>
      api<{ id: string; blocked: boolean }>("/reports", { method: "POST", json: input }),
    onSuccess: (res) =>
      res.blocked
        ? Promise.all([refresh(), qc.invalidateQueries({ queryKey: keys.blocks })])
        : undefined,
  });
}

export const useDeleteAccount = () =>
  useMutation({ meta: { haptic: "warning" }, mutationFn: () => api("/me", { method: "DELETE" }) });

/** "Same time next week": a completed session becomes a standing slot. */
export function useRepeatWeekly() {
  const refresh = useRefreshAll();
  return useMutation({
    meta: { haptic: "success" },
    mutationFn: async (bookingId: string) =>
      (await api<{ series: Series }>(`/bookings/${bookingId}/repeat`, { method: "POST" })).series,
    onSuccess: refresh,
  });
}

/** `invite` unlocks an unlisted block for someone who arrived by link. */
export const useTrainingBlock = (id: string, invite?: string, enabled = true) =>
  useQuery({
    enabled,
    queryKey: keys.trainingBlock(id),
    queryFn: () =>
      api<{ block: TrainingBlock; people: Person[] }>(
        `/training-blocks/${id}${invite ? `?invite=${encodeURIComponent(invite)}` : ""}`,
      ),
  });

/** Blocks with a regular seat open. No faces, no member ids. */
export const usePublicTrainingBlocks = () =>
  useQuery({
    queryKey: keys.publicTrainingBlocks,
    queryFn: async () => (await api<{ blocks: TrainingBlock[] }>("/training-blocks")).blocks,
  });

export function usePostTrainingBlock() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: async (input: PostBlockInput) =>
      (await api<{ block: TrainingBlock }>("/training-blocks", { method: "POST", json: input }))
        .block,
    onSuccess: refresh,
  });
}

export function useAddBlockSlot() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: async (v: { blockId: string; slot: BlockSlotInput }) =>
      (
        await api<{ block: TrainingBlock }>(`/training-blocks/${v.blockId}/slots`, {
          method: "POST",
          json: v.slot,
        })
      ).block,
    onSuccess: refresh,
  });
}

/** Joining a block takes a seat on every slot in it — or files a request. */
export function useJoinTrainingBlock() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: async (v: { blockId: string; inviteCode?: string }) =>
      (
        await api<{ block: TrainingBlock }>(`/training-blocks/${v.blockId}/join`, {
          method: "POST",
          json: { inviteCode: v.inviteCode },
        })
      ).block,
    onSuccess: refresh,
  });
}

export function useResolveBlockRequest() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (v: { blockId: string; memberId: string; action: "approve" | "decline" }) =>
      api(`/training-blocks/${v.blockId}/requests/${encodeURIComponent(v.memberId)}/${v.action}`, {
        method: "POST",
      }),
    onSuccess: refresh,
  });
}

/** "Helped me stick to it?" — a finisher's one answer. An empty list is an answer. */
export function useGiveCredits() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (v: { blockId: string; toIds: string[] }) =>
      api(`/training-blocks/${v.blockId}/credits`, { method: "POST", json: { toIds: v.toIds } }),
    onSuccess: refresh,
  });
}

/** The block is done; its weekly slots carry on as plain standing slots. */
export function useKeepBlockSlots() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (blockId: string) =>
      api(`/training-blocks/${blockId}/next`, { method: "POST", json: { action: "keep_slots" } }),
    onSuccess: refresh,
  });
}

/** Same people, same weekly slots, a new goal and date. */
export function useNextTrainingBlock() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: async (v: {
      blockId: string;
      goalKind: GoalKind;
      eventName?: string;
      goalDate: string;
    }) =>
      (
        await api<{ block: TrainingBlock }>(`/training-blocks/${v.blockId}/next`, {
          method: "POST",
          json: {
            action: "next_block",
            goalKind: v.goalKind,
            eventName: v.eventName,
            goalDate: v.goalDate,
          },
        })
      ).block,
    onSuccess: refresh,
  });
}

/** "Start one like it": a full block, again, for the next group. */
export function useCloneTrainingBlock() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: async (v: { blockId: string; inviteCode?: string }) =>
      (
        await api<{ block: TrainingBlock }>(`/training-blocks/${v.blockId}/clone`, {
          method: "POST",
          json: { inviteCode: v.inviteCode },
        })
      ).block,
    onSuccess: refresh,
  });
}

/** "Make this a training block": a standing slot gets a goal and a date. */
export function useMakeTrainingBlock() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: async (v: {
      seriesId: string;
      goalKind: GoalKind;
      eventName?: string;
      goalDate: string;
    }) =>
      (
        await api<{ block: TrainingBlock }>(`/series/${v.seriesId}/training-block`, {
          method: "POST",
          json: { goalKind: v.goalKind, eventName: v.eventName, goalDate: v.goalDate },
        })
      ).block,
    onSuccess: refresh,
  });
}

export function useLeaveTrainingBlock() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (blockId: string) => api(`/training-blocks/${blockId}/leave`, { method: "POST" }),
    onSuccess: refresh,
  });
}

export function useLeaveSeries() {
  const refresh = useRefreshAll();
  return useMutation({
    meta: { haptic: "warning" },
    mutationFn: (seriesId: string) => api(`/series/${seriesId}/leave`, { method: "POST" }),
    onSuccess: refresh,
  });
}

export function usePostSession() {
  const refresh = useRefreshAll();
  return useMutation({
    meta: { haptic: "success" },
    mutationFn: async (input: PostSessionInput) =>
      (await api<{ session: Session }>("/sessions", { method: "POST", json: input })).session,
    onSuccess: refresh,
  });
}

export function useBookSeat() {
  const refresh = useRefreshAll();
  return useMutation({
    meta: { haptic: "success" },
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
    meta: { haptic: "warning" },
    mutationFn: (sessionId: string) => api(`/sessions/${sessionId}/cancel`, { method: "POST" }),
    onSuccess: refresh,
  });
}

export function useGeoCheckIn() {
  const refresh = useRefreshAll();
  return useMutation({
    meta: { haptic: "success" },
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
    meta: { haptic: "success" },
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
    meta: { haptic: "success" },
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

declare module "@tanstack/react-query" {
  interface Register {
    /** `haptic` names how a successful mutation should feel; refusals always buzz. */
    mutationMeta: { haptic?: "success" | "warning" };
  }
}
