import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Button, Card, Chip, Notice, StateView, T } from "@/components/ui";
import { usePrivateAction } from "@/hooks/use-private-action";
import type { ApiSession } from "@/lib/api";
import type { AssistantPreferences } from "../../../shared/assistant";
import type { AgentMatching, AgentMatchingInput } from "../../../shared/agent-matching";

/** Matching status and privacy controls, not a separate AI activation step. */
export function AssistantDiscovery({
  ownerId,
  session,
  preferences,
}: {
  ownerId: string;
  session: ApiSession;
  preferences: AssistantPreferences | null;
}) {
  const action = usePrivateAction(session),
    router = useRouter(),
    client = useQueryClient();
  const key = ["private-assistant", ownerId];
  const matching = useQuery({
    queryKey: [...key, "matching"],
    gcTime: 0,
    retry: false,
    refetchInterval: 15000,
    queryFn: ({ signal }) =>
      session.request<{ matching: AgentMatching }>("/agents/matching", { signal }),
  });
  const value = matching.error ? null : matching.data?.matching;
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: key });
  };
  const update = (input: AgentMatchingInput) =>
    void action.run(
      (signal) => session.request("/agents/matching", { method: "PUT", json: input, signal }),
      refresh,
    );
  return (
    <Card>
      <T variant="heading">Workout matching</T>
      <T variant="caption" color="textSecondary">
        Using the workout level, times and public meeting places you entered, your agent contacts
        compatible members’ agents and works out a proposal. You both approve before booking.
      </T>
      {(matching.isPending || matching.error) && (
        <StateView
          loading={matching.isPending}
          error={matching.error}
          onRetry={() => void matching.refetch()}
        />
      )}
      {value && (
        <>
          <T variant="label">
            {!value.enabled
              ? "Matching paused"
              : value.ready
                ? "Matching is on"
                : "Planning preferences need attention"}
          </T>
          {value.reason && <Notice>{value.reason}</Notice>}
          {value.lastCheckedAt && (
            <T variant="caption" color="textSecondary">
              Last checked {new Date(value.lastCheckedAt).toLocaleString()}.
            </T>
          )}
          {(value.needs === "verify_member" || value.needs === "verify_government_id") && (
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
          <Button
            variant="soft"
            label="Review my times and preferences"
            onPress={() => router.push("/assistant?planning=1")}
          />
          {value.canChooseWomenOnly && (
            <>
              <Chip
                label={value.womenOnly ? "✓ Women only" : "Women only"}
                selected={value.womenOnly}
                disabled={action.busy}
                onPress={() => update({ enabled: value.enabled, womenOnly: !value.womenOnly })}
              />
              <T variant="caption" color="textSecondary">
                Match only with women. The same verification requirements as a women-only public
                session apply.
              </T>
            </>
          )}
          <Button
            variant="ghost"
            label={value.enabled ? "Pause matching" : "Resume matching"}
            disabled={action.busy}
            onPress={() => update({ enabled: !value.enabled })}
          />
          {value.enabled && value.ready && preferences?.enabled && (
            <Button
              variant="ghost"
              label="Check for matches now"
              loading={action.busy}
              onPress={() =>
                void action.run(
                  (signal) =>
                    session.request("/agents/matching/check", { method: "POST", json: {}, signal }),
                  refresh,
                )
              }
            />
          )}
        </>
      )}
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </Card>
  );
}
