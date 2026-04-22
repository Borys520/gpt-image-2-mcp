# gpt_image_2_mcp — Research Brief

> Compiled 2026-04-22, one day after `gpt-image-2` shipped. This is the reference for the build phase — every parameter, limit, and design decision captured here is sourced from OpenAI docs, the openai-node SDK source, and the MCP TypeScript SDK docs. When the SDK and the OpenAI platform docs disagree, the platform guide wins (the SDK lags behind by one release).

---

## 1. gpt-image-2 API — Canonical Reference

### 1.1 Model identity

| Field | Value |
|---|---|
| Model ID | `gpt-image-2` |
| Snapshot | `gpt-image-2-2026-04-21` |
| Released | 2026-04-21 |
| Classification | State-of-the-art image generation |
| Performance tier | Highest |
| Speed tier | Medium |

### 1.2 Endpoints

| Endpoint | Supported | Notes |
|---|---|---|
| `POST /v1/images/generations` | ✅ | Text → image |
| `POST /v1/images/edits` | ✅ | Image(s) [+ optional mask] → image |
| `POST /v1/images/variations` | ❌ | `dall-e-2` only |
| `POST /v1/chat/completions` | ✅ | Via tool use |
| `POST /v1/responses` | ✅ | Built-in `image_generation` tool |

The Responses API gives you conversational, multi-turn editing via `previous_response_id` and `image_generation_call.id` references. For an MCP server, the standalone `/v1/images/*` endpoints are simpler and sufficient — the MCP client's LLM handles the "conversation."

### 1.3 Generation parameters (`/v1/images/generations`)

All fields except `prompt` are optional. Defaults noted.

| Field | Type | Default | Allowed / Notes |
|---|---|---|---|
| `prompt` | string (req) | — | Max 32,000 chars |
| `model` | string | `dall-e-2` | **Pass `"gpt-image-2"`** |
| `n` | int | 1 | 1–10 |
| `size` | string | `auto` | `auto`, `1024x1024`, `1536x1024`, `1024x1536`, **or any custom WxH** meeting constraints below |
| `quality` | string | `auto` | `low`, `medium`, `high`, `auto` |
| `background` | string | `auto` | `opaque`, `auto` — **`transparent` NOT supported on gpt-image-2** (use gpt-image-1.5 for transparent PNGs) |
| `output_format` | string | `png` | `png`, `jpeg`, `webp` |
| `output_compression` | int 0–100 | 100 | webp/jpeg only |
| `moderation` | string | `auto` | `auto` (stricter), `low` (looser) |
| `stream` | bool | `false` | SSE; see §1.7 |
| `partial_images` | int | 0 | 0–3; **each +100 output tokens** |
| `response_format` | — | — | **Not supported** — gpt-image-2 always returns `b64_json` |
| `user` | string | — | End-user identifier for abuse monitoring |
| `input_fidelity` | — | — | **Not supported** on gpt-image-2 (model always processes inputs at high fidelity; inputs may cost more tokens) |
| `style` | — | — | `dall-e-3` only |

**Custom size constraints** (verbatim from guide):

- Max edge ≤ 3840 px
- Both edges divisible by 16
- Aspect ratio between 3:1 (wide) and 1:3 (tall)
- Total pixels between 655,360 and 8,294,400

Common sizes: 1024×1024, 2048×2048, 1536×1024, 2048×1152, 3840×2160, 1024×1536, 2160×3840.

> ⚠️ "Outputs above 2K are still in beta and may produce inconsistent results."

### 1.4 Edit parameters (`/v1/images/edits`)

Same as generations, plus:

| Field | Type | Notes |
|---|---|---|
| `image` | file or array | **Up to 16 files**, each PNG/WEBP/JPG < 50MB. The announcement claimed "up to 8" — SDK source says 16. Treat 8 as the practical ceiling, 16 as hard limit. |
| `mask` | PNG file | Fully transparent regions (alpha=0) mark editable areas. Applied to the **first** `image`. Must match dimensions of first image. < 4MB. |

Quality options for edits: `standard`, `low`, `medium`, `high`, `auto` (default). Size options same as generate minus 256x256/512x512.

### 1.5 Response schema

```ts
{
  created: number,                              // Unix seconds
  background?: 'transparent' | 'opaque',
  output_format?: 'png' | 'webp' | 'jpeg',
  quality?: 'low' | 'medium' | 'high',
  size?: '1024x1024' | '1024x1536' | '1536x1024', // or custom echo
  data?: Array<{
    b64_json?: string,       // always populated for gpt-image-2
    url?: string,            // never for gpt-image-2
    revised_prompt?: string  // dall-e-3 only
  }>,
  usage?: {
    input_tokens: number,
    output_tokens: number,
    total_tokens: number,
    input_tokens_details: { text_tokens: number, image_tokens: number },
    output_tokens_details?: { image_tokens: number, text_tokens: number }
  }
}
```

### 1.6 Pricing

**Token pricing (per 1M tokens):**
- Image: $8.00 input / $2.00 cached input / $30.00 output
- Text:  $5.00 input / $1.25 cached input / $10.00 output

**Approximate per-image pricing (verified from guide):**

| Quality | 1024×1024 | 1024×1536 | 1536×1024 |
|---|---|---|---|
| low | $0.006 | $0.005 | $0.005 |
| medium | $0.053 | $0.041 | $0.041 |
| high | $0.211 | $0.165 | $0.165 |

Input images (edits) cost extra — gpt-image-2 tokenizes them at high fidelity.

### 1.7 Streaming

When `stream: true` the API emits SSE events:

```
event: image_generation.partial_image
data: { type, b64_json, partial_image_index, background, output_format, quality, size, created_at }

event: image_generation.completed
data: { type, b64_json, usage: {...}, ... }
```

Edit variants: `image_edit.partial_image`, `image_edit.completed`.

> The model page lists "Streaming: Not supported" in a generic feature grid — this refers to chat-completion-style token streaming. The `/v1/images/*` endpoints DO support partial-image SSE. The openai-node SDK defines `ImageGenStreamEvent` and `ImageEditStreamEvent` types, and generate/edit have `ImageGenerateParamsStreaming` variants with `stream: true`. Don't be thrown by the mixed signals.

### 1.8 Rate limits

| Tier | TPM | IPM |
|---|---|---|
| 1 | 100,000 | 5 |
| 2 | 250,000 | 20 |
| 3 | 800,000 | 50 |
| 4 | 3,000,000 | 150 |
| 5 | 8,000,000 | 250 |

### 1.9 Org verification requirement

> "API Organization Verification applies before using any GPT Image model."

---

## 2. openai-node SDK — usage patterns

Package: `openai` (latest v6.x).

### 2.1 Key caveat

The SDK's `ImageModel` union:

```ts
export type ImageModel = 'gpt-image-1.5' | 'dall-e-2' | 'dall-e-3' | 'gpt-image-1' | 'gpt-image-1-mini';
```

**Does not yet list `gpt-image-2`** (the SDK lags the launch by a day). But the `model` param type is `(string & {}) | ImageModel | null`, so we pass `"gpt-image-2"` as a plain string — fully functional, just not in autocomplete.

### 2.2 Generate

```ts
import OpenAI from 'openai';
const client = new OpenAI();

const res = await client.images.generate({
  model: 'gpt-image-2',
  prompt: 'A cute baby sea otter holding a tiny violin',
  size: '1024x1024',
  quality: 'high',
  n: 1,
});
const b64 = res.data![0].b64_json!;
```

### 2.3 Edit

```ts
import fs from 'node:fs';

const res = await client.images.edit({
  model: 'gpt-image-2',
  image: [
    fs.createReadStream('body-lotion.png'),
    fs.createReadStream('bath-bomb.png'),
  ],
  prompt: 'Combine these products into a spa gift box hero shot',
});
```

For Buffer input, use `OpenAI.toFile(buf, 'name.png', { type: 'image/png' })`.

### 2.4 Stream

```ts
const stream = await client.images.generate({
  model: 'gpt-image-2',
  prompt: '...',
  stream: true,
  partial_images: 2,
});
for await (const event of stream) {
  if (event.type === 'image_generation.partial_image') { /* render preview */ }
  if (event.type === 'image_generation.completed') { /* final */ }
}
```

### 2.5 Error handling

`openai` throws `OpenAI.APIError` subclasses: `BadRequestError` (400), `AuthenticationError` (401), `PermissionDeniedError` (403), `NotFoundError` (404), `RateLimitError` (429), `InternalServerError` (5xx). Each has `.status`, `.code`, `.message`.

---

## 3. MCP TypeScript SDK — essentials

Package: `@modelcontextprotocol/sdk` (import paths: `@modelcontextprotocol/sdk/server/mcp.js`, `@modelcontextprotocol/sdk/server/stdio.js`).

### 3.1 Minimal server

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod';

const server = new McpServer(
  { name: 'gpt-image-2', version: '0.1.0' },
  {
    capabilities: { logging: {} },
    instructions: 'Use generate_image for text-to-image; edit_image when provided with reference images.',
  },
);

// register tools here...

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('gpt-image-2 MCP running on stdio'); // stderr, never stdout
```

### 3.2 Tool registration (preferred `registerTool` API)

```ts
server.registerTool(
  'generate_image',
  {
    title: 'Generate Image',
    description: 'Generate an image from a text prompt using gpt-image-2.',
    inputSchema: z.object({
      prompt: z.string().max(32000).describe('Image description'),
      size: z.enum(['auto', '1024x1024', '1536x1024', '1024x1536']).default('auto'),
      quality: z.enum(['low', 'medium', 'high', 'auto']).default('auto'),
      n: z.number().int().min(1).max(10).default(1),
    }),
    annotations: {
      title: 'Generate Image',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,  // calls external API
    },
  },
  async (args) => {
    // ...call openai, return content blocks...
  },
);
```

Key fields in tool config:
- `title` — human-friendly name for UIs
- `description` — **what the LLM reads to decide when to call** — be specific
- `inputSchema` — Zod object (SDK validates args before handler runs)
- `outputSchema` — optional Zod for `structuredContent`
- `annotations` — hints for clients (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`)

### 3.3 CallToolResult content blocks

A tool returns `{ content: ContentBlock[], structuredContent?, isError? }`. Content block shapes (MCP 2025-06-18 spec):

```ts
// Text
{ type: 'text', text: string }

// Image — THIS IS WHAT WE RETURN
{ type: 'image', data: string /* base64 */, mimeType: 'image/png' | 'image/jpeg' | 'image/webp' }

// Audio
{ type: 'audio', data: string /* base64 */, mimeType: string }

// Resource link (reference; client fetches separately)
{ type: 'resource_link', uri: string, name?: string, mimeType?: string }

// Embedded resource (inline)
{ type: 'resource', resource: { uri, mimeType, text? | blob? /* base64 */ } }
```

**Strategy for our MCP:** return the generated image as `{ type: 'image', data, mimeType }` directly so the calling model sees it inline. Optionally ALSO save to disk and include a `resource_link` so users can grab the file — but the inline image is the primary return.

### 3.4 Tool-level errors vs protocol errors

Return `isError: true` with a text content block for recoverable failures — the LLM sees the error and can retry with different args:

```ts
return {
  content: [{ type: 'text', text: `OpenAI returned 400: ${err.message}` }],
  isError: true,
};
```

`throw` only for unrecoverable protocol-level issues.

### 3.5 Progress notifications (optional)

Streaming partial images map naturally to MCP progress notifications:

```ts
async (args, ctx) => {
  const progressToken = ctx.mcpReq._meta?.progressToken;
  const stream = await client.images.generate({ ...args, stream: true, partial_images: 2 });
  let i = 0;
  for await (const evt of stream) {
    if (evt.type === 'image_generation.partial_image' && progressToken !== undefined) {
      await ctx.mcpReq.notify({
        method: 'notifications/progress',
        params: { progressToken, progress: ++i, total: 3, message: 'Rendering preview' },
      });
    }
    if (evt.type === 'image_generation.completed') {
      return { content: [{ type: 'image', data: evt.b64_json, mimeType: `image/${evt.output_format}` }] };
    }
  }
}
```

### 3.6 STDIO logging rule

> **Stdout is reserved for JSON-RPC frames. Use `console.error()` for ALL logs.** Writing to stdout will corrupt the protocol and crash the connection silently.

### 3.7 Transports

| Transport | Use |
|---|---|
| `StdioServerTransport` | Claude Desktop, Cursor, Claude Code, local CLI clients — the default for our MCP |
| `StreamableHTTPServerTransport` | Remote-hosted MCPs (Vercel Functions, etc.) |

### 3.8 Package / build setup

**package.json:**
```json
{
  "name": "gpt-image-2-mcp",
  "version": "0.1.0",
  "type": "module",
  "bin": { "gpt-image-2-mcp": "./build/index.js" },
  "scripts": {
    "build": "tsc && chmod 755 build/index.js",
    "dev": "tsx src/index.ts",
    "inspect": "npx @modelcontextprotocol/inspector node build/index.js"
  },
  "files": ["build"],
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.x",
    "openai": "^6.x",
    "zod": "^3.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "tsx": "^4.x",
    "@types/node": "^22.x"
  }
}
```

**tsconfig.json:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./build",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "build"]
}
```

**src/index.ts shebang:**
```ts
#!/usr/bin/env node
```

### 3.9 Claude Desktop config (for end users)

```json
{
  "mcpServers": {
    "gpt-image-2": {
      "command": "node",
      "args": ["/abs/path/to/gpt_image_2_mcp/build/index.js"],
      "env": { "OPENAI_API_KEY": "sk-..." }
    }
  }
}
```

Or after `npm publish` + `npm i -g`:
```json
{ "command": "gpt-image-2-mcp", "env": { "OPENAI_API_KEY": "sk-..." } }
```

### 3.10 Testing

`npx @modelcontextprotocol/inspector node build/index.js` launches the official MCP Inspector UI to call tools interactively — this is the dev loop.

---

## 4. Prompting guide highlights (for tool descriptions & optional prompt templates)

From the OpenAI GPT image models prompting guide:

- **Structure:** background → subject → details → constraints
- **Text in images:** quote literal text or ALL CAPS; spell tricky words letter-by-letter; use `quality: "medium"` or `"high"` for small/dense text
- **Preservation during edits:** `"change only X" + "keep everything else the same"`; restate preservation list each iteration
- **Multi-image composition:** `"Image 1: product photo… Image 2: style reference… apply Image 2's style to Image 1."`
- **Photorealism:** include the word `"photorealistic"` literally
- **Quality selection:**
  - `low` — drafts, thumbnails, iteration
  - `medium` — balanced default
  - `high` — dense layouts, small text, identity-sensitive edits, infographics
- **gpt-image-2 specifically:** reliable CJK text rendering; strong multi-image reference support; robust face/identity preservation without needing `input_fidelity`

---

## 5. Proposed MCP tool surface

Minimum viable set (build first):

| Tool | Purpose | Key inputs |
|---|---|---|
| `generate_image` | Text → image via `/v1/images/generations` | prompt, size, quality, n, background, output_format, moderation, save_path? |
| `edit_image` | Image(s) [+ mask] → image via `/v1/images/edits` | prompt, images[] (paths or URLs), mask?, size, quality, n, save_path? |

Nice-to-have (add once MVP works):

| Feature | Purpose |
|---|---|
| `stream=true` + partial_images | MCP progress notifications for live previews |
| Prompt templates (`photorealistic`, `infographic`, `text_poster`) | Registered MCP prompts users can invoke via slash commands in clients |
| Resource: `gpt-image-2://history` | List recently generated images on disk |

**Skip**: `createVariation` — gpt-image-2 doesn't support it.

### Return shape per call (proposed)

```ts
{
  content: [
    { type: 'image', data: b64, mimeType: 'image/png' },     // primary: the model sees it
    { type: 'text', text: 'Saved to /path/to/file.png. Tokens: 1234 input / 5678 output ($0.21)' },
  ],
  structuredContent: {
    file_path: '/path/to/file.png',
    model: 'gpt-image-2',
    size: '1024x1024',
    quality: 'high',
    usage: { input_tokens, output_tokens, total_tokens },
    estimated_cost_usd: 0.211
  }
}
```

### Input handling for `edit_image`

Accept any of:
- Absolute file paths (`/a/b/c.png`) — `fs.createReadStream`
- File URLs (`file:///...`) — strip + read
- Data URLs (`data:image/png;base64,...`) — decode to Buffer, wrap with `OpenAI.toFile`
- HTTP/HTTPS URLs — fetch, wrap with `OpenAI.toFile`

This matters because the MCP caller typically won't have a filesystem-path for images it's about to hand us.

### Output persistence

Accept an optional `output_dir` / `save_path` arg. If unset, default to a stable directory: `$GPT_IMAGE_2_MCP_OUTPUT_DIR` or `~/Pictures/gpt-image-2/` or `./output/`. Always return the saved path so the LLM can reference it in subsequent turns.

---

## 6. Architectural decisions to lock in

| Decision | Choice | Rationale |
|---|---|---|
| Language | TypeScript | Best SDK fit; shadcn-of-MCP-servers is TS |
| Transport | stdio | Universal client support; remote HTTP can be added later |
| SDK | `@modelcontextprotocol/sdk` + `openai` | Official, up-to-date |
| Schema | Zod | Required by MCP SDK; good runtime validation |
| Package manager | pnpm (or npm) | User preference — default npm since starter |
| Distribution | npm bin + local `node path/to/build/index.js` | Standard pattern |
| API key | `OPENAI_API_KEY` env var | Injected via Claude Desktop/Code config |
| Image return | Inline base64 `ImageContent` **+** disk save | the model sees it; user keeps the file |
| Errors | `isError: true` for OpenAI 4xx/5xx; throw only on config errors | LLM can retry |
| Logging | `console.error` only | stdio protocol safety |

---

## 7. Open questions / risks

1. **n vs 8 vs 16** — spec says up to 10 for `n`, announcement says "up to 8 images per prompt," SDK docs say "up to 16 images" for edits. Clamp conservatively: `n ≤ 10` for generate, `image.length ≤ 8` for edits (then raise if it works).
2. **Streaming reliability** — day-1 launch; SSE streaming may have edge cases. Ship with `stream: false` default, make streaming opt-in.
3. **Custom size validation** — users will pass weird sizes. Client-side validation (`edge % 16 === 0`, aspect ratio check, pixel total check) before hitting API saves roundtrips.
4. **Cost guardrails** — a careless `n=10, quality=high, size=3840x2160` call costs real money. Consider a `max_cost_usd` check per call, or log estimated cost in the return.
5. **C2PA provenance** — not confirmed whether gpt-image-2 embeds C2PA metadata. If downstream compliance matters, verify with a generated file and note it.
6. **Input image token cost surprise** — edits with many reference images at high fidelity can burn tokens. Surface `usage` in every response.

---

## 8. Sources

- [GPT Image 2 Model page — OpenAI API](https://developers.openai.com/api/docs/models/gpt-image-2)
- [Introducing gpt-image-2 — OpenAI Community announcement](https://community.openai.com/t/introducing-gpt-image-2-available-today-in-the-api-and-codex/1379479)
- [Image generation guide — OpenAI](https://developers.openai.com/api/docs/guides/image-generation)
- [GPT image models prompting guide — OpenAI Cookbook](https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide)
- [High input fidelity cookbook — OpenAI](https://developers.openai.com/cookbook/examples/generate_images_with_high_input_fidelity)
- [openai-node SDK — src/resources/images.ts](https://github.com/openai/openai-node/blob/master/src/resources/images.ts)
- [MCP TypeScript SDK — server docs](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md)
- [MCP TypeScript SDK — server quickstart](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server-quickstart.md)
- [MCP TypeScript SDK — client docs](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/client.md)
- [MCP TypeScript SDK — migration guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration.md)
- [VentureBeat — ChatGPT Images 2.0 launch coverage](https://venturebeat.com/technology/openais-chatgpt-images-2-0-is-here-and-it-does-multilingual-text-full-infographics-slides-maps-even-manga-seemingly-flawlessly)
- [TechCrunch — Images 2.0 text rendering](https://techcrunch.com/2026/04/21/chatgpts-new-images-2-0-model-is-surprisingly-good-at-generating-text/)
- [Replicate — gpt-image-2 mirror](https://replicate.com/openai/gpt-image-2)
