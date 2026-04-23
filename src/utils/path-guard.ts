import os from "node:os";
import path from "node:path";

/**
 * Reject output directories pointing at well-known sensitive system roots.
 * The LLM calling our tools could otherwise direct image writes at places
 * like /etc, /System, or ~/.ssh — low-severity in practice (the content
 * is a PNG and filenames are random) but worth bounding.
 *
 * Opt out entirely with GPT_IMAGE_2_ALLOW_UNSAFE_OUTPUT_DIR=1.
 */

const DENY_PREFIXES_UNIX = [
  "/etc",
  "/bin",
  "/sbin",
  "/usr/bin",
  "/usr/sbin",
  "/System",
  "/var/root",
  "/boot",
  "/dev",
  "/proc",
  "/sys",
];

const DENY_SUFFIXES = [
  ".ssh",
  ".gnupg",
  ".aws",
  ".config/gcloud",
  ".kube",
  ".docker",
];

const DENY_PREFIXES_WIN = [
  "C:\\Windows",
  "C:\\Program Files",
  "C:\\Program Files (x86)",
  "C:\\ProgramData",
];

export function assertSafeOutputDir(resolvedAbsPath: string): void {
  if (process.env.GPT_IMAGE_2_ALLOW_UNSAFE_OUTPUT_DIR === "1") return;

  const norm = path.normalize(resolvedAbsPath);
  const lower = norm.toLowerCase();

  const unixPrefixes = DENY_PREFIXES_UNIX;
  for (const deny of unixPrefixes) {
    if (lower === deny.toLowerCase() || lower.startsWith(deny.toLowerCase() + path.sep)) {
      throw new Error(
        `Refusing to write to sensitive system directory "${norm}". ` +
          `If you really mean it, set GPT_IMAGE_2_ALLOW_UNSAFE_OUTPUT_DIR=1.`,
      );
    }
  }

  if (process.platform === "win32") {
    for (const deny of DENY_PREFIXES_WIN) {
      if (lower.startsWith(deny.toLowerCase())) {
        throw new Error(
          `Refusing to write to sensitive Windows directory "${norm}". ` +
            `If you really mean it, set GPT_IMAGE_2_ALLOW_UNSAFE_OUTPUT_DIR=1.`,
        );
      }
    }
  }

  const home = os.homedir();
  for (const suffix of DENY_SUFFIXES) {
    const hit = path.join(home, suffix);
    if (norm === hit || norm.startsWith(hit + path.sep)) {
      throw new Error(
        `Refusing to write to sensitive user directory "${norm}". ` +
          `If you really mean it, set GPT_IMAGE_2_ALLOW_UNSAFE_OUTPUT_DIR=1.`,
      );
    }
  }
}
