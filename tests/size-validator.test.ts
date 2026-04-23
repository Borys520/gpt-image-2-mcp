import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateSize } from "../src/utils/size-validator.js";

describe("validateSize", () => {
  it("accepts the preset sizes", () => {
    for (const s of ["auto", "1024x1024", "1536x1024", "1024x1536"]) {
      const r = validateSize(s);
      assert.equal(r.ok, true, `preset ${s} should pass`);
      if (r.ok) assert.equal(r.kind, "preset");
    }
  });

  it("trims whitespace and lowercases the x", () => {
    const r = validateSize("  1024X1024  ");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.canonical, "1024x1024");
  });

  it("rejects a non-WxH string", () => {
    const r = validateSize("big");
    assert.equal(r.ok, false);
  });

  it("rejects sizes whose edges aren't multiples of 16", () => {
    const r = validateSize("999x999");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /multiples of 16/);
  });

  it("rejects sizes with edges above 3840", () => {
    const r = validateSize("4096x2048");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /3840/);
  });

  it("rejects aspect ratios outside 1:3 – 3:1", () => {
    // 4:1 ratio
    const r = validateSize("2048x512");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /aspect ratio/);
  });

  it("rejects sizes below the pixel floor", () => {
    const r = validateSize("512x512"); // 262_144 pixels
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /total pixels/);
  });

  it("rejects sizes above the pixel ceiling", () => {
    const r = validateSize("3840x3200"); // 12,288,000 pixels
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /total pixels/);
  });

  it("accepts a valid custom size", () => {
    const r = validateSize("2048x1152"); // ratio 16:9, total ~2.36M pixels
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.kind, "custom");
      assert.equal(r.canonical, "2048x1152");
    }
  });

  it("rejects non-positive edges", () => {
    const r = validateSize("0x1024");
    assert.equal(r.ok, false);
  });
});
