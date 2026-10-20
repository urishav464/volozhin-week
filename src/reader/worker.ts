// «בנה מקראה», off the page's thread: a module worker (Vite bundles it with
// pdf-lib) that receives the files' bytes, draws the Hebrew text on an
// OffscreenCanvas in the app's font, assembles the PDF and hands it back — the
// page stays responsive, and «ביטול» simply ends the worker. Nothing here
// talks to the network except the font.
import { assembleReader, type ReaderJob } from "./assemble";
import { canvasRenderer, offscreenSurface } from "./render";

export type ToWorker = { type: "build"; job: ReaderJob };
export type FromWorker =
  | { type: "progress"; done: number; total: number; step: "read" | "draw" | "save" }
  | { type: "done"; bytes: ArrayBuffer; pages: number; skipped: { name: string; reason: "unreadable" | "protected" }[] }
  | { type: "error"; code: "no_canvas" | "failed"; message: string };

interface WorkerScope {
  postMessage(m: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
  fonts?: { add(f: FontFace): void };
}
const scope = self as unknown as WorkerScope;

/**
 * The app's font (Assistant, as index.html loads it) into the worker's own font set: a worker does not see the
 * page's fonts. Its Hebrew and Latin faces, regular and bold, from Google Fonts' stylesheet. Offline, or
 * blocked: the system's Hebrew face (FONT_STACK) — the reader is still built.
 */
async function loadFont(): Promise<void> {
  if (!scope.fonts || typeof FontFace === "undefined") return;
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 4000));
  const load = (async () => {
    const css = await (await fetch("https://fonts.googleapis.com/css2?family=Assistant:wght@400;700&display=swap")).text();
    const faces: Promise<unknown>[] = [];
    for (const block of css.split("@font-face").slice(1)) {
      const url = /url\((https:[^)]+)\)/.exec(block)?.[1];
      const weight = /font-weight:\s*(\d+)/.exec(block)?.[1] ?? "400";
      const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1];
      if (!url || (range && !/U\+0?5|U\+0000-00FF/i.test(range))) continue; // the Hebrew and the basic Latin faces
      const face = new FontFace("Assistant", `url(${url})`, { weight, unicodeRange: range });
      faces.push(face.load().then((f) => scope.fonts!.add(f)));
    }
    await Promise.allSettled(faces);
  })().catch(() => undefined);
  await Promise.race([load, timeout]);
}

scope.onmessage = async (e) => {
  if (e.data.type !== "build") return;
  if (typeof OffscreenCanvas === "undefined") {
    scope.postMessage({ type: "error", code: "no_canvas", message: "OffscreenCanvas" });
    return;
  }
  try {
    await loadFont();
    const r = await assembleReader(e.data.job, canvasRenderer(offscreenSurface), (p) => scope.postMessage({ type: "progress", ...p }));
    const bytes = r.bytes.buffer.slice(r.bytes.byteOffset, r.bytes.byteOffset + r.bytes.byteLength) as ArrayBuffer;
    scope.postMessage({ type: "done", bytes, pages: r.pages, skipped: r.skipped }, [bytes]);
  } catch (err) {
    scope.postMessage({ type: "error", code: "failed", message: err instanceof Error ? err.message : String(err) });
  }
};
