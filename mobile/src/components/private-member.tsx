import { type ComponentType, useState } from "react";
import { Redirect } from "expo-router";
import { Notice, Screen, StateView } from "@/components/ui";
import { captureApiSession, type ApiSession } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useMe } from "@/lib/queries";
import type { Me } from "@/lib/types";

export type PrivateMemberProps = { member: Me; session: ApiSession };

/** Re-key private state when identity changes; never adopt a later account's token. */
export function PrivateMember({ component }: { component: ComponentType<PrivateMemberProps> }) {
  const { signedIn } = useAuth();
  if (signedIn === null) return null;
  if (!signedIn) return <Redirect href="/sign-in" />;
  return <Member component={component} />;
}

function Member({ component }: { component: ComponentType<PrivateMemberProps> }) {
  const me = useMe();
  if (!me.data)
    return (
      <Screen>
        <StateView loading={me.isPending} error={me.error} onRetry={() => void me.refetch()} />
      </Screen>
    );
  return <Captured key={me.data.id} member={me.data} component={component} />;
}

function Captured({
  member,
  component: Component,
}: {
  member: Me;
  component: ComponentType<PrivateMemberProps>;
}) {
  const [session] = useState(captureApiSession);
  if (!session)
    return (
      <Screen>
        <Notice>Sign in again to open your private information.</Notice>
      </Screen>
    );
  return <Component member={member} session={session} />;
}
