import { use, useState } from "react";
import { ClipboardList, SlidersHorizontal } from "lucide-react-native";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PrivateAssistantChat } from "@/components/assistant-chat";
import type { ChatPreferenceDraft } from "../../../shared/conversation";
import { ActionCard, Segmented } from "@/components/assistant-kit";
import { AssistantDiscovery } from "@/components/assistant-discovery";
import { AppHeader } from "@/components/brand";
import { ComposerDock } from "@/components/composer-dock";
import { PlanPeek } from "@/components/plan-peek";
import { AssistantPlacement } from "@/lib/assistant-placement";
import { AssistantHero, assistantStatus } from "@/components/assistant-hero";
import { ListCard, ListRow, SectionTitle } from "@/components/list";
import { AssistantPreferencesEditor } from "@/components/assistant-preferences";
import { PrivateMember, type PrivateMemberProps } from "@/components/private-member";
import { Button, Card, Notice, Screen, StateView, T } from "@/components/ui";
import { usePrivateAction } from "@/hooks/use-private-action";
import { ApiError } from "@/lib/api";
import { useRefreshOnFocus } from "@/lib/queries";
import { ACTIVITIES, type Booking, type Person, type Session, type Venue } from "@/lib/types";
import type { AgentMatching } from "../../../shared/agent-matching";
import type { AssistantNegotiation, AssistantPreferences } from "../../../shared/assistant";

type Mine = { bookings: Booking[]; sessions: Session[]; people: Person[] };

export default function AssistantRoute() {
  const { negotiationId } = useLocalSearchParams<{ negotiationId?: string }>();
  if (typeof negotiationId === "string" && negotiationId)
    return <Redirect href={{ pathname: "/assistant/plan/[id]", params: { id: negotiationId } }} />;
  return <PrivateMember component={Assistant} />;
}

function Assistant({ member, session }: PrivateMemberProps) {
  useRefreshOnFocus();
  const router = useRouter();
  const params = useLocalSearchParams<{
    negotiationId?: string;
    capture?: string;
    planning?: string;
  }>();
  const routeId = params.planning === "1" ? "planning" : null;
  const [pane, setPane] = useState({ routeId, planning: !!routeId });
  const showPlanning = pane.routeId === routeId ? pane.planning : !!routeId;
  const setShowPlanning = (planning: boolean) => setPane({ routeId, planning });
  const [preferenceDraft, setPreferenceDraft] = useState<ChatPreferenceDraft | undefined>(
    undefined,
  );
  const [draftRevision, setDraftRevision] = useState(0);
  const setSelected = (id: string) =>
    router.push({ pathname: "/assistant/plan/[id]", params: { id } });
  // "Review" on a chat card opens the plan as a peek over the thread, which stays mounted.
  const [peek, setPeek] = useState<string | null>(null);
  const [showPreferences, setShowPreferences] = useState(params.planning === "1");
  const action = usePrivateAction(session);
  const client = useQueryClient();
  const key = ["private-assistant", member.id];
  const preferences = useQuery({
    queryKey: [...key, "preferences"],
    gcTime: 0,
    retry: false,
    queryFn: ({ signal }) =>
      session.request<{ preferences: AssistantPreferences }>("/agents/preferences", { signal }),
  });
  const list = useQuery({
    queryKey: [...key, "negotiations"],
    gcTime: 0,
    retry: false,
    enabled: Boolean(preferences.data),
    refetchInterval: 10_000,
    queryFn: ({ signal }) =>
      session.request<{ negotiations: AssistantNegotiation[] }>("/agents/negotiations", { signal }),
  });
  // Same key as the discovery panel below, so the two share one request.
  const discovery = useQuery({
    queryKey: [...key, "matching"],
    gcTime: 0,
    retry: false,
    enabled: Boolean(preferences.data),
    queryFn: ({ signal }) =>
      session.request<{ matching: AgentMatching }>("/agents/matching", { signal }),
  });
  const mine = useQuery({
    queryKey: [...key, "completed-bookings"],
    gcTime: 0,
    retry: false,
    queryFn: ({ signal }) => session.request<Mine>("/bookings", { signal }),
  });
  const venues = useQuery({
    queryKey: [...key, "venues"],
    gcTime: 0,
    queryFn: ({ signal }) => session.request<{ venues: Venue[] }>("/venues", { signal }),
  });
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: key });
  };
  const partnerName = (ids: string[], names?: Record<string, string>) =>
    names?.[ids.find((id) => id !== member.id) ?? ""] ??
    mine.data?.people.find((person) => ids.includes(person.id) && person.id !== member.id)?.name ??
    "Your workout buddy";
  const unavailable = preferences.error instanceof ApiError && preferences.error.status === 404;
  const current = preferences.data?.preferences ?? null;
  const status = current
    ? assistantStatus(
        member.id,
        current,
        discovery.error ? null : (discovery.data?.matching ?? null),
        list.data?.negotiations ?? [],
      )
    : null;
  const brief =
    current && current.revision > 0
      ? [
          ACTIVITIES[current.activity].label,
          `${current.durationMin} min`,
          `${current.venueIds.length} ${current.venueIds.length === 1 ? "place" : "places"}`,
          `${current.availability.length} ${current.availability.length === 1 ? "time" : "times"}`,
        ]
      : [];
  const inTab = use(AssistantPlacement) === "tab";
  // The message box is pinned by the dock; the thread pads itself clear of it.
  const [dockHeight, setDockHeight] = useState(0);
  return (
    <>
      <Screen
        key={showPlanning ? "planning" : "chat"}
        header={inTab ? <AppHeader /> : undefined}
        contentStyle={dockHeight > 0 ? { paddingBottom: dockHeight + 120 } : undefined}
        onRefresh={() => void refresh()}
        refreshing={list.isRefetching}
      >
        {inTab ? null : <Stack.Screen options={{ title: "Assistant" }} />}
        {showPlanning && status && (
          <AssistantHero
            status={status}
            brief={brief}
            primaryLabel={
              status.negotiationId
                ? "Review the plan"
                : showPlanning && showPreferences
                  ? "Hide preferences"
                  : current?.enabled
                    ? "Review preferences"
                    : "Set up planning"
            }
            onPrimary={() => {
              setShowPlanning(true);
              if (status.negotiationId) setSelected(status.negotiationId);
              else setShowPreferences(showPlanning ? !showPreferences : true);
            }}
            onEditBrief={() => {
              setShowPlanning(true);
              setShowPreferences(true);
            }}
          />
        )}
        <Segmented
          label="Assistant view"
          options={[
            { value: "chat", label: "Chat" },
            { value: "plans", label: "Plans" },
          ]}
          value={showPlanning ? "plans" : "chat"}
          onChange={(value) => setShowPlanning(value === "plans")}
        />
        <ActionCard
          icon={ClipboardList}
          title="Build a workout together"
          note="Create a routine with AI or by hand, then share exercises, sets and instructions with your session."
          primary={{ label: "Workout plans", onPress: () => router.push("/workout-plans") }}
        />
        {!showPlanning && (
          <PrivateAssistantChat
            ownerId={member.id}
            session={session}
            capturePhoto={params.capture === "photo"}
            onPlanning={(kind, targetId, draft) => {
              if (kind === "negotiation" && targetId) return setPeek(targetId);
              setShowPlanning(true);
              if (kind === "preferences") {
                setShowPreferences(true);
                setPreferenceDraft(draft);
                setDraftRevision((value) => value + 1);
              }
            }}
          />
        )}
        {showPlanning && (
          <>
            {unavailable ? (
              <Notice>Workout planning isn’t available yet.</Notice>
            ) : (
              (preferences.isPending || preferences.error) && (
                <StateView
                  loading={preferences.isPending}
                  error={preferences.error}
                  onRetry={() => void preferences.refetch()}
                />
              )
            )}
            {preferences.data && (
              <>
                {venues.error && (
                  <StateView error={venues.error} onRetry={() => void venues.refetch()} />
                )}
                {showPreferences && (
                  <>
                    {venues.isPending && <StateView loading rows={2} />}
                    {venues.data && (
                      <AssistantPreferencesEditor
                        key={`${preferences.data.preferences.revision}:${draftRevision}`}
                        session={session}
                        initial={preferences.data.preferences}
                        venues={venues.data.venues}
                        abilities={member.abilities}
                        draft={preferenceDraft}
                        onSaved={async () => {
                          setPreferenceDraft(undefined);
                          await refresh();
                        }}
                      />
                    )}
                  </>
                )}
                {!list.error && (list.data?.negotiations.length ?? 0) > 0 && (
                  <SectionTitle>Plans in progress</SectionTitle>
                )}
                {list.error && <StateView error={list.error} onRetry={() => void list.refetch()} />}
                {!list.error &&
                  list.data?.negotiations.map((room) => (
                    <Card key={room.id}>
                      <T variant="label">{partnerName(room.memberIds, room.memberNames)}</T>
                      <T>{room.plan?.title ?? "A new workout plan"}</T>
                      <T variant="caption" color="textSecondary">
                        {room.booked
                          ? "Booked"
                          : room.state === "approved"
                            ? "Plan approved · booking terms still to accept"
                            : room.state === "open"
                              ? "Working it out"
                              : room.state === "cancelled"
                                ? "Cancelled"
                                : "Expired"}
                      </T>
                      <Button
                        label="Read agent conversation"
                        variant="soft"
                        onPress={() => setSelected(room.id)}
                      />
                    </Card>
                  ))}
                <SectionTitle>Find a new buddy</SectionTitle>
                <AssistantDiscovery
                  ownerId={member.id}
                  session={session}
                  preferences={preferences.error ? null : preferences.data.preferences}
                />
                {action.error && <Notice tone="danger">{action.error}</Notice>}
              </>
            )}
            {preferences.data && (
              <ListCard>
                <ListRow
                  icon={SlidersHorizontal}
                  label="Assistant settings"
                  detail="Pause, clear the conversation, outside assistants"
                  onPress={() => router.push("/settings/assistant")}
                />
              </ListCard>
            )}
          </>
        )}
      </Screen>
      <ComposerDock aboveTabBar={inTab} onHeight={setDockHeight} />
      {peek && (
        <PlanPeek
          id={peek}
          ownerId={member.id}
          session={session}
          visible
          onClose={() => setPeek(null)}
        />
      )}
    </>
  );
}
