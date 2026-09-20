import { people, venueById, venues } from "./seed";
import { formatWhen } from "./time";
import type { HealthSnapshot, Session } from "./types";
import { ACTIVITIES, ME_ID } from "./types";

export type SiriAction =
  | { type: "navigate"; to: string; search?: Record<string, string> }
  | { type: "draft"; params: Record<string, string> }
  | { type: "live"; sessionId: string };

export type SiriResult = {
  reply: string;
  action?: SiriAction;
  chips?: string[];
};

export type SiriContext = {
  nowIso: string;
  sessions: Session[];
  health: HealthSnapshot;
  liveSessionId?: string;
  viewingSessionId?: string;
};

const BANNED =
  /\b(tinder|swipe|match|spark|date|dating|gym crush|crush)\b/i;

export function sanitizeCopy(text: string) {
  return text.replace(BANNED, "session");
}

function findVenue(text: string) {
  const t = text.toLowerCase();
  if (/katy/.test(t)) return venues.find((v) => v.id === "katy");
  if (/white\s*rock|lake/.test(t)) return venues.find((v) => v.id === "whiterock");
  if (/trinity|forest/.test(t)) return venues.find((v) => v.id === "trinity");
  if (/turtle|creek|oak lawn/.test(t)) return venues.find((v) => v.id === "turtle");
  return undefined;
}

function findActivity(text: string): Session["activity"] | undefined {
  const t = text.toLowerCase();
  if (/hike/.test(t)) return "hike";
  if (/walk/.test(t)) return "walk";
  if (/ride|cycl/.test(t)) return "ride";
  if (/strength|lift/.test(t)) return "strength";
  if (/run|jog|5k|miles/.test(t)) return "run";
  return undefined;
}

function parsePrice(text: string) {
  const t = text.toLowerCase();
  if (/\bfree\b|\$0|no charge/.test(t)) return 0;
  const m = t.match(/\$\s?(\d{1,2})/) || t.match(/(\d{1,2})\s?(bucks|dollars)/);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (n >= 5 && n <= 40) return n * 100;
  if (n === 0) return 0;
  return undefined;
}

function parseSeats(text: string) {
  const t = text.toLowerCase();
  if (/two seats|2 seats|open two/.test(t)) return 3;
  if (/three seats|3 seats/.test(t)) return 4;
  if (/one seat|1 seat/.test(t)) return 2;
  return undefined;
}

const DOW: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

export function parsePostDraft(text: string): Record<string, string> | null {
  const t = text.toLowerCase();
  if (!/post|open two seats|i'm going|im going|i am going|already going/.test(t)) {
    return null;
  }
  const params: Record<string, string> = {};
  const activity = findActivity(t);
  if (activity) params.activity = activity;
  const venue = findVenue(t);
  if (venue) params.venue = venue.id;
  const price = parsePrice(t);
  if (price !== undefined) params.price = String(price);
  const seats = parseSeats(t);
  if (seats) params.capacity = String(seats);
  for (const [name, dow] of Object.entries(DOW)) {
    if (t.includes(name) || t.includes(name.slice(0, 3))) {
      params.dow = String(dow);
      break;
    }
  }
  const tm = t.match(/(\d{1,2})(?::(\d{2}))?\s?(am|pm)/);
  if (tm) {
    let h = Number(tm[1]);
    const min = Number(tm[2] ?? 0);
    const ap = tm[3];
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    params.hour = String(h);
    params.minute = String(min);
  }
  return params;
}

export function localSiri(text: string, ctx: SiriContext): SiriResult | null {
  const t = text.toLowerCase().trim();
  if (!t) return null;

  if (/check.?in|i'm here|im here|at the pin|live session/.test(t)) {
    if (ctx.liveSessionId) {
      return {
        reply: "Check-in is open. Primary is both of you inside 150 meters of the pin. Code is the fallback if GPS drops.",
        action: { type: "live", sessionId: ctx.liveSessionId },
      };
    }
    return { reply: "Nothing in the check-in window right now. Booked seats show a Live banner when the window opens." };
  }

  if (/recovery|hrv|sleep|rings|health|apple fitness/.test(t)) {
    const h = ctx.health;
    if (!h.connected) {
      return {
        reply: "Health isn’t connected yet. I can use rings, sleep, and HRV to suggest seats that fit today — not to coach you.",
        action: { type: "navigate", to: "/health" },
      };
    }
    return {
      reply: `Sleep ${Math.floor(h.sleepMin / 60)} hours ${h.sleepMin % 60}, HRV ${h.hrvMs} ms, recovery ${h.recoveryPct}%. Move ring ${h.moveKcal} of ${h.moveGoal}. Easy miles fit; skip anything that looks like a workout plan.`,
      action: { type: "navigate", to: "/health" },
      chips: ["What can I join this morning?", "Post my Tuesday 6am Katy Trail run"],
    };
  }

  const draft = parsePostDraft(t);
  if (draft) {
    const venue = draft.venue ? venueById(draft.venue) : undefined;
    const act = (draft.activity as Session["activity"] | undefined) ?? "run";
    return {
      reply: `Drafted a ${ACTIVITIES[act].label.toLowerCase()}${venue ? ` at ${venue.name}` : ""}. You’re going anyway — open the seats and I’ll hold the rest.`,
      action: { type: "draft", params: draft },
    };
  }

  if (/invite/.test(t)) {
    return {
      reply: "Empty cluster still works if you invite someone you already know. I’ll make an unlisted session and a share link.",
      action: { type: "navigate", to: "/post?unlisted=1" },
    };
  }

  if (/women/.test(t)) {
    return {
      reply: "Women-only listings are first-class. Priya’s lake miles are the next one in this cluster.",
      action: { type: "navigate", to: "/sessions", search: { filter: "women" } },
    };
  }

  if (/join|book|seat|morning|saturday|hike|run|walk|available|what can/.test(t)) {
    const activity = findActivity(t);
    const venue = findVenue(t);
    const upcoming = ctx.sessions
      .filter((s) => s.visibility === "public" && new Date(s.startAt).getTime() > Date.now() - 30 * 60 * 1000)
      .filter((s) => (activity ? s.activity === activity : true))
      .filter((s) => (venue ? s.venueId === venue.id : true))
      .sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt));
    const top = upcoming[0];
    if (!top) {
      return {
        reply: "Nothing in those hours yet. Post the one you’re doing anyway, or invite someone from Messages.",
        action: { type: "navigate", to: "/post" },
      };
    }
    const host = people.find((p) => p.id === top.hostId);
    const v = venueById(top.venueId);
    return {
      reply: `${host?.name.split(" ")[0] ?? "Host"} · ${formatWhen(top.startAt)} · ${v?.name ?? "trailhead"}. ${top.title} ${top.priceCents ? `Hold ${top.priceCents / 100} dollars.` : "Free seat."}`,
      action: { type: "navigate", to: `/sessions/${top.id}` },
      chips: ["Check me in", "Post the run I’m doing anyway"],
    };
  }

  return null;
}

export function siriSystemPrompt(ctx: SiriContext) {
  const list = ctx.sessions
    .slice(0, 8)
    .map((s) => {
      const host = people.find((p) => p.id === s.hostId)?.name ?? s.hostId;
      const v = venueById(s.venueId)?.name ?? s.venueId;
      return `- ${s.id} | ${s.title} | ${host} | ${v} | ${s.startAt} | ${s.priceCents} cents | ${s.activity} | womenOnly=${s.womenOnly}`;
    })
    .join("\n");
  const h = ctx.health;
  return `You are Siri on Pace, a paid invitation marketplace for in-person workouts in Dallas (Oak Lawn / Uptown cluster). The user is ${people.find((p) => p.id === ME_ID)?.name}.

Product rules:
- Not dating. Never say tinder, swipe, match, spark, date, gym crush.
- Preferred language: post the run, book a seat, hold the slot, show up, trailhead.
- Hosts are accountability companions, not trainers. Never promise weight loss, a program, or coaching.
- Discovery is upcoming sessions, not faces.
- Check-in: both devices within 150m of the pin, window start-20 to start+25. Fallback 4-digit code.
- Cancel >12h full release; ≤12h capture 50%; participant no-show 100%; host no-show release + $10 credit.

Health (Apple Fitness, user opted in): connected=${h.connected} move=${h.moveKcal}/${h.moveGoal} exercise=${h.exerciseMin}/${h.exerciseGoal} stand=${h.standHours}/${h.standGoal} sleepMin=${h.sleepMin} hrv=${h.hrvMs} recovery=${h.recoveryPct}. Use this as personal context for which seat fits today. Do not prescribe training.

Upcoming sessions:
${list}

Live session: ${ctx.liveSessionId ?? "none"}
On screen: ${ctx.viewingSessionId ?? "none"}

Reply in 1-3 short sentences, iOS Siri tone — calm, specific, no hype.
If you recommend a session, mention its id like [[session:seed-tue-am]].
If they should post, mention [[post]].
If they should open live check-in, mention [[live]].
If they should open Health, mention [[health]].`;
}

export const SIRI_CHIPS = [
  "What can I join this morning?",
  "Post my Tuesday 6am Katy Trail run, two seats, $15",
  "How’s my recovery?",
  "Check me in",
  "Women-only lake miles",
];
