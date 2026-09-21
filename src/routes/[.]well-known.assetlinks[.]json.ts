import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/.well-known/assetlinks.json")({
  server: {
    handlers: {
      GET: async () => {
        const { androidAssociationResponse } =
          await import("@/lib/mobile-links/association.server");
        return androidAssociationResponse();
      },
    },
  },
});
