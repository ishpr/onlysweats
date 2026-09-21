import { useEffect, useMemo, useState } from "react";
import { Switch, View } from "react-native";
import { useRouter } from "expo-router";
import * as Crypto from "expo-crypto";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { Button, Card, Field, Notice, Row, StateView, T } from "@/components/ui";
import { usePrivateAction } from "@/hooks/use-private-action";
import type { ApiSession } from "@/lib/api";
import { createAssistantRun } from "@/lib/assistant/run";
import { createChatStreamParser, isChatMessage } from "@/lib/assistant/stream";
import {
  CHAT_CONSENT_NOTICE,
  CHAT_FITNESS_NOTICE,
  CHAT_NOTICE_VERSION,
  type ChatAction,
  type ChatEvent,
  type ChatHistory,
  type ChatMessage,
  type ChatSettings,
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
}: {
  ownerId: string;
  session: ApiSession;
  onPlanning: PlanningAction;
}) {
  const queryKey = ["private-assistant-chat", ownerId];
  const history = useQuery({
    queryKey,
    gcTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await session.request<ChatHistory>("/assistant/chat", { signal });
      if (
        !result?.settings ||
        !Array.isArray(result.messages) ||
        result.messages.length > 40 ||
        !result.messages.every(isChatMessage)
      )
        throw new Error("Your conversation could not be loaded. Please try again.");
      return result;
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
      history={history}
    />
  );
}

// Rotating consent/history generations unmounts all draft and retry state atomically.
function CloudConversation({
  ownerId,
  session,
  onPlanning,
  history,
}: {
  ownerId: string;
  session: ApiSession;
  onPlanning: PlanningAction;
  history: UseQueryResult<ChatHistory, Error>;
}) {
  const router = useRouter();
  const client = useQueryClient();
  const queryKey = ["private-assistant-chat", ownerId];
  const control = usePrivateAction(session);
  const runner = useMemo(() => createAssistantRun(session.isCurrent), [session]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [partial, setPartial] = useState("");
  const [pendingUser, setPendingUser] = useState<ChatMessage | null>(null);
  const [lastTurn, setLastTurn] = useState<ChatTurnInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clearReview, setClearReview] = useState(false);
  const [showPermissions, setShowPermissions] = useState(false);
  useEffect(() => () => runner.cancel(), [runner]);
  const settings = history.error ? null : history.data?.settings;
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
  const changePermissions = (cloudEnabled: boolean, fitnessContextEnabled: boolean) => {
    clearLocal();
    void control.run(
      (signal) =>
        session.request<{ settings: ChatSettings }>("/assistant/settings", {
          method: "PUT",
          signal,
          json: { cloudEnabled, fitnessContextEnabled, noticeVersion: CHAT_NOTICE_VERSION },
        }),
      async (result) => {
        await client.cancelQueries({ queryKey, exact: true });
        if (session.isCurrent())
          client.setQueryData<ChatHistory>(queryKey, { settings: result.settings, messages: [] });
      },
    );
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
    }
  };
  const visible = history.data?.messages ?? [];
  return (
    <View style={{ gap: 14 }}>
      <T color="textSecondary">
        Your private cloud conversation is separate from messages with other members. You review
        every action.
      </T>
      {(history.isPending || history.error) && (
        <StateView
          loading={history.isPending}
          error={history.error}
          onRetry={() => void history.refetch()}
        />
      )}
      {settings && (
        <Card>
          <Row style={{ justifyContent: "space-between" }}>
            <T variant="label">Cloud assistant {settings.cloudEnabled ? "on" : "off"}</T>
            <Switch
              accessibilityLabel="Allow cloud assistant"
              value={settings.cloudEnabled}
              disabled={control.busy}
              onValueChange={(enabled) =>
                changePermissions(enabled, enabled && settings.fitnessContextEnabled)
              }
            />
          </Row>
          {(!settings.cloudEnabled || showPermissions) && (
            <T variant="caption" color="textSecondary">
              {CHAT_CONSENT_NOTICE}
            </T>
          )}
          <Button
            label={showPermissions ? "Hide privacy choices" : "Review privacy choices"}
            variant="ghost"
            onPress={() => setShowPermissions((value) => !value)}
          />
          {showPermissions && (
            <>
              <T variant="caption" color="textSecondary">
                {CHAT_FITNESS_NOTICE}
              </T>
              <Row style={{ justifyContent: "space-between" }}>
                <T variant="label">Include recent workout summaries</T>
                <Switch
                  accessibilityLabel="Share recent fitness summaries with cloud assistant"
                  value={settings.fitnessContextEnabled}
                  disabled={control.busy || !settings.cloudEnabled}
                  onValueChange={(enabled) => changePermissions(true, enabled)}
                />
              </Row>
            </>
          )}
          {!settings.providerAvailable && (
            <Notice>
              The cloud assistant is not available right now. On-device help and your planning tools
              are still available.
            </Notice>
          )}
          {control.error && <Notice tone="danger">{control.error}</Notice>}
        </Card>
      )}
      {visible.map((message) => (
        <Card key={message.id}>
          <T variant="eyebrow">{message.role === "user" ? "You" : "SamePace · Cloud"}</T>
          <T selectable>
            {message.text ||
              (message.status === "interrupted" ? "This reply was interrupted." : "")}
          </T>
          {message.status === "interrupted" && (
            <T variant="caption" color="textSecondary">
              Incomplete reply
            </T>
          )}
          {message.role === "assistant" &&
            message.status === "complete" &&
            message.actions.map((action) => (
              <View key={action.id} style={{ gap: 5 }}>
                <T variant="caption" color="textSecondary">
                  {action.description}
                </T>
                <Button
                  label={action.label}
                  variant="soft"
                  disabled={busy || control.busy}
                  onPress={() => openAction(action)}
                />
              </View>
            ))}
        </Card>
      ))}
      {pendingUser &&
        !visible.some(
          (message) => message.role === "user" && message.requestId === pendingUser.requestId,
        ) && (
          <Card>
            <T variant="eyebrow">You</T>
            <T selectable>{pendingUser.text}</T>
          </Card>
        )}
      {(busy || partial) && (
        <Card>
          <T variant="eyebrow">SamePace · Cloud</T>
          <T selectable>{partial || "Thinking…"}</T>
          {!busy && (
            <T variant="caption" color="textSecondary">
              Incomplete reply
            </T>
          )}
        </Card>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      {lastTurn && error && !busy && (
        <Button
          label="Retry reply"
          variant="soft"
          disabled={control.busy || !settings?.cloudEnabled || !settings.providerAvailable}
          onPress={() => send(lastTurn)}
        />
      )}
      <Field
        label="Message your private assistant"
        placeholder="Help me plan an easy workout this week"
        value={text}
        onChangeText={setText}
        maxLength={2000}
        multiline
        editable={!busy && !control.busy}
      />
      {busy ? (
        <Button label="Stop reply" variant="soft" onPress={stop} />
      ) : (
        <Button
          label="Send to cloud assistant"
          disabled={
            !text.trim() || control.busy || !settings?.cloudEnabled || !settings.providerAvailable
          }
          onPress={() => send()}
        />
      )}
      <T variant="caption" color="textSecondary">
        Only messages sent here go to the cloud. On-device conversations and photos are not added.
      </T>
      {!clearReview ? (
        <Button
          label="Delete cloud conversation"
          variant="ghost"
          disabled={control.busy}
          onPress={() => {
            if (runner.busy) stop();
            setClearReview(true);
          }}
        />
      ) : (
        <Card>
          <Notice>
            Delete your saved private cloud conversation? Your workout logs and planning
            conversations remain available.
          </Notice>
          <Button
            label="Delete conversation"
            variant="danger"
            disabled={control.busy}
            onPress={() => {
              clearLocal();
              void control.run(
                (signal) =>
                  session.request<ChatHistory>("/assistant/chat", { method: "DELETE", signal }),
                async (result) => {
                  await client.cancelQueries({ queryKey, exact: true });
                  if (session.isCurrent()) client.setQueryData<ChatHistory>(queryKey, result);
                },
              );
            }}
          />
          <Button
            label="Keep conversation"
            variant="ghost"
            disabled={control.busy}
            onPress={() => setClearReview(false)}
          />
        </Card>
      )}
    </View>
  );
}
