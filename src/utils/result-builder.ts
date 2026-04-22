import fs from "node:fs";
import path from "node:path";
import type { ImagesResponse } from "openai/resources/images";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { MODEL_ID, type OutputFormat } from "../constants.js";
import { ensureDir } from "./output-dir.js";
import { makeFilename } from "./filename.js";
import { estimateCostFromUsage, formatUsd, type Usage } from "./cost.js";

export interface SavedImage {
  filePath: string;
  filename: string;
  base64: string;
  mimeType: string;
  format: OutputFormat;
  sizeBytes: number;
}

export interface BuildResultOptions {
  response: ImagesResponse;
  outputDir: string;
  filenamePrefix: "image" | "edit" | "session";
  filenameExtra?: string | null;
  requestedSize: string;
  requestedQuality: string;
  requestedN: number;
  requestedFormat: OutputFormat;
  prompt: string;
  /** When present, overrides the primary-summary label (e.g. "edit turn 3"). */
  label?: string;
  /** Include full-image base64 as inline ImageContent blocks in the result. */
  includeInlineImages?: boolean;
}

export interface BuiltResult {
  result: CallToolResult;
  saved: SavedImage[];
  usage?: Usage;
  costUsd: number | null;
}

/**
 * Shared routine that takes an ImagesResponse, writes every image to disk
 * under `outputDir`, and assembles a CallToolResult that mixes inline
 * ImageContent (so the LLM sees the result) with a TextContent summary
 * and structuredContent carrying paths / usage / cost for downstream use.
 */
export function buildImageResult(opts: BuildResultOptions): BuiltResult {
  const { response } = opts;
  if (!response.data || response.data.length === 0) {
    throw new Error("OpenAI response contained no image data.");
  }
  ensureDir(opts.outputDir);

  const outputFormat: OutputFormat = (response.output_format ?? opts.requestedFormat) as OutputFormat;
  const mimeType = `image/${outputFormat}`;

  const saved: SavedImage[] = response.data.map((img, idx) => {
    if (!img.b64_json) {
      throw new Error(
        `OpenAI response item ${idx} had no b64_json. gpt-image-2 should always return base64 — this is unexpected.`,
      );
    }
    const base64 = img.b64_json;
    const buf = Buffer.from(base64, "base64");
    const filename = makeFilename(
      opts.filenamePrefix,
      outputFormat,
      opts.filenameExtra && opts.requestedN === 1
        ? opts.filenameExtra
        : opts.requestedN > 1
          ? `${opts.filenameExtra ?? "n"}-${idx + 1}`
          : null,
    );
    const filePath = path.join(opts.outputDir, filename);
    fs.writeFileSync(filePath, buf);
    return {
      filePath,
      filename,
      base64,
      mimeType,
      format: outputFormat,
      sizeBytes: buf.length,
    };
  });

  const usage = (response.usage ?? undefined) as Usage | undefined;
  const costUsd = estimateCostFromUsage(usage);

  const inline = opts.includeInlineImages !== false;
  const content: CallToolResult["content"] = [];
  if (inline) {
    for (const s of saved) {
      content.push({ type: "image", data: s.base64, mimeType: s.mimeType });
    }
  }
  content.push({ type: "text", text: summarize(opts, saved, usage, costUsd) });

  return {
    result: {
      content,
      structuredContent: {
        model: MODEL_ID,
        prompt: opts.prompt,
        requested: {
          size: opts.requestedSize,
          quality: opts.requestedQuality,
          n: opts.requestedN,
          format: opts.requestedFormat,
        },
        applied: {
          size: response.size ?? opts.requestedSize,
          quality: response.quality ?? opts.requestedQuality,
          background: response.background ?? null,
          output_format: outputFormat,
        },
        images: saved.map((s) => ({
          file_path: s.filePath,
          filename: s.filename,
          size_bytes: s.sizeBytes,
          mime_type: s.mimeType,
        })),
        usage: usage ?? null,
        cost_usd_estimated: costUsd,
      },
    },
    saved,
    usage,
    costUsd,
  };
}

function summarize(
  opts: BuildResultOptions,
  saved: SavedImage[],
  usage: Usage | undefined,
  costUsd: number | null,
): string {
  const header = opts.label ?? (saved.length === 1 ? "Generated 1 image" : `Generated ${saved.length} images`);
  const lines: string[] = [`${header} with ${MODEL_ID}.`];
  lines.push(
    `• Applied: size=${opts.requestedSize}, quality=${opts.requestedQuality}, format=${opts.requestedFormat}${usage ? `` : ""}`,
  );
  lines.push(`• Saved to: ${opts.outputDir}`);
  for (const s of saved) {
    lines.push(`  - ${s.filename} (${kb(s.sizeBytes)})`);
  }
  if (usage) {
    lines.push(
      `• Tokens: input=${usage.input_tokens} (text=${usage.input_tokens_details?.text_tokens ?? "?"}, image=${usage.input_tokens_details?.image_tokens ?? 0})` +
        `, output=${usage.output_tokens}`,
    );
  }
  if (costUsd != null) {
    lines.push(`• Estimated cost: ${formatUsd(costUsd)}`);
  }
  return lines.join("\n");
}

function kb(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}
