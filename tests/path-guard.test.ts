import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { assertSafeOutputDir } from "../src/utils/path-guard.js";

describe("assertSafeOutputDir", () => {
  const originalFlag = process.env.GPT_IMAGE_2_ALLOW_UNSAFE_OUTPUT_DIR;

  beforeEach(() => {
    delete process.env.GPT_IMAGE_2_ALLOW_UNSAFE_OUTPUT_DIR;
  });
  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.GPT_IMAGE_2_ALLOW_UNSAFE_OUTPUT_DIR;
    } else {
      process.env.GPT_IMAGE_2_ALLOW_UNSAFE_OUTPUT_DIR = originalFlag;
    }
  });

  it("allows safe user-writable directories", () => {
    assert.doesNotThrow(() => assertSafeOutputDir(path.join(os.homedir(), "Pictures")));
    assert.doesNotThrow(() => assertSafeOutputDir("/tmp/gpt-image-2"));
    assert.doesNotThrow(() => assertSafeOutputDir(path.join(os.homedir(), "Documents", "my-project")));
  });

  it("rejects /etc and subpaths", () => {
    assert.throws(() => assertSafeOutputDir("/etc"), /sensitive system directory/);
    assert.throws(() => assertSafeOutputDir("/etc/cron.d"), /sensitive system directory/);
  });

  it("rejects other system roots", () => {
    for (const p of ["/bin", "/sbin", "/usr/bin", "/usr/sbin", "/dev", "/proc", "/sys"]) {
      assert.throws(() => assertSafeOutputDir(p), /sensitive/);
    }
  });

  it("rejects ~/.ssh and other user-sensitive subdirs", () => {
    assert.throws(
      () => assertSafeOutputDir(path.join(os.homedir(), ".ssh")),
      /sensitive user directory/,
    );
    assert.throws(
      () => assertSafeOutputDir(path.join(os.homedir(), ".aws", "credentials")),
      /sensitive user directory/,
    );
  });

  it("can be overridden via env var", () => {
    process.env.GPT_IMAGE_2_ALLOW_UNSAFE_OUTPUT_DIR = "1";
    assert.doesNotThrow(() => assertSafeOutputDir("/etc"));
    assert.doesNotThrow(() => assertSafeOutputDir(path.join(os.homedir(), ".ssh")));
  });
});
