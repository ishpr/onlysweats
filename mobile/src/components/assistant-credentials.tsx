import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, Field, Notice, T } from "@/components/ui";
import { usePrivateAction } from "@/hooks/use-private-action";
import { useNow } from "@/hooks/use-now";
import type { ApiSession } from "@/lib/api";
import { API_URL } from "@/lib/config";

type Delegation = { id: string; label: string; expiresAt: string; revokedAt: string | null };
type Issued = {
  id: string;
  label: string;
  token: string;
  expiresAt: string;
  scope: "workout:negotiate";
};

export function AssistantCredentials({
  session,
  ownerId,
}: {
  session: ApiSession;
  ownerId: string;
}) {
  const action = usePrivateAction(session);
  const now = useNow();
  const [label, setLabel] = useState("");
  const [hours, setHours] = useState("24");
  const [issued, setIssued] = useState<Issued | null>(null);
  const [expanded, setExpanded] = useState(false);
  const list = useQuery({
    queryKey: ["private-assistant", ownerId, "delegations"],
    gcTime: 0,
    retry: false,
    queryFn: ({ signal }) =>
      session.request<{ delegations: Delegation[] }>("/agents/delegations", { signal }),
  });
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state !== "active") setIssued(null);
    });
    return () => listener.remove();
  }, []);
  return (
    <Card>
      <T variant="heading">Connect an outside assistant</T>
      <T variant="caption" color="textSecondary">
        Optional. A connection can propose and counter workouts in conversations you both join. It
        cannot approve plans, book workouts, or read your health data.
      </T>
      <Button
        label={expanded ? "Hide connections" : "Manage assistant connections"}
        variant="soft"
        onPress={() => {
          setExpanded((value) => !value);
          setIssued(null);
        }}
      />
      {expanded && (
        <>
          <Field
            label="Assistant name"
            maxLength={80}
            value={label}
            onChangeText={setLabel}
            editable={!action.busy}
          />
          <Field
            label="Connection lifetime (1–24 hours)"
            value={hours}
            onChangeText={setHours}
            keyboardType="number-pad"
            editable={!action.busy}
          />
          <Button
            label="Create one-time credential"
            disabled={action.busy || !label.trim() || issued !== null}
            loading={action.busy}
            onPress={() =>
              void action.run(
                async (signal) => {
                  const expiresInHours = Number(hours);
                  if (
                    !Number.isInteger(expiresInHours) ||
                    expiresInHours < 1 ||
                    expiresInHours > 24
                  )
                    throw new Error("Choose a lifetime from 1 to 24 hours.");
                  return session.request<{ delegation: Issued }>("/agents/delegations", {
                    method: "POST",
                    json: { label, expiresInHours },
                    signal,
                  });
                },
                async ({ delegation }) => {
                  if (AppState.currentState === "active" || AppState.currentState === null)
                    setIssued(delegation);
                  setLabel("");
                  await list.refetch();
                },
              )
            }
          />
          {issued && (
            <>
              <Notice>
                Shown once. Copy this credential only into the assistant you trust. It is hidden
                when you leave the app and cannot be retrieved again.
              </Notice>
              <T selectable accessibilityLabel="One-time assistant credential">
                {issued.token}
              </T>
              <T variant="caption" color="textSecondary">
                Expires {new Date(issued.expiresAt).toLocaleString()}
              </T>
              <T variant="caption" selectable>
                Connection: {API_URL}/api/a2a · A2A 1.0
              </T>
              <Button
                label="I have saved it — hide credential"
                variant="soft"
                onPress={() => setIssued(null)}
              />
            </>
          )}
          {list.error && <Notice tone="danger">{list.error.message}</Notice>}
          {list.data?.delegations.length === 0 && (
            <Notice>No outside assistants are connected.</Notice>
          )}
          {list.data?.delegations.map((connection) => (
            <Card key={connection.id}>
              <T variant="label">{connection.label}</T>
              <T variant="caption" color="textSecondary">
                {connection.revokedAt
                  ? "Revoked"
                  : new Date(connection.expiresAt).getTime() <= now
                    ? "Expired"
                    : `Expires ${new Date(connection.expiresAt).toLocaleString()}`}
              </T>
              {!connection.revokedAt && new Date(connection.expiresAt).getTime() > now && (
                <Button
                  label={`Revoke ${connection.label}`}
                  variant="ghost"
                  disabled={action.busy}
                  onPress={() =>
                    void action.run(
                      (signal) =>
                        session.request(`/agents/delegations/${connection.id}`, {
                          method: "DELETE",
                          signal,
                        }),
                      async () => {
                        if (issued?.id === connection.id) setIssued(null);
                        await list.refetch();
                      },
                    )
                  }
                />
              )}
            </Card>
          ))}
          {action.error && <Notice tone="danger">{action.error}</Notice>}
        </>
      )}
    </Card>
  );
}
