/**
 * The Plan peek: approve from the conversation without leaving it. A half sheet over
 * the chat that draws the same body as the Plan screen, with the same one button. No
 * row here opens anything; "Open full plan" goes to the screen.
 */
import { useRouter } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { StyleSheet, View } from "react-native";

import { PressScale } from "@/components/motion";
import { PlanSummary } from "@/components/plan-summary";
import { Sheet } from "@/components/sheet";
import { useToast } from "@/components/toast";
import { Button, Notice, StateView, T } from "@/components/ui";
import { HitTarget, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import type { ApiSession } from "@/lib/api";
import { usePlanRoom } from "@/lib/plan-room";

export function PlanPeek({
  id,
  ownerId,
  session,
  visible,
  onClose,
}: {
  id: string;
  ownerId: string;
  session: ApiSession;
  visible: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const theme = useTheme();
  const toast = useToast();
  const plan = usePlanRoom(id, ownerId, session);
  const { value, next, buddy } = plan;
  const openFull = () => {
    onClose();
    router.push({ pathname: "/assistant/plan/[id]", params: { id } });
  };
  const press = async () => {
    if (!next) return;
    if (next.kind === "open-session") {
      onClose();
      return router.push({ pathname: "/session/[id]", params: { id: next.sessionId } });
    }
    if (next.kind === "find" || next.kind === "ended") return openFull();
    const receipt = await plan.act();
    if (receipt) {
      toast.show({ message: receipt });
      // The receipt is already in the thread as the sheet uncovers it.
      setTimeout(onClose, 450);
    }
  };
  const disabled =
    !next ||
    next.kind === "waiting" ||
    plan.busy ||
    ((next.kind === "approve" || next.kind === "book") && !plan.venueKnown);
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={value ? `Plan with ${buddy}` : "Plan"}
      footer={
        next ? (
          <Button
            variant="accent"
            label={next.label}
            loading={plan.busy}
            disabled={disabled}
            onPress={() => void press()}
          />
        ) : undefined
      }
    >
      {plan.room.isPending && <StateView loading rows={3} />}
      {plan.room.error && (
        <StateView error={plan.room.error} onRetry={() => void plan.room.refetch()} />
      )}
      {value && <PlanSummary plan={plan} ownerId={ownerId} />}
      {plan.error && <Notice tone="danger">{plan.error}</Notice>}
      {value && (
        <PressScale
          accessibilityRole="link"
          accessibilityLabel="Open full plan"
          onPress={openFull}
          style={styles.link}
        >
          <T variant="label" color="accent" style={styles.flex}>
            Open full plan
          </T>
          <ChevronRight size={18} color={theme.accent} />
        </PressScale>
      )}
      <View style={{ height: Spacing.one }} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  link: { flexDirection: "row", alignItems: "center", minHeight: HitTarget },
});
