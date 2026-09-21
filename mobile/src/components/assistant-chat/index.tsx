import { useState } from "react";
import { View } from "react-native";
import { Button, Notice } from "@/components/ui";
import { Spacing } from "@/constants/theme";
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
  const [onDevice, setOnDevice] = useState(false);
  return (
    <View style={{ gap: Spacing.three }}>
      {capturePhoto && (
        <LocalDraftTools key="photo-entry" ownerId={ownerId} session={session} initiallyExpanded />
      )}
      {onDevice ? (
        <>
          <Notice>
            This separate conversation stays on your iPhone. Returning to coaching closes it; its
            messages and photos are never forwarded.
          </Notice>
          <Button label="Back to coaching" variant="soft" onPress={() => setOnDevice(false)} />
          <LocalChat session={session} onCloud={() => setOnDevice(false)} />
        </>
      ) : (
        <CloudChat
          ownerId={ownerId}
          session={session}
          onPlanning={onPlanning}
          onDevice={() => setOnDevice(true)}
        />
      )}
      {!capturePhoto && <LocalDraftTools ownerId={ownerId} session={session} />}
    </View>
  );
}
