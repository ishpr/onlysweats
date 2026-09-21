import { Redirect, type Href, useLocalSearchParams } from "expo-router";
import SignIn from "@/app/sign-in";
import { EmptyState, Screen, StateView } from "@/components/ui";
import { PrivateMember, type PrivateMemberProps } from "@/components/private-member";
import { useAuth } from "@/lib/auth";
import { appLinkTarget } from "@/lib/app-links";

function useDestination() {
  const { target } = useLocalSearchParams<{ target?: string | string[] }>();
  return typeof target === "string" && target.startsWith("/") && !target.startsWith("//")
    ? appLinkTarget(target)
    : null;
}

/** Hold the destination until /me validates the token, including expired-token launches. */
export default function OpenAppLink() {
  const destination = useDestination();
  const { signedIn } = useAuth();
  if (!destination)
    return (
      <Screen>
        <EmptyState title="This link isn’t valid" body="Ask the sender for a new SamePace link." />
      </Screen>
    );
  if (signedIn === null)
    return (
      <Screen>
        <StateView loading />
      </Screen>
    );
  if (!signedIn) return <SignIn hasPendingLink />;
  return <PrivateMember component={ContinueAppLink} />;
}

function ContinueAppLink({ session }: PrivateMemberProps) {
  const destination = useDestination();
  if (!destination || !session.isCurrent()) return null;
  return <Redirect href={destination as Href} />;
}
