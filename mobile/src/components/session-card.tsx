import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Link } from "expo-router";
import { Clock, MapPin, Users } from "lucide-react-native";
import type { ReactNode } from "react";
import { type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";

import { PressScale } from "@/components/motion";
import { T, withAlpha } from "@/components/ui";
import { Fonts, Radius, Spacing } from "@/constants/theme";
import { OnPhoto, useTheme } from "@/hooks/use-theme";
import { API_URL } from "@/lib/config";
import { formatDuration, formatWhen, inCheckinWindow } from "@/lib/format";
import { ACTIVITIES, type Session, type Venue } from "@/lib/types";

/** Venue photos are served by the API host (`public/venues/*`). */
export const venueImage = (venue?: Venue) =>
  venue ? { uri: `${API_URL}${venue.image}` } : undefined;

/**
 * A venue photo under a dark scrim, with whatever is laid on top reading the dark
 * tokens — in both themes. Used by the hero on a session and the place tiles on Post.
 */
export function PhotoPanel({
  venue,
  style,
  stops = [0.15, 0.6, 1],
  children,
}: {
  venue?: Venue;
  style?: StyleProp<ViewStyle>;
  /** Scrim opacity at the top, middle and bottom. */
  stops?: [number, number, number];
  children: ReactNode;
}) {
  return (
    <OnPhoto>
      <PhotoPanelBody venue={venue} style={style} stops={stops}>
        {children}
      </PhotoPanelBody>
    </OnPhoto>
  );
}

function PhotoPanelBody({
  venue,
  style,
  stops,
  children,
}: {
  venue?: Venue;
  style?: StyleProp<ViewStyle>;
  stops: [number, number, number];
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={[{ backgroundColor: theme.background, overflow: "hidden" }, style]}>
      <Image
        source={venueImage(venue)}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={200}
        accessible={false}
      />
      <LinearGradient
        colors={[
          withAlpha(theme.background, stops[0]),
          withAlpha(theme.background, stops[1]),
          withAlpha(theme.background, stops[2]),
        ]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />
      {children}
    </View>
  );
}

/** What a listing looks like. Shared by the feed and the Post screen's preview. */
export type SessionFace = Pick<
  Session,
  | "activity"
  | "title"
  | "abilityLabel"
  | "abilityFlex"
  | "startAt"
  | "durationMin"
  | "womenOnly"
  | "visibility"
> & { seatsLeft: number; substituteSeat?: boolean; seriesId?: string | null };

const seatsLabel = (n: number) => (n === 0 ? "Full" : `${n} ${n === 1 ? "spot" : "spots"} left`);

/** What this session is to me, when it is anything: shown instead of "is it my level". */
export type MineTag = "Joined" | "Waiting for approval" | "Hosting";

export function SessionCardFace(props: FaceProps) {
  return (
    <OnPhoto>
      <Face {...props} />
    </OnPhoto>
  );
}

type FaceProps = {
  session: SessionFace;
  venue?: Venue;
  /** `true` = inside my level. Only ever shown as a positive — never "not for you". */
  fits?: boolean | null;
  mine?: MineTag;
};

function Face({ session, venue, fits, mine }: FaceProps) {
  const theme = useTheme();
  const live = inCheckinWindow(session.startAt);
  return (
    <View
      style={[styles.card, live && styles.featured, { backgroundColor: theme.backgroundElement }]}
    >
      <Image
        source={venueImage(venue)}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={200}
      />
      <LinearGradient
        colors={[
          withAlpha(theme.background, 0.1),
          withAlpha(theme.background, 0.55),
          theme.background,
        ]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.top}>
        <View style={styles.chips}>
          <Tag label={ACTIVITIES[session.activity].label} />
          {mine ? (
            <Tag label={mine} tone="accent" />
          ) : fits ? (
            <Tag label="Your level" tone="accent" />
          ) : null}
          {live && <Tag label="Check-in open" tone="move" />}
          {session.womenOnly && <Tag label="Women-only" />}
          {session.substituteSeat && <Tag label="Fill-in · this week" />}
          {session.seriesId && !session.substituteSeat && <Tag label="Weekly" />}
          {session.abilityFlex === "flexible" && <Tag label="Any level welcome" />}
          {session.visibility === "unlisted" && <Tag label="Invite-only" />}
        </View>
      </View>
      <View>
        <T variant="eyebrow" style={{ color: withAlpha(theme.text, 0.75) }}>
          {formatWhen(session.startAt)}
        </T>
        <T variant="heading" style={styles.title}>
          {session.title || "Give it a title"}
        </T>
        <T variant="label" style={styles.level}>
          {session.abilityLabel}
        </T>
        <View style={styles.meta}>
          <Meta icon={MapPin} text={venue?.name ?? "—"} />
          <Meta icon={Clock} text={formatDuration(session.durationMin)} />
          <Meta icon={Users} text={seatsLabel(session.seatsLeft)} />
        </View>
      </View>
    </View>
  );
}

/**
 * Discovery shows the workout, the level, the time and the place — never a face
 * (PRD v0.3 §8). Who posted it is on the session itself.
 */
export function SessionCard({
  session,
  venue,
  mine,
}: {
  session: Session;
  venue?: Venue;
  mine?: MineTag;
}) {
  const summary = `${mine ? `${mine}. ` : ""}${ACTIVITIES[session.activity].label}. ${session.title}. ${session.abilityLabel}${session.fitsMe ? ", your level" : ""}. ${formatWhen(session.startAt)} at ${venue?.name ?? "the meeting point"}. ${seatsLabel(session.seatsLeft)}.`;
  return (
    <Link href={{ pathname: "/session/[id]", params: { id: session.id } }} asChild>
      {/* The press animation lives in PressScale's animated style, which survives `Link asChild`. */}
      <PressScale accessibilityRole="button" accessibilityLabel={summary} scaleTo={0.98}>
        <SessionCardFace session={session} venue={venue} fits={session.fitsMe} mine={mine} />
      </PressScale>
    </Link>
  );
}

function Meta({ icon: Icon, text }: { icon: typeof Clock; text: string }) {
  const theme = useTheme();
  const color = withAlpha(theme.text, 0.82);
  return (
    <View style={styles.metaItem}>
      <Icon size={14} color={color} />
      <T variant="caption" style={{ color }}>
        {text}
      </T>
    </View>
  );
}

export function Tag({
  label,
  tone = "glass",
}: {
  label: string;
  tone?: "glass" | "move" | "accent";
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.tag,
        tone === "move"
          ? { backgroundColor: theme.move }
          : tone === "accent"
            ? { backgroundColor: theme.accent }
            : {
                backgroundColor: withAlpha("#161618", 0.72),
                borderColor: theme.border,
                borderWidth: StyleSheet.hairlineWidth,
              },
      ]}
    >
      <T
        style={[
          styles.tagText,
          tone === "accent" && { color: theme.onAccent },
          tone === "move" && { color: theme.onDanger },
        ]}
      >
        {label}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 176,
    borderRadius: Radius.xl,
    overflow: "hidden",
    padding: Spacing.three,
    justifyContent: "space-between",
    gap: Spacing.four,
  },
  featured: { minHeight: 224 },
  top: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: Spacing.two,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, flex: 1 },
  title: { marginTop: Spacing.half },
  level: { marginTop: 2 },
  meta: {
    marginTop: Spacing.one,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: Spacing.two,
    rowGap: Spacing.half,
  },
  metaItem: { flexDirection: "row", alignItems: "center", gap: Spacing.half },
  tag: { borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: Spacing.half },
  tagText: { fontFamily: Fonts.medium, fontSize: 11, lineHeight: 16, letterSpacing: 0.3 },
});
