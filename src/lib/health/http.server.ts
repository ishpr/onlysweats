import { HealthError } from "./contracts.ts";

export const MAX_HEALTH_BODY_BYTES = 512 * 1024;
export const isHealthPath = (path: string) => path === "/health" || path.startsWith("/health/");
export const healthEnabled = () => process.env.HEALTH_SYNC_ENABLED === "true";

/** Enforce the limit while streaming, including requests without Content-Length.
 * Parse errors never echo source measurements or the submitted JSON. */
export async function readHealthBody(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (declaredLength > MAX_HEALTH_BODY_BYTES) throw new HealthError(413, "Health request is too large.");
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_HEALTH_BODY_BYTES) {
        await reader.cancel();
        throw new HealthError(413, "Health request is too large.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!bytes) return undefined;
  const buffer = new Uint8Array(bytes);
  let position = 0;
  for (const chunk of chunks) { buffer.set(chunk, position); position += chunk.length; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer)); }
  catch { throw new HealthError(400, "Body must be JSON."); }
}
