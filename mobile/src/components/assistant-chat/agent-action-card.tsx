import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import * as Location from "expo-location";
import { Check, MapPin, Sparkles } from "lucide-react-native";
import { ActionCard } from "@/components/assistant-kit";
import { Button, Card, Field, Notice, Row, T } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useNow } from "@/hooks/use-now";
import { usePrivateAction } from "@/hooks/use-private-action";
import { useTheme } from "@/hooks/use-theme";
import type { ApiSession } from "@/lib/api";
import {
  agentActionQueryKeys,
  executeAgentAction,
  type AgentActionInteraction,
  type AgentActionResult,
} from "@/lib/assistant/agent-action";
import type { ChatAction, ChatSettings } from "../../../../shared/conversation";

/** Review text is inert. Only the saved server action ID can be executed. */
export function AgentActionCard({
  action,
  messageId,
  ownerId,
  session,
  settings,
  busy = false,
  onExecuted,
  onBusyChange,
}: {
  action: ChatAction;
  messageId: string;
  ownerId: string;
  session: ApiSession;
  settings: ChatSettings;
  busy?: boolean;
  onExecuted: (result: AgentActionResult) => void | Promise<void>;
  onBusyChange?: (busy: boolean) => void;
}) {
  const theme = useTheme();
  const client = useQueryClient();
  const control = usePrivateAction(session);
  const now = useNow();
  const [code, setCode] = useState("");
  const [executedReceipt, setReceipt] = useState<AgentActionResult["receipt"] | null>(null);
  const card = action.kind === "agent_card" ? action.card : undefined;
  if (!card) return null;
  const receipt = executedReceipt ?? card.receipt;
  const expired = now >= Date.parse(card.expiresAt);
  const disabled = busy || control.busy || expired || !!receipt || !session.isCurrent();
  const checkin = card.input === "checkin";

  const execute = (method?: "geo" | "code") => {
    if (disabled || !card.primaryLabel) return;
    onBusyChange?.(true);
    void control
      .run(
        async (signal) => {
          let interaction: AgentActionInteraction | undefined;
          const current = () => {
            if (signal.aborted || !session.isCurrent())
              throw new Error("Your conversation changed. Open it again to continue.");
          };
          if (checkin && method === "code") {
            interaction = { code };
          } else if (checkin) {
            const permission = await Location.requestForegroundPermissionsAsync();
            current();
            if (permission.status !== "granted")
              throw new Error("Location access is off. Enter your workout partner’s code instead.");
            const position = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.High,
            });
            current();
            if (
              !Number.isFinite(position.timestamp) ||
              Date.now() - position.timestamp > 60_000 ||
              position.timestamp - Date.now() > 5_000
            )
              throw new Error("A fresh location is unavailable. Try again or enter the code.");
            interaction = {
              geo: {
                lat: position.coords.latitude,
                lng: position.coords.longitude,
                ...(position.coords.accuracy == null
                  ? {}
                  : { accuracyM: position.coords.accuracy }),
              },
            };
          }
          current();
          return executeAgentAction(session, action, settings, signal, interaction);
        },
        async (result) => {
          // usePrivateAction also fences unmount, abort, duplicate taps and account changes.
          if (!session.isCurrent()) return;
          setCode("");
          setReceipt(result.receipt);
          await onExecuted(result);
          // A cache refresh failure must not turn a confirmed mutation into a failed action.
          void Promise.all(
            agentActionQueryKeys(ownerId).map((queryKey) => client.invalidateQueries({ queryKey })),
          ).catch(() => undefined);
        },
      )
      .finally(() => onBusyChange?.(false));
  };

  if (receipt || card.primaryLabel === null || expired) {
    return (
      <View testID={`agent-card-${messageId}-${action.id}`}>
        <Card>
          <Row>
            {receipt || card.kind === "receipt" ? (
              <Check size={18} color={theme.accent} />
            ) : (
              <Sparkles size={18} color={theme.accent} />
            )}
            <T variant="label">{card.title ?? action.label}</T>
          </Row>
          {receipt ? (
            <T>{receipt.text}</T>
          ) : (
            <>
              {card.facts.map((fact, index) => (
                <T key={`${index}-${fact}`} variant="caption">
                  {fact}
                </T>
              ))}
              {!!action.description && (
                <T variant="caption" color="textSecondary">
                  {action.description}
                </T>
              )}
            </>
          )}
          {expired && !receipt && card.primaryLabel !== null && (
            <T variant="caption" color="textSecondary">
              This review has expired. Ask your assistant to refresh it before continuing.
            </T>
          )}
        </Card>
      </View>
    );
  }

  return (
    <View style={styles.content} testID={`agent-card-${messageId}-${action.id}`}>
      <ActionCard
        icon={checkin ? MapPin : Sparkles}
        title={card.title ?? action.label}
        facts={card.facts}
        note={action.description}
        primary={{ label: card.primaryLabel, onPress: () => execute(checkin ? "geo" : undefined) }}
        busy={busy || control.busy}
      />
      {checkin && (
        <Card>
          <T variant="caption" color="textSecondary">
            Use your current location, or enter the four-digit code your workout partner shows you.
          </T>
          <Field
            label="Partner’s check-in code"
            value={code}
            onChangeText={(value) => setCode(value.replace(/\D/g, "").slice(0, 4))}
            keyboardType="number-pad"
            autoComplete="off"
            maxLength={4}
            editable={!disabled}
          />
          <Button
            label="Check in with code"
            onPress={() => execute("code")}
            disabled={disabled || !/^\d{4}$/.test(code)}
            loading={control.busy}
          />
        </Card>
      )}
      {control.error ? <Notice tone="danger">{control.error}</Notice> : null}
    </View>
  );
}

const styles = StyleSheet.create({ content: { gap: Spacing.one } });
