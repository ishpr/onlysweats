import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import {
  connectHealth,
  disconnectHealth,
  healthAvailable,
  healthConnected,
  readDay,
} from "@/lib/health";

const KEY = ["health-day"] as const;

/**
 * Apple Health on this phone: whether it can be used, whether the member has
 * connected it, and today's numbers. Lives in the query cache so Home and You agree,
 * and re-reads when the app comes back to the front.
 */
export function useHealth() {
  const qc = useQueryClient();
  const available = healthAvailable();
  const q = useQuery({
    queryKey: KEY,
    enabled: available,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const connected = await healthConnected();
      return { connected, day: connected ? await readDay() : null };
    },
  });
  const connect = useCallback(async () => {
    await connectHealth();
    await qc.invalidateQueries({ queryKey: KEY });
  }, [qc]);
  const disconnect = useCallback(async () => {
    await disconnectHealth();
    await qc.invalidateQueries({ queryKey: KEY });
  }, [qc]);

  return {
    available,
    loading: available && q.isPending,
    connected: q.data?.connected ?? false,
    day: q.data?.day ?? null,
    connect,
    disconnect,
  };
}
