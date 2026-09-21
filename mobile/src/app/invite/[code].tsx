import { Link, Redirect, useLocalSearchParams } from "expo-router";
import { View } from "react-native";

import { Button, Screen, StateView, T } from "@/components/ui";
import SignIn from "@/app/sign-in";
import { useAuth } from "@/lib/auth";
import { formatWhen } from "@/lib/format";
import { byId } from "@/lib/lookup";
import { useInvite, useVenues } from "@/lib/queries";

export default function Invite() {
  const { signedIn } = useAuth();
  // The route stays in the stack while authentication changes. Do not request
  // private invite details until the member has signed in.
  return signedIn ? <InviteDetails /> : <SignIn hasInvite />;
}

function InviteDetails() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const invite = useInvite(code);
  const venues = byId(useVenues().data);

  if (!invite.data) {
    return (
      <Screen edges={["bottom"]}>
        <StateView loading={invite.isPending} error={invite.error} />
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
  const { session, people } = invite.data;
  return (
    <Screen edges={["bottom"]}>
      <View>
        <T variant="eyebrow" color="textSecondary">
          Unlisted invite
        </T>
        <T variant="title">{people[0]?.name.split(" ")[0]} opened a seat</T>
        <T color="textSecondary">
          {session.title} · {formatWhen(session.startAt)} · {venues.get(session.venueId)?.name}
        </T>
      </View>
      <Link href={{ pathname: "/session/[id]", params: { id: session.id, invite: code } }} asChild>
        <Button label="See the listing" />
      </Link>
    </Screen>
  );
}
