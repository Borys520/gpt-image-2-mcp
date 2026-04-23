import { randomBytes } from "node:crypto";
import type { OutputFormat } from "../constants.js";
import { log } from "./logger.js";

/**
 * In-memory edit sessions. An edit session is a chain of iterative edits
 * against the same base image — the last generated image becomes the input
 * for the next turn.
 *
 * State is lost on server restart; that's intentional and matches the
 * Gemini MCP pattern. To keep memory bounded even for long-lived servers:
 *   - a soft cap on total sessions (LRU eviction on overflow), and
 *   - a per-session idle TTL after which the session is dropped.
 *
 * Caps can be tuned via env vars:
 *   - GPT_IMAGE_2_SESSION_MAX      (default 20)
 *   - GPT_IMAGE_2_SESSION_TTL_MS   (default 3_600_000 = 1 hour)
 */

export interface EditSession {
  id: string;
  createdAt: number;
  updatedAt: number;
  turnCount: number;
  lastImageBase64: string;
  lastImageMime: string;
  lastImagePath: string;
  lastPrompt: string;
  outputDir: string;
  outputFormat: OutputFormat;
  history: Array<{
    turn: number;
    prompt: string;
    filePath: string;
    at: number;
  }>;
}

const DEFAULT_MAX = 20;
const DEFAULT_TTL_MS = 60 * 60 * 1000;

const MAX_SESSIONS = (() => {
  const v = Number(process.env.GPT_IMAGE_2_SESSION_MAX);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_MAX;
})();
const TTL_MS = (() => {
  const v = Number(process.env.GPT_IMAGE_2_SESSION_TTL_MS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_TTL_MS;
})();

const sessions = new Map<string, EditSession>();

export function createSession(
  init: Omit<EditSession, "id" | "createdAt" | "updatedAt" | "turnCount" | "history">,
): EditSession {
  sweepExpired();
  evictToCap(MAX_SESSIONS - 1);

  const id = `edit-${Date.now()}-${randomBytes(4).toString("hex")}`;
  const now = Date.now();
  const session: EditSession = {
    ...init,
    id,
    createdAt: now,
    updatedAt: now,
    turnCount: 1,
    history: [
      {
        turn: 1,
        prompt: init.lastPrompt,
        filePath: init.lastImagePath,
        at: now,
      },
    ],
  };
  sessions.set(id, session);
  return session;
}

export function getSession(id: string): EditSession | undefined {
  sweepExpired();
  return sessions.get(id);
}

export function updateSession(
  id: string,
  patch: {
    prompt: string;
    base64: string;
    mime: string;
    filePath: string;
    outputFormat?: OutputFormat;
  },
): EditSession {
  sweepExpired();
  const s = sessions.get(id);
  if (!s) {
    throw new Error(`Edit session "${id}" not found. Use list_edit_sessions to see active ones.`);
  }
  s.turnCount += 1;
  s.updatedAt = Date.now();
  s.lastPrompt = patch.prompt;
  s.lastImageBase64 = patch.base64;
  s.lastImageMime = patch.mime;
  s.lastImagePath = patch.filePath;
  if (patch.outputFormat) s.outputFormat = patch.outputFormat;
  s.history.push({
    turn: s.turnCount,
    prompt: patch.prompt,
    filePath: patch.filePath,
    at: s.updatedAt,
  });
  // Refresh LRU position — Map preserves insertion order, so re-set moves
  // this session to the end.
  sessions.delete(id);
  sessions.set(id, s);
  return s;
}

export function endSession(id: string): boolean {
  return sessions.delete(id);
}

export function listSessions(): EditSession[] {
  sweepExpired();
  return [...sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

function sweepExpired(now = Date.now()): void {
  if (TTL_MS <= 0) return;
  const cutoff = now - TTL_MS;
  for (const [id, s] of sessions) {
    if (s.updatedAt < cutoff) {
      sessions.delete(id);
      log.debug("session expired (idle > TTL)", id);
    }
  }
}

function evictToCap(cap: number): void {
  // Map preserves insertion/access order; eldest is at the front.
  while (sessions.size > cap) {
    const eldest = sessions.keys().next().value;
    if (!eldest) break;
    sessions.delete(eldest);
    log.debug("session evicted (LRU cap)", eldest);
  }
}
