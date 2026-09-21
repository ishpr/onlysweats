import { useState } from "react";
import { View } from "react-native";
import { Card, Chip, Row, T } from "@/components/ui";
import type { ApiSession } from "@/lib/api";
import { CloudChat, type PlanningAction } from "./cloud-chat";
import { LocalChat, LocalDraftTools } from "./local-chat";

export function PrivateAssistantChat({
  ownerId,
  session,
  onPlanning,
  capturePhoto = false,
}: {
  ownerId: string;
  session: ApiSession;
  onPlanning: PlanningAction;
  capturePhoto?: boolean;
}) {
  const [mode, setMode] = useState<"local" | "cloud">("local");
  return (
    <View style={{ gap: 16 }}>
      <Card>
        <T variant="heading">Your private assistant</T>
        <T color="textSecondary">
          Talk through your workout, review a draft or find the next step.
        </T>
        <Row>
          <Chip
            label="On this iPhone"
            selected={mode === "local"}
            onPress={() => setMode("local")}
          />
          <Chip
            label="Cloud assistant"
            selected={mode === "cloud"}
            onPress={() => setMode("cloud")}
          />
        </Row>
        <T variant="caption" color="textSecondary">
          Changing modes closes the current reply. Local text is never copied to the cloud
          conversation.
        </T>
      </Card>
      {capturePhoto && (
        <LocalDraftTools key="photo-entry" ownerId={ownerId} session={session} initiallyExpanded />
      )}
      {mode === "local" ? (
        <LocalChat session={session} onCloud={() => setMode("cloud")} />
      ) : (
        <CloudChat ownerId={ownerId} session={session} onPlanning={onPlanning} />
      )}
      {!capturePhoto && <LocalDraftTools ownerId={ownerId} session={session} />}
    </View>
  );
}
