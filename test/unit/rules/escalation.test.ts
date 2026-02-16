import { describe, it, expect } from "vitest";
import { elevatedModeUsed, sudoCommand } from "../../../src/analyzer/rules/escalation.js";
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

describe("elevatedModeUsed (esc-001)", () => {
  const ctx = makeContext();

  it("triggers on elevated.enable", () => {
    const entry = makeEntry({
      action: {
        type: "elevated.enable" as ATFEntry["action"]["type"],
        target: "host",
        detail: "Enabled elevated execution mode",
      },
    });
    const result = elevatedModeUsed.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("esc-001");
    expect(result!.severity).toBe("critical");
    expect(result!.riskContribution).toBe(9);
    expect(result!.labels).toEqual(["escalation"]);
  });

  it("triggers on elevated.command", () => {
    const entry = makeEntry({
      action: {
        type: "elevated.command" as ATFEntry["action"]["type"],
        target: "rm -rf /tmp/cache",
        detail: "Executed elevated command",
      },
    });
    const result = elevatedModeUsed.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("esc-001");
    expect(result!.severity).toBe("critical");
  });

  it("returns null for exec.command", () => {
    const entry = makeEntry({
      action: {
        type: "exec.command" as ATFEntry["action"]["type"],
        target: "ls -la",
        detail: "List files",
      },
    });
    expect(elevatedModeUsed.evaluate(entry, ctx)).toBeNull();
  });

  it("returns null for file.read", () => {
    const entry = makeEntry({
      action: {
        type: "file.read" as ATFEntry["action"]["type"],
        target: "/etc/sudoers",
        detail: "Read sudoers",
      },
    });
    expect(elevatedModeUsed.evaluate(entry, ctx)).toBeNull();
  });

  it("returns null for api.call", () => {
    const entry = makeEntry({
      action: {
        type: "api.call" as ATFEntry["action"]["type"],
        target: "https://admin.example.com/elevate",
        detail: "Elevate permissions via API",
      },
    });
    expect(elevatedModeUsed.evaluate(entry, ctx)).toBeNull();
  });

  it("includes action detail in reason", () => {
    const entry = makeEntry({
      action: {
        type: "elevated.enable" as ATFEntry["action"]["type"],
        target: "host",
        detail: "Enabling host mode for deployment",
      },
    });
    const result = elevatedModeUsed.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.reason).toContain("Enabling host mode for deployment");
  });
});

describe("sudoCommand (esc-002)", () => {
  const ctx = makeContext();

  it("triggers on exec.command with sudo in target", () => {
    const entry = makeEntry({
      action: {
        type: "exec.command" as ATFEntry["action"]["type"],
        target: "sudo rm -rf /tmp/old",
        detail: "Remove old temp files",
      },
    });
    const result = sudoCommand.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("esc-002");
    expect(result!.severity).toBe("critical");
    expect(result!.riskContribution).toBe(9);
    expect(result!.labels).toEqual(["escalation", "execution"]);
  });

  it("triggers on exec.command with sudo in detail", () => {
    const entry = makeEntry({
      action: {
        type: "exec.command" as ATFEntry["action"]["type"],
        target: "apt install nginx",
        detail: "Running sudo apt install nginx",
      },
    });
    const result = sudoCommand.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("esc-002");
  });

  it("triggers when sudo appears mid-target", () => {
    const entry = makeEntry({
      action: {
        type: "exec.command" as ATFEntry["action"]["type"],
        target: "bash -c 'sudo systemctl restart nginx'",
        detail: "Restart nginx",
      },
    });
    const result = sudoCommand.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("esc-002");
  });

  it("returns null for exec.command without sudo", () => {
    const entry = makeEntry({
      action: {
        type: "exec.command" as ATFEntry["action"]["type"],
        target: "ls -la /home/user",
        detail: "List home directory",
      },
    });
    expect(sudoCommand.evaluate(entry, ctx)).toBeNull();
  });

  it("returns null for non-exec.command types", () => {
    const entry = makeEntry({
      action: {
        type: "file.read" as ATFEntry["action"]["type"],
        target: "sudo",
        detail: "Reading sudo binary",
      },
    });
    expect(sudoCommand.evaluate(entry, ctx)).toBeNull();
  });

  it("returns null for elevated.command even with sudo", () => {
    const entry = makeEntry({
      action: {
        type: "elevated.command" as ATFEntry["action"]["type"],
        target: "sudo rm -rf /",
        detail: "Sudo elevated command",
      },
    });
    expect(sudoCommand.evaluate(entry, ctx)).toBeNull();
  });

  it("returns null for exec.script with sudo", () => {
    const entry = makeEntry({
      action: {
        type: "exec.script" as ATFEntry["action"]["type"],
        target: "sudo deploy.sh",
        detail: "Run deploy script with sudo",
      },
    });
    expect(sudoCommand.evaluate(entry, ctx)).toBeNull();
  });

  it("includes target in reason", () => {
    const entry = makeEntry({
      action: {
        type: "exec.command" as ATFEntry["action"]["type"],
        target: "sudo chown root:root /etc/config",
        detail: "Change ownership",
      },
    });
    const result = sudoCommand.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.reason).toContain("sudo chown root:root /etc/config");
  });
});
