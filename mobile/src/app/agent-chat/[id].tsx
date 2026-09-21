import { useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AgentConversation } from "@/components/agent-conversation";
import { PrivateMember, type PrivateMemberProps } from "@/components/private-member";
import { Screen, StateView } from "@/components/ui";
import { useRefreshOnFocus } from "@/lib/queries";
import type { Venue } from "@/lib/types";

export default function AgentChatRoute() {
  return <PrivateMember component={AgentChat} />;
}

function AgentChat({ member, session }: PrivateMemberProps) {
  useRefreshOnFocus();
  const { id } = useLocalSearchParams<{ id: string }>();
  const client = useQueryClient();
  const venues = useQuery({
    queryKey: ["private-assistant", member.id, "venues"],
    gcTime: 0,
    retry: false,
    queryFn: ({ signal }) => session.request<{ venues: Venue[] }>("/venues", { signal }),
  });
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["private-assistant", member.id] });
  };
  return (
    <Screen onRefresh={() => void refresh()}>
      {venues.error && <StateView error={venues.error} onRetry={() => void venues.refetch()} />}
      <AgentConversation
        key={id}
        id={id}
        ownerId={member.id}
        session={session}
        venues={venues.error ? [] : (venues.data?.venues ?? [])}
        people={[]}
        onChange={refresh}
      />
    </Screen>
  );
}
