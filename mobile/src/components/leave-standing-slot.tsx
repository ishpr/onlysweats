import { useState } from "react";

import { ConfirmSheet } from "@/components/confirm-sheet";
import { Button, Notice } from "@/components/ui";
import { useLeaveSeries } from "@/lib/queries";

/** Leaving ends the recurring commitment; skipping only releases one week. */
export function LeaveStandingSlot({ seriesId }: { seriesId: string }) {
  const leave = useLeaveSeries();
  const [asking, setAsking] = useState(false);
  return (
    <>
      {leave.error && !asking && <Notice tone="danger">{leave.error.message}</Notice>}
      <Button
        variant="ghost"
        label="Leave this weekly session"
        loading={leave.isPending}
        onPress={() => setAsking(true)}
      />
      <ConfirmSheet
        visible={asking}
        onClose={() => setAsking(false)}
        title="Leave this weekly session?"
        body="You’ll stop being added each week, and your upcoming sessions in it are cancelled at no cost. It ends if fewer than two people are left."
        confirm={{
          label: "Leave",
          danger: true,
          onPress: () => leave.mutate(seriesId, { onSettled: () => setAsking(false) }),
        }}
        cancelLabel="Keep my place"
        busy={leave.isPending}
      />
    </>
  );
}
