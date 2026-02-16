import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { collectFileEvidence } from "../../src/proof/file-proof.js";

describe("collectFileEvidence", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "agenttrust-fileproof-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("collects evidence for an existing file", async () => {
    const filePath = join(testDir, "test.txt");
    const content = "hello world";
    await writeFile(filePath, content, { mode: 0o644 });

    const evidence = await collectFileEvidence(filePath, "file.read");

    expect(evidence.path).toBe(filePath);
    expect(evidence.existedBefore).toBe(true);
    expect(evidence.existsAfter).toBe(true);
    expect(evidence.sizeBytes).toBe(Buffer.byteLength(content));
    expect(evidence.mode).toBe("0644");
    expect(evidence.mtime).toBeDefined();
    expect(evidence.inode).toBeGreaterThan(0);

    const expectedHash = createHash("sha256").update(content).digest("hex");
    expect(evidence.contentHashPrefix).toBe(expectedHash);
  });

  it("reports non-existent file for file.delete", async () => {
    const filePath = join(testDir, "deleted.txt");

    const evidence = await collectFileEvidence(filePath, "file.delete");

    expect(evidence.path).toBe(filePath);
    expect(evidence.existedBefore).toBe(true);
    expect(evidence.existsAfter).toBe(false);
    expect(evidence.sizeBytes).toBeUndefined();
    expect(evidence.contentHashPrefix).toBeUndefined();
  });

  it("reports existedBefore=false for file.write by default", async () => {
    const filePath = join(testDir, "new.txt");
    await writeFile(filePath, "new content");

    const evidence = await collectFileEvidence(filePath, "file.write");

    expect(evidence.existedBefore).toBe(false);
    expect(evidence.existsAfter).toBe(true);
    expect(evidence.sizeBytes).toBe(Buffer.byteLength("new content"));
  });

  it("respects explicit existedBefore override", async () => {
    const filePath = join(testDir, "overwrite.txt");
    await writeFile(filePath, "overwritten");

    const evidence = await collectFileEvidence(filePath, "file.write", true);

    expect(evidence.existedBefore).toBe(true);
    expect(evidence.existsAfter).toBe(true);
  });

  it("hashes only first 4096 bytes of large files", async () => {
    const filePath = join(testDir, "large.bin");
    const content = Buffer.alloc(8192, 0xab);
    await writeFile(filePath, content);

    const evidence = await collectFileEvidence(filePath, "file.read");

    const expectedHash = createHash("sha256").update(content.subarray(0, 4096)).digest("hex");
    expect(evidence.contentHashPrefix).toBe(expectedHash);
    expect(evidence.sizeBytes).toBe(8192);
  });

  it("handles empty file", async () => {
    const filePath = join(testDir, "empty.txt");
    await writeFile(filePath, "");

    const evidence = await collectFileEvidence(filePath, "file.read");

    expect(evidence.sizeBytes).toBe(0);
    expect(evidence.contentHashPrefix).toBeUndefined();
  });

  it("includes file permissions", async () => {
    const filePath = join(testDir, "secret.key");
    await writeFile(filePath, "secret", { mode: 0o600 });
    await chmod(filePath, 0o600);

    const evidence = await collectFileEvidence(filePath, "file.read");

    expect(evidence.mode).toBe("0600");
  });
});
