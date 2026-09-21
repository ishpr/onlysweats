import type {
  HealthConnection, HealthDataType, HealthRecord, HealthSyncInput, PrivateWorkout,
} from "../../../../shared/health";
import type { HealthTransport } from "./controller";

export type WorkoutPage = { workouts: PrivateWorkout[]; nextCursor: string | null };
export type HealthExportPage = { records: HealthRecord[]; nextCursor: string | null };
function pagination(input: { limit?: number; cursor?: string } = {}) {
  const params = new URLSearchParams();
  if (input.limit !== undefined) params.set("limit", String(input.limit));
  if (input.cursor !== undefined) params.set("cursor", input.cursor);
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** No shared query cache: every request retains the explicitly captured account. */
export function createHealthApi(session: HealthTransport) {
  return {
    connection: () => session.request<{ connection: HealthConnection | null }>("/health/connection"),
    connect: (deviceId: string, types: HealthDataType[]) => session.request<{ connection: HealthConnection }>(
      "/health/connection", { method: "POST", json: { deviceId, types } },
    ),
    sync: (page: HealthSyncInput) => session.request<{ connection: HealthConnection }>(
      "/health/sync", { method: "POST", json: page },
    ),
    disconnect: () => session.request<{ ok: true }>("/health/connection", { method: "DELETE" }),
    workouts: (input?: { limit?: number; cursor?: string }) => session.request<WorkoutPage>(
      `/health/workouts${pagination(input)}`,
    ),
    workout: (id: string) => session.request<{ workout: PrivateWorkout }>(`/health/workouts/${encodeURIComponent(id)}`),
    deleteWorkout: (id: string) => session.request<{ ok: true }>(
      `/health/workouts/${encodeURIComponent(id)}`, { method: "DELETE" },
    ),
    exportRecords: (input?: { limit?: number; cursor?: string }) => session.request<HealthExportPage>(
      `/health/export${pagination(input)}`,
    ),
  };
}
