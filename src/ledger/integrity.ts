import { verifyEntryHash, verifyChain } from "./hash-chain.js";
import { readLedgerFile, listLedgerFiles } from "./storage.js";
import { parseEntry } from "./entry.js";
import { readFile as fsReadFile } from "node:fs/promises";

export interface IntegrityError {
  file: string;
  line: number;
  type: "hash_mismatch" | "chain_broken" | "parse_error";
  detail: string;
}

export interface IntegrityReport {
  valid: boolean;
  totalEntries: number;
  filesChecked: number;
  errors: IntegrityError[];
}

export async function verifyFile(path: string): Promise<IntegrityReport> {
  const errors: IntegrityError[] = [];
  let totalEntries = 0;

  let content: string;
  try {
    content = await fsReadFile(path, "utf-8");
  } catch {
    return { valid: false, totalEntries: 0, filesChecked: 1, errors: [{ file: path, line: 0, type: "parse_error", detail: "Could not read file" }] };
  }

  const lines = content.split("\n").filter((l) => l.trim() !== "");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const entry = parseEntry(line);
    if (!entry) {
      errors.push({ file: path, line: i + 1, type: "parse_error", detail: "Invalid JSON or schema" });
      continue;
    }
    totalEntries++;

    if (!verifyEntryHash(entry as unknown as Record<string, unknown>)) {
      errors.push({
        file: path,
        line: i + 1,
        type: "hash_mismatch",
        detail: `Entry ${entry.id} hash does not match computed hash`,
      });
    }
  }

  // Verify chain linkage
  const result = await readLedgerFile(path);
  if (result.ok && result.value.length > 1) {
    const chainResult = verifyChain(result.value);
    if (!chainResult.valid && chainResult.brokenAt !== undefined) {
      const brokenEntry = result.value[chainResult.brokenAt];
      errors.push({
        file: path,
        line: chainResult.brokenAt + 1,
        type: "chain_broken",
        detail: `Entry ${brokenEntry?.id ?? "unknown"} prevHash does not match previous entry hash`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    totalEntries,
    filesChecked: 1,
    errors,
  };
}

export async function verifyAll(ledgerDir: string): Promise<IntegrityReport> {
  const filesResult = await listLedgerFiles({ ledgerDir });
  if (!filesResult.ok) {
    return {
      valid: false,
      totalEntries: 0,
      filesChecked: 0,
      errors: [{ file: ledgerDir, line: 0, type: "parse_error", detail: filesResult.error }],
    };
  }

  const files = filesResult.value;
  let totalEntries = 0;
  const allErrors: IntegrityError[] = [];

  for (const file of files) {
    const report = await verifyFile(file);
    totalEntries += report.totalEntries;
    allErrors.push(...report.errors);
  }

  return {
    valid: allErrors.length === 0,
    totalEntries,
    filesChecked: files.length,
    errors: allErrors,
  };
}
