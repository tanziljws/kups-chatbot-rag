import assert from "node:assert/strict";
import test from "node:test";
import { allowRequest } from "./rate-limit";

test("allows twelve requests and throttles the next request in the same minute", () => {
  const key = `test-${Math.random()}`;
  for (let i = 0; i < 12; i += 1) {
    assert.equal(allowRequest(key, 1000 + i).allowed, true);
  }
  const limited = allowRequest(key, 1012);
  assert.equal(limited.allowed, false);
  assert.equal(limited.retryAfterSeconds > 0, true);
});

test("resets a request bucket after its minute window", () => {
  const key = `test-reset-${Math.random()}`;
  for (let i = 0; i < 12; i += 1) allowRequest(key, 10_000 + i);
  assert.equal(allowRequest(key, 71_001).allowed, true);
});
