import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/.well-known/agent-card.json")({
  server: { handlers: { GET: async () => {
    const { enabled, agentCard } = await import("@/lib/agents/protocol.server");
    if (!enabled()) return new Response("Not found", { status: 404 });
    const { AgentCard } = await import("@a2a-js/sdk");
    return Response.json(AgentCard.toJSON(agentCard()), { headers: { "cache-control": "public, max-age=300" } });
  } } },
});
