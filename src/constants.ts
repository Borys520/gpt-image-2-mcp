/**
 * Canonical constants for gpt-image-2. Centralized so tools and validators
 * stay in sync with the model's published limits.
 */

export const MODEL_ID = "gpt-image-2";

export const PRESET_SIZES = [
  "auto",
  "1024x1024",
  "1536x1024",
  "1024x1536",
] as const;

export type PresetSize = (typeof PRESET_SIZES)[number];

export const QUALITY_LEVELS = ["auto", "low", "medium", "high"] as const;
export type Quality = (typeof QUALITY_LEVELS)[number];

export const OUTPUT_FORMATS = ["png", "jpeg", "webp"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export const BACKGROUNDS = ["auto", "opaque"] as const;
export type Background = (typeof BACKGROUNDS)[number];

export const MODERATION_LEVELS = ["auto", "low"] as const;
export type Moderation = (typeof MODERATION_LEVELS)[number];

export const MAX_EDGE_PX = 3840;
export const MIN_TOTAL_PIXELS = 655_360;
export const MAX_TOTAL_PIXELS = 8_294_400;
export const EDGE_STEP = 16;
export const MAX_ASPECT_RATIO = 3;
export const MAX_PROMPT_CHARS = 32_000;
export const MAX_EDIT_IMAGES = 8;
export const MAX_MASK_BYTES = 4 * 1024 * 1024;
export const MAX_INPUT_IMAGE_BYTES = 50 * 1024 * 1024;
export const MAX_N = 10;

/**
 * Approximate per-image prices in USD. Sourced from OpenAI's published
 * image generation guide for gpt-image-2. Used for cost estimation only —
 * the authoritative cost comes back in the `usage` field of the response.
 */
export const APPROX_PRICE_PER_IMAGE: Record<
  Exclude<Quality, "auto">,
  { "1024x1024": number; "1024x1536": number; "1536x1024": number }
> = {
  low: { "1024x1024": 0.006, "1024x1536": 0.005, "1536x1024": 0.005 },
  medium: { "1024x1024": 0.053, "1024x1536": 0.041, "1536x1024": 0.041 },
  high: { "1024x1024": 0.211, "1024x1536": 0.165, "1536x1024": 0.165 },
};

/** $ per 1M tokens for gpt-image-2. */
export const TOKEN_PRICES = {
  image: { input: 8.0, cachedInput: 2.0, output: 30.0 },
  text: { input: 5.0, cachedInput: 1.25, output: 10.0 },
} as const;
