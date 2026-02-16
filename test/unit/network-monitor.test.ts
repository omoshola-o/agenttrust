import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import {
  parseLsofOutput,
  parseHostPort,
} from "../../src/witness/network-monitor.js";
import type {
  NetworkWitnessEvent,
  WitnessConfig,
} from "../../src/witness/types.js";
import { DEFAULT_WITNESS_CONFIG } from "../../src/witness/types.js";

function makeConfig(overrides: Partial<WitnessConfig> = {}): WitnessConfig {
  return { ...DEFAULT_WITNESS_CONFIG, ...overrides };
}

describe("parseHostPort", () => {
  it("parses IPv4 address with port", () => {
    const result = parseHostPort("1.2.3.4:443");
    expect(result).toEqual({ host: "1.2.3.4", port: 443 });
  });

  it("parses IPv4 address with different port", () => {
    const result = parseHostPort("192.168.1.100:8080");
    expect(result).toEqual({ host: "192.168.1.100", port: 8080 });
  });

  it("parses IPv6 address in bracket notation", () => {
    const result = parseHostPort("[::1]:80");
    expect(result).toEqual({ host: "::1", port: 80 });
  });

  it("parses full IPv6 address in bracket notation", () => {
    const result = parseHostPort("[2001:db8::1]:443");
    expect(result).toEqual({ host: "2001:db8::1", port: 443 });
  });

  it("returns null for missing closing bracket in IPv6", () => {
    const result = parseHostPort("[::1:80");
    expect(result).toBeNull();
  });

  it("returns null for no colon separator", () => {
    const result = parseHostPort("1.2.3.4");
    expect(result).toBeNull();
  });

  it("returns null for non-numeric port", () => {
    const result = parseHostPort("1.2.3.4:abc");
    expect(result).toBeNull();
  });

  it("returns null for IPv6 with non-numeric port", () => {
    const result = parseHostPort("[::1]:abc");
    expect(result).toBeNull();
  });
});

describe("parseLsofOutput", () => {
  it("parses TCP outbound connections", () => {
    const output = [
      "COMMAND   PID   USER   FD   TYPE DEVICE SIZE/OFF NODE NAME",
      "node    12345  user   20u  IPv4 0x1234      0t0  TCP 192.168.1.100:52341->93.184.216.34:443 (ESTABLISHED)",
    ].join("\n");

    const result = parseLsofOutput(output);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      protocol: "tcp",
      remoteHost: "93.184.216.34",
      remotePort: 443,
      pid: 12345,
      command: "node",
    });
  });

  it("parses UDP connections", () => {
    const output = [
      "COMMAND   PID   USER   FD   TYPE DEVICE SIZE/OFF NODE NAME",
      "chrome  5678  user   30u  IPv4 0xabcd      0t0  UDP 10.0.0.1:54321->8.8.8.8:53",
    ].join("\n");

    const result = parseLsofOutput(output);
    expect(result).toHaveLength(1);
    expect(result[0]!.protocol).toBe("udp");
    expect(result[0]!.remoteHost).toBe("8.8.8.8");
    expect(result[0]!.remotePort).toBe(53);
  });

  it("parses IPv6 connections", () => {
    const output = [
      "COMMAND   PID   USER   FD   TYPE DEVICE SIZE/OFF NODE NAME",
      "node    12345  user   21u  IPv6 0x5678      0t0  TCP [::ffff:10.0.0.1]:3000->[2001:db8::1]:443 (ESTABLISHED)",
    ].join("\n");

    const result = parseLsofOutput(output);
    expect(result).toHaveLength(1);
    expect(result[0]!.remoteHost).toBe("2001:db8::1");
    expect(result[0]!.remotePort).toBe(443);
  });

  it("filters out localhost connections (127.0.0.1)", () => {
    const output = [
      "COMMAND   PID   USER   FD   TYPE DEVICE SIZE/OFF NODE NAME",
      "node    12345  user   20u  IPv4 0x1234      0t0  TCP 127.0.0.1:52341->127.0.0.1:3000 (ESTABLISHED)",
    ].join("\n");

    const result = parseLsofOutput(output);
    expect(result).toHaveLength(0);
  });

  it("filters out localhost connections (::1)", () => {
    const output = [
      "COMMAND   PID   USER   FD   TYPE DEVICE SIZE/OFF NODE NAME",
      "node    12345  user   21u  IPv6 0x5678      0t0  TCP [::1]:3000->[::1]:52342 (ESTABLISHED)",
    ].join("\n");

    const result = parseLsofOutput(output);
    expect(result).toHaveLength(0);
  });

  it("filters out 0.0.0.0 connections", () => {
    const output = [
      "COMMAND   PID   USER   FD   TYPE DEVICE SIZE/OFF NODE NAME",
      "node    12345  user   20u  IPv4 0x1234      0t0  TCP 10.0.0.1:3000->0.0.0.0:443 (ESTABLISHED)",
    ].join("\n");

    const result = parseLsofOutput(output);
    expect(result).toHaveLength(0);
  });

  it("skips listening sockets (no -> arrow)", () => {
    const output = [
      "COMMAND   PID   USER   FD   TYPE DEVICE SIZE/OFF NODE NAME",
      "node    12345  user   20u  IPv4 0x1234      0t0  TCP *:3000 (LISTEN)",
    ].join("\n");

    const result = parseLsofOutput(output);
    expect(result).toHaveLength(0);
  });

  it("skips lines with unknown protocol (not TCP/UDP)", () => {
    const output = [
      "COMMAND   PID   USER   FD   TYPE DEVICE SIZE/OFF NODE NAME",
      "node    12345  user   20u  IPv4 0x1234      0t0  RAW 10.0.0.1:0->8.8.8.8:0",
    ].join("\n");

    const result = parseLsofOutput(output);
    expect(result).toHaveLength(0);
  });

  it("handles multiple connections from the same process", () => {
    const output = [
      "COMMAND   PID   USER   FD   TYPE DEVICE SIZE/OFF NODE NAME",
      "node    12345  user   20u  IPv4 0x1234      0t0  TCP 10.0.0.1:52341->93.184.216.34:443 (ESTABLISHED)",
      "node    12345  user   21u  IPv4 0x1235      0t0  TCP 10.0.0.1:52342->151.101.1.69:443 (ESTABLISHED)",
      "node    12345  user   22u  IPv4 0x1236      0t0  TCP 10.0.0.1:52343->140.82.121.4:443 (ESTABLISHED)",
    ].join("\n");

    const result = parseLsofOutput(output);
    expect(result).toHaveLength(3);
    expect(result.map((c) => c.remoteHost)).toEqual([
      "93.184.216.34",
      "151.101.1.69",
      "140.82.121.4",
    ]);
  });

  it("returns empty array for empty output", () => {
    expect(parseLsofOutput("")).toEqual([]);
  });

  it("returns empty array for header-only output", () => {
    const output = "COMMAND   PID   USER   FD   TYPE DEVICE SIZE/OFF NODE NAME";
    expect(parseLsofOutput(output)).toEqual([]);
  });

  it("skips lines with non-numeric PID", () => {
    const output = [
      "COMMAND   PID   USER   FD   TYPE DEVICE SIZE/OFF NODE NAME",
      "node    abc  user   20u  IPv4 0x1234      0t0  TCP 10.0.0.1:52341->93.184.216.34:443 (ESTABLISHED)",
    ].join("\n");

    const result = parseLsofOutput(output);
    expect(result).toHaveLength(0);
  });
});

// Mock child_process at the module level for ESM compatibility
const mockExec = vi.fn();

vi.mock("node:child_process", () => ({
  exec: (...args: unknown[]) => mockExec(...args),
}));

describe("NetworkMonitor", () => {
  let NetworkMonitor: typeof import("../../src/witness/network-monitor.js").NetworkMonitor;

  beforeEach(async () => {
    vi.useFakeTimers();
    mockExec.mockReset();

    const mod = await import("../../src/witness/network-monitor.js");
    NetworkMonitor = mod.NetworkMonitor;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setExecOutput(output: string): void {
    mockExec.mockImplementation(
      (
        _cmd: string,
        _opts: unknown,
        callback?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        if (callback) {
          callback(null, { stdout: output, stderr: "" });
        }
        return { on: vi.fn(), stdout: null, stderr: null };
      },
    );
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
      return `${c.command}    ${c.pid}  user   20u  IPv4 0x1234      0t0  ${c.protocol.toUpperCase()} ${c.localHost}:${c.localPort}->${c.remoteHost}:${c.remotePort}${state}`;
    });
    return [header, ...lines].join("\n");
  }

  it("emits connection_opened for new connections on poll", async () => {
    setExecOutput(makeLsofOutput([]));

    const config = makeConfig({ networkPollingMs: 100 });
    const monitor = new NetworkMonitor(config);
    const events: NetworkWitnessEvent[] = [];

    await monitor.start((event) => {
      events.push(event);
    });

    const updatedOutput = makeLsofOutput([
      {
        command: "node",
        pid: 100,
        localHost: "10.0.0.1",
        localPort: 52341,
        remoteHost: "93.184.216.34",
        remotePort: 443,
        protocol: "TCP",
        state: "ESTABLISHED",
      },
    ]);
    setExecOutput(updatedOutput);

    await vi.advanceTimersByTimeAsync(150);

    monitor.stop();

    const openedEvents = events.filter((e) => e.type === "connection_opened");
    expect(openedEvents).toHaveLength(1);
    expect(openedEvents[0]!.remoteHost).toBe("93.184.216.34");
    expect(openedEvents[0]!.remotePort).toBe(443);
    expect(openedEvents[0]!.protocol).toBe("tcp");
    expect(openedEvents[0]!.pid).toBe(100);
    expect(openedEvents[0]!.command).toBe("node");
  });

  it("emits connection_closed for disappeared connections", async () => {
    setExecOutput(makeLsofOutput([
      {
        command: "node",
        pid: 100,
        localHost: "10.0.0.1",
        localPort: 52341,
        remoteHost: "93.184.216.34",
        remotePort: 443,
        protocol: "TCP",
        state: "ESTABLISHED",
      },
    ]));

    const config = makeConfig({ networkPollingMs: 100 });
    const monitor = new NetworkMonitor(config);
    const events: NetworkWitnessEvent[] = [];

    await monitor.start((event) => {
      events.push(event);
    });

    // Connection disappears
    setExecOutput(makeLsofOutput([]));

    await vi.advanceTimersByTimeAsync(150);

    monitor.stop();

    const closedEvents = events.filter((e) => e.type === "connection_closed");
    expect(closedEvents).toHaveLength(1);
    expect(closedEvents[0]!.remoteHost).toBe("93.184.216.34");
    expect(closedEvents[0]!.remotePort).toBe(443);
  });

  it("does not emit events for connections seen in initial scan that persist", async () => {
    setExecOutput(makeLsofOutput([
      {
        command: "node",
        pid: 100,
        localHost: "10.0.0.1",
        localPort: 52341,
        remoteHost: "93.184.216.34",
        remotePort: 443,
        protocol: "TCP",
        state: "ESTABLISHED",
      },
    ]));

    const config = makeConfig({ networkPollingMs: 100 });
    const monitor = new NetworkMonitor(config);
    const events: NetworkWitnessEvent[] = [];

    await monitor.start((event) => {
      events.push(event);
    });

    // Same connections on first poll
    await vi.advanceTimersByTimeAsync(150);

    monitor.stop();

    expect(events).toHaveLength(0);
  });

  it("accepts a gateway PID and queries process tree for lsof filtering", async () => {
    // Mock needs to handle both ps and lsof commands
    const psOutput = [
      "  PID  PPID USER     COMMAND",
      "   42     1 user     openclaw",
      "  100    42 user     node",
    ].join("\n");

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

    await monitor.start(() => {}, 42);

    // Verify lsof was called with PID list from the process tree
    const calls = mockExec.mock.calls;
    const lsofCalls = calls.filter((c) => (c[0] as string).startsWith("lsof"));
    expect(lsofCalls.length).toBeGreaterThanOrEqual(1);
    const lsofCmd = lsofCalls[0]![0] as string;
    // Should contain both gateway PID (42) and child PID (100)
    expect(lsofCmd).toContain("-p");
    expect(lsofCmd).toContain("42");
    expect(lsofCmd).toContain("100");

    monitor.stop();
  });

  it("uses unfiltered lsof when no gateway PID is provided", async () => {
    setExecOutput(makeLsofOutput([]));

    const config = makeConfig({ networkPollingMs: 100 });
    const monitor = new NetworkMonitor(config);

    await monitor.start(() => {});

    const calls = mockExec.mock.calls;
    const lsofCalls = calls.filter((c) => (c[0] as string).startsWith("lsof"));
    expect(lsofCalls.length).toBeGreaterThanOrEqual(1);
    expect(lsofCalls[0]![0]).toBe("lsof -i -n -P");

    monitor.stop();
  });

  it("setGatewayPid updates the PID used for filtering", () => {
    const config = makeConfig({ networkPollingMs: 100 });
    const monitor = new NetworkMonitor(config);

    monitor.setGatewayPid(99);
    monitor.setGatewayPid(null);
    // Just confirm it does not throw
  });

  it("stop() clears active connections and poll timer", async () => {
    setExecOutput(makeLsofOutput([
      {
        command: "node",
        pid: 100,
        localHost: "10.0.0.1",
        localPort: 52341,
        remoteHost: "93.184.216.34",
        remotePort: 443,
        protocol: "TCP",
        state: "ESTABLISHED",
      },
    ]));

    const config = makeConfig({ networkPollingMs: 100 });
    const monitor = new NetworkMonitor(config);

    await monitor.start(() => {});

    monitor.stop();

    // After stop, advancing timers should not cause issues
    await vi.advanceTimersByTimeAsync(500);
  });

  it("includes observedAt timestamp in connection events", async () => {
    setExecOutput(makeLsofOutput([]));

    const config = makeConfig({ networkPollingMs: 100 });
    const monitor = new NetworkMonitor(config);
    const events: NetworkWitnessEvent[] = [];

    await monitor.start((event) => {
      events.push(event);
    });

    setExecOutput(makeLsofOutput([
      {
        command: "curl",
        pid: 555,
        localHost: "10.0.0.1",
        localPort: 52341,
        remoteHost: "93.184.216.34",
        remotePort: 80,
        protocol: "TCP",
        state: "ESTABLISHED",
      },
    ]));

    await vi.advanceTimersByTimeAsync(150);

    monitor.stop();

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(typeof events[0]!.observedAt).toBe("string");
    expect(isNaN(new Date(events[0]!.observedAt).getTime())).toBe(false);
  });
});
