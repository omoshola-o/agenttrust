import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDigestPath, writeDigest, writeDigestForDate } from "../../src/digest/writer.js";
import type { DigestConfig } from "../../src/digest/types.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "agenttrust-writer-test-"));
}

function makeConfig(outputDir: string): DigestConfig {
  return {
    outputDir,
    types: ["daily"],
    highlightThreshold: 7,
    maxDetailEntries: 20,
  };
}

describe("getDigestPath", () => {
  it("returns correct daily path format (YYYY-MM-DD-daily.md)", () => {
    const config = makeConfig("/tmp/digests");
    const date = new Date("2026-02-15T12:00:00.000Z");
    const path = getDigestPath(config, "daily", date);
    expect(path).toBe(join("/tmp/digests", "2026-02-15-daily.md"));
  });

  it("returns correct weekly path format (YYYY-WNN-weekly.md)", () => {
    const config = makeConfig("/tmp/digests");
    const date = new Date("2026-02-15T12:00:00.000Z");
    const path = getDigestPath(config, "weekly", date);
    // Feb 15 2026 is in week 07
    expect(path).toBe(join("/tmp/digests", "2026-W07-weekly.md"));
  });

  it("zero-pads the week number for single-digit weeks", () => {
    const config = makeConfig("/tmp/digests");
    const date = new Date("2026-01-05T12:00:00.000Z");
    const path = getDigestPath(config, "weekly", date);
    expect(path).toContain("-W0");
    expect(path).toContain("-weekly.md");
  });

  it("formats date components with zero-padding", () => {
    const config = makeConfig("/tmp/digests");
    const date = new Date("2026-03-05T12:00:00.000Z");
    const path = getDigestPath(config, "daily", date);
    expect(path).toBe(join("/tmp/digests", "2026-03-05-daily.md"));
  });
});

describe("writeDigest", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("creates the file with correct content", async () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    const config = makeConfig(dir);
    const content = "# Test Digest\nSome content here.";

    await writeDigest(config, content, "test-digest.md");

    const filePath = join(dir, "test-digest.md");
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, "utf-8")).toBe(content);
  });

  it("creates output directory if it does not exist", async () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    const nestedDir = join(dir, "nested", "output");
    const config = makeConfig(nestedDir);
    const content = "# Nested Digest";

    await writeDigest(config, content, "nested.md");

    expect(existsSync(nestedDir)).toBe(true);
    const filePath = join(nestedDir, "nested.md");
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, "utf-8")).toBe(content);
  });
});

describe("writeDigestForDate", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("returns the correct path for a daily digest", async () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    const config = makeConfig(dir);
    const date = new Date("2026-02-15T12:00:00.000Z");
    const content = "# Daily Digest Content";

    const resultPath = await writeDigestForDate(config, content, "daily", date);

    expect(resultPath).toBe(join(dir, "2026-02-15-daily.md"));
  });

  it("returns the correct path for a weekly digest", async () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    const config = makeConfig(dir);
    const date = new Date("2026-02-15T12:00:00.000Z");
    const content = "# Weekly Digest Content";

    const resultPath = await writeDigestForDate(config, content, "weekly", date);

    expect(resultPath).toBe(join(dir, "2026-W07-weekly.md"));
  });

  it("writes the file to disk", async () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    const config = makeConfig(dir);
    const date = new Date("2026-02-15T12:00:00.000Z");
    const content = "# Written Digest\nBody content.";

    const resultPath = await writeDigestForDate(config, content, "daily", date);

    expect(existsSync(resultPath)).toBe(true);
    expect(readFileSync(resultPath, "utf-8")).toBe(content);
  });

  it("creates output directory if it does not exist", async () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    const nestedDir = join(dir, "deep", "digests");
    const config = makeConfig(nestedDir);
    const date = new Date("2026-02-15T12:00:00.000Z");
    const content = "# Deep Digest";

    await writeDigestForDate(config, content, "daily", date);

    expect(existsSync(nestedDir)).toBe(true);
  });
});
