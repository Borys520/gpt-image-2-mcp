import { z } from "zod";
import { toFile } from "openai";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type OutputFormat } from "../constants.js";
import { describeOpenAIError, getClient } from "../openai-client.js";
import {
  editViaDirectEndpoint,
  editViaResponses,
  usingDirectEdits,
} from "../utils/edit-via-responses.js";
import { log } from "../utils/logger.js";
import { resolveOutputDir } from "../utils/output-dir.js";
import { buildImageResult } from "../utils/result-builder.js";

type EditSize = "1024x1024" | "1024x1536" | "1536x1024" | "auto";
type EditQuality = "low" | "medium" | "high" | "auto";
import {
  createSession,
  endSession,
  getSession,
  listSessions,
  updateSession,
} from "../utils/session-store.js";
import { loadImage, loadMask } from "../utils/file-input.js";
import { validateSize } from "../utils/size-validator.js";
import {
  backgroundField,
  editQualityField,
  endSessionOutput,
  filenamePrefixField,
  listSessionsOutput,
  maskField,
  outputCompressionField,
  outputDirField,
  outputFormatField,
  promptField,
  sessionImageResultOutput,
  sizeField,
  userField,
} from "./schemas.js";
import { toolError } from "./tool-error.js";

/**
 * Iterative-edit session tools. The Gemini MCP exposes the same shape:
 *   start → one or more continue → end (optional; sessions also decay on server restart).
 *
 * State is held in memory; the last-generated image is re-fed to the API on
 * each continue, so you can iterate "make the sky more orange" → "add clouds"
 * → "now switch to night" without re-supplying reference images.
 */

export function registerSessionTools(server: McpServer): void {
  registerStart(server);
  registerContinue(server);
  registerEnd(server);
  registerList(server);
}

function registerStart(server: McpServer): void {
  const inputSchema = {
    prompt: promptField,
    images: z
      .array(z.string().min(1))
      .min(1)
      .max(8)
      .describe("1–8 input images to seed the session (same source formats as edit_image)."),
    mask: maskField,
    size: sizeField,
    quality: editQualityField,
    background: backgroundField,
    output_format: outputFormatField,
    output_compression: outputCompressionField,
    output_dir: outputDirField,
    filename_prefix: filenamePrefixField,
    user: userField,
  };

  server.registerTool(
    "start_edit_session",
    {
      title: "Start Iterative Edit Session",
      description:
        "Begin a stateful multi-turn edit session. Returns a session_id you then pass to " +
        "continue_edit_session to iteratively refine the image (each turn uses the previous " +
        "turn's output as the input). Use end_edit_session when done.",
      inputSchema,
      outputSchema: sessionImageResultOutput,
      annotations: {
        title: "Start Edit Session",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args): Promise<CallToolResult> => {
      try {
        const sizeCheck = validateSize(args.size ?? "auto");
        if (!sizeCheck.ok) return toolError(sizeCheck.error);
        const outputDir = resolveOutputDir(args.output_dir);
        const outputFormat = (args.output_format ?? "png") as OutputFormat;
        const quality = args.quality ?? "auto";
        const background = args.background ?? "auto";

        const uploadables = await Promise.all(args.images.map((s) => loadImage(s)));
        const mask = args.mask ? await loadMask(args.mask) : undefined;

        const useDirect = usingDirectEdits();

        log.info("start_edit_session", {
          promptPreview: args.prompt.slice(0, 80),
          inputCount: args.images.length,
          route: useDirect ? "direct" : "responses",
        });

        const client = getClient();
        const editParams = {
          prompt: args.prompt,
          images: uploadables,
          mask,
          size: sizeCheck.canonical as EditSize,
          quality: quality as EditQuality,
          background,
          output_format: args.output_format,
          output_compression: args.output_compression,
          user: args.user,
        };
        const res = useDirect
          ? await editViaDirectEndpoint(client, editParams)
          : await editViaResponses(client, editParams);

        const built = buildImageResult({
          response: res,
          outputDir,
          filenamePrefix: "session",
          filenameExtra: `${args.filename_prefix ?? "turn1"}`,
          requestedSize: sizeCheck.canonical,
          requestedQuality: String(quality),
          requestedN: 1,
          requestedFormat: outputFormat,
          prompt: args.prompt,
          label: "Started edit session",
        });

        const first = built.saved[0]!;
        const session = createSession({
          lastImageBase64: first.base64,
          lastImageMime: first.mimeType,
          lastImagePath: first.filePath,
          lastPrompt: args.prompt,
          outputDir,
          outputFormat,
        });

        return addSessionIdToResult(built.result, session.id, session.turnCount);
      } catch (err) {
        const msg = describeOpenAIError(err);
        log.error("start_edit_session failed", msg);
        return toolError(msg);
      }
    },
  );
}

function registerContinue(server: McpServer): void {
  const inputSchema = {
    session_id: z.string().min(1).describe("The session id returned by start_edit_session."),
    prompt: promptField,
    size: sizeField,
    quality: editQualityField,
    background: backgroundField,
    output_format: outputFormatField,
    output_compression: outputCompressionField,
    filename_prefix: filenamePrefixField,
    user: userField,
  };

  server.registerTool(
    "continue_edit_session",
    {
      title: "Continue Edit Session",
      description:
        "Apply another edit turn to an existing session. The previous turn's output image is " +
        "used as the input. Use short, focused prompts like \"make the sky more orange\" or " +
        "\"add a small boat on the horizon\"; include \"keep everything else the same\" to " +
        "limit drift. Returns the new image and the updated session.",
      inputSchema,
      outputSchema: sessionImageResultOutput,
      annotations: {
        title: "Continue Edit Session",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args): Promise<CallToolResult> => {
      try {
        const session = getSession(args.session_id);
        if (!session) {
          return toolError(
            `Session "${args.session_id}" not found. Call start_edit_session first, or list_edit_sessions to see active sessions.`,
          );
        }
        const sizeCheck = validateSize(args.size ?? "auto");
        if (!sizeCheck.ok) return toolError(sizeCheck.error);
        const outputFormat = (args.output_format ?? session.outputFormat) as OutputFormat;
        const quality = args.quality ?? "auto";

        log.info("continue_edit_session", {
          session_id: session.id,
          turn: session.turnCount + 1,
          promptPreview: args.prompt.slice(0, 80),
        });

        const buf = Buffer.from(session.lastImageBase64, "base64");
        const ext = session.outputFormat;
        const prevFile = await toFile(buf, `session-${session.id}-prev.${ext}`, { type: session.lastImageMime });
        const background = args.background ?? "auto";

        const useDirect = usingDirectEdits();
        const client = getClient();
        const editParams = {
          prompt: args.prompt,
          images: [prevFile],
          size: sizeCheck.canonical as EditSize,
          quality: quality as EditQuality,
          background,
          output_format: args.output_format,
          output_compression: args.output_compression,
          user: args.user,
        };
        const res = useDirect
          ? await editViaDirectEndpoint(client, editParams)
          : await editViaResponses(client, editParams);

        const built = buildImageResult({
          response: res,
          outputDir: session.outputDir,
          filenamePrefix: "session",
          filenameExtra: `${args.filename_prefix ?? session.id}-turn${session.turnCount + 1}`,
          requestedSize: sizeCheck.canonical,
          requestedQuality: String(quality),
          requestedN: 1,
          requestedFormat: outputFormat,
          prompt: args.prompt,
          label: `Session ${session.id} — turn ${session.turnCount + 1}`,
        });

        const saved = built.saved[0]!;
        const updatedSession = updateSession(session.id, {
          prompt: args.prompt,
          base64: saved.base64,
          mime: saved.mimeType,
          filePath: saved.filePath,
          outputFormat,
        });

        return addSessionIdToResult(built.result, updatedSession.id, updatedSession.turnCount);
      } catch (err) {
        const msg = describeOpenAIError(err);
        log.error("continue_edit_session failed", msg);
        return toolError(msg);
      }
    },
  );
}

function registerEnd(server: McpServer): void {
  const inputSchema = {
    session_id: z.string().min(1).describe("The session id to end."),
  };
  server.registerTool(
    "end_edit_session",
    {
      title: "End Edit Session",
      description:
        "Free an iterative-edit session. Safe to skip — sessions are in-memory only and are " +
        "discarded on server restart — but calling this frees memory sooner and keeps " +
        "list_edit_sessions tidy.",
      inputSchema,
      outputSchema: endSessionOutput,
      annotations: {
        title: "End Edit Session",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args): Promise<CallToolResult> => {
      const existed = endSession(args.session_id);
      return {
        content: [
          {
            type: "text",
            text: existed
              ? `Ended session ${args.session_id}.`
              : `Session ${args.session_id} was not active (nothing to do).`,
          },
        ],
        structuredContent: { ended: existed, session_id: args.session_id },
      };
    },
  );
}

function registerList(server: McpServer): void {
  const inputSchema = {};
  server.registerTool(
    "list_edit_sessions",
    {
      title: "List Edit Sessions",
      description:
        "List active iterative-edit sessions (in-memory only, discarded on server restart). " +
        "Useful to recover a session_id after a client reconnect.",
      inputSchema,
      outputSchema: listSessionsOutput,
      annotations: {
        title: "List Edit Sessions",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (): Promise<CallToolResult> => {
      const list = listSessions().map((s) => ({
        session_id: s.id,
        created_at: new Date(s.createdAt).toISOString(),
        updated_at: new Date(s.updatedAt).toISOString(),
        turns: s.turnCount,
        last_prompt: s.lastPrompt,
        last_image_path: s.lastImagePath,
      }));
      const text =
        list.length === 0
          ? "No active edit sessions."
          : `Active sessions (${list.length}):\n` +
            list
              .map(
                (s, i) =>
                  `  ${i + 1}. ${s.session_id} — ${s.turns} turn(s), last: "${s.last_prompt.slice(0, 60)}" → ${s.last_image_path}`,
              )
              .join("\n");
      return {
        content: [{ type: "text", text }],
        structuredContent: { sessions: list },
      };
    },
  );
}

function addSessionIdToResult(
  result: CallToolResult,
  sessionId: string,
  turn: number,
): CallToolResult {
  const sc = (result.structuredContent ?? {}) as Record<string, unknown>;
  return {
    ...result,
    content: [
      ...result.content,
      { type: "text", text: `session_id: ${sessionId} (turn ${turn})` },
    ],
    structuredContent: {
      ...sc,
      session_id: sessionId,
      turn,
    },
  };
}
