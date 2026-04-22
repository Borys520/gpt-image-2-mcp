/**
 * stderr-only logger. NEVER use stdout — MCP reserves it for JSON-RPC.
 * Writing to stdout silently corrupts the protocol and kills the client.
 */

type Level = "debug" | "info" | "warn" | "error";

const ENABLED: Record<Level, boolean> = {
  debug: process.env.GPT_IMAGE_2_MCP_DEBUG === "1" || process.env.GPT_IMAGE_2_MCP_DEBUG === "true",
  info: true,
  warn: true,
  error: true,
};

function emit(level: Level, parts: unknown[]): void {
  if (!ENABLED[level]) return;
  const ts = new Date().toISOString();
  const prefix = `[gpt-image-2-mcp ${ts} ${level}]`;
  const line = parts
    .map((p) => (typeof p === "string" ? p : safeStringify(p)))
    .join(" ");
  process.stderr.write(`${prefix} ${line}\n`);
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export const log = {
  debug: (...parts: unknown[]) => emit("debug", parts),
  info: (...parts: unknown[]) => emit("info", parts),
  warn: (...parts: unknown[]) => emit("warn", parts),
  error: (...parts: unknown[]) => emit("error", parts),
};
