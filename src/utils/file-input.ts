import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toFile, type Uploadable } from "openai";
import {
  MAX_EDIT_IMAGES,
  MAX_INPUT_IMAGE_BYTES,
  MAX_MASK_BYTES,
} from "../constants.js";

const HTTP_FETCH_TIMEOUT_MS = 15_000;

/**
 * Accept any of:
 *   - absolute or relative filesystem path
 *   - "file://" URL
 *   - "data:image/...;base64,..." URL
 *   - "http(s)://" URL
 * …and return a value the OpenAI SDK can upload.
 */
export async function loadImage(
  spec: string,
  { maxBytes = MAX_INPUT_IMAGE_BYTES }: { maxBytes?: number } = {},
): Promise<Uploadable> {
  const trimmed = spec.trim();

  if (trimmed.startsWith("data:")) {
    const parsed = parseDataUrl(trimmed);
    if (parsed.bytes.length > maxBytes) {
      throw new Error(
        `Data-URL image is ${humanBytes(parsed.bytes.length)}, exceeds ${humanBytes(maxBytes)} limit.`,
      );
    }
    return toFile(parsed.bytes, parsed.filename, { type: parsed.mime });
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return fetchImageCapped(trimmed, maxBytes);
  }

  const absPath = trimmed.startsWith("file://")
    ? fileURLToFsPath(trimmed)
    : path.isAbsolute(trimmed)
      ? trimmed
      : path.resolve(process.cwd(), trimmed);

  if (!fs.existsSync(absPath)) {
    throw new Error(`Image file not found: ${absPath}`);
  }
  const stat = fs.statSync(absPath);
  if (stat.size > maxBytes) {
    throw new Error(
      `Image ${absPath} is ${humanBytes(stat.size)}, exceeds ${humanBytes(maxBytes)} limit.`,
    );
  }
  return fs.createReadStream(absPath);
}

/**
 * Fetch a remote image with three safety checks:
 *   1. Hard timeout (so a slow-drip server can't tie us up)
 *   2. Early bail on Content-Length when the server declares oversized payload
 *   3. Streaming read that aborts the moment the running byte count exceeds
 *      maxBytes — a lying or absent Content-Length cannot OOM us
 */
async function fetchImageCapped(url: string, maxBytes: number): Promise<Uploadable> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(HTTP_FETCH_TIMEOUT_MS) });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to fetch image from ${url}: ${reason}`);
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch image from ${url}: HTTP ${res.status} ${res.statusText}`);
  }
  const contentType = res.headers.get("content-type") ?? "image/png";
  const declared = res.headers.get("content-length");
  if (declared) {
    const size = Number(declared);
    if (Number.isFinite(size) && size > maxBytes) {
      throw new Error(
        `Remote image at ${url} declares ${humanBytes(size)}, exceeds ${humanBytes(maxBytes)} limit.`,
      );
    }
  }
  if (!res.body) {
    throw new Error(`Remote image fetch returned no body: ${url}`);
  }
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new Error(
          `Remote image at ${url} exceeded ${humanBytes(maxBytes)} during streaming (read ${humanBytes(total)}).`,
        );
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.cancel().catch(() => {
      /* best-effort cleanup */
    });
  }
  const buf = Buffer.concat(chunks);
  const filename = filenameFromUrl(url, contentType);
  return toFile(buf, filename, { type: contentType });
}

export async function loadMask(spec: string): Promise<Uploadable> {
  return loadImage(spec, { maxBytes: MAX_MASK_BYTES });
}

export function validateEditImageCount(n: number): void {
  if (n < 1) throw new Error("edit_image requires at least one input image.");
  if (n > MAX_EDIT_IMAGES) {
    throw new Error(
      `edit_image accepts up to ${MAX_EDIT_IMAGES} input images; received ${n}.`,
    );
  }
}

interface ParsedDataUrl {
  bytes: Buffer;
  mime: string;
  filename: string;
}

function parseDataUrl(url: string): ParsedDataUrl {
  const match = url.match(/^data:([^;,]+)(;base64)?,(.*)$/s);
  if (!match) throw new Error("Invalid data URL.");
  const mime = match[1] ?? "image/png";
  const isBase64 = match[2] === ";base64";
  const payload = match[3] ?? "";
  const bytes = isBase64
    ? Buffer.from(payload, "base64")
    : Buffer.from(decodeURIComponent(payload), "utf8");
  const ext = mime.split("/")[1] ?? "png";
  return { bytes, mime, filename: `input.${ext}` };
}

function fileURLToFsPath(url: string): string {
  try {
    return fileURLToPath(url);
  } catch {
    // Fallback for malformed URLs; prefer Node's parser when it works.
    return url.replace(/^file:\/\//, "");
  }
}

function filenameFromUrl(url: string, mime: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    if (last && /\.[a-z0-9]+$/i.test(last)) return last;
  } catch {
    /* fall through */
  }
  const ext = (mime.split("/")[1] ?? "png").replace(/[^a-z0-9]/gi, "");
  return `input.${ext || "png"}`;
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
}
