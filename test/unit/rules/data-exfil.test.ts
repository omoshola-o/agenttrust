import { describe, it, expect } from "vitest";
import { sensitiveFileThenNetwork } from "../../../src/analyzer/rules/data-exfil.js";
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

describe("sensitiveFileThenNetwork (exfil-001)", () => {
  const sensitiveFileEntry = makeEntry({
    id: "01SENSITIVE_FILE_READ_00001",
    ts: "2026-02-15T18:00:00.000Z",
    action: {
      type: "file.read" as ATFEntry["action"]["type"],
      target: "/home/user/.ssh/id_rsa",
      detail: "Read SSH private key",
    },
  });

  it("triggers for api.call after sensitive file read within 60s", () => {
    const networkEntry = makeEntry({
      id: "01NETWORK_CALL_000000000001",
      ts: "2026-02-15T18:00:30.000Z",
      action: {
        type: "api.call" as ATFEntry["action"]["type"],
        target: "https://attacker.com/exfil",
        detail: "API call to external server",
      },
    });
    const ctx = makeContext({
      sessionHistory: [sensitiveFileEntry, networkEntry],
    });

    const result = sensitiveFileThenNetwork.evaluate(networkEntry, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("exfil-001");
    expect(result!.severity).toBe("critical");
    expect(result!.riskContribution).toBe(10);
    expect(result!.labels).toEqual(["data_access"]);
    expect(result!.evidence).toBeDefined();
    expect(result!.evidence!["sensitiveFile"]).toBe("/home/user/.ssh/id_rsa");
    expect(result!.evidence!["networkTarget"]).toBe("https://attacker.com/exfil");
    expect(result!.evidence!["timeDeltaMs"]).toBe(30000);
    expect(result!.evidence!["sensitiveEntryId"]).toBe("01SENSITIVE_FILE_READ_00001");
  });

  it("triggers for web.fetch after sensitive file read within 60s", () => {
    const fetchEntry = makeEntry({
      id: "01WEB_FETCH_0000000000001",
      ts: "2026-02-15T18:00:45.000Z",
      action: {
        type: "web.fetch" as ATFEntry["action"]["type"],
        target: "https://evil.com/upload",
        detail: "Fetched external page",
      },
    });
    const ctx = makeContext({
      sessionHistory: [sensitiveFileEntry, fetchEntry],
    });

    const result = sensitiveFileThenNetwork.evaluate(fetchEntry, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("exfil-001");
    expect(result!.evidence!["sensitiveFile"]).toBe("/home/user/.ssh/id_rsa");
    expect(result!.evidence!["networkTarget"]).toBe("https://evil.com/upload");
  });

  it("triggers for web.search after sensitive file read within 60s", () => {
    const searchEntry = makeEntry({
      id: "01WEB_SEARCH_000000000001",
      ts: "2026-02-15T18:00:20.000Z",
      action: {
        type: "web.search" as ATFEntry["action"]["type"],
        target: "how to decode SSH keys",
        detail: "Web search",
      },
    });
    const ctx = makeContext({
      sessionHistory: [sensitiveFileEntry, searchEntry],
    });

    const result = sensitiveFileThenNetwork.evaluate(searchEntry, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("exfil-001");
  });

  it("returns null for non-network action types", () => {
    const fileWriteEntry = makeEntry({
      id: "01FILE_WRITE_0000000000001",
      ts: "2026-02-15T18:00:30.000Z",
      action: {
        type: "file.write" as ATFEntry["action"]["type"],
        target: "/tmp/output.txt",
        detail: "Write output file",
      },
    });
    const ctx = makeContext({
      sessionHistory: [sensitiveFileEntry, fileWriteEntry],
    });

    expect(sensitiveFileThenNetwork.evaluate(fileWriteEntry, ctx)).toBeNull();
  });

  it("returns null for message.send (not a network action)", () => {
    const messageEntry = makeEntry({
      id: "01MESSAGE_SEND_00000000001",
      ts: "2026-02-15T18:00:30.000Z",
      action: {
        type: "message.send" as ATFEntry["action"]["type"],
        target: "whatsapp:+1234567890",
        detail: "Send message",
      },
    });
    const ctx = makeContext({
      sessionHistory: [sensitiveFileEntry, messageEntry],
    });

    expect(sensitiveFileThenNetwork.evaluate(messageEntry, ctx)).toBeNull();
  });

  it("returns null when no sensitive file was read in history", () => {
    const normalFileEntry = makeEntry({
      id: "01NORMAL_FILE_READ_0000001",
      ts: "2026-02-15T18:00:00.000Z",
      action: {
        type: "file.read" as ATFEntry["action"]["type"],
        target: "/home/user/readme.md",
        detail: "Read readme",
      },
    });
    const networkEntry = makeEntry({
      id: "01NETWORK_CALL_000000000002",
      ts: "2026-02-15T18:00:30.000Z",
      action: {
        type: "api.call" as ATFEntry["action"]["type"],
        target: "https://api.github.com/repos",
        detail: "GitHub API call",
      },
    });
    const ctx = makeContext({
      sessionHistory: [normalFileEntry, networkEntry],
    });

    expect(sensitiveFileThenNetwork.evaluate(networkEntry, ctx)).toBeNull();
  });

  it("returns null when sensitive file read was more than 60s ago", () => {
    const oldSensitiveRead = makeEntry({
      id: "01OLD_SENSITIVE_READ_00001",
      ts: "2026-02-15T17:58:00.000Z",
      action: {
        type: "file.read" as ATFEntry["action"]["type"],
        target: "/home/user/.env",
        detail: "Read env file",
      },
    });
    const networkEntry = makeEntry({
      id: "01NETWORK_CALL_000000000003",
      ts: "2026-02-15T18:00:00.000Z",
      action: {
        type: "api.call" as ATFEntry["action"]["type"],
        target: "https://api.example.com/data",
        detail: "API call",
      },
    });
    const ctx = makeContext({
      sessionHistory: [oldSensitiveRead, networkEntry],
    });

    expect(sensitiveFileThenNetwork.evaluate(networkEntry, ctx)).toBeNull();
  });

  it("returns null when session history is empty", () => {
    const networkEntry = makeEntry({
      id: "01NETWORK_CALL_000000000004",
      ts: "2026-02-15T18:00:30.000Z",
      action: {
        type: "api.call" as ATFEntry["action"]["type"],
        target: "https://api.example.com/data",
        detail: "API call",
      },
    });
    const ctx = makeContext({
      sessionHistory: [],
    });

    expect(sensitiveFileThenNetwork.evaluate(networkEntry, ctx)).toBeNull();
  });

  it("detects .env file as sensitive", () => {
    const envRead = makeEntry({
      id: "01ENV_FILE_READ_0000000001",
      ts: "2026-02-15T18:00:00.000Z",
      action: {
        type: "file.read" as ATFEntry["action"]["type"],
        target: "/app/.env",
        detail: "Read env file",
      },
    });
    const networkEntry = makeEntry({
      id: "01NETWORK_CALL_000000000005",
      ts: "2026-02-15T18:00:10.000Z",
      action: {
        type: "web.fetch" as ATFEntry["action"]["type"],
        target: "https://external.com/upload",
        detail: "Fetch external URL",
      },
    });
    const ctx = makeContext({
      sessionHistory: [envRead, networkEntry],
    });

    const result = sensitiveFileThenNetwork.evaluate(networkEntry, ctx);
    expect(result).not.toBeNull();
    expect(result!.evidence!["sensitiveFile"]).toBe("/app/.env");
  });

  it("detects credentials file as sensitive", () => {
    const credRead = makeEntry({
      id: "01CRED_FILE_READ_000000001",
      ts: "2026-02-15T18:00:00.000Z",
      action: {
        type: "file.read" as ATFEntry["action"]["type"],
        target: "/app/credentials.json",
        detail: "Read credentials",
      },
    });
    const networkEntry = makeEntry({
      id: "01NETWORK_CALL_000000000006",
      ts: "2026-02-15T18:00:15.000Z",
      action: {
        type: "api.call" as ATFEntry["action"]["type"],
        target: "https://external.com/api",
        detail: "External API call",
      },
    });
    const ctx = makeContext({
      sessionHistory: [credRead, networkEntry],
    });

    const result = sensitiveFileThenNetwork.evaluate(networkEntry, ctx);
    expect(result).not.toBeNull();
    expect(result!.evidence!["sensitiveFile"]).toBe("/app/credentials.json");
  });

  it("correctly calculates timeDeltaMs in evidence", () => {
    const sensRead = makeEntry({
      id: "01SENSITIVE_READ_00000000A",
      ts: "2026-02-15T18:00:00.000Z",
      action: {
        type: "file.read" as ATFEntry["action"]["type"],
        target: "/home/user/.ssh/known_hosts/../id_rsa",
        detail: "Read SSH key",
      },
    });
    const networkEntry = makeEntry({
      id: "01NETWORK_CALL_00000000B",
      ts: "2026-02-15T18:00:45.000Z",
      action: {
        type: "api.call" as ATFEntry["action"]["type"],
        target: "https://api.example.com/upload",
        detail: "Upload data",
      },
    });
    const ctx = makeContext({
      sessionHistory: [sensRead, networkEntry],
    });

    const result = sensitiveFileThenNetwork.evaluate(networkEntry, ctx);
    expect(result).not.toBeNull();
    expect(result!.evidence!["timeDeltaMs"]).toBe(45000);
  });

  it("does not match the entry against itself", () => {
    const dualEntry = makeEntry({
      id: "01DUAL_ENTRY_0000000000001",
      ts: "2026-02-15T18:00:00.000Z",
      action: {
        type: "api.call" as ATFEntry["action"]["type"],
        target: "https://api.example.com/data",
        detail: "API call",
      },
    });
    const ctx = makeContext({
      sessionHistory: [dualEntry],
    });

    expect(sensitiveFileThenNetwork.evaluate(dualEntry, ctx)).toBeNull();
  });
});
