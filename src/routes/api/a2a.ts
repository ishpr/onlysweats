import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/a2a")({
  server: { handlers: { POST: async ({ request }) => {
    const { enabled, handleA2A } = await import("@/lib/agents/protocol.server");
    if (!enabled()) return new Response("Not found", { status: 404 });
    const { getSql } = await import("@/lib/db");
    return handleA2A(request, await getSql());
  } } },
});
