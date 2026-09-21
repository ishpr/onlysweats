export async function sharePrivateExport(contents: string, isCurrent: () => boolean) {
  if (!isCurrent()) throw new Error("Export cancelled.");
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const link = document.createElement("a");
  try {
    link.href = url;
    link.download = `samepace-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    // Give the browser time to consume the download before releasing its data.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
