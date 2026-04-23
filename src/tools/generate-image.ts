import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { MODEL_ID, type OutputFormat } from "../constants.js";
import { describeOpenAIError, getClient } from "../openai-client.js";
import { approximateCost, formatUsd } from "../utils/cost.js";
import { log } from "../utils/logger.js";
import { resolveOutputDir } from "../utils/output-dir.js";
import { buildImageResult } from "../utils/result-builder.js";
import { validateSize } from "../utils/size-validator.js";
import {
  backgroundField,
  filenamePrefixField,
  imageResultOutput,
  moderationField,
  nField,
  outputCompressionField,
  outputDirField,
  outputFormatField,
  promptField,
  qualityField,
  sizeField,
  userField,
} from "./schemas.js";
import { toolError } from "./tool-error.js";

const inputSchema = {
  prompt: promptField,
  size: sizeField,
  quality: qualityField,
  n: nField,
  background: backgroundField,
  output_format: outputFormatField,
  output_compression: outputCompressionField,
  moderation: moderationField,
  output_dir: outputDirField,
  filename_prefix: filenamePrefixField,
  user: userField,
};

export function registerGenerateImage(server: McpServer): void {
  server.registerTool(
    "generate_image",
    {
      title: "Generate Image",
      description:
        "Generate an image from a text prompt using OpenAI's gpt-image-2 model. " +
        "The image is written to disk and also returned inline so you can see it. " +
        "gpt-image-2 handles photoreal, illustrations, infographics, multilingual text (incl. CJK), " +
        "and complex structured visuals. It does NOT support transparent backgrounds. " +
        'Sizes accept presets or any custom "WxH" where edges are multiples of 16, max edge 3840px, ' +
        "aspect ratio within 1:3–3:1, total pixels 655K–8.29M.",
      inputSchema,
      outputSchema: imageResultOutput,
      annotations: {
        title: "Generate Image",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args): Promise<CallToolResult> => {
      try {
        const sizeCheck = validateSize(args.size ?? "auto");
        if (!sizeCheck.ok) {
          return toolError(sizeCheck.error);
        }
        const outputDir = resolveOutputDir(args.output_dir);
        const outputFormat = (args.output_format ?? "png") as OutputFormat;
        const quality = args.quality ?? "auto";
        const n = args.n ?? 1;

        const priceHint = approximateCost({ quality, size: sizeCheck.canonical, n });
        log.info("generate_image call", {
          promptPreview: args.prompt.slice(0, 80),
          size: sizeCheck.canonical,
          quality,
          n,
          outputFormat,
          priceHint: formatUsd(priceHint),
        });

        const client = getClient();
        const res = await client.images.generate({
          model: MODEL_ID,
          prompt: args.prompt,
          size: sizeCheck.canonical === "auto" ? "auto" : (sizeCheck.canonical as "1024x1024"),
          quality,
          n,
          background: args.background ?? "auto",
          output_format: outputFormat,
          ...(args.output_compression != null ? { output_compression: args.output_compression } : {}),
          moderation: args.moderation ?? "auto",
          ...(args.user ? { user: args.user } : {}),
        });

        const built = buildImageResult({
          response: res,
          outputDir,
          filenamePrefix: "image",
          filenameExtra: args.filename_prefix,
          requestedSize: sizeCheck.canonical,
          requestedQuality: String(quality),
          requestedN: n,
          requestedFormat: outputFormat,
          prompt: args.prompt,
        });
        return built.result;
      } catch (err) {
        const msg = describeOpenAIError(err);
        log.error("generate_image failed", msg);
        return toolError(msg);
      }
    },
  );
}
