import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  isValidLoginInput,
  MAX_LOGIN_EMAIL_BYTES,
  MAX_LOGIN_PASSWORD_BYTES,
} from "./login-validation.js";

describe("login input validation", () => {
  test("accepts bounded email and password strings", () => {
    assert.equal(isValidLoginInput("user@example.invalid", "password"), true);
  });

  test("rejects missing, malformed, empty, and overlong credentials", () => {
    assert.equal(isValidLoginInput(undefined, "password"), false);
    assert.equal(isValidLoginInput("bad email", "password"), false);
    assert.equal(isValidLoginInput("user@example.invalid", ""), false);
    assert.equal(
      isValidLoginInput(`${"a".repeat(MAX_LOGIN_EMAIL_BYTES)}@x`, "password"),
      false,
    );
    assert.equal(
      isValidLoginInput(
        "user@example.invalid",
        "p".repeat(MAX_LOGIN_PASSWORD_BYTES + 1),
      ),
      false,
    );
  });
});
