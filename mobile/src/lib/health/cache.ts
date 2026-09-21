import type { QueryClient } from "@tanstack/react-query";

/** Permission changes and deletion invalidate every page, including in-flight reads. */
export async function clearPrivateHealthCache(client: QueryClient, ownerId: string) {
  for (const family of ["private-health", "private-fitness"]) {
    const filter = { queryKey: [family, ownerId] };
    await client.cancelQueries(filter);
    client.removeQueries(filter);
  }
}
