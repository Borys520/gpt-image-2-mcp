import type OpenAI from "openai";
import type { Uploadable } from "openai";
import type { ImagesResponse } from "openai/resources/images";
import { MODEL_ID } from "../constants.js";
import { log } from "./logger.js";

/**
 * Route image edits through the Responses API's `image_generation` tool
 * instead of `/v1/images/edits`. At launch (2026-04-21) the direct edit
 * endpoint rejects `gpt-image-2` with `400 Invalid value: 'gpt-image-2'.
 * Value must be 'dall-e-2'.` — an acknowledged OpenAI-side bug affecting
 * gpt-image-1.5 and gpt-image-2 alike. The Responses path is documented
 * to work today and supports masks, sizes, quality, background, etc.
 *
 * The trade-off: this path requires a cheap "host" chat model (default
 * `gpt-4.1-mini`, overridable via `OPENAI_RESPONSES_EDIT_MODEL`) that
 * decides to invoke the image_generation tool — we force it via
 * `tool_choice: { type: 'image_generation' }`. A few hundred extra text
 * tokens per edit call (typically <$0.001).
 */

export interface EditViaResponsesParams {
  prompt: string;
  images: Uploadable[];
  mask?: Uploadable;
  size?: "1024x1024" | "1024x1536" | "1536x1024" | "auto";
  quality?: "low" | "medium" | "high" | "auto";
  background?: "transparent" | "opaque" | "auto";
  output_format?: "png" | "jpeg" | "webp";
  output_compression?: number;
  moderation?: "low" | "auto";
  user?: string;
}

const HOST_MODEL = process.env.OPENAI_RESPONSES_EDIT_MODEL || "gpt-4.1-mini";

export async function editViaResponses(
  client: OpenAI,
  params: EditViaResponsesParams,
): Promise<ImagesResponse> {
  const uploadedFileIds: string[] = [];
  let maskFileId: string | undefined;

  try {
    log.info(
      `editViaResponses: uploading ${params.images.length} image(s)${params.mask ? " + mask" : ""} as files, host_model=${HOST_MODEL}`,
    );
    for (const img of params.images) {
      const f = await client.files.create({ file: img, purpose: "vision" });
      uploadedFileIds.push(f.id);
    }
    if (params.mask) {
      const mf = await client.files.create({ file: params.mask, purpose: "vision" });
      maskFileId = mf.id;
    }

    const userContent: Array<
      | { type: "input_text"; text: string }
      | { type: "input_image"; file_id: string; detail: "auto" | "low" | "high" }
    > = [{ type: "input_text", text: params.prompt }];
    for (const fid of uploadedFileIds) {
      userContent.push({ type: "input_image", file_id: fid, detail: "auto" });
    }

    const imageTool: Record<string, unknown> = {
      type: "image_generation",
      model: MODEL_ID,
      action: "edit",
    };
    if (params.size && params.size !== "auto") imageTool.size = params.size;
    if (params.quality && params.quality !== "auto") imageTool.quality = params.quality;
    if (params.background && params.background !== "auto") imageTool.background = params.background;
    if (params.output_format) imageTool.output_format = params.output_format;
    if (params.output_compression != null) imageTool.output_compression = params.output_compression;
    if (params.moderation && params.moderation !== "auto") imageTool.moderation = params.moderation;
    if (maskFileId) imageTool.input_image_mask = { file_id: maskFileId };

    const resp = await client.responses.create({
      model: HOST_MODEL,
      input: [{ role: "user", content: userContent }] as never,
      tools: [imageTool as never],
      tool_choice: { type: "image_generation" },
      ...(params.user ? { user: params.user } : {}),
    });

    const call = resp.output?.find(
      (o): o is typeof o & { type: "image_generation_call"; result: string | null; status: string } =>
        o.type === "image_generation_call",
    );
    if (!call) {
      const outTypes = (resp.output ?? []).map((o) => o.type).join(", ") || "none";
      throw new Error(
        `Responses API did not return an image_generation_call output (got: ${outTypes}). The host model may have refused to invoke the tool.`,
      );
    }
    if (call.status !== "completed") {
      throw new Error(`Image edit did not complete: status=${call.status}.`);
    }
    if (!call.result) {
      throw new Error("Responses API returned image_generation_call with no base64 result.");
    }

    const usage = resp.usage
      ? {
          input_tokens: resp.usage.input_tokens ?? 0,
          output_tokens: resp.usage.output_tokens ?? 0,
          total_tokens: resp.usage.total_tokens ?? 0,
          input_tokens_details: {
            text_tokens:
              (resp.usage.input_tokens_details as { text_tokens?: number } | undefined)?.text_tokens ??
              resp.usage.input_tokens ??
              0,
            image_tokens:
              (resp.usage.input_tokens_details as { image_tokens?: number } | undefined)?.image_tokens ?? 0,
          },
          output_tokens_details: {
            image_tokens:
              (resp.usage.output_tokens_details as { image_tokens?: number } | undefined)?.image_tokens ??
              resp.usage.output_tokens ??
              0,
            text_tokens:
              (resp.usage.output_tokens_details as { text_tokens?: number } | undefined)?.text_tokens ?? 0,
          },
        }
      : undefined;

    return {
      created: Math.floor(Date.now() / 1000),
      data: [{ b64_json: call.result }],
      ...(imageTool.size ? { size: imageTool.size as "1024x1024" } : {}),
      ...(imageTool.quality ? { quality: imageTool.quality as "low" | "medium" | "high" } : {}),
      ...(imageTool.background ? { background: imageTool.background as "opaque" | "transparent" } : {}),
      ...(imageTool.output_format ? { output_format: imageTool.output_format as "png" | "jpeg" | "webp" } : {}),
      ...(usage ? { usage } : {}),
    } as ImagesResponse;
  } finally {
    await Promise.allSettled([
      ...uploadedFileIds.map((id) =>
        client.files.delete(id).catch((err) => log.debug("cleanup file delete failed", id, (err as Error).message)),
      ),
      ...(maskFileId
        ? [client.files.delete(maskFileId).catch((err) => log.debug("cleanup mask delete failed", (err as Error).message))]
        : []),
    ]);
  }
}
