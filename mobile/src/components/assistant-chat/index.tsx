import { useState } from "react";
import { View } from "react-native";
import { Cloud, Smartphone } from "lucide-react-native";
import { Segmented } from "@/components/assistant-kit";
import { T } from "@/components/ui";
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
  const [mode, setMode] = useState<"local" | "cloud">("local");
  const modeControl = (
    <View style={{ gap: Spacing.one }}>
      <Segmented
        label="Where your assistant runs"
        options={[
          { value: "local", label: "On this iPhone", icon: Smartphone },
          { value: "cloud", label: "Cloud", icon: Cloud },
        ]}
        value={mode}
        onChange={setMode}
      />
      <T variant="caption" color="textSecondary">
        Switching closes this reply. Local text and photos stay out of cloud chat.
      </T>
    </View>
  );
  return (
    <View style={{ gap: Spacing.three }}>
      {capturePhoto && (
        <LocalDraftTools key="photo-entry" ownerId={ownerId} session={session} initiallyExpanded />
      )}
      {mode === "local" ? (
        <LocalChat session={session} onCloud={() => setMode("cloud")} modeControl={modeControl} />
      ) : (
        <CloudChat
          ownerId={ownerId}
          session={session}
          onPlanning={onPlanning}
          modeControl={modeControl}
        />
      )}
      {!capturePhoto && <LocalDraftTools ownerId={ownerId} session={session} />}
    </View>
  );
}
