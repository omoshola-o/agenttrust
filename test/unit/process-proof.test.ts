import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { collectProcessEvidence } from "../../src/proof/process-proof.js";

describe("collectProcessEvidence", () => {
  it("collects evidence for a successful command", () => {
    const evidence = collectProcessEvidence("ls -la", {
      stdout: "file1.txt\nfile2.txt\n",
      stderr: "",
      exitCode: 0,
      pid: 12345,
    });

    expect(evidence.command).toBe("ls -la");
    expect(evidence.exitCode).toBe(0);
    expect(evidence.pid).toBe(12345);
    expect(evidence.hadStderr).toBe(false);
    expect(evidence.stdoutLength).toBe("file1.txt\nfile2.txt\n".length);

    const expectedHash = createHash("sha256").update("file1.txt\nfile2.txt\n").digest("hex");
    expect(evidence.stdoutHash).toBe(expectedHash);
  });

  it("detects stderr presence", () => {
    const evidence = collectProcessEvidence("bad-cmd", {
      stdout: "",
      stderr: "command not found",
      exitCode: 127,
    });

    expect(evidence.hadStderr).toBe(true);
    expect(evidence.exitCode).toBe(127);
    expect(evidence.stdoutLength).toBe(0);
    expect(evidence.stdoutHash).toBeUndefined();
  });

  it("handles missing stdout and stderr", () => {
    const evidence = collectProcessEvidence("silent-cmd", {});

    expect(evidence.command).toBe("silent-cmd");
    expect(evidence.hadStderr).toBe(false);
    expect(evidence.stdoutLength).toBeUndefined();
    expect(evidence.stdoutHash).toBeUndefined();
    expect(evidence.exitCode).toBeUndefined();
    expect(evidence.pid).toBeUndefined();
  });

  it("handles Buffer stdout", () => {
    const buf = Buffer.from("buffer output");
    const evidence = collectProcessEvidence("cat file", {
      stdout: buf,
      stderr: "",
      exitCode: 0,
    });

    expect(evidence.stdoutLength).toBe("buffer output".length);
    expect(evidence.stdoutHash).toBeDefined();
  });

  it("handles empty string stderr as no stderr", () => {
    const evidence = collectProcessEvidence("cmd", {
      stdout: "out",
      stderr: "",
      exitCode: 0,
    });

    expect(evidence.hadStderr).toBe(false);
  });
});
