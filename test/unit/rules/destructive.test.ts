import { describe, it, expect } from "vitest";
import { fileDeletion, recursiveDelete } from "../../../src/analyzer/rules/destructive.js";
import { DEFAULT_CONFIG } from "../../../src/analyzer/types.js";
import type { ATFEntry } from "../../../src/ledger/entry.js";
import type { RuleContext } from "../../../src/analyzer/types.js";

function makeEntry(overrides: Partial<ATFEntry> = {}): ATFEntry {
  return {
    id: "01TESTENTRY000000000000001",
    v: 1,
    ts: "2026-02-15T18:00:00.000Z",
    prevHash: "",
    hash: "testhash",
    agent: "default",
    session: "ses_test",
    action: {
      type: "file.read" as ATFEntry["action"]["type"],
      target: "/home/user/test.txt",
      detail: "Read test file",
    },
    context: {
      goal: "Test goal",
      trigger: "test",
    },
    outcome: {
      status: "success",
    },
    risk: {
      score: 0,
      labels: [],
      autoFlagged: false,
    },
    ...overrides,
  };
}

function makeContext(overrides: Partial<RuleContext> = {}): RuleContext {
  return {
    sessionHistory: [],
    recentEntries: [],
    knownTargets: new Set<string>(),
    config: DEFAULT_CONFIG,
    ...overrides,
  };
}

describe("fileDeletion (destr-001)", () => {
  const ctx = makeContext();

  it("triggers on file.delete actions", () => {
    const entry = makeEntry({
      action: {
        type: "file.delete" as ATFEntry["action"]["type"],
        target: "/home/user/temp/old-report.txt",
        detail: "Deleted old report",
      },
    });
    const result = fileDeletion.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("destr-001");
  });

  it("returns null for non-file.delete action types", () => {
    const entry = makeEntry({
      action: {
        type: "file.read" as ATFEntry["action"]["type"],
        target: "/home/user/test.txt",
        detail: "Read a file",
      },
    });
    expect(fileDeletion.evaluate(entry, ctx)).toBeNull();
  });

  it("returns null for file.write", () => {
    const entry = makeEntry({
      action: {
        type: "file.write" as ATFEntry["action"]["type"],
        target: "/home/user/output.txt",
        detail: "Wrote output",
      },
    });
    expect(fileDeletion.evaluate(entry, ctx)).toBeNull();
  });

  it("returns null for exec.command", () => {
    const entry = makeEntry({
      action: {
        type: "exec.command" as ATFEntry["action"]["type"],
        target: "ls -la",
        detail: "Listed files",
      },
    });
    expect(fileDeletion.evaluate(entry, ctx)).toBeNull();
  });

  it("returns medium severity and risk 5 for normal path", () => {
    const entry = makeEntry({
      action: {
        type: "file.delete" as ATFEntry["action"]["type"],
        target: "/home/user/documents/draft.txt",
        detail: "Deleted draft",
      },
    });
    const result = fileDeletion.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("medium");
    expect(result!.riskContribution).toBe(5);
    expect(result!.labels).toEqual(["execution"]);
  });

  it("returns high severity and risk 8 for sensitive .env path", () => {
    const entry = makeEntry({
      action: {
        type: "file.delete" as ATFEntry["action"]["type"],
        target: "/home/user/project/.env",
        detail: "Deleted env file",
      },
    });
    const result = fileDeletion.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("high");
    expect(result!.riskContribution).toBe(8);
  });

  it("returns high severity and risk 8 for sensitive .ssh/ path", () => {
    const entry = makeEntry({
      action: {
        type: "file.delete" as ATFEntry["action"]["type"],
        target: "/home/user/.ssh/id_rsa",
        detail: "Deleted SSH key",
      },
    });
    const result = fileDeletion.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("high");
    expect(result!.riskContribution).toBe(8);
  });

  it("returns high severity for credentials path", () => {
    const entry = makeEntry({
      action: {
        type: "file.delete" as ATFEntry["action"]["type"],
        target: "/home/user/.aws/credentials",
        detail: "Deleted AWS credentials",
      },
    });
    const result = fileDeletion.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("high");
    expect(result!.riskContribution).toBe(8);
  });

  it("includes target path in reason", () => {
    const entry = makeEntry({
      action: {
        type: "file.delete" as ATFEntry["action"]["type"],
        target: "/home/user/data/old-logs.txt",
        detail: "Deleted old logs",
      },
    });
    const result = fileDeletion.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.reason).toContain("/home/user/data/old-logs.txt");
  });

  it("includes (sensitive path) in reason for sensitive paths", () => {
    const entry = makeEntry({
      action: {
        type: "file.delete" as ATFEntry["action"]["type"],
        target: "/home/user/.ssh/known_hosts",
        detail: "Deleted known hosts",
      },
    });
    const result = fileDeletion.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.reason).toContain("sensitive path");
  });

  it("has correct rule metadata", () => {
    expect(fileDeletion.id).toBe("destr-001");
    expect(fileDeletion.category).toBe("destructive");
    expect(fileDeletion.severity).toBe("medium");
    expect(fileDeletion.enabledByDefault).toBe(true);
  });
});

describe("recursiveDelete (destr-002)", () => {
  const ctx = makeContext();

  it("triggers on exec.command with rm -rf in target", () => {
    const entry = makeEntry({
      action: {
        type: "exec.command" as ATFEntry["action"]["type"],
        target: "rm -rf /tmp/build",
        detail: "Clean build directory",
      },
    });
    const result = recursiveDelete.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("destr-002");
    expect(result!.severity).toBe("critical");
    expect(result!.riskContribution).toBe(9);
    expect(result!.labels).toEqual(["execution"]);
  });

  it("triggers on exec.command with rm -r in target", () => {
    const entry = makeEntry({
      action: {
        type: "exec.command" as ATFEntry["action"]["type"],
        target: "rm -r /home/user/old-project",
        detail: "Remove old project",
      },
    });
    const result = recursiveDelete.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("destr-002");
  });

  it("triggers on exec.command with rm -r in detail", () => {
    const entry = makeEntry({
      action: {
        type: "exec.command" as ATFEntry["action"]["type"],
        target: "/bin/bash cleanup.sh",
        detail: "Script runs rm -r on temp files",
      },
    });
    const result = recursiveDelete.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("destr-002");
  });

  it("triggers on exec.command with rm -rf in detail", () => {
    const entry = makeEntry({
      action: {
        type: "exec.command" as ATFEntry["action"]["type"],
        target: "/bin/bash deploy.sh",
        detail: "Runs rm -rf dist/ before rebuild",
      },
    });
    const result = recursiveDelete.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("destr-002");
  });

  it("returns null for exec.command without rm -r", () => {
    const entry = makeEntry({
      action: {
        type: "exec.command" as ATFEntry["action"]["type"],
        target: "ls -la /home/user",
        detail: "Listed files",
      },
    });
    expect(recursiveDelete.evaluate(entry, ctx)).toBeNull();
  });

  it("returns null for exec.command with plain rm (no recursive flag)", () => {
    const entry = makeEntry({
      action: {
        type: "exec.command" as ATFEntry["action"]["type"],
        target: "rm /tmp/file.txt",
        detail: "Removed single file",
      },
    });
    expect(recursiveDelete.evaluate(entry, ctx)).toBeNull();
  });

  it("returns null for non-exec.command action types", () => {
    const entry = makeEntry({
      action: {
        type: "file.delete" as ATFEntry["action"]["type"],
        target: "rm -rf /tmp/build",
        detail: "File delete with rm-rf-like target",
      },
    });
    expect(recursiveDelete.evaluate(entry, ctx)).toBeNull();
  });

  it("returns null for file.read even if target contains rm -rf", () => {
    const entry = makeEntry({
      action: {
        type: "file.read" as ATFEntry["action"]["type"],
        target: "/home/user/scripts/rm -rf cleanup.sh",
        detail: "Read a script file",
      },
    });
    expect(recursiveDelete.evaluate(entry, ctx)).toBeNull();
  });

  it("is case-insensitive for rm -rf detection", () => {
    const entry = makeEntry({
      action: {
        type: "exec.command" as ATFEntry["action"]["type"],
        target: "RM -RF /tmp/build",
        detail: "Uppercase remove",
      },
    });
    const result = recursiveDelete.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("destr-002");
  });

  it("includes target in reason", () => {
    const entry = makeEntry({
      action: {
        type: "exec.command" as ATFEntry["action"]["type"],
        target: "rm -rf /var/data",
        detail: "Clean data",
      },
    });
    const result = recursiveDelete.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.reason).toContain("rm -rf /var/data");
  });

  it("has correct rule metadata", () => {
    expect(recursiveDelete.id).toBe("destr-002");
    expect(recursiveDelete.category).toBe("destructive");
    expect(recursiveDelete.severity).toBe("critical");
    expect(recursiveDelete.enabledByDefault).toBe(true);
  });
});
