import type { ChatTurn } from "./rag";

const MAX_SESSIONS = 500;
const MAX_TURNS = 6;
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_TURN_CHARS = 2000;

type SessionEntry = {
  turns: ChatTurn[];
  expiresAt: number;
};

const sessions = new Map<string, SessionEntry>();

function pruneExpired(now: number) {
  for (const [id, entry] of sessions) {
    if (entry.expiresAt <= now) sessions.delete(id);
  }
}

export function getSessionHistory(sessionId: string, now = Date.now()): ChatTurn[] {
  pruneExpired(now);
  const entry = sessions.get(sessionId);
  if (!entry) return [];

  entry.expiresAt = now + SESSION_TTL_MS;
  return entry.turns.map((turn) => ({ ...turn }));
}

export function saveSessionHistory(sessionId: string, turns: ChatTurn[], now = Date.now()) {
  pruneExpired(now);
  const boundedTurns = turns
    .slice(-MAX_TURNS)
    .flatMap((turn) => {
      if ((turn.role !== "user" && turn.role !== "assistant") || typeof turn.content !== "string") return [];
      const content = turn.content.trim().slice(0, MAX_TURN_CHARS);
      return content ? [{ role: turn.role, content } satisfies ChatTurn] : [];
    });

  if (sessions.has(sessionId)) sessions.delete(sessionId);
  sessions.set(sessionId, { turns: boundedTurns, expiresAt: now + SESSION_TTL_MS });
  while (sessions.size > MAX_SESSIONS) {
    const oldestId = sessions.keys().next().value;
    if (!oldestId) break;
    sessions.delete(oldestId);
  }
}
