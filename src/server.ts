import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGenerateImage } from "./tools/generate-image.js";
import { registerEditImage } from "./tools/edit-image.js";
import { registerSessionTools } from "./tools/session-tools.js";
import { getDefaultOutputDir } from "./utils/output-dir.js";

function readPackageMetadata(): { name: string; version: string } {
  // package.json lives at the repo/package root regardless of whether this
  // file runs from `src/` (tsx) or `build/` (compiled) — npm always includes
  // package.json in the published tarball.
  try {
    const pkgUrl = new URL("../package.json", import.meta.url);
    const raw = readFileSync(fileURLToPath(pkgUrl), "utf8");
    const pkg = JSON.parse(raw) as { name?: string; version?: string };
    return {
      name: pkg.name ?? "gpt-image-2-mcp",
      version: pkg.version ?? "0.0.0",
    };
  } catch {
    return { name: "gpt-image-2-mcp", version: "0.0.0" };
  }
}

const { name: PKG_NAME, version: PKG_VERSION } = readPackageMetadata();

export function createServer(): McpServer {
  const server = new McpServer(
    { name: PKG_NAME, version: PKG_VERSION },
    {
      instructions:
        [
          "This server wraps OpenAI's gpt-image-2 image model.",
          "",
          "Tools:",
          "  • generate_image              — text → image",
          "  • edit_image                  — 1–8 input images (+ optional mask) → image",
          "  • start_edit_session          — begin an iterative multi-turn edit",
          "  • continue_edit_session       — apply another refinement turn",
          "  • end_edit_session            — release a session",
          "  • list_edit_sessions          — discover active sessions",
          "",
          `Generated images are saved to disk at ${getDefaultOutputDir()} by default (override per-call via \`output_dir\`, or globally via the GPT_IMAGE_2_OUTPUT_DIR env var). File paths are returned in each tool result's structuredContent.`,
          "",
          "Size defaults to \"auto\". Custom sizes must be multiples of 16 per edge, max edge 3840px, aspect ratio within 1:3–3:1, total pixels 655,360–8,294,400.",
          "",
          "gpt-image-2 does NOT support transparent backgrounds. For transparent PNGs, a different model is required.",
        ].join("\n"),
    },
  );

  registerGenerateImage(server);
  registerEditImage(server);
  registerSessionTools(server);

  return server;
}
