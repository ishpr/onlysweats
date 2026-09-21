import { APP_TERMS_VERSION, type AppTermsStatus } from "../../../shared/app-terms.ts";
import { createSerialWrites } from "./serial-writes.ts";

const invalid = () => new Error("Your SamePace terms could not be confirmed. Please try again.");
export function readAppTermsStatus(value: unknown): AppTermsStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const v = value as Record<string, unknown>;
  const timestamp = (s: unknown) =>
    typeof s === "string" && s.length <= 40 && Number.isFinite(Date.parse(s));
  if (
    v.version !== APP_TERMS_VERSION ||
    typeof v.ownerId !== "string" ||
    !v.ownerId ||
    v.ownerId.length > 200 ||
    typeof v.accepted !== "boolean" ||
    !(
      v.acceptedVersion === null ||
      (typeof v.acceptedVersion === "string" && v.acceptedVersion.length <= 100)
    ) ||
    !(v.acceptedAt === null || timestamp(v.acceptedAt)) ||
    (v.accepted && (v.acceptedVersion !== APP_TERMS_VERSION || !timestamp(v.acceptedAt))) ||
    (!v.accepted && v.acceptedVersion === APP_TERMS_VERSION && v.acceptedAt !== null)
  )
    throw invalid();
  return {
    ownerId: v.ownerId,
    version: APP_TERMS_VERSION,
    accepted: v.accepted,
    acceptedVersion: v.acceptedVersion as string | null,
    acceptedAt: v.acceptedAt as string | null,
  };
}

type Receipt = { tokenHash: string; status: AppTermsStatus };
const parseReceipt = (text: string | null): Receipt | null => {
  if (!text || text.length > 2000) return null;
  try {
    const value = JSON.parse(text);
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      typeof value.tokenHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.tokenHash)
    )
      return null;
    const status = readAppTermsStatus(value.status);
    return status.accepted ? { tokenHash: value.tokenHash, status } : null;
  } catch {
    return null;
  }
};

export function permitsAppAccess(input: {
  currentSession: boolean;
  live: AppTermsStatus | null;
  receipt: AppTermsStatus | null;
  failure: "none" | "connection" | "denied";
}) {
  if (!input.currentSession || input.failure === "denied") return false;
  return (input.live ?? input.receipt)?.accepted === true;
}

/** A committed acceptance with a lost reply is confirmed by a fresh authenticated read. */
export async function confirmTermsAcceptance(
  request: (method: "GET" | "PUT") => Promise<unknown>,
  isCurrent: () => boolean,
): Promise<AppTermsStatus> {
  let status: AppTermsStatus;
  if (!isCurrent()) throw invalid();
  try {
    status = readAppTermsStatus(await request("PUT"));
  } catch (failure) {
    if (!isCurrent()) throw invalid();
    status = readAppTermsStatus(await request("GET"));
    if (!status.accepted) throw failure;
  }
  if (!isCurrent() || !status.accepted) throw invalid();
  return status;
}

/** A small exact-session receipt permits already-accepted terms during offline startup. */
export function createAppTermsStore(storage: {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  clear(): Promise<void>;
}) {
  const serial = createSerialWrites();
  let generation = 0;
  let receiptRevision = 0;
  let binding: Promise<string> | null = null;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const current = (captured: number) => captured === generation && binding !== null;
  return {
    generation: () => generation,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    bind(hash: Promise<string> | null) {
      generation++;
      binding = hash;
      // A rejected native hash must remain unavailable without an unhandled rejection.
      void hash?.catch(() => undefined);
      notify();
    },
    clear() {
      generation++;
      binding = null;
      notify();
      return serial(() => storage.clear());
    },
    async load(): Promise<AppTermsStatus | null> {
      const captured = generation,
        hash = binding;
      if (!hash) return null;
      const tokenHash = await hash;
      if (!current(captured)) return null;
      let status: AppTermsStatus | null = null;
      await serial(async () => {
        if (!current(captured)) return;
        const receipt = parseReceipt(await storage.read());
        status = current(captured) && receipt?.tokenHash === tokenHash ? receipt.status : null;
      });
      return status;
    },
    async remember(value: unknown, isCurrent: () => boolean) {
      const status = readAppTermsStatus(value);
      if (!status.accepted) throw invalid();
      const captured = generation,
        hash = binding,
        revision = receiptRevision;
      if (!hash || !isCurrent()) throw invalid();
      const tokenHash = await hash;
      if (
        !current(captured) ||
        revision !== receiptRevision ||
        !isCurrent() ||
        !/^[a-f0-9]{64}$/.test(tokenHash)
      )
        throw invalid();
      await serial(async () => {
        if (!current(captured) || revision !== receiptRevision || !isCurrent()) throw invalid();
        await storage.write(JSON.stringify({ tokenHash, status } satisfies Receipt));
        if (!current(captured) || revision !== receiptRevision || !isCurrent()) throw invalid();
      });
    },
    forget() {
      receiptRevision++;
      return serial(() => storage.clear());
    },
  };
}
