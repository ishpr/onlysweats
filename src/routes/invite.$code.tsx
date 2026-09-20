import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { personById, venueById } from "@/lib/seed";
import { usePaceStore } from "@/lib/store";
import { When } from "@/components/when";

export const Route = createFileRoute("/invite/$code")({ component: Invite });

function Invite() {
  const { code } = Route.useParams();
  const sessions = usePaceStore((s) => s.sessions);
  const bookSeat = usePaceStore((s) => s.bookSeat);
  const session =
    sessions.find((s) => s.code === code && s.visibility === "unlisted") ??
    sessions.find((s) => s.id === "seed-invite");

  if (!session) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
        <p className="text-lg font-semibold">Invite expired</p>
        <Link to="/" className="mt-3 text-sm text-muted">
          Open Pace
        </Link>
      </div>
    );
  }

  const host = personById(session.hostId);
  const venue = venueById(session.venueId);

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
        Unlisted invite
      </p>
      <h1 className="mt-2 text-balance text-[32px] font-semibold tracking-tight">
        {host?.name.split(" ")[0]} opened a seat
      </h1>
      <p className="mt-3 text-pretty text-muted">
        {session.title} · <When iso={session.startAt} /> · {venue?.name}
      </p>
      <Button
        className="mt-8 w-full"
        onClick={() => {
          bookSeat(session.id);
        }}
      >
        Book the seat
      </Button>
      <Link to="/sessions/$id" params={{ id: session.id }} className="mt-4 text-center text-sm text-muted">
        View listing
      </Link>
    </div>
  );
}
