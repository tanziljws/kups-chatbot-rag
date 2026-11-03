import assert from "node:assert/strict";
import { test } from "node:test";
import { getSessionHistory, saveSessionHistory } from "./session-memory";

test("keeps only the latest six turns and returns copies", () => {
  const sessionId = `session-${Math.random()}`;
  saveSessionHistory(sessionId, [
    { role: "user", content: "one" },
    { role: "assistant", content: "two" },
    { role: "user", content: "three" },
    { role: "assistant", content: "four" },
    { role: "user", content: "five" },
    { role: "assistant", content: "six" },
    { role: "user", content: "seven" },
  ], 1_000);

  const history = getSessionHistory(sessionId, 2_000);
  assert.deepEqual(history.map((turn) => turn.content), ["two", "three", "four", "five", "six", "seven"]);
  history[0].content = "changed";
  assert.equal(getSessionHistory(sessionId, 2_000)[0]?.content, "two");
});

test("expires inactive sessions after thirty minutes", () => {
  const sessionId = `session-${Math.random()}`;
  saveSessionHistory(sessionId, [{ role: "user", content: "hello" }], 10_000);
  assert.equal(getSessionHistory(sessionId, 10_000 + 30 * 60 * 1000).length, 0);
});
