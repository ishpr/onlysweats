import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Camera, ShieldCheck, Trash2 } from "lucide-react-native";
import { ChatBubble, Composer, TypingDots } from "@/components/assistant-kit";
import { ListCard, ListRow, SectionTitle } from "@/components/list";
import { Spacing } from "@/constants/theme";
import { Button, Card, Field, Notice, Row, T } from "@/components/ui";
import type { ApiSession } from "@/lib/api";
import { createAssistantRun } from "@/lib/assistant/run";
import {
  getIntelligenceCapability,
  respond,
  draftText,
  draftPhoto,
  intelligenceReason,
  LOCAL_AI_NOTICE,
  type IntelligenceCapability,
  type IntelligenceHistory,
  type LocalDraftResult,
  type LocalTextResult,
} from "@/lib/intelligence";
import { DraftReview, type ReviewableWorkoutDraft } from "./draft-review";

export function useLocalCapability(session: ApiSession) {
  const [capability, setCapability] = useState<IntelligenceCapability | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    void getIntelligenceCapability()
      .then((value) => {
        if (active && session.isCurrent()) setCapability(value);
      })
      .catch(() => {
        if (active && session.isCurrent())
          setCapability({
            available: false,
            reason: null,
            photoTextRecognition: false,
            planDrafting: false,
            execution: "on_device",
          });
      });
    return () => {
      active = false;
    };
  }, [revision, session]);
  return { capability, refresh: () => setRevision((value) => value + 1) };
}

export function LocalChat({ session, onCloud }: { session: ApiSession; onCloud: () => void }) {
  const router = useRouter();
  const { capability, refresh } = useLocalCapability(session);
  const [history, setHistory] = useState<IntelligenceHistory[]>([]);
  const [text, setText] = useState("");
  const [partial, setPartial] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [lastText, setLastText] = useState<string | null>(null);
  const runner = useMemo(() => createAssistantRun(session.isCurrent), [session]);
  useEffect(() => () => runner.cancel(), [runner]);
  const stop = () => {
    runner.cancel();
    setBusy(false);
    setPartial("");
    setError("Local reply stopped. You can try again.");
  };
  const send = (retry?: string) => {
    const input = (retry ?? text).trim();
    if (
      !input ||
      input.length > 1000 ||
      runner.busy ||
      !capability?.available ||
      !session.isCurrent()
    )
      return;
    const contextHistory =
      retry && history.at(-1)?.role === "user" && history.at(-1)?.text === input
        ? history.slice(0, -1)
        : history;
    const context = contextHistory
      .slice(-4)
      .map((item) => ({ ...item, text: item.text.slice(0, 1000) }));
    if (!retry)
      setHistory((items) => [...items, { role: "user" as const, text: input }].slice(-40));
    setText("");
    setLastText(input);
    setPartial("");
    setBusy(true);
    setError(null);
    void runner.start<{ partial: string } | LocalTextResult>(
      async (signal, publish) => {
        const result = await respond(input, context, {
          signal,
          onPartial: (value) => publish({ partial: value }),
        });
        publish(result);
      },
      (result) => {
        if ("partial" in result) {
          setPartial(result.partial);
          return;
        }
        setPartial("");
        if (result.status === "available") {
          setHistory((items) =>
            [...items, { role: "assistant" as const, text: result.text }].slice(-40),
          );
          setLastText(null);
        } else setError(intelligenceReason(result.reason));
      },
      () => {
        setPartial("");
        setError("The local reply did not finish. Try again or continue manually.");
      },
      () => setBusy(false),
    );
  };
  return (
    <View style={{ gap: Spacing.three }}>
      {!capability && <TypingDots label="Checking on-device availability" />}
      {capability && !capability.available && (
        <Card>
          <Notice>{intelligenceReason(capability.reason)}</Notice>
          <Button label="Check availability again" variant="soft" onPress={refresh} />
          <Button label="Back to coaching" variant="soft" onPress={onCloud} />
          <Button
            label="Log an exercise manually"
            variant="ghost"
            onPress={() => router.push("/fitness")}
          />
        </Card>
      )}
      {history.map((message, index) => (
        <ChatBubble
          key={index}
          from={message.role === "user" ? "me" : "assistant"}
          source={message.role === "assistant" ? "On this iPhone" : undefined}
        >
          {message.text}
        </ChatBubble>
      ))}
      {busy && (
        <ChatBubble from="assistant" source="On this iPhone">
          {partial ? <T selectable>{partial}</T> : <TypingDots />}
        </ChatBubble>
      )}
      {Boolean(error) && <Notice tone="danger">{error}</Notice>}
      {Boolean(error) && lastText !== null && lastText.length > 0 && !busy && (
        <Button label="Retry on this iPhone" variant="soft" onPress={() => send(lastText)} />
      )}
      <Composer
        value={text}
        onChangeText={(value) => setText(value.slice(0, 1000))}
        onSend={() => send()}
        onStop={stop}
        streaming={busy}
        placeholder="Ask on this iPhone"
        disabled={busy || !capability?.available}
      />
      <SectionTitle>Controls</SectionTitle>
      <ListCard>
        <ListRow
          icon={ShieldCheck}
          label="On-device privacy"
          value="Private"
          expanded={showPrivacy}
          onPress={() => setShowPrivacy((value) => !value)}
        >
          <View style={{ gap: Spacing.one }}>
            <T variant="caption" color="textSecondary">
              {LOCAL_AI_NOTICE}
            </T>
            <T variant="caption" color="textSecondary">
              This conversation is kept only while this view is open. It cannot see saved workouts,
              contact members or make bookings.
            </T>
          </View>
        </ListRow>
        <ListRow
          icon={Trash2}
          label="Clear on-device conversation"
          onPress={() => {
            runner.cancel();
            setBusy(false);
            setHistory([]);
            setPartial("");
            setText("");
            setError(null);
            setLastText(null);
          }}
        />
      </ListCard>
    </View>
  );
}

export function LocalDraftTools({
  ownerId,
  session,
  initiallyExpanded = false,
}: {
  ownerId: string;
  session: ApiSession;
  initiallyExpanded?: boolean;
}) {
  const { capability } = useLocalCapability(session);
  const runner = useMemo(() => createAssistantRun(session.isCurrent), [session]);
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ReviewableWorkoutDraft | null>(null);
  const [draftRevision, setDraftRevision] = useState(0);
  const [rawOnly, setRawOnly] = useState(false);
  useEffect(() => () => runner.cancel(), [runner]);
  const run = (kind: "text" | "photo" | "camera") => {
    if (runner.busy || !session.isCurrent()) return;
    setBusy(true);
    setError(null);
    setDraft(null);
    setRawOnly(false);
    void runner.start<LocalDraftResult>(
      async (signal, publish) => {
        if (kind === "text") {
          publish(await draftText(note, { signal }));
          return;
        }
        if (kind === "camera") {
          const permission = await ImagePicker.requestCameraPermissionsAsync();
          if (!permission.granted)
            throw new Error(
              "Camera permission is needed to take a workout photo. You can choose an existing picture instead.",
            );
        }
        if (signal.aborted || !session.isCurrent()) return;
        const options: ImagePicker.ImagePickerOptions = {
          mediaTypes: ["images"],
          allowsEditing: false,
          quality: 0.8,
          base64: false,
          exif: false,
        };
        const picked =
          kind === "camera"
            ? await ImagePicker.launchCameraAsync(options)
            : await ImagePicker.launchImageLibraryAsync(options);
        if (picked.canceled || signal.aborted || !session.isCurrent()) return;
        const asset = picked.assets[0];
        if (!asset || (asset.fileSize && asset.fileSize > 25 * 1024 * 1024))
          throw new Error("Choose a picture smaller than 25 MB.");
        publish(await draftPhoto(asset.uri, { signal }));
      },
      (result) => {
        if (result.status === "available") {
          setDraft(result.draft);
          setDraftRevision((value) => value + 1);
          setRawOnly(!result.modelUsed);
        } else setError(intelligenceReason(result.reason));
      },
      (failure) =>
        setError(
          failure instanceof Error ? failure.message : "The draft did not finish. Try again.",
        ),
      () => setBusy(false),
    );
  };
  return (
    <View style={{ gap: Spacing.two }}>
      <ListCard>
        <ListRow
          icon={Camera}
          label="Draft from a note or photo"
          detail="Processed on this iPhone"
          expanded={expanded}
          onPress={() => setExpanded((value) => !value)}
        />
      </ListCard>
      {expanded && (
        <Card>
          <T variant="heading">A draft you can check</T>
          <T variant="caption" color="textSecondary">
            Photos and notes entered here are processed on this iPhone. Photos are never uploaded to
            the cloud assistant.
          </T>
          <Field
            label="Workout note for a local draft"
            placeholder="Squats: 3 sets of 8 at 40 kg"
            value={note}
            onChangeText={setNote}
            maxLength={1000}
            multiline
            editable={!busy}
          />
          <Button
            label="Prepare local draft"
            variant="soft"
            disabled={busy || !note.trim() || !capability?.available}
            onPress={() => run("text")}
          />
          <Row style={{ flexWrap: "wrap" }}>
            <Button
              label="Choose workout photo"
              variant="soft"
              disabled={busy || !capability?.photoTextRecognition}
              onPress={() => run("photo")}
            />
            <Button
              label="Take workout photo"
              variant="soft"
              disabled={busy || !capability?.photoTextRecognition}
              onPress={() => run("camera")}
            />
          </Row>
          {capability && !capability.available && (
            <Notice>
              {intelligenceReason(capability.reason)}
              {capability.photoTextRecognition
                ? " Photo text recognition is still available on this device."
                : ""}
            </Notice>
          )}
          {busy && (
            <Button
              label="Cancel draft"
              variant="ghost"
              onPress={() => {
                runner.cancel();
                setBusy(false);
                setDraft(null);
              }}
            />
          )}
          {Boolean(error) && <Notice tone="danger">{error}</Notice>}
          {rawOnly && (
            <Notice>
              The photo text was read locally. The language model is unavailable, so exercise fields
              were left blank for you.
            </Notice>
          )}
        </Card>
      )}
      {draft && (
        <DraftReview
          key={draftRevision}
          draft={draft}
          ownerId={ownerId}
          session={session}
          onDismiss={() => {
            setDraft(null);
            setRawOnly(false);
          }}
        />
      )}
    </View>
  );
}
