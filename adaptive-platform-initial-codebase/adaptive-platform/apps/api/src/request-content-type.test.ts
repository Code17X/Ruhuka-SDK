import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isJsonContentType } from "./request-content-type.js";

describe("JSON request media type", () => {
  test("accepts application/json with optional valid parameters", () => {
    assert.equal(isJsonContentType("application/json"), true);
    assert.equal(isJsonContentType("Application/JSON; charset=utf-8"), true);
    assert.equal(
      isJsonContentType('application/json; charset="utf-8;v=1"'),
      true,
    );
  });

  test("rejects malformed or different media types", () => {
    assert.equal(isJsonContentType(undefined), false);
    assert.equal(isJsonContentType("application/jsonfoo"), false);
    assert.equal(isJsonContentType("application/json; charset="), false);
    assert.equal(isJsonContentType('application/json; charset="utf-8'), false);
    assert.equal(isJsonContentType("text/application/json"), false);
  });
});
