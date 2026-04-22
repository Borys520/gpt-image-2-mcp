import { randomBytes } from "node:crypto";
import type { OutputFormat } from "../constants.js";

/**
 * In-memory edit sessions. An edit session is a chain of iterative edits
 * against the same base image — the last generated image becomes the input
 * for the next turn. State is lost on server restart; that's intentional
 * and matches the Gemini MCP pattern.
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

const sessions = new Map<string, EditSession>();

export function createSession(init: Omit<EditSession, "id" | "createdAt" | "updatedAt" | "turnCount" | "history">): EditSession {
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
  const s = sessions.get(id);
  if (!s) throw new Error(`Edit session "${id}" not found. Use list_edit_sessions to see active ones.`);
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
  return s;
}

export function endSession(id: string): boolean {
  return sessions.delete(id);
}

export function listSessions(): EditSession[] {
  return [...sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}
