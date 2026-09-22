/**
 * What your assistant can use. The same permissions the chat used to keep behind its
 * "Privacy choices" row — now one page, one switch each, plain words, with the full
 * notice one tap away. Writes go to the same server records as before.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ConfirmSheet } from "@/components/confirm-sheet";
import { ListCard, SectionTitle } from "@/components/list";
import { PrivateMember, type PrivateMemberProps } from "@/components/private-member";
import { SettingRow } from "@/components/settings-kit";
import { Sheet } from "@/components/sheet";
import { Notice, Screen, StateView, T } from "@/components/ui";
import { usePrivateAction } from "@/hooks/use-private-action";
import {
  chatHistoryUseUpdate,
  chatPermissionUpdate,
  readChatSettings,
  type ChatPermission,
  type ChatSettingsUpdate,
} from "@/lib/assistant/settings";

import {
  CHAT_CONSENT_NOTICE,
  CHAT_FITNESS_NOTICE,
  CHAT_HISTORY_USE_NOTICE,
  CHAT_MANUAL_WORKOUT_NOTICE,
  type ChatHistory,
  type ChatSettings,
} from "../../../../shared/conversation";
import { FITNESS_AI_CONSENT_NOTICE, type FitnessConsent } from "../../../../shared/fitness";

export default function PrivacyRoute() {
  return <PrivateMember component={Privacy} />;
}

type About = "cloud" | "health" | "logs" | "relevant" | "drafts" | null;

function Privacy({ member, session }: PrivateMemberProps) {
  const client = useQueryClient();
  const control = usePrivateAction(session);
  const chatKey = ["private-assistant-chat", member.id];
  const chat = useQuery({
    queryKey: chatKey,
    gcTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await session.request<ChatHistory>("/assistant/chat?workoutPlanDrafts=true", {
        signal,
      });
      return { ...result, settings: readChatSettings(result.settings) };
    },
  });
  const fitnessKey = ["private-fitness", member.id, "consent"];
  const fitness = useQuery({
    queryKey: fitnessKey,
    gcTime: 0,
    retry: false,
    queryFn: ({ signal }) =>
      session.request<{ consent: FitnessConsent }>("/fitness/consent", { signal }),
  });
  const settings = chat.error ? null : (chat.data?.settings ?? null);
  const [about, setAbout] = useState<About>(null);
  const [pending, setPending] = useState<{ update: ChatSettingsUpdate; label: string } | null>(
    null,
  );

  // Any change to these clears the cloud conversation; switching OFF is asked first.
  const write = (update: ChatSettingsUpdate) =>
    void control.run(
      async (signal) => {
        await client.cancelQueries({ queryKey: chatKey, exact: true });
        const result = await session.request<{ settings: ChatSettings }>("/assistant/settings", {
          method: "PUT",
          signal,
          json: update,
        });
        return readChatSettings(result.settings);
      },
      async (next) => {
        setPending(null);
        if (session.isCurrent())
          client.setQueryData<ChatHistory>(chatKey, { settings: next, messages: [] });
        await client.invalidateQueries({ queryKey: ["private-assistant-chat"] });
      },
    );
  const flip = (permission: ChatPermission, label: string) => (enabled: boolean) => {
    if (!settings) return;
    const update = chatPermissionUpdate(settings, permission, enabled);
    if (enabled) write(update);
    else setPending({ update, label });
  };

  const ABOUT: Record<NonNullable<About>, { title: string; body: string }> = {
    cloud: { title: "Think in the cloud", body: CHAT_CONSENT_NOTICE },
    health: { title: "Use my Apple Health workouts", body: CHAT_FITNESS_NOTICE },
    logs: { title: "Use my plans and logs", body: CHAT_MANUAL_WORKOUT_NOTICE },
    relevant: { title: "Bring history in when it helps", body: CHAT_HISTORY_USE_NOTICE },
    drafts: { title: "Help me log workouts", body: FITNESS_AI_CONSENT_NOTICE },
  };

  return (
    <Screen>
      <T color="textSecondary">
        What your assistant is allowed to use. Nothing here ever reaches a buddy or their assistant.
      </T>
      {(chat.isPending || chat.error) && (
        <StateView
          loading={chat.isPending}
          error={chat.error}
          onRetry={() => void chat.refetch()}
        />
      )}
      {settings && (
        <>
          <SectionTitle>Conversation</SectionTitle>
          <ListCard>
            <SettingRow
              label="Think in the cloud"
              detail={
                settings.providerAvailable
                  ? "Smarter answers. Off means it only works on this iPhone."
                  : "Not available right now. It still works on this iPhone."
              }
              value={settings.cloudEnabled}
              disabled={control.busy}
              onValueChange={flip("cloudEnabled", "Think in the cloud")}
              onAbout={() => setAbout("cloud")}
            />
            <SettingRow
              label="Use my Apple Health workouts"
              detail="Up to five recent workout summaries. Never raw samples, sleep or HRV."
              value={settings.fitnessContextEnabled}
              disabled={control.busy || !settings.cloudEnabled}
              onValueChange={flip("fitnessContextEnabled", "Use my Apple Health workouts")}
              onAbout={() => setAbout("health")}
            />
            <SettingRow
              label="Use my plans and logs"
              detail="Recent saved plans and what you entered. Plans are targets, not results."
              value={settings.manualWorkoutContextEnabled}
              disabled={control.busy || !settings.cloudEnabled}
              onValueChange={flip("manualWorkoutContextEnabled", "Use my plans and logs")}
              onAbout={() => setAbout("logs")}
            />
            <SettingRow
              label="Bring history in when it helps"
              detail="Off means it only looks when you ask."
              value={settings.historyUse === "when_relevant"}
              disabled={control.busy || !settings.cloudEnabled}
              onValueChange={(enabled) => {
                const update = chatHistoryUseUpdate(
                  settings,
                  enabled ? "when_relevant" : "when_requested",
                );
                if (enabled) write(update);
                else setPending({ update, label: "Bring history in when it helps" });
              }}
              onAbout={() => setAbout("relevant")}
            />
          </ListCard>
          <T variant="caption" color="textFaint">
            Changing any of these clears the cloud conversation. Your logs and plans stay.
          </T>
        </>
      )}

      <SectionTitle>Logging</SectionTitle>
      {(fitness.isPending || fitness.error) && (
        <StateView
          loading={fitness.isPending}
          error={fitness.error}
          onRetry={() => void fitness.refetch()}
        />
      )}
      {fitness.data && (
        <ListCard>
          <SettingRow
            label="Help me log workouts"
            detail={
              fitness.data.consent.providerAvailable
                ? "Turns a note into an editable draft. You check it before saving."
                : "Not available right now. Logging by hand works without it."
            }
            value={fitness.data.consent.enabled}
            disabled={control.busy}
            onValueChange={(enabled) =>
              void control.run(
                (signal) =>
                  session.request("/fitness/consent", { method: "PUT", json: { enabled }, signal }),
                async () => {
                  await client.invalidateQueries({ queryKey: ["private-fitness", member.id] });
                },
              )
            }
            onAbout={() => setAbout("drafts")}
          />
        </ListCard>
      )}
      {control.error && <Notice tone="danger">{control.error}</Notice>}

      <Sheet
        visible={about !== null}
        onClose={() => setAbout(null)}
        title={about ? ABOUT[about].title : ""}
        subtitle="The full notice, as it applies."
        startFull
      >
        <T color="textSecondary" selectable>
          {about ? ABOUT[about].body : ""}
        </T>
      </Sheet>
      <ConfirmSheet
        visible={pending !== null}
        onClose={() => setPending(null)}
        title={`Turn off “${pending?.label ?? ""}”?`}
        body="This clears your cloud conversation. Your logs, plans and sessions aren’t touched."
        confirm={{ label: "Turn off", onPress: () => pending && write(pending.update) }}
        cancelLabel="Keep it on"
        busy={control.busy}
      />
    </Screen>
  );
}
