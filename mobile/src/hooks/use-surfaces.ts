import { useEffect } from "react";

import { useNow } from "@/hooks/use-now";
import { setBadge } from "@/lib/push";
import { useMe, useMine, useNotifications, useVenues } from "@/lib/queries";
import { byId } from "@/lib/lookup";
import { syncLiveActivity, syncNextSessionWidget } from "@/lib/widgets";

/**
 * Mirrors what the app knows onto the Home Screen widget and the Live Activity.
 * Mounted once, under the tabs: it re-runs when bookings change, and each minute
 * so a check-in window that opens while the app is up starts its activity.
 */
export function useSurfaces() {
  const me = useMe().data;
  const mine = useMine().data;
  const venues = useVenues().data;
  const now = useNow(60_000);
  const unread = useNotifications().data?.unread;

  useEffect(() => {
    if (unread !== undefined) setBadge(unread);
  }, [unread]);

  useEffect(() => {
    if (!me || !mine || !venues) return;
    const snap = {
      meId: me.id,
      bookings: mine.bookings,
      sessions: mine.sessions,
      people: mine.people,
      venues: byId(venues),
    };
    syncNextSessionWidget(snap, now);
    syncLiveActivity(snap, now);
  }, [me, mine, venues, now]);
}
