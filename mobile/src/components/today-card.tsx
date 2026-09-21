/**
 * Today, read from the Apple Health history a member chose to sync — drawn, not
 * listed: a neutral frame for recorded history, the heart-rate trace since midnight, and a
 * tile for each reading with its own week behind it. Every figure is the member's
 * own; nothing is a score, and nothing here is advice.
 */
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  Activity,
  ChevronRight,
  Droplet,
  Dumbbell,
  Flame,
  Footprints,
  HeartPulse,
  Moon,
  NotebookPen,
  type LucideIcon,
} from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { AreaChart, DayDial, StageBar, WeekBars } from "@/components/charts";
import { PressScale, Skeleton } from "@/components/motion";
import { Button, Card, Notice, Row, T, withAlpha } from "@/components/ui";
import { Fonts, Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { ApiError, captureApiSession, type ApiSession } from "@/lib/api";
import { formatWhen } from "@/lib/format";
import type { Session } from "@/lib/types";

import type { HealthConnection } from "../../../shared/health";
import {
  hoursMinutes,
  pickForToday,
  readToday,
  type Effort,
  type TodayRead,
  type TodaySummary,
  type Week,
} from "../../../shared/today";

const KIND: Record<string, string> = {
  run: "Run",
  walk: "Walk",
  ride: "Ride",
  hike: "Hike",
  strength: "Strength",
  mobility: "Mobility",
  other: "Workout",
};

/** The parent keys this component by member ID, so an account change drops its session. */
export function TodayCard({ ownerId, sessions }: { ownerId: string; sessions: Session[] }) {
  const [session] = useState(captureApiSession);
  return session ? <Compact ownerId={ownerId} session={session} sessions={sessions} /> : null;
}

/** The full picture, for the Today sheet. Keyed by member ID like the card. */
export function TodayDetail({ ownerId }: { ownerId: string }) {
  const [session] = useState(captureApiSession);
  return session ? <Detail ownerId={ownerId} session={session} /> : null;
}

function useToday(ownerId: string, session: ApiSession) {
  return useQuery({
    queryKey: ["private-health", ownerId, "today"],
    gcTime: 0,
    staleTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      const { connection } = await session.request<{ connection: HealthConnection | null }>(
        "/health/connection",
        { signal },
      );
      if (!connection) return { connected: false as const };
      const midnight = new Date();
      midnight.setHours(0, 0, 0, 0);
      const summary = await session.request<TodaySummary>(
        `/health/today?dayStart=${encodeURIComponent(midnight.toISOString())}`,
        { signal },
      );
      const minuteNow = Math.round((Date.now() - midnight.getTime()) / 60_000);
      return { connected: true as const, summary, minuteNow };
    },
  });
}

const LEVEL: Record<Effort, 0 | 1 | 2> = { easy: 0, steady: 1, ready: 2 };
const WORD: Record<Effort, string> = { easy: "Easy", steady: "Steady", ready: "Ready" };

/** The gauge shows OUR read, so it is lit only when we have one. */
function Dial({ read, size }: { read: TodayRead; size?: number }) {
  const theme = useTheme();
  const ours = read.ourRead;
  return (
    <DayDial level={ours ? LEVEL[ours.effort] : null} size={size}>
      <T
        variant="label"
        style={{
          color: !ours ? theme.textFaint : ours.effort === "easy" ? theme.stand : theme.accent,
        }}
      >
        {ours ? WORD[ours.effort] : read.status === "observed" ? "Synced" : "No data"}
      </T>
      <T variant="caption" color="textFaint" style={styles.dialSub}>
        {ours ? "our read" : "today"}
      </T>
    </DayDial>
  );
}

/** Home: the day in one glance. The charts live one tap away, in the Today sheet. */
function Compact({
  ownerId,
  session,
  sessions,
}: {
  ownerId: string;
  session: ApiSession;
  sessions: Session[];
}) {
  const router = useRouter();
  const theme = useTheme();
  const query = useToday(ownerId, session);

  // Health sync is switched off for this account: say nothing.
  if (query.isPending || (query.error instanceof ApiError && query.error.status === 404)) {
    return null;
  }
  if (query.error) {
    return (
      <Card>
        <Header />
        <Notice>Today’s summary could not load.</Notice>
        <Button label="Try again" variant="soft" onPress={() => void query.refetch()} />
      </Card>
    );
  }
  if (!query.data.connected) {
    return (
      <Card>
        <Header />
        <T variant="caption" color="textSecondary">
          Choose what to sync from Apple Health.
        </T>
        <Button
          label="Connect Apple Health"
          variant="accent"
          onPress={() => router.push("/health")}
        />
      </Card>
    );
  }

  const d = query.data.summary.snapshot;
  const read = readToday(d, query.data.summary.trends);
  const pick = pickForToday(
    sessions.map((s) => ({
      id: s.id,
      fitsMe: s.fitsMe,
      startAt: +new Date(s.startAt),
      activity: s.activity,
      anyLevelWelcome: s.abilityFlex === "flexible",
    })),
    read.ourRead?.effort,
  );
  const picked = pick ? sessions.find((s) => s.id === pick.id) : undefined;
  const stats = [
    d.sleepMin !== null && {
      icon: Moon,
      color: theme.stand,
      value: hoursMinutes(d.sleepMin),
      label: "Sleep",
      spoken: `Sleep last night: ${hoursMinutes(d.sleepMin)}`,
    },
    d.restingHr !== null && {
      icon: HeartPulse,
      color: theme.move,
      value: `${d.restingHr} bpm`,
      label: "Resting HR",
      spoken: `Recorded resting heart rate: ${d.restingHr} beats per minute`,
    },
    d.steps !== null && {
      icon: Footprints,
      color: theme.accent,
      value: d.steps.toLocaleString("en-US"),
      label: "Steps",
      spoken: `Steps today: ${d.steps.toLocaleString("en-US")}`,
    },
  ].filter(
    (x): x is { icon: LucideIcon; color: string; value: string; label: string; spoken: string } =>
      Boolean(x),
  );

  return (
    <Card>
      <PressScale
        accessibilityRole="button"
        accessibilityLabel={`Today. ${stats.length > 0 ? stats.map((stat) => stat.spoken).join(". ") : `${read.headline}. ${read.lines.join(" ")}`} Open your day`}
        onPress={() => router.push("/today")}
        scaleTo={0.98}
        style={styles.compact}
      >
        <Row>
          <HeartPulse size={18} color={theme.accent} />
          <T variant="eyebrow" color="textSecondary" style={styles.flex}>
            Today
          </T>
          <T variant="caption" color="accent">
            See your day
          </T>
          <ChevronRight size={16} color={theme.accent} />
        </Row>
        <Row style={styles.hero}>
          <Dial read={read} />
          <View style={styles.flex}>
            <T variant="heading">{read.headline}</T>
            <T variant="caption" color="textSecondary">
              {read.ourRead ? read.ourRead.because : read.lines[0]}
            </T>
            {stats.length > 0 ? (
              <View style={styles.pills}>
                {stats.map(({ icon: Icon, color, value, label }) => (
                  <View
                    key={label}
                    accessible
                    accessibilityLabel={`${label}: ${value}`}
                    style={[styles.pill, { backgroundColor: theme.field }]}
                  >
                    <Icon size={13} color={color} />
                    <T variant="caption" style={styles.statText} numberOfLines={1}>
                      {value}
                    </T>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </Row>
      </PressScale>
      {picked && pick && <Suggested why={pick.why} session={picked} />}
    </Card>
  );
}

function Suggested({ why, session }: { why: string; session: Session }) {
  const router = useRouter();
  const theme = useTheme();
  return (
    <PressScale
      accessibilityRole="button"
      accessibilityLabel={`${why}: ${session.title}, ${formatWhen(session.startAt)}`}
      onPress={() => router.push({ pathname: "/session/[id]", params: { id: session.id } })}
      style={[styles.rowLink, { backgroundColor: theme.accentSoft }]}
    >
      <View style={styles.flex}>
        <T variant="eyebrow" color="accent">
          {why}
        </T>
        <T variant="label">{session.title}</T>
        <T variant="caption" color="textSecondary">
          {formatWhen(session.startAt)} · {session.abilityLabel}
        </T>
      </View>
      <ChevronRight size={18} color={theme.accent} />
    </PressScale>
  );
}

function Detail({ ownerId, session }: { ownerId: string; session: ApiSession }) {
  const router = useRouter();
  const theme = useTheme();
  const query = useToday(ownerId, session);
  if (query.isPending) return <Skeleton rows={4} />;
  if (query.error || !query.data.connected) {
    return (
      <Card>
        <Notice>
          {query.error ? "Today’s summary could not load." : "Apple Health isn’t connected."}
        </Notice>
        <Button
          label={query.error ? "Try again" : "Connect Apple Health"}
          variant="soft"
          onPress={() => (query.error ? void query.refetch() : router.push("/health"))}
        />
      </Card>
    );
  }

  const { summary, minuteNow } = query.data;
  const { snapshot: d, trends: t } = summary;
  const read = readToday(d, t);

  const heart = t.heartToday;
  const glucose = t.glucoseToday;
  // The day so far — and never narrower than the readings, whatever the clocks say.
  const dayEnd = Math.max(
    60,
    minuteNow,
    ...heart.map((h) => h.minute),
    ...glucose.map((g) => g.minute),
  );
  const lastGlucose = glucose[glucose.length - 1];
  const tiles: ReactNode[] = [];
  if (d.sleepMin !== null) {
    tiles.push(
      <Tile
        key="sleep"
        icon={Moon}
        color={theme.stand}
        label="Sleep"
        value={hoursMinutes(d.sleepMin)}
        note={
          d.sleepBaseMin !== null ? `Earlier average ${hoursMinutes(d.sleepBaseMin)}` : "Last night"
        }
        wide={t.sleepStages !== null}
      >
        {t.sleepStages ? (
          <StageBar
            stages={[
              { label: "Deep", minutes: t.sleepStages.deep, color: theme.stand },
              { label: "Core", minutes: t.sleepStages.core, color: withAlpha(theme.stand, 0.55) },
              { label: "REM", minutes: t.sleepStages.rem, color: theme.exercise },
              { label: "Awake", minutes: t.sleepStages.awake, color: withAlpha(theme.move, 0.7) },
            ]}
          />
        ) : (
          <WeekBars values={t.sleepWeek} color={theme.stand} />
        )}
      </Tile>,
    );
  }
  if (d.restingHr !== null) {
    tiles.push(
      <Tile
        key="rhr"
        icon={HeartPulse}
        color={theme.move}
        label="Resting heart rate"
        value={String(d.restingHr)}
        unit="bpm"
        note={
          d.restingHrBase !== null
            ? `Earlier average ${Math.round(d.restingHrBase)} bpm`
            : "This week"
        }
      >
        <AreaChart
          id="rhr"
          color={theme.move}
          height={40}
          points={week(t.restingHrWeek)}
          xDomain={[0, 6]}
        />
      </Tile>,
    );
  }
  if (d.hrvMs !== null) {
    tiles.push(
      <Tile
        key="hrv"
        icon={Activity}
        color={theme.exercise}
        label="HRV · SDNN"
        value={String(d.hrvMs)}
        unit="ms"
        note={d.hrvBase !== null ? `Earlier average ${Math.round(d.hrvBase)} ms` : "This week"}
      >
        <AreaChart
          id="hrv"
          color={theme.exercise}
          height={40}
          points={week(t.hrvWeek)}
          xDomain={[0, 6]}
        />
      </Tile>,
    );
  }
  // A new app can temporarily receive the older server shape. Undefined must
  // remain unavailable, never become the string "undefined" or a zero point.
  const rmssdWeek = t.hrvRmssdWeek ?? [];
  const rmssdCurrent = d.hrvRmssdMs ?? null;
  if (rmssdCurrent !== null || rmssdWeek.some((value) => value !== null)) {
    tiles.push(
      <Tile
        key="hrv-rmssd"
        icon={Activity}
        color={theme.stand}
        label="HRV · RMSSD"
        value={rmssdCurrent === null ? "—" : String(rmssdCurrent)}
        unit={rmssdCurrent === null ? undefined : "ms"}
        note={
          rmssdCurrent === null
            ? "No reading today or yesterday"
            : d.hrvRmssdBase != null
              ? `Earlier average ${Math.round(d.hrvRmssdBase)} ms`
              : "Recorded sample average"
        }
      >
        <AreaChart
          id="hrv-rmssd"
          color={theme.stand}
          height={40}
          points={week(rmssdWeek)}
          xDomain={[0, 6]}
        />
        {d.hrvRmssdSource?.name && (
          <T variant="caption" color="textSecondary">
            {d.hrvRmssdSource.name}
          </T>
        )}
      </Tile>,
    );
  }
  if (d.steps !== null) {
    tiles.push(
      <Tile
        key="steps"
        icon={Footprints}
        color={theme.accent}
        label="Steps"
        value={d.steps.toLocaleString("en-US")}
        note="Last 7 days"
      >
        <WeekBars values={t.stepsWeek} color={theme.accent} />
      </Tile>,
    );
  }
  const move = t.moveKcalWeek[t.moveKcalWeek.length - 1];
  if (move !== null) {
    tiles.push(
      <Tile
        key="move"
        icon={Flame}
        color={theme.move}
        label="Active energy"
        value={move.toLocaleString("en-US")}
        unit="kcal"
        note="Last 7 days"
      >
        <WeekBars values={t.moveKcalWeek} color={theme.move} />
      </Tile>,
    );
  }
  if (lastGlucose) {
    tiles.push(
      <Tile
        key="glucose"
        icon={Droplet}
        color={theme.stand}
        label="Glucose"
        value={String(lastGlucose.value)}
        unit="mg/dL"
        note={`Today ${Math.min(...glucose.map((g) => g.low))}–${Math.max(...glucose.map((g) => g.high))}`}
      >
        <AreaChart
          id="glucose"
          color={theme.stand}
          height={40}
          points={glucose.map((g) => ({ x: g.minute, y: g.value }))}
          xDomain={[0, dayEnd]}
        />
      </Tile>,
    );
  }

  return (
    <View style={styles.detail}>
      <Card>
        <Header
          right={
            summary.syncedAt
              ? `Synced ${new Date(summary.syncedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
              : undefined
          }
        />
        <Row style={styles.hero}>
          <Dial read={read} />
          <View style={styles.flex}>
            {read.ourRead ? (
              <T variant="eyebrow" color="accent">
                SamePace’s read
              </T>
            ) : null}
            <T variant="heading">{read.headline}</T>
            {read.ourRead ? (
              <T variant="caption" color="textSecondary">
                {read.ourRead.because}
              </T>
            ) : null}
          </View>
        </Row>
        <View style={[styles.recorded, { borderTopColor: theme.border }]}>
          <T variant="eyebrow" color="textFaint">
            Recorded
          </T>
          {read.lines.map((line) => (
            <T key={line} variant="caption" color="textSecondary">
              {line}
            </T>
          ))}
        </View>
        {read.ourRead ? (
          <T variant="caption" color="textFaint" style={styles.axis}>
            Our read is a rough guide from your sleep, heart readings and training — to help pick a
            session, not medical advice.
          </T>
        ) : null}
      </Card>

      {heart.length > 1 && (
        <Card style={styles.panel}>
          <Row style={styles.between}>
            <T variant="caption" color="textSecondary">
              Heart rate today
            </T>
            <T variant="label">
              {Math.min(...heart.map((h) => h.low))}–{Math.max(...heart.map((h) => h.high))}
              <T variant="caption" color="textSecondary">
                {" "}
                bpm
              </T>
            </T>
          </Row>
          <AreaChart
            id="heart"
            color={theme.move}
            height={72}
            points={heart.map((h) => ({ x: h.minute, y: h.value }))}
            band={heart.map((h) => ({ x: h.minute, low: h.low, high: h.high }))}
            xDomain={[0, dayEnd]}
          />
          <Row style={styles.between}>
            <T variant="caption" color="textFaint" style={styles.axis}>
              12 AM
            </T>
            <T variant="caption" color="textFaint" style={styles.axis}>
              Now
            </T>
          </Row>
        </Card>
      )}

      {tiles.length > 0 && <View style={styles.grid}>{tiles}</View>}

      {d.workouts.map((w) => (
        <PressScale
          key={w.id}
          accessibilityRole="button"
          accessibilityLabel={`${KIND[w.kind]}, ${hoursMinutes(w.minutes)}. View this workout`}
          onPress={() => router.push({ pathname: "/workout/[id]", params: { id: w.id } })}
          style={[styles.rowLink, { backgroundColor: theme.backgroundElement }]}
        >
          <View style={[styles.badge, { backgroundColor: withAlpha(theme.exercise, 0.14) }]}>
            <Dumbbell size={16} color={theme.exercise} />
          </View>
          <View style={styles.flex}>
            <T variant="label">{KIND[w.kind]}</T>
            <T variant="caption" color="textSecondary">
              {hoursMinutes(w.minutes)}
              {w.meters ? ` · ${(w.meters / 1609.344).toFixed(1)} mi` : ""}
            </T>
          </View>
          <ChevronRight size={18} color={theme.textFaint} />
        </PressScale>
      ))}

      {tiles.length === 0 && heart.length < 2 && d.workouts.length === 0 && (
        <T variant="caption" color="textSecondary">
          Sync the readings you choose to see your recorded history.
        </T>
      )}
      <T variant="caption" color="textFaint">
        Your own readings, compared only with your own week. Private to you — never shown to other
        members, and not medical advice.
      </T>
      <Button label="Manage Apple Health" variant="ghost" onPress={() => router.push("/health")} />
    </View>
  );
}

const week = (values: Week) => values.map((y, x) => ({ x, y }));

function Header({ right }: { right?: string }) {
  const theme = useTheme();
  return (
    <Row>
      <HeartPulse size={18} color={theme.accent} />
      <T variant="eyebrow" color="textSecondary" style={styles.flex}>
        Today
      </T>
      {right ? (
        <T variant="caption" color="textFaint">
          {right}
        </T>
      ) : null}
    </Row>
  );
}

function Tile({
  icon: Icon,
  color,
  label,
  value,
  unit,
  note,
  wide,
  children,
}: {
  icon: LucideIcon;
  color: string;
  label: string;
  value: string;
  unit?: string;
  note: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}${unit ? ` ${unit}` : ""}. ${note}.`}
      style={[styles.tile, wide && styles.tileWide]}
    >
      <Card style={styles.tileCard}>
        <Row style={styles.tileHead}>
          <Icon size={14} color={color} />
          <T variant="caption" color="textSecondary" numberOfLines={1} style={styles.flex}>
            {label}
          </T>
        </Row>
        <T variant="heading" style={styles.value}>
          {value}
          {unit ? (
            <T variant="caption" color="textSecondary">
              {" "}
              {unit}
            </T>
          ) : null}
        </T>
        {children}
        <T variant="caption" color="textFaint" style={styles.axis}>
          {note}
        </T>
      </Card>
    </View>
  );
}

/**
 * The training tools, one tap from Home instead of three screens deep in You. (The
 * assistant has its own row above these — see `AssistantSpot`.)
 */
export function TrainingShortcuts() {
  const router = useRouter();
  const theme = useTheme();
  const items: {
    icon: LucideIcon;
    label: string;
    hint: string;
    href: "/fitness" | "/health";
  }[] = [
    { icon: NotebookPen, label: "Fitness log", hint: "What you did", href: "/fitness" },
    { icon: HeartPulse, label: "Workouts", hint: "Apple Health", href: "/health" },
  ];
  return (
    <View style={styles.shortcuts}>
      {items.map(({ icon: Icon, label, hint, href }) => (
        <PressScale
          key={href}
          accessibilityRole="button"
          accessibilityLabel={`${label}. ${hint}`}
          onPress={() => router.push(href)}
          style={styles.flex}
        >
          <Card style={styles.shortcut}>
            <View style={[styles.badge, { backgroundColor: theme.accentSoft }]}>
              <Icon size={18} color={theme.accent} />
            </View>
            <T variant="label" numberOfLines={1}>
              {label}
            </T>
            <T variant="caption" color="textSecondary" numberOfLines={1} style={styles.axis}>
              {hint}
            </T>
          </Card>
        </PressScale>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  between: { justifyContent: "space-between", alignItems: "baseline" },
  hero: { alignItems: "center", gap: Spacing.three },
  compact: { gap: Spacing.two },
  detail: { gap: Spacing.two },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  stat: {
    flexGrow: 1,
    flexBasis: 96,
    gap: Spacing.half,
  },
  statLabel: { alignItems: "center", gap: Spacing.half },
  statText: { fontFamily: Fonts.medium, fontVariant: ["tabular-nums"] },
  recorded: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.two, gap: 2 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: Spacing.one },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: Spacing.half,
  },
  dialSub: { fontSize: 11, lineHeight: 14 },
  panel: { padding: Spacing.three, gap: Spacing.half },
  axis: { fontSize: 12, lineHeight: 16 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.one },
  tile: { flexGrow: 1, flexBasis: "46%" },
  tileCard: { flex: 1, padding: Spacing.three, gap: Spacing.half },
  tileWide: { flexBasis: "100%" },
  tileHead: { gap: 6 },
  value: { fontVariant: ["tabular-nums"] },
  rowLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    borderRadius: Radius.lg,
    padding: Spacing.two,
    minHeight: 56,
  },
  badge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  shortcuts: { flexDirection: "row", gap: Spacing.one },
  shortcut: { gap: Spacing.half, padding: Spacing.two },
});
