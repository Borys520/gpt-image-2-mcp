#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { log } from "./utils/logger.js";
import { getDefaultOutputDir } from "./utils/output-dir.js";

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info(
    "gpt-image-2-mcp running on stdio",
    `outputDir=${getDefaultOutputDir()}`,
    `node=${process.version}`,
  );
}

main().catch((err) => {
  log.error("fatal startup error", err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
