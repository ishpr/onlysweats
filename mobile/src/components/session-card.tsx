import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Link } from "expo-router";
import { Clock, MapPin, Users } from "lucide-react-native";
import type { ReactNode } from "react";
import { type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";

import { PressScale } from "@/components/motion";
import { T, withAlpha } from "@/components/ui";
import { Fonts, Radius, Spacing } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { OnPhoto, useTheme } from "@/hooks/use-theme";
import { formatMiles, milesBetween, useArea } from "@/lib/area";
import { API_URL } from "@/lib/config";
import { formatDuration, formatWhen, inCheckinWindow } from "@/lib/format";
import { ACTIVITIES, type Session, type Venue } from "@/lib/types";

/** Venue photos are served by the API host (`public/venues/*`). */
export const venueImage = (venue?: Venue) =>
  venue ? { uri: `${API_URL}${venue.image}` } : undefined;

/**
 * The photo card, in two builds.
 *
 * **Dark**: the photograph fills the card and fades into the page; tags and text sit
 * on it, reading the dark tokens.
 *
 * **Light**: a dusk photo fading to black is a black slab on a white page, so the
 * photograph sits on top — tags over it, under a whisper of scrim — and the text
 * goes below on the light surface, in the light theme's own ink. No black anywhere
 * but the picture itself.
 */
export function PhotoCard({
  venue,
  tags,
  children,
  footer,
  style,
  photoHeight = 132,
  minHeight = 176,
}: {
  venue?: Venue;
  tags?: ReactNode;
  children: ReactNode;
  /** Actions under the text (buttons), inside the card. */
  footer?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Light build: how tall the photograph is. */
  photoHeight?: number;
  /** Dark build: the card's minimum height. */
  minHeight?: number;
}) {
  const scheme = useColorScheme();
  const theme = useTheme();
  if (scheme === "light") {
    return (
      // The shadow sits on an outer view: `overflow: hidden` (for the photo's rounded
      // corners) would clip it.
      <View style={[styles.lightShadow, glassShadow, style]}>
        <View
          style={[
            styles.lightCard,
            { backgroundColor: theme.backgroundElement, borderColor: theme.glassEdge },
          ]}
        >
          <OnPhoto>
            <View style={{ height: photoHeight }}>
              <Image
                source={venueImage(venue)}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                transition={200}
                accessible={false}
              />
              <LinearGradient
                colors={["rgba(5,5,6,0.45)", "rgba(5,5,6,0)"]}
                locations={[0, 0.6]}
                style={StyleSheet.absoluteFill}
              />
              {tags ? <View style={styles.lightTags}>{tags}</View> : null}
            </View>
          </OnPhoto>
          <View style={styles.lightBody}>{children}</View>
          {footer ? <View style={styles.lightFooter}>{footer}</View> : null}
        </View>
      </View>
    );
  }
  return (
    <OnPhoto>
      <DarkPhotoCard venue={venue} tags={tags} footer={footer} style={style} minHeight={minHeight}>
        {children}
      </DarkPhotoCard>
    </OnPhoto>
  );
}

function DarkPhotoCard({
  venue,
  tags,
  children,
  footer,
  style,
  minHeight,
}: {
  venue?: Venue;
  tags?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  style?: StyleProp<ViewStyle>;
  minHeight: number;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { minHeight, backgroundColor: theme.background }, style]}>
      <Image
        source={venueImage(venue)}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={200}
        accessible={false}
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
      <View style={styles.top}>{tags}</View>
      <View style={styles.darkBody}>
        {children}
        {footer}
      </View>
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

export function SessionCardFace({ session, venue, fits, mine }: FaceProps) {
  const { area } = useArea();
  const away = area?.coords && venue ? formatMiles(milesBetween(area.coords, venue)) : null;
  const live = inCheckinWindow(session.startAt);
  return (
    <PhotoCard
      venue={venue}
      minHeight={live ? 224 : 176}
      tags={
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
      }
    >
      <T variant="eyebrow" color="textSecondary">
        {formatWhen(session.startAt)}
      </T>
      <T variant="heading" style={styles.title}>
        {session.title || "Give it a name"}
      </T>
      <T variant="label" style={styles.level}>
        {session.abilityLabel}
      </T>
      <View style={styles.meta}>
        <Meta icon={MapPin} text={`${venue?.name ?? "—"}${away ? ` · ${away}` : ""}`} />
        <Meta icon={Clock} text={formatDuration(session.durationMin)} />
        <Meta icon={Users} text={seatsLabel(session.seatsLeft)} />
      </View>
    </PhotoCard>
  );
}

type FaceProps = {
  session: SessionFace;
  venue?: Venue;
  /** `true` = inside my level. Only ever shown as a positive — never "not for you". */
  fits?: boolean | null;
  mine?: MineTag;
};

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
  return (
    <View style={styles.metaItem}>
      <Icon size={14} color={theme.textSecondary} />
      <T variant="caption" color="textSecondary">
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

const glassShadow = {
  shadowColor: "#0F1419",
  shadowOpacity: 0.08,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 8 },
  elevation: 2,
} as const;

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.xl,
    overflow: "hidden",
    padding: Spacing.three,
    justifyContent: "space-between",
    gap: Spacing.four,
  },
  darkBody: { gap: 0 },
  lightShadow: { borderRadius: Radius.xl },
  lightCard: { borderRadius: Radius.xl, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  lightTags: { position: "absolute", top: Spacing.two, left: Spacing.two, right: Spacing.two },
  lightBody: { padding: Spacing.three, gap: 0 },
  lightFooter: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.three },
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
