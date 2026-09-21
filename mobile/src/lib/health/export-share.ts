import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as Crypto from "expo-crypto";

export async function sharePrivateExport(contents: string, isCurrent: () => boolean) {
  if (!(await Sharing.isAvailableAsync()))
    throw new Error("Sharing is not available on this device.");
  if (!isCurrent()) throw new Error("Export cancelled.");
  const file = new File(Paths.cache, `samepace-export-${Crypto.randomUUID()}.json`);
  try {
    file.create();
    file.write(contents);
    if (!isCurrent()) throw new Error("Export cancelled.");
    await Sharing.shareAsync(file.uri, {
      mimeType: "application/json",
      UTI: "public.json",
      dialogTitle: "Save your SamePace export",
    });
  } finally {
    if (file.exists) file.delete();
  }
}
