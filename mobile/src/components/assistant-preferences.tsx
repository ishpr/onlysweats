import { useState } from "react";
import { Switch, View } from "react-native";
import { AbilityPicker } from "@/components/ability-picker";
import { Button, Card, Chip, Field, Notice, Row, T } from "@/components/ui";
import { usePrivateAction } from "@/hooks/use-private-action";
import { defaultAbility } from "@/lib/ability";
import type { ApiSession } from "@/lib/api";
import { localDateTime, parseLocalDateTime } from "@/lib/local-datetime";
import { ACTIVITIES, type Activity, type MemberAbilities, type Venue } from "@/lib/types";
import type { ChatPreferenceDraft } from "../../../shared/conversation";
import type { AssistantPreferences, AssistantPreferencesInput } from "../../../shared/assistant";

export function AssistantPreferencesEditor({
  session,
  initial,
  venues,
  abilities,
  draft,
  onSaved,
}: {
  session: ApiSession;
  initial: AssistantPreferences;
  venues: Venue[];
  abilities: MemberAbilities;
  draft?: ChatPreferenceDraft;
  onSaved: () => Promise<unknown>;
}) {
  const action = usePrivateAction(session);
  const [enabled, setEnabled] = useState(initial.revision === 0 ? true : initial.enabled);
  const [activity, setActivity] = useState(draft?.activity ?? initial.activity);
  const [ability, setAbility] = useState(
    draft?.activity && draft.activity !== initial.activity
      ? defaultAbility(draft.activity, abilities)
      : initial.ability,
  );
  const [duration, setDuration] = useState(String(draft?.durationMin ?? initial.durationMin));
  const [venueIds, setVenues] = useState(initial.venueIds);
  const [intent, setIntent] = useState(draft?.approvedIntent ?? initial.approvedIntent);
  const [windows, setWindows] = useState(() =>
    initial.availability.map((window) => ({
      startAt: localDateTime(window.startAt),
      endAt: localDateTime(window.endAt),
    })),
  );
  const save = () =>
    action.run(
      async (signal) => {
        if (!enabled)
          return session.request("/agents/preferences", {
            method: "PUT",
            signal,
            json: {
              enabled: false,
              activity: initial.activity,
              ability: initial.ability,
              durationMin: initial.durationMin,
              venueIds: initial.venueIds,
              availability: initial.availability,
              approvedIntent: initial.approvedIntent,
            },
          });
        const durationMin = Number(duration);
        if (!Number.isInteger(durationMin) || durationMin < 10 || durationMin > 360)
          throw new Error("Choose a workout length from 10 to 360 minutes.");
        const input: AssistantPreferencesInput = {
          enabled,
          activity,
          ability,
          durationMin,
          venueIds,
          availability: windows.map((window) => ({
            startAt: parseLocalDateTime(window.startAt),
            endAt: parseLocalDateTime(window.endAt),
          })),
          approvedIntent: intent.trim(),
        };
        if (enabled && (!venueIds.length || !windows.length))
          throw new Error("Choose a meeting place and add an available time.");
        return session.request("/agents/preferences", { method: "PUT", json: input, signal });
      },
      async () => {
        await onSaved();
      },
    );
  return (
    <Card>
      <T variant="heading">Preferences you choose to share</T>
      {draft && (
        <Notice>
          These are assistant suggestions. Check the activity, ability, duration and note before
          saving. Sharing stays under your control; nothing has been sent to another member.
        </Notice>
      )}
      <T variant="caption" color="textSecondary">
        Your agent uses these entered preferences to find compatible partners and work out proposals
        with their agents. Your Apple Health data and exercise log stay private.
      </T>
      <Row>
        <T style={{ flex: 1 }}>Allow preference sharing</T>
        <Switch
          accessibilityLabel="Allow preference sharing"
          value={enabled}
          disabled={action.busy}
          onValueChange={setEnabled}
        />
      </Row>
      <T variant="caption" color="textSecondary">
        {initial.revision === 0
          ? "Save your times and places so your agent can begin matching. You approve every booking."
          : initial.enabled
            ? "Currently shared. Save to apply your changes."
            : "Planning is paused. Keep it paused or resume sharing when you save."}
      </T>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {(Object.keys(ACTIVITIES) as Activity[]).map((type) => (
          <Chip
            key={type}
            label={ACTIVITIES[type].label}
            selected={type === activity}
            disabled={action.busy}
            onPress={() => {
              setActivity(type);
              setAbility(defaultAbility(type, abilities));
            }}
          />
        ))}
      </View>
      <View pointerEvents={action.busy ? "none" : "auto"}>
        <AbilityPicker value={ability} onChange={setAbility} />
      </View>
      <Field
        label="Workout length (minutes)"
        keyboardType="number-pad"
        value={duration}
        onChangeText={setDuration}
        editable={!action.busy}
      />
      <T variant="label">Public meeting places</T>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {venues.map((venue) => (
          <Chip
            key={venue.id}
            label={venue.name}
            selected={venueIds.includes(venue.id)}
            disabled={action.busy || (!venueIds.includes(venue.id) && venueIds.length >= 10)}
            onPress={() =>
              setVenues((current) =>
                current.includes(venue.id)
                  ? current.filter((id) => id !== venue.id)
                  : [...current, venue.id],
              )
            }
          />
        ))}
      </View>
      <Field
        label="What should your buddy know? (optional)"
        placeholder="For example: an easy session and a consistent weekly routine"
        multiline
        maxLength={240}
        value={intent}
        onChangeText={setIntent}
        editable={!action.busy}
      />
      <T variant="label">Times you are available</T>
      <T variant="caption" color="textSecondary">
        Use your phone’s local time. Enter windows within the next 14 days, long enough for this
        workout and no longer than one day. We do not read your calendar.
      </T>
      {windows.map((window, index) => (
        <View key={index} style={{ gap: 8 }}>
          <Field
            label={`Available from ${index + 1} (YYYY-MM-DD HH:mm)`}
            value={window.startAt}
            editable={!action.busy}
            onChangeText={(value) =>
              setWindows((current) =>
                current.map((item, i) => (index === i ? { ...item, startAt: value } : item)),
              )
            }
          />
          <Field
            label={`Available until ${index + 1} (YYYY-MM-DD HH:mm)`}
            value={window.endAt}
            editable={!action.busy}
            onChangeText={(value) =>
              setWindows((current) =>
                current.map((item, i) => (index === i ? { ...item, endAt: value } : item)),
              )
            }
          />
          <Button
            label={`Remove time ${index + 1}`}
            variant="ghost"
            disabled={action.busy}
            onPress={() => setWindows((current) => current.filter((_, i) => i !== index))}
          />
        </View>
      ))}
      <Button
        label="Add available time"
        variant="soft"
        disabled={action.busy || windows.length >= 12}
        onPress={() => setWindows((current) => [...current, { startAt: "", endAt: "" }])}
      />
      {action.error && <Notice tone="danger">{action.error}</Notice>}
      <Button
        label="Save planning preferences"
        loading={action.busy}
        disabled={action.busy}
        onPress={() => void save()}
      />
      {initial.enabled && (
        <Button
          label="Stop sharing now"
          variant="ghost"
          disabled={action.busy}
          onPress={() =>
            void action.run(
              (signal) =>
                session.request("/agents/preferences", {
                  method: "PUT",
                  signal,
                  json: {
                    enabled: false,
                    activity: initial.activity,
                    ability: initial.ability,
                    durationMin: initial.durationMin,
                    venueIds: initial.venueIds,
                    availability: initial.availability,
                    approvedIntent: initial.approvedIntent,
                  },
                }),
              async () => {
                await onSaved();
              },
            )
          }
        />
      )}
    </Card>
  );
}
