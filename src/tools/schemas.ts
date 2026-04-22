import { z } from "zod";
import {
  BACKGROUNDS,
  MAX_EDIT_IMAGES,
  MAX_N,
  MAX_PROMPT_CHARS,
  MODERATION_LEVELS,
  OUTPUT_FORMATS,
  QUALITY_LEVELS,
} from "../constants.js";

/**
 * Shared Zod fragments used by multiple tools. These are raw shapes (not
 * wrapped in z.object()) so the MCP SDK can treat each key as a discrete
 * tool argument for schema introspection.
 */

export const promptField = z
  .string()
  .min(1, "prompt is required")
  .max(MAX_PROMPT_CHARS, `prompt must be ≤ ${MAX_PROMPT_CHARS} characters`)
  .describe(
    "Image description. gpt-image-2 handles very detailed prompts; use ALL CAPS or quote literal text you want rendered verbatim.",
  );

export const sizeField = z
  .string()
  .default("auto")
  .describe(
    'Output dimensions. "auto" (default), one of the presets "1024x1024", "1536x1024", "1024x1536", or a custom "WxH" where both edges are multiples of 16, max edge ≤ 3840px, aspect ratio within 1:3–3:1, and total pixels 655,360–8,294,400. Outputs above 2K are beta.',
  );

export const qualityField = z
  .enum(QUALITY_LEVELS)
  .default("auto")
  .describe(
    'Generation quality. "low" for fast drafts, "medium" balanced (default when model picks), "high" for dense layouts and text, "auto" lets the model choose.',
  );

export const nField = z
  .number()
  .int()
  .min(1)
  .max(MAX_N)
  .default(1)
  .describe(`How many images to generate (1–${MAX_N}). Each counts toward rate limits and cost.`);

export const backgroundField = z
  .enum(BACKGROUNDS)
  .default("auto")
  .describe(
    'Background behavior. "opaque" forces a filled background; "auto" lets the model pick. gpt-image-2 does NOT support transparent backgrounds — use a different model for that.',
  );

export const outputFormatField = z
  .enum(OUTPUT_FORMATS)
  .default("png")
  .describe('File format. "png" (default, lossless), "jpeg" (smaller, lossy), "webp" (best compression).');

export const outputCompressionField = z
  .number()
  .int()
  .min(0)
  .max(100)
  .optional()
  .describe("Compression level 0–100 for jpeg/webp outputs. Ignored for png. Defaults to 100 (minimal compression).");

export const moderationField = z
  .enum(MODERATION_LEVELS)
  .default("auto")
  .describe(
    'Moderation strictness. "auto" (default) applies standard safety filtering; "low" is less restrictive (still subject to OpenAI policy).',
  );

export const outputDirField = z
  .string()
  .optional()
  .describe(
    "Absolute or relative directory where generated images should be written. Defaults to $GPT_IMAGE_2_OUTPUT_DIR or a per-project subfolder under the OS config dir. The directory is created if missing.",
  );

export const filenamePrefixField = z
  .string()
  .max(60)
  .optional()
  .describe(
    "Short label appended to the generated filename so you can find it later (e.g. \"hero-banner\"). Letters/digits/hyphens only; auto-sanitized.",
  );

export const userField = z
  .string()
  .max(256)
  .optional()
  .describe(
    "Optional end-user identifier forwarded to OpenAI for abuse monitoring. Pass a stable hashed user ID, not PII.",
  );

export const imagesArrayField = z
  .array(z.string().min(1))
  .min(1, "Provide at least one image.")
  .max(MAX_EDIT_IMAGES, `gpt-image-2 edit accepts up to ${MAX_EDIT_IMAGES} images per call.`)
  .describe(
    "Input images. Each entry can be: an absolute file path, a relative path (resolved from CWD), a file:// URL, an http(s):// URL, or a data:image/...;base64,... URL. PNG/WEBP/JPG, up to 50MB each.",
  );

export const maskField = z
  .string()
  .optional()
  .describe(
    "Optional PNG mask — fully transparent pixels mark the editable region. Must match the first input image's dimensions and be <4MB. Accepts the same source types as `images`.",
  );

export const editQualityField = z
  .enum(["auto", "low", "medium", "high", "standard"] as const)
  .default("auto")
  .describe("Edit quality. Same levels as generate, plus \"standard\" for backward-compatible callers.");
