import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type OutputFormat } from "../constants.js";
import { describeOpenAIError, getClient } from "../openai-client.js";
import { editViaResponses } from "../utils/edit-via-responses.js";
import { loadImage, loadMask, validateEditImageCount } from "../utils/file-input.js";
import { log } from "../utils/logger.js";
import { resolveOutputDir } from "../utils/output-dir.js";
import { buildImageResult } from "../utils/result-builder.js";
import { validateSize } from "../utils/size-validator.js";

type EditSize = "1024x1024" | "1024x1536" | "1536x1024" | "auto";
type EditQuality = "low" | "medium" | "high" | "auto";
import {
  backgroundField,
  editQualityField,
  filenamePrefixField,
  imagesArrayField,
  maskField,
  nField,
  outputCompressionField,
  outputDirField,
  outputFormatField,
  promptField,
  sizeField,
  userField,
} from "./schemas.js";

const inputSchema = {
  prompt: promptField,
  images: imagesArrayField,
  mask: maskField,
  size: sizeField,
  quality: editQualityField,
  n: nField,
  background: backgroundField,
  output_format: outputFormatField,
  output_compression: outputCompressionField,
  output_dir: outputDirField,
  filename_prefix: filenamePrefixField,
  user: userField,
};

export function registerEditImage(server: McpServer): void {
  server.registerTool(
    "edit_image",
    {
      title: "Edit Image",
      description:
        "Edit or compose images with gpt-image-2. Give 1–8 input images plus a text prompt; " +
        "optionally include a PNG mask whose transparent regions mark what to change " +
        "(mask applies to the first image). Great for: swap backgrounds, retouch products, " +
        "combine multiple reference images into one composition, maintain a character across scenes. " +
        "gpt-image-2 always processes inputs at high fidelity (no input_fidelity knob needed). " +
        "The edited image is saved to disk and returned inline.",
      inputSchema,
      annotations: {
        title: "Edit Image",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args): Promise<CallToolResult> => {
      try {
        validateEditImageCount(args.images.length);
        const sizeCheck = validateSize(args.size ?? "auto");
        if (!sizeCheck.ok) return toolError(sizeCheck.error);

        const outputDir = resolveOutputDir(args.output_dir);
        const outputFormat = (args.output_format ?? "png") as OutputFormat;
        const quality = args.quality ?? "auto";
        const background = args.background ?? "auto";
        const n = args.n ?? 1;

        if (n > 1) {
          log.warn(
            `edit_image: requested n=${n}, but routed via Responses API which returns 1 image per call. Clamping to n=1. (We'll restore n>1 once OpenAI fixes /v1/images/edits for gpt-image-2.)`,
          );
        }

        log.info("edit_image call", {
          promptPreview: args.prompt.slice(0, 80),
          inputCount: args.images.length,
          hasMask: !!args.mask,
          size: sizeCheck.canonical,
          quality,
          background,
          n: 1,
          route: "responses",
        });

        const uploadables = await Promise.all(args.images.map((s) => loadImage(s)));
        const mask = args.mask ? await loadMask(args.mask) : undefined;

        const client = getClient();
        const res = await editViaResponses(client, {
          prompt: args.prompt,
          images: uploadables,
          mask,
          size: sizeCheck.canonical as EditSize,
          quality: quality as EditQuality,
          background,
          output_format: args.output_format,
          output_compression: args.output_compression,
          user: args.user,
        });

        const built = buildImageResult({
          response: res,
          outputDir,
          filenamePrefix: "edit",
          filenameExtra: args.filename_prefix,
          requestedSize: sizeCheck.canonical,
          requestedQuality: String(quality),
          requestedN: 1,
          requestedFormat: outputFormat,
          prompt: args.prompt,
          label: "Edited 1 image (via Responses API)",
        });
        return built.result;
      } catch (err) {
        const msg = describeOpenAIError(err);
        log.error("edit_image failed", msg);
        return toolError(msg);
      }
    },
  );
}

function toolError(text: string): CallToolResult {
  return {
    content: [{ type: "text", text }],
    isError: true,
  };
}
