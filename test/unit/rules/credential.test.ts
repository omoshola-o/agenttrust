import { describe, it, expect } from "vitest";
import {
  sshKeyAccess,
  envSecretAccess,
  passwordStoreAccess,
} from "../../../src/analyzer/rules/credential.js";
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

describe("sshKeyAccess (cred-001)", () => {
  const ctx = makeContext();

  it("triggers on file.read of .ssh/id_rsa", () => {
    const entry = makeEntry({
      action: {
        type: "file.read" as ATFEntry["action"]["type"],
        target: "/home/user/.ssh/id_rsa",
        detail: "Read SSH private key",
      },
    });
    const result = sshKeyAccess.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("cred-001");
    expect(result!.severity).toBe("critical");
    expect(result!.riskContribution).toBe(9);
    expect(result!.labels).toEqual(["data_access", "escalation"]);
  });

  it("triggers on file.read of a .pem file", () => {
    const entry = makeEntry({
      action: {
        type: "file.read" as ATFEntry["action"]["type"],
        target: "/etc/ssl/certs/server.pem",
        detail: "Read PEM certificate",
      },
    });
    const result = sshKeyAccess.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("cred-001");
  });

  it("triggers on file.read of a .key file", () => {
    const entry = makeEntry({
      action: {
        type: "file.read" as ATFEntry["action"]["type"],
        target: "/etc/ssl/private/private.key",
        detail: "Read private key file",
      },
    });
    const result = sshKeyAccess.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("cred-001");
  });

  it("returns null for non-file.read action type", () => {
    const entry = makeEntry({
      action: {
        type: "file.write" as ATFEntry["action"]["type"],
        target: "/home/user/.ssh/id_rsa",
        detail: "Write SSH key",
      },
    });
    expect(sshKeyAccess.evaluate(entry, ctx)).toBeNull();
  });

  it("returns null for file.read of a normal file", () => {
    const entry = makeEntry({
      action: {
        type: "file.read" as ATFEntry["action"]["type"],
        target: "/home/user/readme.md",
        detail: "Read readme",
      },
    });
    expect(sshKeyAccess.evaluate(entry, ctx)).toBeNull();
  });

  it("returns null for api.call type even with SSH-like target", () => {
    const entry = makeEntry({
      action: {
        type: "api.call" as ATFEntry["action"]["type"],
        target: "https://example.com/.ssh/id_rsa",
        detail: "API call",
      },
    });
    expect(sshKeyAccess.evaluate(entry, ctx)).toBeNull();
  });
});

describe("envSecretAccess (cred-002)", () => {
  const ctx = makeContext();

  it("triggers on file.read of .env", () => {
    const entry = makeEntry({
      action: {
        type: "file.read" as ATFEntry["action"]["type"],
        target: "/app/.env",
        detail: "Read env file",
      },
    });
    const result = envSecretAccess.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("cred-002");
    expect(result!.severity).toBe("high");
    expect(result!.riskContribution).toBe(8);
    expect(result!.labels).toEqual(["data_access"]);
  });

  it("triggers on file.read of .env.local", () => {
    const entry = makeEntry({
      action: {
        type: "file.read" as ATFEntry["action"]["type"],
        target: "/app/.env.local",
        detail: "Read local env",
      },
    });
    const result = envSecretAccess.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("cred-002");
  });

  it("triggers on file.read of credentials.json", () => {
    const entry = makeEntry({
      action: {
        type: "file.read" as ATFEntry["action"]["type"],
        target: "/app/credentials.json",
        detail: "Read credentials",
      },
    });
    const result = envSecretAccess.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("cred-002");
  });

  it("triggers on file.read of secrets.yaml", () => {
    const entry = makeEntry({
      action: {
        type: "file.read" as ATFEntry["action"]["type"],
        target: "/app/config/secrets.yaml",
        detail: "Read secrets",
      },
    });
    const result = envSecretAccess.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("cred-002");
  });

  it("triggers on file.read of tokens.json", () => {
    const entry = makeEntry({
      action: {
        type: "file.read" as ATFEntry["action"]["type"],
        target: "/app/tokens.json",
        detail: "Read tokens file",
      },
    });
    const result = envSecretAccess.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("cred-002");
  });

  it("returns null for file.read of a non-sensitive file", () => {
    const entry = makeEntry({
      action: {
        type: "file.read" as ATFEntry["action"]["type"],
        target: "/app/config/database.yaml",
        detail: "Read database config",
      },
    });
    expect(envSecretAccess.evaluate(entry, ctx)).toBeNull();
  });

  it("returns null for non-file.read action type", () => {
    const entry = makeEntry({
      action: {
        type: "exec.command" as ATFEntry["action"]["type"],
        target: "cat .env",
        detail: "Cat env file",
      },
    });
    expect(envSecretAccess.evaluate(entry, ctx)).toBeNull();
  });
});

describe("passwordStoreAccess (cred-003)", () => {
  const ctx = makeContext();

  it("triggers on file.read of passwords.txt", () => {
    const entry = makeEntry({
      action: {
        type: "file.read" as ATFEntry["action"]["type"],
        target: "/home/user/passwords.txt",
        detail: "Read passwords file",
      },
    });
    const result = passwordStoreAccess.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("cred-003");
    expect(result!.severity).toBe("critical");
    expect(result!.riskContribution).toBe(9);
    expect(result!.labels).toEqual(["data_access"]);
  });

  it("triggers on file.read of keychain.db", () => {
    const entry = makeEntry({
      action: {
        type: "file.read" as ATFEntry["action"]["type"],
        target: "/home/user/Library/keychain.db",
        detail: "Read keychain",
      },
    });
    const result = passwordStoreAccess.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("cred-003");
  });

  it("triggers on file.read of vault.json", () => {
    const entry = makeEntry({
      action: {
        type: "file.read" as ATFEntry["action"]["type"],
        target: "/app/vault.json",
        detail: "Read vault",
      },
    });
    const result = passwordStoreAccess.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("cred-003");
  });

  it("returns null for file.read of a non-sensitive file", () => {
    const entry = makeEntry({
      action: {
        type: "file.read" as ATFEntry["action"]["type"],
        target: "/home/user/notes.txt",
        detail: "Read notes",
      },
    });
    expect(passwordStoreAccess.evaluate(entry, ctx)).toBeNull();
  });

  it("returns null for non-file.read action type", () => {
    const entry = makeEntry({
      action: {
        type: "file.delete" as ATFEntry["action"]["type"],
        target: "/home/user/passwords.txt",
        detail: "Delete passwords file",
      },
    });
    expect(passwordStoreAccess.evaluate(entry, ctx)).toBeNull();
  });

  it("returns null for message.send even with password-like target", () => {
    const entry = makeEntry({
      action: {
        type: "message.send" as ATFEntry["action"]["type"],
        target: "passwords.txt",
        detail: "Send passwords",
      },
    });
    expect(passwordStoreAccess.evaluate(entry, ctx)).toBeNull();
  });
});
