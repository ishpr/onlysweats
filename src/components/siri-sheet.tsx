import { useNavigate } from "@tanstack/react-router";
import { ArrowUp } from "lucide-react";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { IntelligenceBloom } from "@/components/icons";
import { askSiri } from "@/lib/ask-siri";
import { localSiri, sanitizeCopy, SIRI_CHIPS, type SiriContext, type SiriResult } from "@/lib/siri";
import { usePaceStore } from "@/lib/store";
import { isInCheckinWindow } from "@/lib/time";
import { ME_ID } from "@/lib/types";
import { cn } from "@/lib/utils";

type Turn = { role: "me" | "siri"; text: string };

export function SiriSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const ask = useServerFn(askSiri);
  const sessions = usePaceStore((s) => s.sessions);
  const bookings = usePaceStore((s) => s.bookings);
  const health = usePaceStore((s) => s.health);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([
    {
      role: "siri",
      text: "This is a demo using sample listings and simulated health readings. Try finding or posting a sample session. It cannot read your Apple Health data.",
    },
  ]);

  const ctx: SiriContext = useMemo(() => {
    const live = sessions.find((s) => {
      const mine = bookings.find(
        (b) => b.sessionId === s.id && b.participantId === ME_ID && b.status === "confirmed",
      );
      return Boolean(mine) && isInCheckinWindow(s.startAt);
    });
    return {
      nowIso: new Date().toISOString(),
      sessions,
      health,
      liveSessionId: live?.id,
    };
  }, [sessions, bookings, health]);

  async function run(prompt: string) {
    const text = prompt.trim();
    if (!text || busy) return;
    setInput("");
    setTurns((t) => [...t, { role: "me", text }]);
    setBusy(true);
    const local = localSiri(text, ctx);
    let result: SiriResult = local ?? {
      reply: "I’ll look across the sample listings and simulated readings.",
    };
    if (!local) {
      try {
        const remote = await ask({ data: { prompt: text, ctx } });
        if (remote.ok) {
          result = interpretRemote(sanitizeCopy(remote.text), ctx);
        } else if (!local) {
          result = {
            reply:
              "I can still help on-device. Try “what can I join this morning” or “post my Tuesday 6am Katy Trail run”.",
            chips: SIRI_CHIPS.slice(0, 3),
          };
        }
      } catch {
        result = local ?? {
          reply:
            "On-device only right now. Ask what you can join this morning, or to post a session.",
          chips: SIRI_CHIPS.slice(0, 3),
        };
      }
    }
    setTurns((t) => [...t, { role: "siri", text: result.reply }]);
    setBusy(false);
    if (result.action) {
      window.setTimeout(() => {
        applyAction(result.action!, navigate, onClose);
      }, 1400);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      <button
        type="button"
        className="absolute inset-0 bg-bg/70 backdrop-blur-xl"
        aria-label="Close Siri"
        onClick={onClose}
      />
      <div className="relative mx-auto mt-auto flex w-full max-w-lg flex-col px-4 pb-[max(16px,env(safe-area-inset-bottom))]">
        <div className="glass-strong mb-4 max-h-[52dvh] overflow-y-auto rounded-[28px] p-5">
          <div className="mb-4 flex items-center gap-2 text-sm text-muted">
            <IntelligenceBloom className="size-5" />
            Siri · SamePace
          </div>
          <div className="flex flex-col gap-3">
            {turns.map((turn, i) => (
              <p
                key={`${turn.role}-${i}`}
                className={cn(
                  "max-w-[92%] text-pretty text-[15px] leading-relaxed",
                  turn.role === "me" ? "ml-auto rounded-2xl bg-fg/10 px-3 py-2 text-fg" : "text-fg",
                )}
              >
                {turn.text}
              </p>
            ))}
            {busy && <p className="text-sm text-muted">Checking sample readings and listings…</p>}
          </div>
        </div>
        <div className="mb-3 flex flex-wrap gap-2">
          {SIRI_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              className="glass rounded-full px-3 py-2 text-left text-[12px] text-fg"
              onClick={() => void run(chip)}
            >
              {chip}
            </button>
          ))}
        </div>
        <form
          className="glass flex items-center gap-2 rounded-full p-1.5 pl-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(input);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Siri"
            className="h-11 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
          />
          <button
            type="submit"
            className="flex size-11 items-center justify-center rounded-full bg-fg text-bg"
            aria-label="Send"
          >
            <ArrowUp className="size-5" />
          </button>
        </form>
      </div>
    </div>
  );
}

function interpretRemote(text: string, ctx: SiriContext): SiriResult {
  const session = text.match(/\[\[session:([^\]]+)\]\]/);
  const cleaned = text
    .replace(/\[\[session:[^\]]+\]\]/g, "")
    .replace("[[post]]", "")
    .replace("[[live]]", "")
    .replace("[[health]]", "")
    .trim();
  if (session) {
    return {
      reply: cleaned,
      action: { type: "navigate", to: `/sessions/${session[1]}` },
    };
  }
  if (text.includes("[[post]]")) {
    return { reply: cleaned, action: { type: "navigate", to: "/post" } };
  }
  if (text.includes("[[live]]") && ctx.liveSessionId) {
    return {
      reply: cleaned,
      action: { type: "live", sessionId: ctx.liveSessionId },
    };
  }
  if (text.includes("[[health]]")) {
    return { reply: cleaned, action: { type: "navigate", to: "/health" } };
  }
  return { reply: cleaned || text };
}

function applyAction(
  action: NonNullable<SiriResult["action"]>,
  navigate: ReturnType<typeof useNavigate>,
  onClose: () => void,
) {
  if (action.type === "navigate") {
    void navigate({
      to: action.to,
      search: action.search,
    } as never);
    onClose();
  } else if (action.type === "live") {
    void navigate({ to: "/live/$id", params: { id: action.sessionId } });
    onClose();
  } else if (action.type === "draft") {
    void navigate({ to: "/post", search: action.params });
    onClose();
  }
}
