import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeFilename } from "../src/utils/filename.js";

describe("makeFilename", () => {
  it("builds prefix-timestamp-id.ext for a simple case", () => {
    const name = makeFilename("image", "png");
    assert.match(name, /^image-\d{8}-\d{6}-[a-f0-9]{6}\.png$/);
  });

  it("appends a sanitized extra label when provided", () => {
    const name = makeFilename("image", "jpeg", "My Hero Banner!!");
    assert.match(name, /^image-\d{8}-\d{6}-[a-f0-9]{6}-My-Hero-Banner-\.jpeg$/);
  });

  it("truncates the extra label to 30 characters", () => {
    const long = "a".repeat(100);
    const name = makeFilename("edit", "webp", long);
    // prefix-date-time-6hex-{30 a's}.webp
    const match = name.match(/^edit-\d{8}-\d{6}-[a-f0-9]{6}-(a+)\.webp$/);
    assert.ok(match, `did not match expected shape: ${name}`);
    assert.equal(match![1]!.length, 30);
  });

  it("ignores null/empty extras", () => {
    const a = makeFilename("image", "png", null);
    const b = makeFilename("image", "png", "");
    // Neither should contain a trailing "-something" block before ".png"
    assert.match(a, /^image-\d{8}-\d{6}-[a-f0-9]{6}\.png$/);
    assert.match(b, /^image-\d{8}-\d{6}-[a-f0-9]{6}\.png$/);
  });

  it("respects session and edit prefixes", () => {
    assert.match(makeFilename("session", "png"), /^session-/);
    assert.match(makeFilename("edit", "png"), /^edit-/);
  });
});
