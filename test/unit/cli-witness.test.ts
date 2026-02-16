import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ulid } from "ulid";
import { registerWitnessCommand } from "../../cli/commands/witness.js";
import { registerCorrelateCommand } from "../../cli/commands/correlate.js";
import { registerTrustCommand } from "../../cli/commands/trust.js";
import type { WitnessEntry } from "../../src/witness/types.js";

let tempDir: string;
let consoleSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  tempDir = join(tmpdir(), `agenttrust-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const atDir = join(tempDir, ".agenttrust");
  await mkdir(join(atDir, "ledger"), { recursive: true });
  await mkdir(join(atDir, "claims"), { recursive: true });
  await mkdir(join(atDir, "digests"), { recursive: true });
  await mkdir(join(atDir, "witness"), { recursive: true });
  consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  consoleSpy.mockRestore();
  await rm(tempDir, { recursive: true, force: true });
});

function makeWitnessEntry(
  source: "filesystem" | "process" | "network",
  event: WitnessEntry["event"],
  overrides: Partial<WitnessEntry> = {},
): WitnessEntry {
  return {
    id: ulid(),
    v: 1,
    ts: new Date().toISOString(),
    prevHash: "",
    hash: "testhash" + Math.random().toString(36).slice(2),
    source,
    event,
    correlated: false,
    ...overrides,
  };
}

async function writeWitnessFile(entries: WitnessEntry[]): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);
  const filePath = join(tempDir, ".agenttrust", "witness", `${date}.witness.jsonl`);
  const lines = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  await writeFile(filePath, lines);
}

describe("witness status command", () => {
  it("reports event counts from witness files", async () => {
    const entries: WitnessEntry[] = [
      makeWitnessEntry("filesystem", {
        type: "file_created",
        path: "/tmp/test.txt",
        observedAt: new Date().toISOString(),
      }),
      makeWitnessEntry("filesystem", {
        type: "file_modified",
        path: "/tmp/test2.txt",
        observedAt: new Date().toISOString(),
      }),
      makeWitnessEntry("process", {
        type: "process_spawned",
        pid: 1234,
        command: "node",
        observedAt: new Date().toISOString(),
      }),
    ];
    await writeWitnessFile(entries);

    const program = new Command();
    program.exitOverride();
    registerWitnessCommand(program);

    await program.parseAsync(["node", "test", "witness", "status", "-w", tempDir]);

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("Witness Status");
    expect(output).toContain("Total events: 3");
    expect(output).toContain("2 file");
    expect(output).toContain("1 process");
    expect(output).toContain("0 network");
  });

  it("handles empty witness directory", async () => {
    const program = new Command();
    program.exitOverride();
    registerWitnessCommand(program);

    await program.parseAsync(["node", "test", "witness", "status", "-w", tempDir]);

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("Total events: 0");
  });
});

describe("witness log command", () => {
  it("shows recent witness events", async () => {
    const entries: WitnessEntry[] = [
      makeWitnessEntry("filesystem", {
        type: "file_created",
        path: "/tmp/hello.txt",
        observedAt: new Date().toISOString(),
      }),
      makeWitnessEntry("network", {
        type: "connection_opened",
        remoteHost: "api.example.com",
        remotePort: 443,
        protocol: "tcp",
        pid: 5678,
        observedAt: new Date().toISOString(),
      }),
    ];
    await writeWitnessFile(entries);

    const program = new Command();
    program.exitOverride();
    registerWitnessCommand(program);

    await program.parseAsync(["node", "test", "witness", "log", "-w", tempDir]);

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("Witness Events (2)");
    expect(output).toContain("/tmp/hello.txt");
    expect(output).toContain("api.example.com");
  });

  it("filters by source", async () => {
    const entries: WitnessEntry[] = [
      makeWitnessEntry("filesystem", {
        type: "file_created",
        path: "/tmp/hello.txt",
        observedAt: new Date().toISOString(),
      }),
      makeWitnessEntry("process", {
        type: "process_spawned",
        pid: 1234,
        command: "node",
        observedAt: new Date().toISOString(),
      }),
    ];
    await writeWitnessFile(entries);

    const program = new Command();
    program.exitOverride();
    registerWitnessCommand(program);

    await program.parseAsync(["node", "test", "witness", "log", "--source", "filesystem", "-w", tempDir]);

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("Witness Events (1)");
    expect(output).toContain("/tmp/hello.txt");
    expect(output).not.toContain("node");
  });

  it("shows no-events message when empty", async () => {
    const program = new Command();
    program.exitOverride();
    registerWitnessCommand(program);

    await program.parseAsync(["node", "test", "witness", "log", "-w", tempDir]);

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("No witness events found");
  });

  it("shows process events with PID info", async () => {
    const entries: WitnessEntry[] = [
      makeWitnessEntry("process", {
        type: "process_spawned",
        pid: 9999,
        command: "/usr/bin/curl",
        observedAt: new Date().toISOString(),
      }),
    ];
    await writeWitnessFile(entries);

    const program = new Command();
    program.exitOverride();
    registerWitnessCommand(program);

    await program.parseAsync(["node", "test", "witness", "log", "-w", tempDir]);

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("PID 9999");
    expect(output).toContain("/usr/bin/curl");
  });
});

describe("witness config command", () => {
  it("shows default configuration", async () => {
    const program = new Command();
    program.exitOverride();
    registerWitnessCommand(program);

    await program.parseAsync(["node", "test", "witness", "config"]);

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("Witness Configuration");
    expect(output).toContain("Enabled:");
    expect(output).toContain("Watch paths:");
    expect(output).toContain("Process polling:");
    expect(output).toContain("Network polling:");
    expect(output).toContain("Buffer size:");
  });
});

describe("correlate command", () => {
  it("shows report when no data present", async () => {
    const program = new Command();
    program.exitOverride();
    registerCorrelateCommand(program);

    await program.parseAsync(["node", "test", "correlate", "-w", tempDir]);

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("No witness events or execution entries");
  });

  it("runs correlation with witness data only", async () => {
    const entries: WitnessEntry[] = [
      makeWitnessEntry("filesystem", {
        type: "file_created",
        path: "/tmp/mystery.txt",
        observedAt: new Date().toISOString(),
      }),
    ];
    await writeWitnessFile(entries);

    const program = new Command();
    program.exitOverride();
    registerCorrelateCommand(program);

    await program.parseAsync(["node", "test", "correlate", "-w", tempDir]);

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("Correlation Report");
  });
});

describe("trust command", () => {
  it("shows trust verdict for empty workspace", async () => {
    const program = new Command();
    program.exitOverride();
    registerTrustCommand(program);

    await program.parseAsync(["node", "test", "trust", "-w", tempDir]);

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("Trust Verdict");
    expect(output).toContain("TRUST SCORE:");
    expect(output).toContain("Integrity");
    expect(output).toContain("Consistency");
    expect(output).toContain("Witness");
  });

  it("accepts --last flag", async () => {
    const program = new Command();
    program.exitOverride();
    registerTrustCommand(program);

    await program.parseAsync(["node", "test", "trust", "--last", "1h", "-w", tempDir]);

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("Period: last 1h");
  });

  it("shows verified level for empty workspace with intact integrity", async () => {
    const program = new Command();
    program.exitOverride();
    registerTrustCommand(program);

    await program.parseAsync(["node", "test", "trust", "-w", tempDir]);

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    // Empty workspace has 100 integrity, 100 consistency, 100 witness = verified
    expect(output).toContain("VERIFIED");
  });
});
