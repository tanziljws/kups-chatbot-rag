import { randomUUID, timingSafeEqual } from "node:crypto";

export type LiveChatStatus = "waiting" | "active" | "closed";
export type LiveChatRole = "visitor" | "consultant";
export type LiveChatService = "expert" | "mentor";

export type LiveChatMessage = {
  id: string;
  sender: LiveChatRole;
  text: string;
  sentAt: string;
};

export type LiveChatSessionSummary = {
  id: string;
  visitorName: string;
  topic: string;
  status: LiveChatStatus;
  createdAt: string;
  updatedAt: string;
  consultantName?: string;
  serviceType?: LiveChatService;
  expertId?: string;
  expertName?: string;
  preferredAt?: string;
  groupName?: string;
  area?: string;
  intakeSummary?: string;
  closeSummary?: string;
  lastMessage?: LiveChatMessage;
  messageCount: number;
};

export type LiveChatSession = LiveChatSessionSummary & {
  messages: LiveChatMessage[];
};

export type LiveChatEvent =
  | { type: "snapshot"; session: LiveChatSession }
  | { type: "message"; message: LiveChatMessage }
  | { type: "status"; session: LiveChatSession }
  | { type: "queue"; sessions: LiveChatSessionSummary[] };

type InternalSession = LiveChatSession & { visitorToken: string };
type LiveChatStore = {
  sessions: Map<string, InternalSession>;
  sessionListeners: Map<string, Set<(event: LiveChatEvent) => void>>;
  queueListeners: Set<(event: LiveChatEvent) => void>;
};

const globalStore = globalThis as typeof globalThis & {
  __kupsLiveChatStore?: LiveChatStore;
};
const store = (globalStore.__kupsLiveChatStore ??= {
  sessions: new Map(),
  sessionListeners: new Map(),
  queueListeners: new Set(),
});

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_SESSIONS = 100;
const MAX_MESSAGES_PER_SESSION = 300;

function publicSession(session: InternalSession): LiveChatSession {
  const { visitorToken: _visitorToken, ...visible } = session;
  return structuredClone(visible);
}

function summary(session: InternalSession): LiveChatSessionSummary {
  const { messages, ...visible } = publicSession(session);
  return {
    ...visible,
    lastMessage: messages.at(-1),
    messageCount: messages.length,
  };
}

function pruneExpiredSessions(now = Date.now()) {
  for (const [id, session] of store.sessions) {
    if (now - new Date(session.updatedAt).getTime() >= SESSION_TTL_MS) {
      store.sessions.delete(id);
      store.sessionListeners.delete(id);
    }
  }
}

function queueSnapshot(): LiveChatSessionSummary[] {
  pruneExpiredSessions();
  return [...store.sessions.values()]
    .filter((session) => session.status !== "closed")
    .sort((left, right) => {
      if (left.status !== right.status)
        return left.status === "waiting" ? -1 : 1;
      return left.status === "waiting"
        ? left.createdAt.localeCompare(right.createdAt)
        : right.updatedAt.localeCompare(left.updatedAt);
    })
    .map(summary);
}

function publishQueue() {
  const event: LiveChatEvent = { type: "queue", sessions: queueSnapshot() };
  for (const listener of store.queueListeners) listener(event);
}

function publishSession(
  session: InternalSession,
  type: "message" | "status",
  message?: LiveChatMessage,
) {
  const event: LiveChatEvent =
    type === "message" && message
      ? { type, message: structuredClone(message) }
      : { type: "status", session: publicSession(session) };
  for (const listener of store.sessionListeners.get(session.id) ?? [])
    listener(event);
  publishQueue();
}

export function getOperatorToken(): string | null {
  const configured = process.env.LIVE_CHAT_OPERATOR_TOKEN?.trim();
  if (configured) return configured;
  return process.env.NODE_ENV === "production" ? null : "local-kups-dev";
}

export function getConsultantName(): string {
  return process.env.LIVE_CHAT_OPERATOR_NAME?.trim() || "Konsultan KUPS";
}

export function isOperatorToken(candidate: string | null | undefined): boolean {
  const expected = getOperatorToken();
  if (!expected || !candidate) return false;
  const expectedBytes = Buffer.from(expected);
  const candidateBytes = Buffer.from(candidate);
  return (
    expectedBytes.length === candidateBytes.length &&
    timingSafeEqual(expectedBytes, candidateBytes)
  );
}

export function createSession(
  visitorName: string,
  topic: string,
  intake: {
    groupName?: string;
    area?: string;
    summary: string;
    serviceType: LiveChatService;
    expertId?: string;
    expertName?: string;
    preferredAt?: string;
  },
) {
  pruneExpiredSessions();
  if (store.sessions.size >= MAX_SESSIONS) return null;

  const now = new Date().toISOString();
  const session: InternalSession = {
    id: randomUUID(),
    visitorName,
    topic,
    serviceType: intake.serviceType,
    expertId: intake.expertId,
    expertName: intake.expertName,
    preferredAt: intake.preferredAt,
    groupName: intake.groupName,
    area: intake.area,
    intakeSummary: intake.summary,
    status: "waiting",
    createdAt: now,
    updatedAt: now,
    messages: [
      {
        id: randomUUID(),
        sender: "visitor",
        text: intake.summary,
        sentAt: now,
      },
    ],
    messageCount: 1,
    visitorToken: randomUUID(),
  };
  store.sessions.set(session.id, session);
  const visible = publicSession(session);
  publishQueue();
  return { session: visible, visitorToken: session.visitorToken };
}

export function getSession(sessionId: string): LiveChatSession | null {
  pruneExpiredSessions();
  const session = store.sessions.get(sessionId);
  return session ? publicSession(session) : null;
}

export function getSessionSummary(
  sessionId: string,
): LiveChatSessionSummary | null {
  pruneExpiredSessions();
  const session = store.sessions.get(sessionId);
  return session ? summary(session) : null;
}

export function listSessions(): LiveChatSessionSummary[] {
  return queueSnapshot();
}

export function visitorOwnsSession(
  sessionId: string,
  token: string | null | undefined,
): boolean {
  pruneExpiredSessions();
  const session = store.sessions.get(sessionId);
  if (!session || !token) return false;
  const expected = Buffer.from(session.visitorToken);
  const candidate = Buffer.from(token);
  return (
    expected.length === candidate.length && timingSafeEqual(expected, candidate)
  );
}

export function claimSession(sessionId: string): LiveChatSession | null {
  pruneExpiredSessions();
  const session = store.sessions.get(sessionId);
  if (!session || session.status !== "waiting") return null;
  session.status = "active";
  session.consultantName = getConsultantName();
  session.updatedAt = new Date().toISOString();
  publishSession(session, "status");
  return publicSession(session);
}

export function closeSession(
  sessionId: string,
  closeSummary = "",
): LiveChatSession | null {
  pruneExpiredSessions();
  const session = store.sessions.get(sessionId);
  if (!session || session.status === "closed") return null;
  session.status = "closed";
  session.closeSummary = closeSummary.trim().slice(0, 1200) || undefined;
  session.updatedAt = new Date().toISOString();
  publishSession(session, "status");
  return publicSession(session);
}

export function addMessage(
  sessionId: string,
  sender: LiveChatRole,
  text: string,
): LiveChatMessage | null {
  pruneExpiredSessions();
  const session = store.sessions.get(sessionId);
  if (!session || session.status === "closed") return null;
  if (sender === "consultant" && session.status !== "active") return null;

  const message: LiveChatMessage = {
    id: randomUUID(),
    sender,
    text,
    sentAt: new Date().toISOString(),
  };
  session.messages.push(message);
  if (session.messages.length > MAX_MESSAGES_PER_SESSION)
    session.messages.shift();
  session.messageCount = Math.min(
    MAX_MESSAGES_PER_SESSION,
    session.messageCount + 1,
  );
  session.updatedAt = message.sentAt;
  publishSession(session, "message", message);
  return structuredClone(message);
}

export function subscribeToSession(
  sessionId: string,
  listener: (event: LiveChatEvent) => void,
) {
  const listeners = store.sessionListeners.get(sessionId) ?? new Set();
  listeners.add(listener);
  store.sessionListeners.set(sessionId, listeners);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) store.sessionListeners.delete(sessionId);
  };
}

export function subscribeToQueue(listener: (event: LiveChatEvent) => void) {
  store.queueListeners.add(listener);
  return () => store.queueListeners.delete(listener);
}
