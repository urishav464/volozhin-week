// A PDF's page count, read in the browser when it is picked (pdf-lib, loaded on
// demand) — what register_source_file records, and the manifest's estimate
// counts. null: the file could not be read (protected by a password, damaged);
// the reader's build tries it again and says so.
export async function countPdfPages(file: Blob): Promise<number | null> {
  try {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false });
    const n = doc.getPageCount();
    return n > 0 ? n : null;
  } catch {
    return null;
  }
}
