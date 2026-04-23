import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Return a tool-level error as a CallToolResult. MCP clients see `isError: true`
 * and can surface the message back to the calling model for self-correction.
 * Reserve thrown exceptions for unrecoverable protocol / config errors.
 */
export function toolError(text: string): CallToolResult {
  return {
    content: [{ type: "text", text }],
    isError: true,
  };
}
