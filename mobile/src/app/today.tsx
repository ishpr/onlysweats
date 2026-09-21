import { Screen, StateView } from "@/components/ui";
import { TodayDetail } from "@/components/today-card";
import { useMe } from "@/lib/queries";

/** The whole day, drawn: opened from the Today card on Home. */
export default function TodayRoute() {
  const me = useMe();
  return (
    <Screen>
      {me.data ? (
        <TodayDetail key={me.data.id} ownerId={me.data.id} />
      ) : (
        <StateView loading={me.isPending} error={me.error} onRetry={() => void me.refetch()} />
      )}
    </Screen>
  );
}
