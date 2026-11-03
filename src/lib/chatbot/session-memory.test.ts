import assert from "node:assert/strict";
import { test } from "node:test";
import { getSessionHistory, saveSessionHistory } from "./session-memory";

test("keeps only the latest twenty-four turns and returns copies", () => {
  const sessionId = `session-${Math.random()}`;
  saveSessionHistory(sessionId, Array.from({ length: 26 }, (_, index) => ({
    role: index % 2 === 0 ? "user" as const : "assistant" as const,
    content: `turn-${index}`,
  })), 1_000);

  const history = getSessionHistory(sessionId, 2_000);
  assert.equal(history.length, 24);
  assert.equal(history[0]?.content, "turn-2");
  assert.equal(history.at(-1)?.content, "turn-25");
  history[0].content = "changed";
  assert.equal(getSessionHistory(sessionId, 2_000)[0]?.content, "turn-2");
});

test("expires inactive sessions after thirty minutes", () => {
  const sessionId = `session-${Math.random()}`;
  saveSessionHistory(sessionId, [{ role: "user", content: "hello" }], 10_000);
  assert.equal(getSessionHistory(sessionId, 10_000 + 30 * 60 * 1000).length, 0);
});
