import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/.well-known/apple-app-site-association")({
  server: {
    handlers: {
      GET: async () => {
        const { appleAssociationResponse } = await import("@/lib/mobile-links/association.server");
        return appleAssociationResponse();
      },
    },
  },
});
