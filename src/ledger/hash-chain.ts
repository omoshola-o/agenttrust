import { createHash } from "node:crypto";

/**
 * Recursively sort object keys alphabetically for deterministic serialization.
 */
function sortKeys(obj: unknown): unknown {
  if (obj === null || obj === undefined || typeof obj !== "object") {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sortKeys);
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    sorted[key] = sortKeys((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

export function canonicalize(obj: Record<string, unknown>): string {
  return JSON.stringify(sortKeys(obj));
}

export function hashEntry(entry: Record<string, unknown>): string {
  const { hash: _, ...rest } = entry;
  const canonical = canonicalize(rest);
  return createHash("sha256").update(canonical).digest("hex");
}

export function verifyEntryHash(entry: Record<string, unknown>): boolean {
  const computed = hashEntry(entry);
  return computed === entry["hash"];
}

export interface ChainVerification {
  valid: boolean;
  brokenAt?: number;
}

export function verifyChain(
  entries: ReadonlyArray<{ hash: string; prevHash: string }>,
): ChainVerification {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    if (i === 0) {
      if (entry.prevHash !== "") {
        return { valid: false, brokenAt: 0 };
      }
    } else {
      const prev = entries[i - 1]!;
      if (entry.prevHash !== prev.hash) {
        return { valid: false, brokenAt: i };
      }
    }
  }
  return { valid: true };
}
