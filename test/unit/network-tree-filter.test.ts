import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import type {
  NetworkWitnessEvent,
  WitnessConfig,
} from "../../src/witness/types.js";
import { DEFAULT_WITNESS_CONFIG } from "../../src/witness/types.js";

function makeConfig(overrides: Partial<WitnessConfig> = {}): WitnessConfig {
  return { ...DEFAULT_WITNESS_CONFIG, ...overrides };
}

// Mock child_process at the module level for ESM compatibility
const mockExec = vi.fn();

vi.mock("node:child_process", () => ({
  exec: (...args: unknown[]) => mockExec(...args),
}));

describe("NetworkMonitor process tree filtering", () => {
  let NetworkMonitor: typeof import("../../src/witness/network-monitor.js").NetworkMonitor;

  function makePsOutput(processes: Array<{ pid: number; ppid: number; user: string; command: string }>): string {
    const header = "  PID  PPID USER     COMMAND";
    const lines = processes.map((p) =>
      `  ${p.pid}  ${p.ppid}  ${p.user}  ${p.command}`,
    );
    return [header, ...lines].join("\n");
  }

  function makeLsofOutput(connections: Array<{
    command: string;
    pid: number;
    localHost: string;
    localPort: number;
    remoteHost: string;
    remotePort: number;
    protocol: string;
    state?: string;
  }>): string {
    const header = "COMMAND   PID   USER   FD   TYPE DEVICE SIZE/OFF NODE NAME";
    const lines = connections.map((c) => {
      const state = c.state ? ` (${c.state})` : "";
      return `${c.command}    ${c.pid}  user   20u  IPv4 0x1234      0t0  ${c.protocol.toUpperCase()} 10.0.0.1:${c.localPort}->${c.remoteHost}:${c.remotePort}${state}`;
    });
    return [header, ...lines].join("\n");
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    mockExec.mockReset();

    const mod = await import("../../src/witness/network-monitor.js");
    NetworkMonitor = mod.NetworkMonitor;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("filters connections by full process tree, not just gateway PID", async () => {
    const psOutput = makePsOutput([
      { pid: 100, ppid: 1, user: "user", command: "openclaw" },
      { pid: 200, ppid: 100, user: "user", command: "node" },
      { pid: 300, ppid: 200, user: "user", command: "curl" },
      { pid: 9999, ppid: 1, user: "user", command: "Google Chrome" },
    ]);

    const lsofOutput = makeLsofOutput([
      { command: "curl", pid: 300, localHost: "10.0.0.1", localPort: 50001, remoteHost: "api.example.com", remotePort: 443, protocol: "TCP", state: "ESTABLISHED" },
    ]);

    mockExec.mockImplementation(
      (
        cmd: string,
        _opts: unknown,
        callback?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        const stdout = (cmd as string).startsWith("ps") ? psOutput : lsofOutput;
        if (callback) {
          callback(null, { stdout, stderr: "" });
        }
        return { on: vi.fn(), stdout: null, stderr: null };
      },
    );

    const config = makeConfig({ networkPollingMs: 100 });
    const monitor = new NetworkMonitor(config);
    const events: NetworkWitnessEvent[] = [];

    // Start with gateway PID 100 — child 200 and grandchild 300 should be included
    await monitor.start((event) => { events.push(event); }, 100);

    // Verify the lsof command includes all PIDs in the tree
    const lsofCalls = mockExec.mock.calls.filter(
      (c) => (c[0] as string).startsWith("lsof"),
    );
    expect(lsofCalls.length).toBeGreaterThanOrEqual(1);
    const lsofCmd = lsofCalls[0]![0] as string;
    expect(lsofCmd).toContain("100");
    expect(lsofCmd).toContain("200");
    expect(lsofCmd).toContain("300");
    // Chrome PID should NOT be in the lsof command
    expect(lsofCmd).not.toContain("9999");

    monitor.stop();
  });

  it("returns no connections when gateway PID is not found in process list", async () => {
    const psOutput = makePsOutput([
      { pid: 1, ppid: 0, user: "root", command: "launchd" },
      { pid: 500, ppid: 1, user: "user", command: "Finder" },
    ]);

    mockExec.mockImplementation(
      (
        cmd: string,
        _opts: unknown,
        callback?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        if (callback) {
          callback(null, { stdout: psOutput, stderr: "" });
        }
        return { on: vi.fn(), stdout: null, stderr: null };
      },
    );

    const config = makeConfig({ networkPollingMs: 100 });
    const monitor = new NetworkMonitor(config);
    const events: NetworkWitnessEvent[] = [];

    // Gateway PID 42 doesn't exist in the process list
    await monitor.start((event) => { events.push(event); }, 42);

    // No lsof calls should be made because getGatewayTreePids returns empty set
    const lsofCalls = mockExec.mock.calls.filter(
      (c) => (c[0] as string).startsWith("lsof"),
    );
    expect(lsofCalls).toHaveLength(0);

    monitor.stop();
  });

  it("falls back to single PID when ps fails", async () => {
    let callCount = 0;
    mockExec.mockImplementation(
      (
        cmd: string,
        _opts: unknown,
        callback?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        callCount++;
        if ((cmd as string).startsWith("ps")) {
          // ps fails
          if (callback) {
            callback(new Error("ps failed"), { stdout: "", stderr: "error" });
          }
        } else {
          // lsof succeeds
          if (callback) {
            callback(null, { stdout: makeLsofOutput([]), stderr: "" });
          }
        }
        return { on: vi.fn(), stdout: null, stderr: null };
      },
    );

    const config = makeConfig({ networkPollingMs: 100 });
    const monitor = new NetworkMonitor(config);

    await monitor.start(() => {}, 42);

    // When ps fails, it should fall back to using just the gateway PID
    const lsofCalls = mockExec.mock.calls.filter(
      (c) => (c[0] as string).startsWith("lsof"),
    );
    expect(lsofCalls.length).toBeGreaterThanOrEqual(1);
    const lsofCmd = lsofCalls[0]![0] as string;
    expect(lsofCmd).toContain("-p 42");

    monitor.stop();
  });

  it("includes deeply nested descendant PIDs", async () => {
    const psOutput = makePsOutput([
      { pid: 10, ppid: 1, user: "user", command: "openclaw" },
      { pid: 20, ppid: 10, user: "user", command: "node" },
      { pid: 30, ppid: 20, user: "user", command: "bash" },
      { pid: 40, ppid: 30, user: "user", command: "python" },
      { pid: 50, ppid: 40, user: "user", command: "curl" },
    ]);

    mockExec.mockImplementation(
      (
        cmd: string,
        _opts: unknown,
        callback?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        const stdout = (cmd as string).startsWith("ps") ? psOutput : makeLsofOutput([]);
        if (callback) {
          callback(null, { stdout, stderr: "" });
        }
        return { on: vi.fn(), stdout: null, stderr: null };
      },
    );

    const config = makeConfig({ networkPollingMs: 100 });
    const monitor = new NetworkMonitor(config);

    await monitor.start(() => {}, 10);

    const lsofCalls = mockExec.mock.calls.filter(
      (c) => (c[0] as string).startsWith("lsof"),
    );
    expect(lsofCalls.length).toBeGreaterThanOrEqual(1);
    const lsofCmd = lsofCalls[0]![0] as string;
    // All descendants should be in the PID list
    expect(lsofCmd).toContain("10");
    expect(lsofCmd).toContain("20");
    expect(lsofCmd).toContain("30");
    expect(lsofCmd).toContain("40");
    expect(lsofCmd).toContain("50");

    monitor.stop();
  });

  it("uses process tree on poll as well", async () => {
    const psOutput = makePsOutput([
      { pid: 100, ppid: 1, user: "user", command: "openclaw" },
      { pid: 200, ppid: 100, user: "user", command: "node" },
    ]);

    mockExec.mockImplementation(
      (
        cmd: string,
        _opts: unknown,
        callback?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        const stdout = (cmd as string).startsWith("ps") ? psOutput : makeLsofOutput([]);
        if (callback) {
          callback(null, { stdout, stderr: "" });
        }
        return { on: vi.fn(), stdout: null, stderr: null };
      },
    );

    const config = makeConfig({ networkPollingMs: 100 });
    const monitor = new NetworkMonitor(config);

    await monitor.start(() => {}, 100);

    // Advance timer to trigger a poll
    await vi.advanceTimersByTimeAsync(150);

    // Should have made ps + lsof calls during the poll too
    const lsofCalls = mockExec.mock.calls.filter(
      (c) => (c[0] as string).startsWith("lsof"),
    );
    // At least 2 lsof calls: initial scan + poll
    expect(lsofCalls.length).toBeGreaterThanOrEqual(2);

    // Poll lsof should also have the process tree PIDs
    const pollLsofCmd = lsofCalls[1]![0] as string;
    expect(pollLsofCmd).toContain("100");
    expect(pollLsofCmd).toContain("200");

    monitor.stop();
  });
});
