import { Alert } from "react-native";

import { Button, Notice } from "@/components/ui";
import { useLeaveSeries } from "@/lib/queries";

/** Leaving ends the recurring commitment; skipping only releases one week. */
export function LeaveStandingSlot({ seriesId }: { seriesId: string }) {
  const leave = useLeaveSeries();
  return (
    <>
      {leave.error && <Notice tone="danger">{leave.error.message}</Notice>}
      <Button
        variant="ghost"
        label="Leave this weekly session"
        loading={leave.isPending}
        onPress={() =>
          Alert.alert(
            "Leave this weekly session?",
            "You’ll stop being added each week, and your upcoming sessions in it are cancelled at no cost. It ends if fewer than two people are left.",
            [
              { text: "Keep my place", style: "cancel" },
              {
                text: "Leave",
                style: "destructive",
                onPress: () => leave.mutate(seriesId),
              },
            ],
          )
        }
      />
    </>
  );
}
