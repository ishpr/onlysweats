import { Link, useLocalSearchParams } from "expo-router";
import { View } from "react-native";

import { Button, Screen, StateView, T } from "@/components/ui";
import { formatWhen } from "@/lib/format";
import { byId } from "@/lib/lookup";
import { useInvite, useVenues } from "@/lib/queries";

export default function Invite() {
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
