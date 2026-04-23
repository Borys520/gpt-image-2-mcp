import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { log } from "./logger.js";
import { assertSafeOutputDir } from "./path-guard.js";

/**
 * Resolve the default output directory for generated images, mirroring the
 * pattern from the local Gemini MCP server:
 *
 *   1. $GPT_IMAGE_2_OUTPUT_DIR if set — absolute honors, relative resolves from CWD
 *   2. Platform config dir + "/gpt-image-2-mcp/output/" + short hash of
 *      (git-root || process.cwd()) so each project gets its own folder
 *
 * The directory is created lazily the first time an image is saved.
 */

const APP_NAME = "gpt-image-2-mcp";

let cachedDefaultDir: string | undefined;

export function getDefaultOutputDir(): string {
  if (cachedDefaultDir) return cachedDefaultDir;
  const override = process.env.GPT_IMAGE_2_OUTPUT_DIR?.trim();
  if (override) {
    cachedDefaultDir = path.isAbsolute(override)
      ? override
      : path.resolve(process.cwd(), override);
    return cachedDefaultDir;
  }
  const base = configRoot();
  const projectKey = projectKeyFromCwd();
  cachedDefaultDir = path.join(base, APP_NAME, "output", projectKey);
  return cachedDefaultDir;
}

export function resolveOutputDir(explicit?: string | null): string {
  const resolved =
    explicit && explicit.trim().length > 0
      ? path.isAbsolute(explicit)
        ? explicit
        : path.resolve(process.cwd(), explicit)
      : getDefaultOutputDir();
  assertSafeOutputDir(resolved);
  return resolved;
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function configRoot(): string {
  if (process.platform === "win32") {
    return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  }
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
}

function projectKeyFromCwd(): string {
  const cwd = process.cwd();
  const root = gitRootOrNull(cwd) ?? cwd;
  const resolved = (() => {
    try {
      return fs.realpathSync(root);
    } catch {
      return root;
    }
  })();
  const basename = path.basename(resolved).replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 40);
  const hash = createHash("sha256").update(resolved).digest("hex").slice(0, 12);
  return basename ? `${basename}-${hash}` : hash;
}

function gitRootOrNull(cwd: string): string | null {
  try {
    const out = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
      timeout: 2_000,
    }).trim();
    return out || null;
  } catch (err) {
    log.debug("git rev-parse failed (not a git repo)", (err as Error).message);
    return null;
  }
}
