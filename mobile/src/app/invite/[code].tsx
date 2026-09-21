import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { PrivateMember, type PrivateMemberProps } from "@/components/private-member";
import { inviteStage, validInviteCode } from "@/lib/app-links";
import { ApiError } from "@/lib/api";
import type { Session } from "@/lib/types";

import { EmptyState, Screen, StateView } from "@/components/ui";
import SignIn from "@/app/sign-in";
import { useAuth } from "@/lib/auth";

export default function Invite() {
  const { signedIn } = useAuth();
  const { code } = useLocalSearchParams<{ code?: string | string[] }>();
  const stage = inviteStage(code, signedIn);
  if (stage === "invalid")
    return (
      <Screen>
        <EmptyState title="This invite isn’t valid" body="Ask whoever sent it for a new link." />
      </Screen>
    );
  if (stage === "loading")
    return (
      <Screen>
        <StateView loading />
      </Screen>
    );
  // The route stays in the stack while authentication changes. Do not request
  // private invite details until the member has signed in.
  return stage === "resolve" ? <PrivateMember component={InviteDetails} /> : <SignIn hasInvite />;
}

function InviteDetails({ member, session }: PrivateMemberProps) {
  const { code } = useLocalSearchParams<{ code: string }>();
  const router = useRouter();
  const invite = useQuery({
    queryKey: ["private-invite", member.id, code],
    gcTime: 0,
    enabled: Boolean(validInviteCode(code)),
    queryFn: ({ signal }) =>
      session.request<{ session: Session } | { trainingBlockId: string }>(
        `/invites/${encodeURIComponent(code)}`,
        { signal },
      ),
  });

  if (!invite.data || invite.error) {
    return (
      <Screen edges={["bottom"]}>
        {invite.error instanceof ApiError && [403, 404, 410].includes(invite.error.status) ? (
          <EmptyState
            title="This invite isn’t open any more"
            body="It may have expired, or the session was cancelled. Ask whoever sent it for a new link."
            action={{ label: "Find a session", onPress: () => router.replace("/sessions") }}
          />
        ) : (
          <StateView
            loading={invite.isPending}
            error={invite.error}
            onRetry={() => void invite.refetch()}
          />
        )}
      </Screen>
    );
  }
  // The same link shape opens an unlisted training block.
  if ("trainingBlockId" in invite.data) {
    return (
      <Redirect
        href={{
          pathname: "/training-block/[id]",
          params: { id: invite.data.trainingBlockId, invite: code },
        }}
      />
    );
  }
  // The invite is the key; the session page is where the decision gets made.
  return (
    <Redirect
      href={{ pathname: "/session/[id]", params: { id: invite.data.session.id, invite: code } }}
    />
  );
}
