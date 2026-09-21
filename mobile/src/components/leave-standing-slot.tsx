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
        label="Leave standing slot"
        loading={leave.isPending}
        onPress={() =>
          Alert.alert(
            "Leave this standing slot?",
            "You’ll stop being booked each week, and your upcoming seats are released at no charge. Sessions already started are unchanged. The slot ends if fewer than two regulars remain; otherwise the remaining regulars continue.",
            [
              { text: "Keep my place", style: "cancel" },
              {
                text: "Leave standing slot",
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
