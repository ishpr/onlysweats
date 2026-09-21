import { z } from "zod";
import type { HealthDataType, HealthRecord, HealthSyncInput } from "../../../shared/health.ts";

export const HEALTH_TYPES = [
  "workout",
  "heart_rate",
  "resting_heart_rate",
  "heart_rate_variability",
  "heart_rate_variability_rmssd",
  "cycling_power",
  "sleep",
  "steps",
  "distance",
  "active_energy",
  "blood_glucose",
] as const satisfies readonly HealthDataType[];
export const healthType = z.enum(HEALTH_TYPES);
// Canonical UUID casing prevents a source record from bypassing a tombstone.
export const sourceId = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());
const nonnegative = z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER);
const source = z
  .object({
    bundleId: z.string().trim().min(1).max(255),
    name: z.string().trim().min(1).max(255),
  })
  .strict();
const base = { externalId: sourceId, source, startAt: timestamp, endAt: timestamp };

export const workoutZoneGroup = z
  .object({
    metric: z.enum(["heart_rate", "cycling_power"]),
    unit: z.enum(["bpm", "W"]),
    source: z.enum(["system", "user", "app"]),
    zones: z
      .array(
        z
          .object({
            index: z.number().int().min(0).max(100),
            minimum: nonnegative.nullable(),
            maximum: nonnegative.nullable(),
            durationSeconds: nonnegative.nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((group, ctx) => {
    if (group.unit !== (group.metric === "heart_rate" ? "bpm" : "W")) {
      ctx.addIssue({ code: "custom", message: "Zone unit must match its metric." });
    }
    for (let i = 0; i < group.zones.length; i++) {
      const zone = group.zones[i];
      const previous = group.zones[i - 1];
      if (
        (zone.minimum === null && i !== 0) ||
        (zone.maximum === null && i !== group.zones.length - 1) ||
        (zone.minimum !== null && zone.maximum !== null && zone.minimum >= zone.maximum) ||
        (previous && (zone.index <= previous.index || previous.maximum !== zone.minimum))
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["zones", i],
          message: "Zone thresholds must be contiguous and ordered.",
        });
      }
    }
  });

export const healthRecord = z
  .discriminatedUnion("type", [
    z
      .object({
        ...base,
        type: z.literal("workout"),
        activity: z.enum(["run", "walk", "ride", "hike", "strength", "mobility", "other"]),
        durationSeconds: nonnegative,
        distanceMeters: nonnegative.nullable(),
        activeEnergyKilocalories: nonnegative.nullable(),
        zones: z
          .array(workoutZoneGroup)
          .max(2)
          .refine(
            (groups) => new Set(groups.map((g) => g.metric)).size === groups.length,
            "Do not repeat zone metrics.",
          )
          .optional(),
      })
      .strict(),
    z
      .object({
        ...base,
        type: z.literal("heart_rate"),
        value: nonnegative.positive(),
        unit: z.literal("bpm"),
      })
      .strict(),
    z
      .object({
        ...base,
        type: z.literal("resting_heart_rate"),
        value: nonnegative.positive(),
        unit: z.literal("bpm"),
      })
      .strict(),
    z
      .object({
        ...base,
        type: z.literal("heart_rate_variability"),
        value: nonnegative,
        unit: z.literal("ms"),
      })
      .strict(),
    z
      .object({
        ...base,
        type: z.literal("heart_rate_variability_rmssd"),
        value: nonnegative,
        unit: z.literal("ms"),
      })
      .strict(),
    z
      .object({
        ...base,
        type: z.literal("cycling_power"),
        value: nonnegative,
        unit: z.literal("W"),
      })
      .strict(),
    z
      .object({
        ...base,
        type: z.literal("steps"),
        value: nonnegative.int(),
        unit: z.literal("count"),
      })
      .strict(),
    z
      .object({ ...base, type: z.literal("distance"), value: nonnegative, unit: z.literal("m") })
      .strict(),
    z
      .object({
        ...base,
        type: z.literal("active_energy"),
        value: nonnegative,
        unit: z.literal("kcal"),
      })
      .strict(),
    z
      .object({
        ...base,
        type: z.literal("blood_glucose"),
        value: nonnegative.positive(),
        unit: z.literal("mg/dL"),
      })
      .strict(),
    z
      .object({
        ...base,
        type: z.literal("sleep"),
        stage: z.enum(["in_bed", "asleep_unspecified", "awake", "core", "deep", "rem"]),
      })
      .strict(),
  ])
  .superRefine((record, ctx) => {
    const elapsed = Date.parse(record.endAt) - Date.parse(record.startAt);
    if (elapsed < 0)
      ctx.addIssue({ code: "custom", path: ["endAt"], message: "Must be at or after startAt." });
    if (record.type === "workout" && record.durationSeconds > elapsed / 1000 + 1) {
      ctx.addIssue({
        code: "custom",
        path: ["durationSeconds"],
        message: "Active duration cannot exceed elapsed time.",
      });
    }
  }) satisfies z.ZodType<HealthRecord>;

export const connectionInput = z
  .object({
    deviceId: sourceId,
    automaticSync: z.boolean().default(false),
    types: z
      .array(healthType)
      .min(1)
      .max(HEALTH_TYPES.length)
      .refine((types) => types.includes("workout"), "Workout access must be selected.")
      .refine((types) => new Set(types).size === types.length, "Select each type once."),
  })
  .strict();

export const syncInput = z
  .object({
    deviceId: sourceId,
    generation: sourceId,
    type: healthType,
    expectedSequence: z.number().int().min(0).max(2_147_483_646),
    records: z.array(healthRecord).max(200),
    deletedIds: z.array(sourceId).max(200),
    // HKQueryAnchor secure archives are opaque base64, not interpreted by the server.
    anchor: z
      .string()
      .min(1)
      .max(16 * 1024),
    hasMore: z.boolean(),
  })
  .strict()
  .superRefine((page, ctx) => {
    if (page.records.some((record) => record.type !== page.type)) {
      ctx.addIssue({
        code: "custom",
        path: ["records"],
        message: "Every record must match the page type.",
      });
    }
    if (new Set(page.records.map((record) => record.externalId)).size !== page.records.length) {
      ctx.addIssue({
        code: "custom",
        path: ["records"],
        message: "A page cannot repeat a source ID.",
      });
    }
  }) satisfies z.ZodType<HealthSyncInput>;

export const pageInput = (maximum: number) =>
  z
    .object({
      limit: z.coerce.number().int().min(1).max(maximum).default(maximum),
      cursor: z.string().min(1).max(1024).optional(),
    })
    .strict();

export class HealthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
