import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import * as Crypto from "expo-crypto";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import {
  Activity,
  CalendarDays,
  ClipboardList,
  Settings2,
  ShieldCheck,
  Smartphone,
  Trash2,
  Users,
} from "lucide-react-native";
import {
  ActionCard,
  ChatBubble,
  CoachNotes,
  Composer,
  ComposerRow,
  TypingDots,
} from "@/components/assistant-kit";
import { ListCard, ListRow } from "@/components/list";
import { Sheet } from "@/components/sheet";
import { ComposerPortal } from "@/lib/composer-slot";
import { Spacing } from "@/constants/theme";
import { Button, Notice, StateView, T } from "@/components/ui";
import { usePrivateAction } from "@/hooks/use-private-action";
import type { ApiSession } from "@/lib/api";
import { createAssistantRun } from "@/lib/assistant/run";
import { createChatStreamParser, isChatMessage } from "@/lib/assistant/stream";
import { readChatSettings } from "@/lib/assistant/settings";
import { storeGeneratedWorkoutPlanDraft } from "@/lib/workout-plans/draft-handoff";
import { WorkoutPlanDraftCard } from "./workout-plan-draft-card";
import {
  type ChatAction,
  type ChatEvent,
  type ChatHistory,
  type ChatMessage,
  type ChatTurnInput,
  type ChatPreferenceDraft,
} from "../../../../shared/conversation";

export type PlanningAction = (
  kind: "preferences" | "discovery" | "negotiation",
  targetId?: string,
  preferenceDraft?: ChatPreferenceDraft,
) => void;
export function CloudChat({
  ownerId,
  session,
  onPlanning,
  onDevice,
}: {
  ownerId: string;
  session: ApiSession;
  onPlanning: PlanningAction;
  onDevice: () => void;
}) {
  const queryKey = ["private-assistant-chat", ownerId];
  const history = useQuery({
    queryKey,
    gcTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await session.request<ChatHistory>("/assistant/chat?workoutPlanDrafts=true", {
        signal,
      });
      if (
        !result?.settings ||
        !Array.isArray(result.messages) ||
        result.messages.length > 40 ||
        !result.messages.every(isChatMessage)
      )
        throw new Error("Your conversation could not be loaded. Please try again.");
      return { ...result, settings: readChatSettings(result.settings) };
    },
  });
  return (
    <CloudConversation
      key={
        history.data
          ? `${history.data.settings.consentGeneration}:${history.data.settings.historyGeneration}`
          : "loading"
      }
      ownerId={ownerId}
      session={session}
      onPlanning={onPlanning}
      onDevice={onDevice}
      history={history}
    />
  );
}

// Rotating consent/history generations unmounts all draft and retry state atomically.
function CloudConversation({
  ownerId,
  session,
  onPlanning,
  onDevice,
  history,
}: {
  ownerId: string;
  session: ApiSession;
  onPlanning: PlanningAction;
  history: UseQueryResult<ChatHistory, Error>;
  onDevice: () => void;
}) {
  const router = useRouter();
  const client = useQueryClient();
  const queryKey = ["private-assistant-chat", ownerId];
  const control = usePrivateAction(session);
  const runner = useMemo(() => createAssistantRun(session.isCurrent), [session]);
  const [text, setText] = useState("");
  const [showOptions, setShowOptions] = useState(false);
  const [busy, setBusy] = useState(false);
  const [partial, setPartial] = useState("");
  const [pendingUser, setPendingUser] = useState<ChatMessage | null>(null);
  const [lastTurn, setLastTurn] = useState<ChatTurnInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clearReview, setClearReview] = useState(false);
  const [permissionsUnconfirmed, setPermissionsUnconfirmed] = useState(false);
  useEffect(() => () => runner.cancel(), [runner]);
  const settings = history.error || permissionsUnconfirmed ? null : history.data?.settings;
  const stop = () => {
    runner.cancel();
    setBusy(false);
    setError("Reply stopped. Your message may already be saved; retry continues the same request.");
  };
  const clearLocal = () => {
    runner.cancel();
    setBusy(false);
    setPartial("");
    setPendingUser(null);
    setLastTurn(null);
    setError(null);
    setText("");
  };
  const send = (retry?: ChatTurnInput) => {
    if (runner.busy || control.busy || !session.isCurrent()) return;
    if (!settings?.cloudEnabled || !settings.providerAvailable) return;
    if (
      retry &&
      (retry.consentGeneration !== settings.consentGeneration ||
        retry.historyGeneration !== settings.historyGeneration)
    ) {
      clearLocal();
      setError("Your conversation permissions changed. Write a new message to continue.");
      return;
    }
    const input: ChatTurnInput = retry ?? {
      requestId: Crypto.randomUUID(),
      text: text.trim(),
      consentGeneration: settings.consentGeneration,
      historyGeneration: settings.historyGeneration,
      workoutPlanDrafts: true,
    };
    if (!input.text || input.text.length > 2000) return;
    setBusy(true);
    setError(null);
    setPartial("");
    setLastTurn(input);
    setText("");
    setPendingUser({
      id: `pending-${input.requestId}`,
      requestId: input.requestId,
      role: "user",
      text: input.text,
      actions: [],
      createdAt: new Date().toISOString(),
      status: "complete",
    });
    void runner.start<ChatEvent>(
      async (signal, publish) => {
        const parser = createChatStreamParser(input.requestId, publish);
        await session.stream(
          "/assistant/chat",
          { method: "POST", json: input, signal },
          parser.push,
        );
        parser.finish();
      },
      (event) => {
        if (event.type === "delta") setPartial((value) => value + event.text);
        if (event.type === "error") setError(event.message);
        if (event.type === "done") {
          setPartial("");
          setLastTurn(null);
          setPendingUser(null);
          client.setQueryData<ChatHistory>(queryKey, (current) =>
            current &&
            current.settings.consentGeneration === input.consentGeneration &&
            current.settings.historyGeneration === input.historyGeneration
              ? {
                  ...current,
                  messages: [
                    ...current.messages.filter((message) => message.requestId !== input.requestId),
                    {
                      id: `pending-${input.requestId}`,
                      requestId: input.requestId,
                      role: "user" as const,
                      text: input.text,
                      actions: [],
                      createdAt: new Date().toISOString(),
                      status: "complete" as const,
                    },
                    event.message,
                  ].slice(-40),
                }
              : current,
          );
        }
        // Action previews are intentionally held until the server completes the reply.
      },
      (failure) =>
        setError(
          failure instanceof Error
            ? failure.message
            : "The reply did not finish. Check your connection and retry.",
        ),
      () => {
        setBusy(false);
        void history.refetch();
      },
    );
  };
  const openAction = (action: ChatAction) => {
    if (!session.isCurrent()) return;
    switch (action.kind) {
      case "preferences":
      case "discovery":
      case "negotiation":
        onPlanning(action.kind, action.targetId, action.preferenceDraft);
        break;
      case "session":
        if (action.targetId)
          router.push({ pathname: "/session/[id]", params: { id: action.targetId } });
        break;
      case "workout":
        if (action.targetId)
          router.push({ pathname: "/workout/[id]", params: { id: action.targetId } });
        break;
      case "fitness":
        router.push("/fitness");
        break;
      case "workout_plan": {
        if (!action.workoutPlanDraft) return;
        const id = Crypto.randomUUID();
        storeGeneratedWorkoutPlanDraft(id, ownerId, action.workoutPlanDraft, session.isCurrent);
        router.push({ pathname: "/workout-plan/new", params: { draftId: id } });
        break;
      }
    }
  };
  const visible =
    history.error || control.busy || permissionsUnconfirmed ? [] : (history.data?.messages ?? []);
  const icons = {
    preferences: Settings2,
    discovery: Users,
    negotiation: Users,
    session: CalendarDays,
    workout: Activity,
    fitness: ClipboardList,
    workout_plan: ClipboardList,
  };
  return (
    <View style={{ gap: Spacing.three }}>
      {(history.isPending || history.error) && (
        <StateView
          loading={history.isPending}
          error={history.error}
          onRetry={() => void history.refetch()}
        />
      )}
      {permissionsUnconfirmed && !control.busy && (
        <>
          <Notice>
            Your privacy change could not be confirmed. Refresh permissions before continuing.
          </Notice>
          <Button
            label="Refresh permissions"
            variant="soft"
            onPress={() => {
              void control.run(
                async () => {
                  const result = await history.refetch();
                  if (result.error) throw result.error;
                  if (!result.data) throw new Error("Your permissions could not be refreshed.");
                },
                () => setPermissionsUnconfirmed(false),
              );
            }}
          />
        </>
      )}
      {settings && !settings.cloudEnabled && (
        <Notice>Coaching is off. You can change this in Privacy choices below.</Notice>
      )}
      {settings && !settings.providerAvailable && (
        <Notice>
          Coaching is unavailable right now. You can use on-device help below or open Plans.
        </Notice>
      )}
      {visible.map((message) => (
        <ChatBubble
          key={message.id}
          from={message.role === "user" ? "me" : "assistant"}
          source={message.role === "assistant" ? "SamePace" : undefined}
          streaming={message.status === "interrupted"}
          leading={
            message.role === "assistant" && message.status === "complete"
              ? message.actions.map((action) =>
                  action.kind === "workout_plan" && action.workoutPlanDraft ? (
                    <WorkoutPlanDraftCard
                      key={action.id}
                      draft={action.workoutPlanDraft}
                      onReview={() => openAction(action)}
                      busy={busy || control.busy}
                    />
                  ) : null,
                )
              : undefined
          }
          footer={
            <>
              {message.status === "interrupted" && (
                <T variant="caption" color="textSecondary">
                  Incomplete reply
                </T>
              )}
              {message.role === "assistant" &&
                message.status === "complete" &&
                message.actions.map((action) =>
                  action.kind === "workout_plan" && action.workoutPlanDraft ? null : (
                    <ActionCard
                      key={action.id}
                      icon={icons[action.kind]}
                      title={action.label}
                      facts={
                        action.preferenceDraft
                          ? [
                              ...(action.preferenceDraft.activity
                                ? [action.preferenceDraft.activity]
                                : []),
                              ...(action.preferenceDraft.durationMin
                                ? [`${action.preferenceDraft.durationMin} min`]
                                : []),
                            ]
                          : undefined
                      }
                      note={action.description}
                      primary={{ label: "Review", onPress: () => openAction(action) }}
                      busy={busy || control.busy}
                    />
                  ),
                )}
            </>
          }
        >
          {message.role === "assistant" &&
          message.status === "complete" &&
          message.actions.some(
            (action) => action.kind === "workout_plan" && action.workoutPlanDraft,
          ) ? (
            <CoachNotes text={message.text} />
          ) : (
            message.text || (message.status === "interrupted" ? "This reply was interrupted." : "")
          )}
        </ChatBubble>
      ))}
      {pendingUser &&
        !visible.some(
          (message) => message.role === "user" && message.requestId === pendingUser.requestId,
        ) && <ChatBubble from="me">{pendingUser.text}</ChatBubble>}
      {(busy || Boolean(partial)) && (
        <ChatBubble
          from="assistant"
          source="SamePace"
          streaming
          footer={
            !busy ? (
              <T variant="caption" color="textSecondary">
                Incomplete reply
              </T>
            ) : undefined
          }
        >
          {partial || <TypingDots />}
        </ChatBubble>
      )}
      {Boolean(error) && <Notice tone="danger">{error}</Notice>}
      {lastTurn && Boolean(error) && !busy && (
        <Button
          label="Retry reply"
          variant="soft"
          disabled={control.busy || !settings?.cloudEnabled || !settings.providerAvailable}
          onPress={() => send(lastTurn)}
        />
      )}
      {settings?.cloudEnabled && (
        <ComposerPortal>
          <ComposerRow onOptions={() => setShowOptions(true)}>
            <Composer
              value={text}
              onChangeText={(value) => setText(value.slice(0, 2000))}
              onSend={() => send()}
              onStop={stop}
              streaming={busy}
              placeholder="Ask your coach"
              disabled={
                busy || control.busy || !settings?.cloudEnabled || !settings.providerAvailable
              }
            />
          </ComposerRow>
        </ComposerPortal>
      )}
      <Sheet
        visible={showOptions}
        onClose={() => setShowOptions(false)}
        title="Chat options"
        subtitle="Privacy, clearing this chat, and switching to on-device help."
      >
        <ListCard>
          <ListRow
            icon={ShieldCheck}
            label="What your assistant can use"
            value={settings?.cloudEnabled ? "Cloud on" : "Cloud off"}
            onPress={() => {
              setShowOptions(false);
              router.push("/settings/privacy");
            }}
          />
          <ListRow
            icon={Trash2}
            label="Delete conversation"
            expanded={clearReview}
            onPress={() => {
              if (control.busy) return;
              if (runner.busy) stop();
              setClearReview((value) => !value);
            }}
          >
            <ActionCard
              icon={Trash2}
              title="Delete this conversation?"
              note="Removes saved private chat. Your workout logs and plans remain available."
              primary={{
                label: "Delete conversation",
                onPress: () => {
                  clearLocal();
                  void control.run(
                    (signal) =>
                      session.request<ChatHistory>("/assistant/chat", { method: "DELETE", signal }),
                    async (result) => {
                      await client.cancelQueries({ queryKey, exact: true });
                      if (session.isCurrent())
                        client.setQueryData<ChatHistory>(queryKey, {
                          ...result,
                          settings: readChatSettings(result.settings),
                        });
                    },
                  );
                },
              }}
              secondary={{ label: "Keep", onPress: () => setClearReview(false) }}
              busy={control.busy}
            />
          </ListRow>
          <ListRow
            icon={Smartphone}
            label="Use on-device help"
            value="Separate chat"
            onPress={onDevice}
          />
        </ListCard>
      </Sheet>
      {Boolean(control.error) && <Notice tone="danger">{control.error}</Notice>}
    </View>
  );
}
