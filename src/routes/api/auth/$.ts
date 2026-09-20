import { createFileRoute } from "@tanstack/react-router";

/**
 * Better Auth's own endpoints (`/api/auth/*`): sign-up, sign-in, sign-out,
 * get-session. The web client uses the session cookie; the React Native client
 * reads the `set-auth-token` response header and sends it back as
 * `Authorization: Bearer …` (the `bearer` plugin in `@/lib/auth/server`).
 */
async function handle({ request }: { request: Request }) {
  const { auth } = await import("@/lib/auth/server");
  return auth.handler(request);
}

export const Route = createFileRoute("/api/auth/$")({
  server: { handlers: { GET: handle, POST: handle } },
});
