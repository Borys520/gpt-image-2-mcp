import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  approximateCost,
  estimateCostFromUsage,
  formatUsd,
} from "../src/utils/cost.js";

describe("estimateCostFromUsage", () => {
  it("returns null for missing usage", () => {
    assert.equal(estimateCostFromUsage(null), null);
    assert.equal(estimateCostFromUsage(undefined), null);
  });

  it("splits tokens using details when present", () => {
    const cost = estimateCostFromUsage({
      input_tokens: 1000,
      output_tokens: 2000,
      total_tokens: 3000,
      input_tokens_details: { text_tokens: 900, image_tokens: 100 },
      output_tokens_details: { image_tokens: 2000, text_tokens: 0 },
    });
    // 900 text input @ $5/M + 100 image input @ $8/M + 2000 image output @ $30/M
    // = (900/1e6)*5 + (100/1e6)*8 + (2000/1e6)*30 + 0
    // = 0.0045 + 0.0008 + 0.06 = 0.0653
    assert.ok(cost !== null);
    assert.ok(Math.abs(cost - 0.0653) < 1e-6, `expected ~0.0653, got ${cost}`);
  });

  it("falls back to sensible defaults when details are missing", () => {
    const cost = estimateCostFromUsage({
      input_tokens: 100,
      output_tokens: 500,
      total_tokens: 600,
    });
    // No details — attributes all input to text and all output to image.
    // (100/1e6)*5 + (500/1e6)*30 = 0.0005 + 0.015 = 0.0155
    assert.ok(cost !== null);
    assert.ok(Math.abs(cost - 0.0155) < 1e-6, `expected ~0.0155, got ${cost}`);
  });
});

describe("approximateCost", () => {
  it("uses the published price table for low/medium/high at known sizes", () => {
    assert.equal(approximateCost({ quality: "low", size: "1024x1024", n: 1 }), 0.006);
    assert.equal(approximateCost({ quality: "medium", size: "1024x1024", n: 1 }), 0.053);
    assert.equal(approximateCost({ quality: "high", size: "1536x1024", n: 1 }), 0.165);
  });

  it("scales by n", () => {
    assert.equal(approximateCost({ quality: "low", size: "1024x1024", n: 4 }), 0.024);
  });

  it("treats auto as medium for the estimate", () => {
    const auto = approximateCost({ quality: "auto", size: "1024x1024", n: 1 });
    const medium = approximateCost({ quality: "medium", size: "1024x1024", n: 1 });
    assert.equal(auto, medium);
  });

  it("returns null for sizes not in the table (e.g. custom)", () => {
    assert.equal(
      approximateCost({ quality: "medium", size: "2048x1152", n: 1 }),
      null,
    );
  });
});

describe("formatUsd", () => {
  it("renders tiny amounts with 4 decimal places", () => {
    assert.equal(formatUsd(0.0053), "$0.0053");
  });
  it("renders small amounts with 3 decimal places", () => {
    assert.equal(formatUsd(0.053), "$0.053");
  });
  it("renders larger amounts with 2 decimal places", () => {
    assert.equal(formatUsd(1.23), "$1.23");
  });
  it("handles nullish", () => {
    assert.equal(formatUsd(null), "n/a");
    assert.equal(formatUsd(undefined), "n/a");
  });
});
