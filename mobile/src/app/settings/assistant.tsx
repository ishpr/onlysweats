/**
 * Assistant controls: pause it, clear its conversation, connect an outside assistant.
 * These used to sit at the bottom of the assistant screen as "Controls".
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, PauseCircle, PlayCircle, Trash2 } from "lucide-react-native";
import { useState } from "react";

import { AssistantCredentials } from "@/components/assistant-credentials";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { ListCard, ListRow, SectionTitle } from "@/components/list";
import { PrivateMember, type PrivateMemberProps } from "@/components/private-member";
import { useToast } from "@/components/toast";
import { Notice, Screen, StateView, T } from "@/components/ui";
import { usePrivateAction } from "@/hooks/use-private-action";

import type { AssistantPreferences } from "../../../../shared/assistant";
import type { ChatHistory } from "../../../../shared/conversation";

export default function AssistantSettingsRoute() {
  return <PrivateMember component={AssistantSettings} />;
}

function AssistantSettings({ member, session }: PrivateMemberProps) {
  const client = useQueryClient();
  const action = usePrivateAction(session);
  const toast = useToast();
  const [confirm, setConfirm] = useState<"pause" | "clear" | null>(null);
  const [showConnected, setShowConnected] = useState(false);
  const key = ["private-assistant", member.id];
  const preferences = useQuery({
    queryKey: [...key, "preferences"],
    gcTime: 0,
    retry: false,
    queryFn: ({ signal }) =>
      session.request<{ preferences: AssistantPreferences }>("/agents/preferences", { signal }),
  });
  const current = preferences.error ? null : (preferences.data?.preferences ?? null);
  const setEnabled = (enabled: boolean) =>
    current &&
    void action.run(
      (signal) =>
        session.request("/agents/preferences", {
          method: "PUT",
          signal,
          json: {
            enabled,
            activity: current.activity,
            ability: current.ability,
            durationMin: current.durationMin,
            venueIds: current.venueIds,
            availability: current.availability,
            approvedIntent: current.approvedIntent,
          },
        }),
      async () => {
        setConfirm(null);
        toast.show({ message: enabled ? "Your assistant is looking again." : "Paused." });
        await client.invalidateQueries({ queryKey: key });
      },
    );
  const clear = () =>
    void action.run(
      (signal) => session.request<ChatHistory>("/assistant/chat", { method: "DELETE", signal }),
      async () => {
        setConfirm(null);
        toast.show({ message: "Conversation cleared." });
        await client.invalidateQueries({ queryKey: ["private-assistant-chat"] });
      },
    );

  return (
    <Screen>
      {(preferences.isPending || preferences.error) && (
        <StateView
          loading={preferences.isPending}
          error={preferences.error}
          onRetry={() => void preferences.refetch()}
        />
      )}
      <SectionTitle>Looking for a buddy</SectionTitle>
      <ListCard>
        {current?.enabled ? (
          <ListRow
            icon={PauseCircle}
            label="Pause my assistant"
            detail="Stops sharing what you’re after. Plans already agreed stay as they are."
            onPress={() => setConfirm("pause")}
          />
        ) : (
          <ListRow
            icon={PlayCircle}
            label="Start looking again"
            detail={
              current ? "Uses what you told it last time." : "Set up what you’re looking for first."
            }
            onPress={() => (current ? setEnabled(true) : undefined)}
          />
        )}
      </ListCard>

      <SectionTitle>Conversation</SectionTitle>
      <ListCard>
        <ListRow
          icon={Trash2}
          label="Delete conversation"
          detail="Clears your private chat. Logs, plans and sessions stay."
          danger
          onPress={() => setConfirm("clear")}
        />
      </ListCard>

      <SectionTitle>Outside assistants</SectionTitle>
      <ListCard>
        <ListRow
          icon={Link2}
          label="Connect an outside assistant"
          expanded={showConnected}
          onPress={() => setShowConnected((value) => !value)}
        >
          <AssistantCredentials session={session} ownerId={member.id} />
        </ListRow>
      </ListCard>
      <T variant="caption" color="textFaint">
        An outside assistant can only do what yours can — propose. You still approve every plan.
      </T>
      {action.error && <Notice tone="danger">{action.error}</Notice>}

      <ConfirmSheet
        visible={confirm === "pause"}
        onClose={() => setConfirm(null)}
        title="Pause your assistant?"
        body="It stops looking for a buddy and stops sharing what you’re after. Plans already agreed stay as they are. Start it again any time."
        confirm={{ label: "Pause", onPress: () => setEnabled(false) }}
        cancelLabel="Keep looking"
        busy={action.busy}
      />
      <ConfirmSheet
        visible={confirm === "clear"}
        onClose={() => setConfirm(null)}
        title="Delete this conversation?"
        body="Removes your private chat with the assistant. Your logs, plans and sessions aren’t touched."
        confirm={{ label: "Delete conversation", danger: true, onPress: clear }}
        cancelLabel="Keep"
        busy={action.busy}
      />
    </Screen>
  );
}
