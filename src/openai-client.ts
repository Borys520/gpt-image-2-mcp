import OpenAI, { APIError } from "openai";
import { log } from "./utils/logger.js";

let cached: OpenAI | undefined;

/**
 * Lazy singleton — the API key is only required when a tool is actually
 * invoked. This lets the server start cleanly even without a key set,
 * useful for `--help` / tool listing via MCP Inspector.
 */
export function getClient(): OpenAI {
  if (cached) return cached;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ConfigError(
      "OPENAI_API_KEY is not set. Add it to the MCP server's `env` block in your client config.",
    );
  }
  const base = process.env.OPENAI_BASE_URL?.trim();
  const organization = process.env.OPENAI_ORG_ID?.trim();
  const project = process.env.OPENAI_PROJECT_ID?.trim();
  cached = new OpenAI({
    apiKey,
    ...(base ? { baseURL: base } : {}),
    ...(organization ? { organization } : {}),
    ...(project ? { project } : {}),
  });
  log.info("OpenAI client initialized", {
    baseURL: base ?? "default",
    hasOrg: !!organization,
    hasProject: !!project,
  });
  return cached;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Translate an OpenAI SDK error into a short, user-facing string for a
 * tool-level error. Keeps internal details (traces, request IDs) in stderr
 * logs rather than the model-visible response.
 */
export function describeOpenAIError(err: unknown): string {
  if (err instanceof ConfigError) return err.message;
  if (err instanceof APIError) {
    const parts = [`OpenAI API error ${err.status ?? "?"}`];
    if (err.code) parts.push(`code=${err.code}`);
    if (err.message) parts.push(err.message);
    if (err.status === 400 && /model|gpt-image-2/i.test(err.message ?? "")) {
      parts.push("(verify your org has access to gpt-image-2 — may require Organization Verification)");
    }
    if (err.status === 401) parts.push("(check OPENAI_API_KEY)");
    if (err.status === 429) parts.push("(rate limit or quota — retry or reduce n/quality)");
    return parts.join(" — ");
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
