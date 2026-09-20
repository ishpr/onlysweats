import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Link } from "expo-router";
import { Clock, MapPin, Users } from "lucide-react-native";
import { StyleSheet, View } from "react-native";

import { PressScale } from "@/components/motion";
import { T, withAlpha } from "@/components/ui";
import { Fonts, Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { API_URL } from "@/lib/config";
import { formatDuration, formatWhen, inCheckinWindow } from "@/lib/format";
import { ACTIVITIES, type Session, type Venue } from "@/lib/types";

/** Venue photos are served by the API host (`public/venues/*`). */
export const venueImage = (venue?: Venue) =>
  venue ? { uri: `${API_URL}${venue.image}` } : undefined;

/**
 * Discovery shows the workout, the level, the time and the place — never a face
 * (PRD v0.3 §8). Who posted it is on the session itself.
 */
export function SessionCard({ session, venue }: { session: Session; venue?: Venue }) {
  const theme = useTheme();
  const live = inCheckinWindow(session.startAt);
  const seats =
    session.seatsLeft === 0
      ? "Full"
      : `${session.seatsLeft} ${session.seatsLeft === 1 ? "seat" : "seats"}`;
  const summary = `${session.title}. ${session.abilityLabel}. ${formatWhen(session.startAt)} at ${venue?.name ?? "the pin"}. ${seats}.`;
  return (
    <Link href={{ pathname: "/session/[id]", params: { id: session.id } }} asChild>
      {/* The press animation lives in PressScale's animated style, which survives `Link asChild`. */}
      <PressScale accessibilityRole="button" accessibilityLabel={summary} scaleTo={0.98}>
        <View
          style={[
            styles.card,
            live && styles.featured,
            { backgroundColor: theme.backgroundElement },
          ]}
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
              {live && <Tag label="Live" tone="move" />}
              {session.womenOnly && <Tag label="Women-only" />}
              {session.substituteSeat && <Tag label="Substitute seat" />}
              {session.seriesId && !session.substituteSeat && <Tag label="Standing slot" />}
              {session.abilityFlex === "flexible" && <Tag label="Flexible level" />}
              {session.visibility === "unlisted" && <Tag label="Unlisted" />}
            </View>
          </View>
          <View>
            <T variant="eyebrow" style={{ color: withAlpha(theme.text, 0.75) }}>
              {formatWhen(session.startAt)}
            </T>
            <T variant="heading" style={styles.title}>
              {session.title}
            </T>
            <T variant="label" style={styles.level}>
              {session.abilityLabel}
            </T>
            <View style={styles.meta}>
              <Meta icon={MapPin} text={venue?.name ?? "—"} />
              <Meta icon={Clock} text={formatDuration(session.durationMin)} />
              <Meta icon={Users} text={seats} />
            </View>
          </View>
        </View>
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

export function Tag({ label, tone = "glass" }: { label: string; tone?: "glass" | "move" }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.tag,
        tone === "move"
          ? { backgroundColor: theme.move }
          : {
              backgroundColor: withAlpha("#161618", 0.72),
              borderColor: theme.border,
              borderWidth: StyleSheet.hairlineWidth,
            },
      ]}
    >
      <T style={styles.tagText}>{label}</T>
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
