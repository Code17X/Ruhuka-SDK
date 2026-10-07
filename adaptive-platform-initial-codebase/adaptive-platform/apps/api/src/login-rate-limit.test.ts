import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { LoginRateLimiter } from "./login-rate-limit.js";

describe("login rate limiter", () => {
  test("preserves ten attempts per window", () => {
    const limiter = new LoginRateLimiter();
    for (let count = 0; count < 10; count++) {
      assert.equal(limiter.allow("client", 1000), true);
    }
    assert.equal(limiter.allow("client", 1000), false);
  });

  test("expires a key's window and allows it again", () => {
    const limiter = new LoginRateLimiter(2, 100, 2);
    assert.equal(limiter.allow("client-a", 0), true);
    assert.equal(limiter.allow("client-b", 0), true);
    assert.equal(limiter.allow("client-a", 99), true);
    assert.equal(limiter.allow("client-a", 100), true);
    assert.equal(limiter.trackedKeyCount, 2);
  });

  test("evicts the oldest tracked key at capacity and admits the new key", () => {
    const limiter = new LoginRateLimiter(2, 100, 2);
    assert.equal(limiter.allow("client-a", 0), true);
    assert.equal(limiter.allow("client-b", 1), true);
    assert.equal(limiter.allow("client-c", 2), true);
    assert.equal(limiter.trackedKeyCount, 2);
    assert.equal(limiter.allow("client-a", 3), true);
    assert.equal(limiter.trackedKeyCount, 2);
  });

  test("keeps the attempt limit for an unexpired key", () => {
    const limiter = new LoginRateLimiter(2, 100, 2);
    assert.equal(limiter.allow("client-a", 0), true);
    assert.equal(limiter.allow("client-a", 1), true);
    assert.equal(limiter.allow("client-a", 2), false);
    assert.equal(limiter.trackedKeyCount, 1);
  });
});
