/**
 * Development only: every sheet behaviour and inline primitive on one page, so the
 * acceptance checks in the master plan (phase 1) can be run by hand. Presented as a
 * full-screen modal on purpose — it proves a Sheet works over that kind of route too.
 * Production builds redirect away.
 */
import { Redirect, useRouter } from "expo-router";
import { Bell, Flag, LogOut, Pencil, Share2 } from "lucide-react-native";
import { useRef, useState } from "react";
import { View } from "react-native";

import { ConfirmSheet } from "@/components/confirm-sheet";
import { ListCard, ListRow, SectionTitle } from "@/components/list";
import { OverflowMenu } from "@/components/overflow-menu";
import { PlanPeek } from "@/components/plan-peek";
import { Sheet } from "@/components/sheet";
import { SwipeRow } from "@/components/swipe-row";
import { useToast } from "@/components/toast";
import { captureApiSession } from "@/lib/api";
import { Button, Card, Field, Row, Screen, T } from "@/components/ui";

type Which = "compact" | "large" | "dirty" | "locked" | "confirm" | null;

export default function DevKit() {
  const router = useRouter();
  const toast = useToast();
  const [which, setWhich] = useState<Which>(null);
  const [note, setNote] = useState("");
  const [rows, setRows] = useState(["Bench press · 3 sets", "Squat · 5 sets", "Row · 4 sets"]);
  const [muted, setMuted] = useState(false);
  const [peekId, setPeekId] = useState<string | null>(null);
  const [session] = useState(captureApiSession);
  const opener = useRef<View>(null);
  if (!__DEV__) return <Redirect href="/" />;
  const close = () => setWhich(null);

  return (
    <Screen
      edges={["top", "bottom"]}
      footer={<Button variant="soft" label="Close the design kit" onPress={() => router.back()} />}
    >
      <Row>
        <View style={{ flex: 1 }}>
          <T variant="title">Design kit</T>
          <T variant="caption" color="textSecondary">
            Sheets and inline primitives. Development builds only.
          </T>
        </View>
        <OverflowMenu
          accessibilityLabel="Example options"
          items={[
            { icon: Pencil, label: "Edit", onPress: () => toast.show({ message: "Edit chosen" }) },
            {
              icon: Share2,
              label: "Share",
              onPress: () => toast.show({ message: "Share chosen" }),
            },
            {
              icon: Bell,
              label: "Mute",
              checked: muted,
              onPress: () => setMuted((value) => !value),
            },
            { icon: Flag, label: "Report", danger: true, onPress: () => setWhich("confirm") },
          ]}
        />
      </Row>

      <SectionTitle>Sheets</SectionTitle>
      <ListCard>
        <View ref={opener}>
          <ListRow label="Compact — hugs a few options" onPress={() => setWhich("compact")} />
        </View>
        <ListRow label="Large — half, full, half, close" onPress={() => setWhich("large")} />
        <ListRow label="Dirty — unsaved input refuses a swipe" onPress={() => setWhich("dirty")} />
        <ListRow label="Locked — must be answered" onPress={() => setWhich("locked")} />
        <ListRow label="Confirm — one consequence" onPress={() => setWhich("confirm")} />
      </ListCard>

      <SectionTitle>Plan (phase 3)</SectionTitle>
      <ListCard>
        <ListRow
          label="Plan screen — unknown id (error state)"
          onPress={() =>
            router.push({ pathname: "/assistant/plan/[id]", params: { id: "not-a-real-plan" } })
          }
        />
        <ListRow label="Plan peek — unknown id" onPress={() => setPeekId("not-a-real-plan")} />
      </ListCard>
      {peekId && session && (
        <PlanPeek
          id={peekId}
          ownerId="dev"
          session={session}
          visible
          onClose={() => setPeekId(null)}
        />
      )}

      <SectionTitle>Swipe to delete, with Undo</SectionTitle>
      {rows.map((row) => (
        <SwipeRow
          key={row}
          deleteLabel={`Delete ${row}`}
          onDelete={() => {
            const before = rows;
            setRows((current) => current.filter((item) => item !== row));
            toast.show({
              message: "Exercise deleted",
              actionLabel: "Undo",
              onAction: () => setRows(before),
            });
          }}
        >
          <Card>
            <T variant="label">{row}</T>
          </Card>
        </SwipeRow>
      ))}
      <Button
        variant="soft"
        label="Show a plain receipt"
        onPress={() => toast.show({ message: "You’re in. See you Tuesday at 6:00." })}
      />

      <Sheet
        visible={which === "compact"}
        onClose={close}
        title="Chat options"
        subtitle="A fixed panel: nothing to pull up to."
        returnFocusTo={opener}
      >
        <ListCard>
          <ListRow icon={Bell} label="Notifications" value="On" onPress={close} />
          <ListRow icon={LogOut} label="Leave this chat" onPress={close} />
        </ListCard>
      </Sheet>

      <Sheet
        visible={which === "large"}
        onClose={close}
        title="Your day"
        subtitle="Pull or scroll up to fill the screen; pull down to come back."
        footer={<Button variant="accent" label="Done" onPress={close} />}
      >
        {Array.from({ length: 14 }, (_, index) => (
          <Card key={index}>
            <T variant="label">Reading {index + 1}</T>
            <T variant="caption" color="textSecondary">
              Long content so the sheet has somewhere to go.
            </T>
          </Card>
        ))}
      </Sheet>

      <Sheet
        visible={which === "dirty"}
        onClose={() => {
          setNote("");
          close();
        }}
        title="Log an exercise"
        subtitle="Type something, then try to swipe it away."
        dirty={note.length > 0}
        keepMounted
        footer={
          <Button
            variant="accent"
            label="Save"
            disabled={note.length === 0}
            onPress={() => {
              setNote("");
              close();
              toast.show({ message: "Saved" });
            }}
          />
        }
      >
        <Field label="What did you do?" value={note} onChangeText={setNote} />
      </Sheet>

      <Sheet
        visible={which === "locked"}
        onClose={close}
        title="Sam wants to plan a run with you"
        subtitle="Nothing is shared until you join."
        locked
        footer={
          <>
            <Button variant="accent" label="Join" onPress={close} />
            <Button variant="ghost" label="Not this time" onPress={close} />
          </>
        }
      >
        <T color="textSecondary">This one has no Close and ignores swipes and taps outside.</T>
      </Sheet>

      <ConfirmSheet
        visible={which === "confirm"}
        onClose={close}
        title="Delete this workout?"
        body="Its sets and notes go with it. Your Apple Health records aren’t touched."
        confirm={{
          label: "Delete workout",
          danger: true,
          onPress: () => {
            close();
            toast.show({ message: "Workout deleted" });
          },
        }}
      />
    </Screen>
  );
}
