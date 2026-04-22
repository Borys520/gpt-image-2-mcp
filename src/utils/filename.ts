import { randomBytes } from "node:crypto";
import type { OutputFormat } from "../constants.js";

/**
 * Build a reasonably unique, sortable filename for a generated image.
 * Shape: `{prefix}-{YYYYMMDD-HHMMSS}-{6hex}.{ext}` — e.g. `image-20260422-120301-a1b2c3.png`.
 */
export function makeFilename(
  prefix: "image" | "edit" | "session",
  ext: OutputFormat,
  extra?: string | null,
): string {
  const ts = timestamp();
  const id = randomBytes(3).toString("hex");
  const tail = extra && extra.length > 0 ? `-${sanitize(extra).slice(0, 30)}` : "";
  return `${prefix}-${ts}-${id}${tail}.${ext}`;
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, "-");
}
