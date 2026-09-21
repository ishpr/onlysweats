/**
 * One shape for every consequence: a sentence on what happens, the button that does it,
 * and a way back. Replaces inline "Card + Notice + two buttons" confirms and alert boxes.
 * If the action can be undone, don't confirm it at all — do it and offer Undo (see toast).
 */
import type { RefObject } from "react";
import type { View } from "react-native";

import { Sheet } from "@/components/sheet";
import { Button, Notice, T } from "@/components/ui";

export function ConfirmSheet({
  visible,
  onClose,
  title,
  body,
  confirm,
  cancelLabel = "Cancel",
  busy = false,
  error,
  returnFocusTo,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** What happens, and what doesn't. One or two sentences. */
  body: string;
  confirm: { label: string; onPress: () => void; danger?: boolean };
  cancelLabel?: string;
  busy?: boolean;
  error?: string | null;
  returnFocusTo?: RefObject<View | null>;
}) {
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={title}
      // While it is working the sheet can't be swiped away from under the request.
      locked={busy}
      returnFocusTo={returnFocusTo}
      footer={
        <>
          <Button
            variant={confirm.danger ? "danger" : "accent"}
            label={confirm.label}
            loading={busy}
            disabled={busy}
            onPress={confirm.onPress}
          />
          <Button variant="ghost" label={cancelLabel} disabled={busy} onPress={onClose} />
        </>
      }
    >
      <T color="textSecondary">{body}</T>
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </Sheet>
  );
}
