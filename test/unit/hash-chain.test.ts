import { describe, it, expect } from "vitest";
import {
  canonicalize,
  hashEntry,
  verifyEntryHash,
  verifyChain,
} from "../../src/ledger/hash-chain.js";

describe("canonicalize", () => {
  it("sorts keys alphabetically", () => {
    const result = canonicalize({ z: 1, a: 2, m: 3 });
    expect(result).toBe('{"a":2,"m":3,"z":1}');
  });

  it("sorts nested object keys", () => {
    const result = canonicalize({ b: { z: 1, a: 2 }, a: 1 });
    expect(result).toBe('{"a":1,"b":{"a":2,"z":1}}');
  });

  it("preserves arrays in order", () => {
    const result = canonicalize({ arr: [3, 1, 2] });
    expect(result).toBe('{"arr":[3,1,2]}');
  });

  it("produces no whitespace", () => {
    const result = canonicalize({ foo: "bar", baz: { x: 1 } });
    expect(result).not.toMatch(/\s/);
  });

  it("is deterministic across calls", () => {
    const obj = { b: 2, a: 1, c: { z: 3, y: 4 } };
    expect(canonicalize(obj)).toBe(canonicalize(obj));
  });
});

describe("hashEntry", () => {
  it("produces a 64-char hex string (SHA-256)", () => {
    const entry = { id: "test", v: 1, prevHash: "", ts: "2026-01-01T00:00:00.000Z" };
    const hash = hashEntry(entry);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("excludes the hash field from computation", () => {
    const entry = { id: "test", v: 1, prevHash: "", ts: "2026-01-01" };
    const hash1 = hashEntry(entry);
    const hash2 = hashEntry({ ...entry, hash: "should-be-ignored" });
    expect(hash1).toBe(hash2);
  });

  it("different entries produce different hashes", () => {
    const entry1 = { id: "a", v: 1, prevHash: "" };
    const entry2 = { id: "b", v: 1, prevHash: "" };
    expect(hashEntry(entry1)).not.toBe(hashEntry(entry2));
  });
});

describe("verifyEntryHash", () => {
  it("returns true for valid hash", () => {
    const entry: Record<string, unknown> = { id: "test", v: 1, prevHash: "" };
    entry["hash"] = hashEntry(entry);
    expect(verifyEntryHash(entry)).toBe(true);
  });

  it("returns false when entry is tampered", () => {
    const entry: Record<string, unknown> = { id: "test", v: 1, prevHash: "" };
    entry["hash"] = hashEntry(entry);
    entry["id"] = "tampered";
    expect(verifyEntryHash(entry)).toBe(false);
  });
});

describe("verifyChain", () => {
  it("returns valid for empty chain", () => {
    expect(verifyChain([])).toEqual({ valid: true });
  });

  it("returns valid for single entry with empty prevHash", () => {
    expect(verifyChain([{ hash: "abc", prevHash: "" }])).toEqual({ valid: true });
  });

  it("returns invalid if first entry has non-empty prevHash", () => {
    expect(verifyChain([{ hash: "abc", prevHash: "xyz" }])).toEqual({
      valid: false,
      brokenAt: 0,
    });
  });

  it("returns valid for properly linked chain", () => {
    const chain = [
      { hash: "hash1", prevHash: "" },
      { hash: "hash2", prevHash: "hash1" },
      { hash: "hash3", prevHash: "hash2" },
    ];
    expect(verifyChain(chain)).toEqual({ valid: true });
  });

  it("detects broken link in chain", () => {
    const chain = [
      { hash: "hash1", prevHash: "" },
      { hash: "hash2", prevHash: "WRONG" },
      { hash: "hash3", prevHash: "hash2" },
    ];
    expect(verifyChain(chain)).toEqual({ valid: false, brokenAt: 1 });
  });
});
