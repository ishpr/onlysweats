import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { AbilityPicker } from "@/components/ability-picker";
import { Button, Card, Chip, Field, Notice, Row, Screen, T } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { defaultAbility } from "@/lib/ability";
import { atCluster, dayLabel, formatWhen } from "@/lib/format";
import { useMe, usePostSession, useVenues } from "@/lib/queries";
import { ACTIVITIES, type Ability, type Activity } from "@/lib/types";

const HOURS = Array.from({ length: 17 }, (_, i) => i + 5); // 5 AM – 9 PM
const MINUTES = [0, 15, 30, 45];
const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
const DURATION: Record<Activity, number> = {
  run: 45,
  ride: 90,
  strength: 60,
  hike: 150,
  walk: 45,
  mobility: 30,
};

export default function Post() {
  const { unlisted } = useLocalSearchParams<{ unlisted?: string }>();
  const router = useRouter();
  const theme = useTheme();
  const me = useMe().data;
  const venues = useVenues().data ?? [];
  const post = usePostSession();

  const [activity, setActivity] = useState<Activity>("run");
  // `null` = untouched, so the level follows my profile until I change it.
  const [picked, setPicked] = useState<Ability | null>(null);
  const ability = picked ?? defaultAbility(activity, me?.abilities);
  const [flexible, setFlexible] = useState(false);
  const [venueId, setVenueId] = useState("katy");
  const [title, setTitle] = useState(unlisted ? "Easy one — just us" : "The one I’m doing anyway");
  const [detail, setDetail] = useState("I’m going either way. Join if you’ll be at the pin.");
  const [days, setDays] = useState(1);
  const [hour, setHour] = useState(6);
  const [minute, setMinute] = useState(0);
  const [capacity, setCapacity] = useState(unlisted ? 2 : 3);
  const [isUnlisted, setUnlisted] = useState(Boolean(unlisted));
  const [instant, setInstant] = useState(true);
  const [womenOnly, setWomenOnly] = useState(false);

  const start = atCluster(days, hour, minute);
  const open = capacity - 1;

  function publish() {
    post.mutate(
      {
        venueId,
        activity,
        title: title.trim(),
        detail: detail.trim(),
        ability,
        abilityFlex: flexible ? "flexible" : "strict",
        startAt: start.toISOString(),
        durationMin: DURATION[activity],
        capacity,
        visibility: isUnlisted ? "unlisted" : "public",
        joinMode: instant ? "instant" : "approve",
        womenOnly,
      },
      { onSuccess: (s) => router.replace({ pathname: "/session/[id]", params: { id: s.id } }) },
    );
  }

  return (
    <Screen edges={["bottom"]}>
      <T variant="title">You’re going anyway. Open {open === 1 ? "a seat" : `${open} seats`}.</T>

      <Picker label="Activity">
        {(Object.keys(ACTIVITIES) as Activity[]).map((a) => (
          <Chip
            key={a}
            label={ACTIVITIES[a].label}
            selected={activity === a}
            onPress={() => {
              setActivity(a);
              setPicked(null);
            }}
          />
        ))}
      </Picker>

      <Card>
        <T variant="eyebrow" color="stand">
          Level
        </T>
        <T variant="caption" color="textSecondary">
          A buddy at the wrong level is worse than no buddy. Say what this one is.
        </T>
        <AbilityPicker value={ability} onChange={setPicked} />
        {ability.kind !== "open" && (
          <Chip
            label={flexible ? "✓ I’ll adjust to whoever joins" : "I’ll adjust to whoever joins"}
            selected={flexible}
            onPress={() => setFlexible(!flexible)}
          />
        )}
      </Card>

      <Field label="Title" value={title} onChangeText={setTitle} maxLength={120} />
      <Field
        label="About the workout"
        value={detail}
        onChangeText={setDetail}
        multiline
        maxLength={1000}
      />

      <View style={styles.group}>
        <T variant="caption" color="textSecondary">
          Place
        </T>
        {venues.map((v) => {
          const on = v.id === venueId;
          return (
            <Pressable
              key={v.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${v.name}, ${v.neighborhood}`}
              onPress={() => setVenueId(v.id)}
            >
              <Card style={on ? { borderColor: theme.accent, borderWidth: 2 } : undefined}>
                <T variant="label">{v.name}</T>
                <T variant="caption" color="textSecondary">
                  {v.neighborhood} · {v.type.replace("_", " ")}
                </T>
              </Card>
            </Pressable>
          );
        })}
      </View>

      <Picker label="Day">
        {Array.from({ length: 8 }, (_, i) => (
          <Chip key={i} label={dayLabel(i)} selected={days === i} onPress={() => setDays(i)} />
        ))}
      </Picker>
      <Picker label="Start (Dallas time)">
        {HOURS.map((h) => (
          <Chip key={h} label={hourLabel(h)} selected={hour === h} onPress={() => setHour(h)} />
        ))}
      </Picker>
      <Picker label="Minutes">
        {MINUTES.map((m) => (
          <Chip
            key={m}
            label={`:${String(m).padStart(2, "0")}`}
            selected={minute === m}
            onPress={() => setMinute(m)}
          />
        ))}
      </Picker>

      <Picker label="People, including you">
        {[2, 3, 4].map((n) => (
          <Chip
            key={n}
            label={String(n)}
            selected={capacity === n}
            onPress={() => setCapacity(n)}
          />
        ))}
      </Picker>

      <Row style={styles.wrap}>
        <Chip label="Public" selected={!isUnlisted} onPress={() => setUnlisted(false)} />
        <Chip label="Invite only" selected={isUnlisted} onPress={() => setUnlisted(true)} />
        <Chip label="Instant join" selected={instant} onPress={() => setInstant(true)} />
        <Chip label="I approve each person" selected={!instant} onPress={() => setInstant(false)} />
        {me?.gender === "woman" && (
          <Chip label="Women-only" selected={womenOnly} onPress={() => setWomenOnly(!womenOnly)} />
        )}
      </Row>

      <T variant="caption" color="textSecondary">
        Starts {formatWhen(start.toISOString())}. Nobody pays to join and you don’t earn — the same
        no-show rules apply to you as to whoever joins.
      </T>
      {post.error && <Notice tone="danger">{post.error.message}</Notice>}
      <Button label="Post the session" loading={post.isPending} onPress={publish} />
    </Screen>
  );
}

function Picker({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.group}>
      <T variant="caption" color="textSecondary">
        {label}
      </T>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.one },
  chips: { gap: Spacing.one, paddingRight: Spacing.three },
  wrap: { flexWrap: "wrap", gap: Spacing.one },
});
