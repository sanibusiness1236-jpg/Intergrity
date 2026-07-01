// Heavy text-extraction runs here, OFF the main event loop.
//
// OCR (tesseract.js), PDF parsing and DOCX parsing are CPU-bound and can take
// several seconds. Running them inline on the single Node thread froze the
// whole server — student logins, auto-saves and the live-monitor polls all
// stalled behind one examiner's scanned-PDF upload. Doing the work in a
// worker thread keeps the main thread free to serve exam traffic.
const { parentPort, workerData } = require("worker_threads");
const fs = require("fs");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const Tesseract = require("tesseract.js");

async function run() {
  const { filePath, mimetype, originalName } = workerData;
  const buf = await fs.promises.readFile(filePath);
  const lower = (originalName || "").toLowerCase();

  // PDF
  if (mimetype.includes("pdf") || lower.endsWith(".pdf")) {
    const data = await pdfParse(buf);
    return (data.text || "").trim();
  }

  // DOCX / DOC
  if (
    mimetype.includes("word") ||
    mimetype.includes("officedocument") ||
    lower.endsWith(".docx") ||
    lower.endsWith(".doc")
  ) {
    const result = await mammoth.extractRawText({ buffer: buf });
    return (result.value || "").trim();
  }

  // Image (OCR)
  if (mimetype.startsWith("image/") || /\.(jpe?g|png)$/.test(lower)) {
    const { data } = await Tesseract.recognize(buf, "eng", { logger: () => {} });
    return (data.text || "").trim();
  }

  // Plain-text fallback
  return buf.toString("utf-8");
}

run()
  .then((text) => parentPort.postMessage({ ok: true, text }))
  .catch((err) => parentPort.postMessage({ ok: false, error: err && err.message ? err.message : "Extraction failed" }));
