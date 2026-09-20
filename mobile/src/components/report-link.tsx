import { useRouter } from "expo-router";

import { Button } from "@/components/ui";

/**
 * The way into report + block, wherever another member appears. It names the
 * context — a report always says which session it is about.
 */
export function ReportLink({
  memberId,
  name,
  sessionId,
  bookingId,
}: {
  memberId: string;
  name: string;
  sessionId?: string;
  bookingId?: string;
}) {
  const router = useRouter();
  // Not `<Link asChild>`: it drops a Pressable's function style, and with it the button.
  return (
    <Button
      variant="ghost"
      label={`Report or block ${name}`}
      onPress={() =>
        router.push({
          pathname: "/report",
          params: { memberId, name, sessionId: sessionId ?? "", bookingId: bookingId ?? "" },
        })
      }
    />
  );
}
