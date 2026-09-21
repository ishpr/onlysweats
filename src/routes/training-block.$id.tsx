import { createFileRoute } from "@tanstack/react-router";
import { AppLinkHandoff } from "@/components/site/app-link-handoff";
export const Route = createFileRoute("/training-block/$id")({
  validateSearch: (search: Record<string, unknown>) => ({
    invite:
      typeof search.invite === "string" && /^[A-Za-z0-9_-]{4,64}$/.test(search.invite)
        ? search.invite
        : undefined,
  }),
  head: () => ({
    meta: [{ title: "Open training goal — SamePace" }, { name: "robots", content: "noindex" }],
  }),
  component: TrainingLink,
});
function TrainingLink() {
  return (
    <AppLinkHandoff
      kind="training-block"
      id={Route.useParams().id}
      invite={Route.useSearch().invite}
    />
  );
}
