import { createFileRoute } from "@tanstack/react-router";

/** The Pace JSON API. One catch-all route; dispatch lives in `http.server.ts`. */
async function handle({ request }: { request: Request }) {
  const { handleApi } = await import("@/lib/pace/http.server");
  return handleApi(request);
}

export const Route = createFileRoute("/api/v1/$")({
  server: {
    handlers: { GET: handle, POST: handle, PATCH: handle, DELETE: handle },
  },
});
