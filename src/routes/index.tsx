import { createFileRoute } from "@tanstack/react-router";
import { CalendarCheck, MapPin, Repeat, ShieldCheck, UserRoundCheck, UsersRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SiteShell } from "@/components/site/site-shell";
import { SITE } from "@/lib/site";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SamePace — a workout buddy who shows up" },
      {
        name: "description",
        content:
          "Find a workout buddy at your level who actually shows up. Join a session near you or post the one you’re already doing — you both check in when you get there.",
      },
    ],
  }),
  component: Landing,
});

const STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: CalendarCheck,
    title: "Post the one you’re doing anyway",
    body: "A time, a public place, an activity and a level — a 9:30 pace for five miles, a steady 16 mph ride, an upper-body hour at the gym.",
  },
  {
    icon: UsersRound,
    title: "Someone at your level joins",
    body: "Sessions are shown by time, place and level. Two to four people, never a crowd. You see the exact meeting spot once you’re in.",
  },
  {
    icon: MapPin,
    title: "You both check in at the pin",
    body: "Within 150 metres, inside a short window — or with a four-digit code when the trail drops GPS. Location is only read on that one screen.",
  },
];

const PROMISES: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: ShieldCheck,
    title: "Not showing up has a cost",
    body: "Cancel twelve hours ahead and it’s free. Inside that, or a no-show, costs a fee and a strike — the same for whoever posted and whoever joined. Two strikes pause public sessions for two weeks.",
  },
  {
    icon: Repeat,
    title: "Same time next week",
    body: "One tap turns a session that worked into a standing slot. Skip a week with notice and your seat goes to a substitute — you keep your place.",
  },
  {
    icon: UserRoundCheck,
    title: "Sessions, not faces",
    body: "There is no people search, no profiles to scroll and no “about me”. A profile is a first name, a level and a track record, and you only see it on a session that person posted or joined. Women-only sessions are built in.",
  },
];

function Landing() {
  return (
    <SiteShell>
      <section className="py-8 md:py-14">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-accent">
          Run · ride · lift · hike · walk
        </p>
        <h1 className="mt-3 text-balance text-[40px] font-semibold leading-[1.05] tracking-tight md:text-[56px]">
          A workout buddy at your level who shows up.
        </h1>
        <p className="mt-5 max-w-xl text-pretty text-lg leading-relaxed text-muted">
          Join a session near you, or post the one you’re already doing. You both check in when you
          get there — so people turn up — and it’s one tap to do it again next week.
        </p>
        <p className="glass mt-8 inline-flex min-h-11 items-center rounded-full px-5 text-sm text-fg">
          In private testing for iPhone and Android · starting in {SITE.cluster}
        </p>
      </section>

      <section aria-labelledby="how" className="py-8">
        <h2 id="how" className="text-2xl font-semibold tracking-tight">
          How it works
        </h2>
        <ol className="mt-5 grid gap-3 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="glass rounded-[28px] p-5">
              <div className="flex items-center gap-3">
                <s.icon className="size-5 text-stand" aria-hidden />
                <span className="text-xs font-medium uppercase tracking-[0.14em] text-faint">
                  Step {i + 1}
                </span>
              </div>
              <h3 className="mt-3 text-lg font-semibold tracking-tight">{s.title}</h3>
              <p className="mt-2 text-pretty text-[15px] leading-relaxed text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="why" className="py-8">
        <h2 id="why" className="text-2xl font-semibold tracking-tight">
          What a group chat can’t do
        </h2>
        <ul className="mt-5 flex flex-col gap-3">
          {PROMISES.map((p) => (
            <li key={p.title} className="glass flex gap-4 rounded-[28px] p-5">
              <p.icon className="mt-1 size-5 shrink-0 text-accent" aria-hidden />
              <div>
                <h3 className="text-lg font-semibold tracking-tight">{p.title}</h3>
                <p className="mt-1 text-pretty text-[15px] leading-relaxed text-muted">{p.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="not" className="py-8">
        <h2 id="not" className="text-2xl font-semibold tracking-tight">
          What it isn’t
        </h2>
        <p className="mt-3 max-w-2xl text-pretty text-base leading-relaxed text-muted">
          Nobody sells a seat and nobody is a trainer: no money moves between members, and asking for
          payment for a {SITE.name} session gets you reported. It doesn’t write training plans, log
          workouts or run thirty-person classes. It does one thing — two to four people, same level,
          same place, actually there.
        </p>
      </section>
    </SiteShell>
  );
}
