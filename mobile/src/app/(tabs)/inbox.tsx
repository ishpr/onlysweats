import { Link, useRouter } from "expo-router";
import { MessageCircle } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Enter } from "@/components/motion";
import { AppHeader } from "@/components/brand";
import { AssistantDiscovery } from "@/components/assistant-discovery";
import { PrivateMember, type PrivateMemberProps } from "@/components/private-member";
import { Avatar, Button, Card, EmptyState, Row, Screen, StateView, T } from "@/components/ui";
import { formatWhen } from "@/lib/format";
import { byId } from "@/lib/lookup";
import { useRefreshOnFocus } from "@/lib/queries";
import type { Booking, Person, Session } from "@/lib/types";
import type { AssistantNegotiation, AssistantPreferences } from "../../../../shared/assistant";

type Mine = { bookings: Booking[]; people: Person[]; sessions: Session[] };
export default function InboxRoute() {
  return <PrivateMember component={Inbox} />;
}
function Inbox({ member, session }: PrivateMemberProps) {
  useRefreshOnFocus();
  const router = useRouter(),
    client = useQueryClient();
  const [showHistory, setShowHistory] = useState(false);
  const key = ["private-assistant", member.id];
  const rooms = useQuery({
    queryKey: [...key, "negotiations"],
    gcTime: 0,
    retry: false,
    refetchInterval: 5000,
    queryFn: ({ signal }) =>
      session.request<{ negotiations: AssistantNegotiation[] }>("/agents/negotiations", { signal }),
  });
  const preferences = useQuery({
    queryKey: [...key, "preferences"],
    gcTime: 0,
    retry: false,
    queryFn: ({ signal }) =>
      session.request<{ preferences: AssistantPreferences }>("/agents/preferences", { signal }),
  });
  const mine = useQuery({
    queryKey: [...key, "legacy-bookings"],
    gcTime: 0,
    retry: false,
    enabled: showHistory,
    queryFn: ({ signal }) => session.request<Mine>("/bookings", { signal }),
  });
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: key });
  };
  const sessions = byId(mine.data?.sessions),
    people = byId(mine.data?.people);
  return (
    <Screen
      hidesTabBar
      header={<AppHeader />}
      onRefresh={() => void refresh()}
      refreshing={rooms.isRefetching}
    >
      <View>
        <T variant="title">Chats</T>
        <T variant="caption" color="textSecondary">
          Your agents find workout partners and work out the details here. Read along, then approve
          the plan and booking terms yourself.
        </T>
      </View>
      <AssistantDiscovery
        ownerId={member.id}
        session={session}
        preferences={preferences.data?.preferences ?? null}
      />
      {(rooms.isPending || rooms.error) && (
        <StateView
          loading={rooms.isPending}
          error={rooms.error}
          onRetry={() => void rooms.refetch()}
        />
      )}
      {!rooms.isPending && !rooms.error && !rooms.data?.negotiations.length && (
        <EmptyState
          icon={MessageCircle}
          title="No agent conversations yet"
          body="Your assistant will start a conversation when it finds a compatible partner. Keep your times and meeting places up to date."
          action={{
            label: "Review planning preferences",
            onPress: () => router.push("/assistant?planning=1"),
          }}
        />
      )}
      {!rooms.error &&
        rooms.data?.negotiations.map((room, index) => {
          const otherId = room.memberIds.find((id) => id !== member.id) ?? "";
          const name = room.memberNames?.[otherId] ?? "Your workout buddy";
          const status = room.booked
            ? "Booked"
            : room.state === "cancelled"
              ? "Ended"
              : room.state === "expired"
                ? "Expired"
                : room.state === "approved"
                  ? "Review booking terms"
                  : room.plan
                    ? "Review proposal"
                    : "Planning";
          return (
            <Enter key={room.id} index={index}>
              <Link href={{ pathname: "/assistant/plan/[id]", params: { id: room.id } }} asChild>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Your assistant and ${name}’s assistant. ${status}`}
                >
                  <Card>
                    <Row>
                      <Avatar
                        initials={name
                          .split(/\s+/)
                          .slice(0, 2)
                          .map((part) => part[0])
                          .join("")}
                      />
                      <View style={styles.flex}>
                        <T variant="label">With {name}’s assistant</T>
                        <T variant="caption" color="textSecondary">
                          {room.plan?.title ?? "Finding a workout together"}
                        </T>
                      </View>
                      <T variant="caption" color="accent">
                        {status}
                      </T>
                    </Row>
                  </Card>
                </Pressable>
              </Link>
            </Enter>
          );
        })}
      <Button
        variant="ghost"
        label={showHistory ? "Hide session history" : "Previous session history"}
        onPress={() => setShowHistory((value) => !value)}
      />
      {showHistory && (
        <>
          <T variant="caption" color="textSecondary">
            Read-only history of previous member messages and session notes. These were not agent
            conversations.
          </T>
          {(mine.isPending || mine.error) && (
            <StateView
              loading={mine.isPending}
              error={mine.error}
              onRetry={() => void mine.refetch()}
            />
          )}
          {!mine.error &&
            mine.data?.bookings.map((booking) => {
              const workout = sessions.get(booking.sessionId);
              const other = people.get(
                booking.hostId === member.id ? booking.participantId : booking.hostId,
              );
              return (
                <Link
                  key={booking.id}
                  href={{ pathname: "/thread/[id]", params: { id: booking.id } }}
                  asChild
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Session history with ${other?.name ?? "your buddy"}`}
                  >
                    <Card>
                      <T variant="label">{other?.name ?? "Your buddy"}</T>
                      <T variant="caption" color="textSecondary">
                        {workout?.title}
                        {workout ? ` · ${formatWhen(workout.startAt)}` : ""}
                      </T>
                    </Card>
                  </Pressable>
                </Link>
              );
            })}
        </>
      )}
    </Screen>
  );
}
const styles = StyleSheet.create({ flex: { flex: 1 } });
