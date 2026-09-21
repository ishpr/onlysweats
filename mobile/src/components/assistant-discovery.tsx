import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Button, Card, Chip, Notice, StateView, T } from "@/components/ui";
import { usePrivateAction } from "@/hooks/use-private-action";
import type { ApiSession } from "@/lib/api";
import { ACTIVITIES } from "@/lib/types";
import type { AssistantNegotiation, AssistantPreferences } from "../../../shared/assistant";
import { DISCOVERY_NOTICE, type MemberDiscovery } from "../../../shared/discovery";

export function AssistantDiscovery({
  ownerId,
  session,
  preferences,
  onInvited,
}: {
  ownerId: string;
  session: ApiSession;
  preferences: AssistantPreferences | null;
  onInvited: (room: AssistantNegotiation) => Promise<void>;
}) {
  const action = usePrivateAction(session);
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [womenOnly, setWomenOnly] = useState(false);
  const discovery = useQuery({
    queryKey: ["private-assistant", ownerId, "discovery", preferences?.revision],
    gcTime: 0,
    retry: false,
    queryFn: ({ signal }) =>
      session.request<{ discovery: MemberDiscovery }>("/agents/discovery", { signal }),
  });
  const value = discovery.error ? null : discovery.data?.discovery;
  const refresh = async () => {
    await discovery.refetch();
  };
  return (
    <Card>
      <T variant="heading">Meet a new workout buddy</T>
      <T variant="caption" color="textSecondary">
        Opt in to find members whose entered workout preferences fit yours. Inviting someone opens a
        planning request; they choose whether to join.
      </T>
      {(discovery.isPending || discovery.error) && (
        <StateView
          loading={discovery.isPending}
          error={discovery.error}
          onRetry={() => void refresh()}
        />
      )}
      {value && (
        <>
          {value.reason && <Notice>{value.reason}</Notice>}
          {/* Meeting someone new is a public meeting: the same checks as a public session. */}
          {value.needs && (
            <Button
              variant="accent"
              label={value.needs === "verify_government_id" ? "Verify your ID" : "Verify it’s you"}
              onPress={() =>
                router.push({
                  pathname: "/verify",
                  params: {
                    tier: value.needs === "verify_government_id" ? "government_id" : "member",
                  },
                })
              }
            />
          )}
          {value.enabled && value.womenOnly && (
            <T variant="caption" color="textSecondary">
              Women only: you’re shown only to women, and only shown women.
            </T>
          )}
          {value.enabled && value.expiresAt && (
            <T variant="caption" color="textSecondary">
              Discovery is on until {new Date(value.expiresAt).toLocaleString()}.
            </T>
          )}
          {!value.enabled && (
            <>
              <Button
                label={expanded ? "Hide discovery permissions" : "Review discovery permissions"}
                variant="soft"
                onPress={() => setExpanded((value) => !value)}
              />
              {expanded && (
                <>
                  <T variant="caption" color="textSecondary">
                    {DISCOVERY_NOTICE}
                  </T>
                  {!preferences?.enabled && (
                    <Notice>First save and share your entered planning preferences above.</Notice>
                  )}
                  {value.canChooseWomenOnly && (
                    <>
                      <Chip
                        label={womenOnly ? "✓ Women only" : "Women only"}
                        selected={womenOnly}
                        onPress={() => setWomenOnly(!womenOnly)}
                      />
                      <T variant="caption" color="textSecondary">
                        You’re shown only to women, and only shown women. Like a women-only session,
                        it asks for a government ID check once verification is on.
                      </T>
                    </>
                  )}
                  <Button
                    label="Allow buddy discovery for 7 days"
                    disabled={action.busy || !preferences?.enabled || !value.eligible}
                    onPress={() =>
                      void action.run(
                        (signal) =>
                          session.request("/agents/discovery", {
                            method: "PUT",
                            json: {
                              enabled: true,
                              preferenceRevision: preferences?.revision,
                              womenOnly: value.canChooseWomenOnly && womenOnly,
                            },
                            signal,
                          }),
                        refresh,
                      )
                    }
                  />
                </>
              )}
            </>
          )}
          {value.enabled && value.candidates.length === 0 && (
            <Notice>
              No compatible opted-in buddies are available right now. You can change your entered
              times or venues and enable discovery again.
            </Notice>
          )}
          {value.candidates.map((candidate) => (
            <Card key={candidate.memberId}>
              <T variant="label">{candidate.name}</T>
              <T variant="caption" color="textSecondary">
                {ACTIVITIES[candidate.activity].label} · {candidate.sharedVenueCount} shared public
                meeting {candidate.sharedVenueCount === 1 ? "place" : "places"}
              </T>
              <Button
                label={`Invite ${candidate.name} to plan`}
                variant="soft"
                disabled={action.busy || !value.enabled || !value.eligible || !preferences?.enabled}
                onPress={() =>
                  void action.run(
                    (signal) =>
                      session.request<{ negotiation: AssistantNegotiation }>(
                        "/agents/discovery/invitations",
                        {
                          method: "POST",
                          json: {
                            memberId: candidate.memberId,
                            preferenceRevision: preferences?.revision,
                          },
                          signal,
                        },
                      ),
                    async ({ negotiation }) => {
                      await onInvited(negotiation);
                      await refresh();
                    },
                  )
                }
              />
            </Card>
          ))}
        </>
      )}
      {(value?.enabled || discovery.error) && (
        <Button
          variant="ghost"
          label="Turn off buddy discovery"
          disabled={action.busy}
          onPress={() =>
            void action.run(
              (signal) =>
                session.request("/agents/discovery", {
                  method: "PUT",
                  json: { enabled: false },
                  signal,
                }),
              refresh,
            )
          }
        />
      )}
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </Card>
  );
}
