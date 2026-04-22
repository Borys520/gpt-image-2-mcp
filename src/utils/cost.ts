import {
  APPROX_PRICE_PER_IMAGE,
  TOKEN_PRICES,
  type Quality,
} from "../constants.js";

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_tokens_details?: { image_tokens?: number; text_tokens?: number };
  output_tokens_details?: { image_tokens?: number; text_tokens?: number };
}

/**
 * Compute an authoritative USD cost from the token usage the API returns.
 * Image and text tokens are billed at different rates; we split them out
 * using the details when present, else attribute all input to text and all
 * output to image (the typical shape for a pure text prompt → image call).
 */
export function estimateCostFromUsage(usage: Usage | undefined | null): number | null {
  if (!usage) return null;
  const inImgT = usage.input_tokens_details?.image_tokens ?? 0;
  const inTxtT =
    usage.input_tokens_details?.text_tokens ??
    Math.max(usage.input_tokens - inImgT, 0);
  const outImgT =
    usage.output_tokens_details?.image_tokens ?? usage.output_tokens ?? 0;
  const outTxtT = usage.output_tokens_details?.text_tokens ?? 0;

  const perMillion = (tokens: number, pricePerMillion: number) =>
    (tokens / 1_000_000) * pricePerMillion;

  const cost =
    perMillion(inTxtT, TOKEN_PRICES.text.input) +
    perMillion(inImgT, TOKEN_PRICES.image.input) +
    perMillion(outTxtT, TOKEN_PRICES.text.output) +
    perMillion(outImgT, TOKEN_PRICES.image.output);
  return round4(cost);
}

/**
 * Rough price estimate before making the API call — used for logging /
 * user-facing "you're about to spend ~$X" hints. Returns null if we can't
 * match a known row.
 */
export function approximateCost(params: {
  quality: Quality;
  size: string;
  n: number;
}): number | null {
  const { quality, size, n } = params;
  if (quality === "auto") return approximateCost({ ...params, quality: "medium" });
  const row = APPROX_PRICE_PER_IMAGE[quality];
  if (!row) return null;
  const key = size as keyof typeof row;
  const unit = row[key];
  if (typeof unit !== "number") return null;
  return round4(unit * Math.max(1, n));
}

export function formatUsd(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "n/a";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
