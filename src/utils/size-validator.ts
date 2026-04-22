import {
  EDGE_STEP,
  MAX_ASPECT_RATIO,
  MAX_EDGE_PX,
  MAX_TOTAL_PIXELS,
  MIN_TOTAL_PIXELS,
  PRESET_SIZES,
  type PresetSize,
} from "../constants.js";

export type SizeCheck =
  | { ok: true; kind: "preset" | "custom"; canonical: string }
  | { ok: false; error: string };

const PRESET_SET = new Set<string>(PRESET_SIZES);

/**
 * Validate a size string against gpt-image-2's rules:
 *   - "auto" or one of the preset sizes, OR
 *   - a custom "WxH" where both edges are multiples of 16, max edge <= 3840,
 *     aspect ratio is between 1:3 and 3:1, and total pixels are 655,360 – 8,294,400.
 *
 * Returns the canonical form (whitespace-trimmed, lowercase "x").
 */
export function validateSize(input: string): SizeCheck {
  const s = input.trim().toLowerCase().replace(/\s+/g, "");
  if (PRESET_SET.has(s)) {
    return { ok: true, kind: "preset", canonical: s };
  }
  const m = s.match(/^(\d+)x(\d+)$/);
  if (!m) {
    return {
      ok: false,
      error: `Invalid size "${input}". Use "auto" or WxH (e.g. "1024x1024", "2048x1152"). Allowed presets: ${PRESET_SIZES.join(", ")}.`,
    };
  }
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { ok: false, error: `Invalid size "${input}": both edges must be positive integers.` };
  }
  if (w % EDGE_STEP !== 0 || h % EDGE_STEP !== 0) {
    return {
      ok: false,
      error: `Invalid size ${w}x${h}: both edges must be multiples of ${EDGE_STEP}.`,
    };
  }
  if (Math.max(w, h) > MAX_EDGE_PX) {
    return {
      ok: false,
      error: `Invalid size ${w}x${h}: max edge is ${MAX_EDGE_PX}px (4K beta).`,
    };
  }
  const ratio = Math.max(w, h) / Math.min(w, h);
  if (ratio > MAX_ASPECT_RATIO) {
    return {
      ok: false,
      error: `Invalid size ${w}x${h}: aspect ratio must be between 1:${MAX_ASPECT_RATIO} and ${MAX_ASPECT_RATIO}:1 (got ${ratio.toFixed(2)}:1).`,
    };
  }
  const total = w * h;
  if (total < MIN_TOTAL_PIXELS || total > MAX_TOTAL_PIXELS) {
    return {
      ok: false,
      error: `Invalid size ${w}x${h}: total pixels must be between ${MIN_TOTAL_PIXELS.toLocaleString()} and ${MAX_TOTAL_PIXELS.toLocaleString()} (got ${total.toLocaleString()}).`,
    };
  }
  return { ok: true, kind: "custom", canonical: `${w}x${h}` };
}

export function isPresetSize(s: string): s is PresetSize {
  return PRESET_SET.has(s);
}
