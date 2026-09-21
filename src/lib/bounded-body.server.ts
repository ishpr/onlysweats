/** Limit webhook bytes before parsing or authenticating; never log the body. */
export async function boundedText(request: Request, limit = 1024 * 1024): Promise<string | null> {
  if (Number(request.headers.get("content-length")) > limit) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.length;
    if (bytes > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(part.value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
