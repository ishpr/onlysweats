import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import { EmptyState, Screen, StateView } from "@/components/ui";
import SignIn from "@/app/sign-in";
import { useAuth } from "@/lib/auth";
import { useInvite } from "@/lib/queries";

export default function Invite() {
  const { signedIn } = useAuth();
  // The route stays in the stack while authentication changes. Do not request
  // private invite details until the member has signed in.
  return signedIn ? <InviteDetails /> : <SignIn hasInvite />;
}

function InviteDetails() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const router = useRouter();
  const invite = useInvite(code);

  if (!invite.data) {
    return (
      <Screen edges={["bottom"]}>
        {invite.error ? (
          <EmptyState
            title="This invite isn’t open any more"
            body="It may have expired, or the session was cancelled. Ask whoever sent it for a new link."
            action={{ label: "Find a session", onPress: () => router.replace("/sessions") }}
          />
        ) : (
          <StateView loading />
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
