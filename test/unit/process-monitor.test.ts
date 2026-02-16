import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import {
  parsePsOutput,
  getProcessTree,
} from "../../src/witness/process-monitor.js";
import type {
  ProcessWitnessEvent,
  WitnessConfig,
} from "../../src/witness/types.js";
import { DEFAULT_WITNESS_CONFIG } from "../../src/witness/types.js";

function makeConfig(overrides: Partial<WitnessConfig> = {}): WitnessConfig {
  return { ...DEFAULT_WITNESS_CONFIG, ...overrides };
}

describe("parsePsOutput", () => {
  it("parses valid ps output with header and data lines", () => {
    const output = [
      "  PID  PPID USER     COMMAND",
      "    1     0 root     /sbin/init",
      "  100     1 user     /usr/bin/node",
      "  200   100 user     /usr/bin/python3",
    ].join("\n");

    const result = parsePsOutput(output);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ pid: 1, ppid: 0, command: "/sbin/init", user: "root" });
    expect(result[1]).toEqual({ pid: 100, ppid: 1, command: "/usr/bin/node", user: "user" });
    expect(result[2]).toEqual({ pid: 200, ppid: 100, command: "/usr/bin/python3", user: "user" });
  });

  it("skips empty lines", () => {
    const output = [
      "  PID  PPID USER     COMMAND",
      "",
      "    1     0 root     /sbin/init",
      "",
      "  100     1 user     node",
      "",
    ].join("\n");

    const result = parsePsOutput(output);
    expect(result).toHaveLength(2);
  });

  it("skips malformed lines with fewer than 4 fields", () => {
    const output = [
      "  PID  PPID USER     COMMAND",
      "    1     0 root     /sbin/init",
      "  bad line",
      "  200   100",
      "  300   100 user     valid-command",
    ].join("\n");

    const result = parsePsOutput(output);
    expect(result).toHaveLength(2);
    expect(result[0]!.pid).toBe(1);
    expect(result[1]!.pid).toBe(300);
  });

  it("skips lines with non-numeric PID or PPID", () => {
    const output = [
      "  PID  PPID USER     COMMAND",
      "  abc     0 root     init",
      "    1   xyz root     init",
      "    2     1 root     real-process",
    ].join("\n");

    const result = parsePsOutput(output);
    expect(result).toHaveLength(1);
    expect(result[0]!.pid).toBe(2);
  });

  it("handles commands with spaces by joining remaining parts", () => {
    const output = [
      "  PID  PPID USER     COMMAND",
      "  100     1 user     /usr/bin/node server.js --port 3000",
      "  200     1 user     /usr/bin/python3 -m http.server",
    ].join("\n");

    const result = parsePsOutput(output);
    expect(result).toHaveLength(2);
    expect(result[0]!.command).toBe("/usr/bin/node server.js --port 3000");
    expect(result[1]!.command).toBe("/usr/bin/python3 -m http.server");
  });

  it("returns empty array for empty input", () => {
    expect(parsePsOutput("")).toEqual([]);
  });

  it("returns empty array for header-only input", () => {
    const output = "  PID  PPID USER     COMMAND";
    expect(parsePsOutput(output)).toEqual([]);
  });
});

describe("getProcessTree", () => {
  it("returns just the root PID when it has no children", () => {
    const processes = [
      { pid: 1, ppid: 0, command: "init" },
      { pid: 100, ppid: 1, command: "bash" },
      { pid: 200, ppid: 1, command: "sshd" },
    ];

    const tree = getProcessTree(processes, 200);
    expect(tree.size).toBe(1);
    expect(tree.has(200)).toBe(true);
  });

  it("includes direct children of the root PID", () => {
    const processes = [
      { pid: 1, ppid: 0, command: "init" },
      { pid: 100, ppid: 1, command: "openclaw" },
      { pid: 200, ppid: 100, command: "node" },
      { pid: 300, ppid: 100, command: "python" },
    ];

    const tree = getProcessTree(processes, 100);
    expect(tree.size).toBe(3);
    expect(tree.has(100)).toBe(true);
    expect(tree.has(200)).toBe(true);
    expect(tree.has(300)).toBe(true);
  });

  it("includes grandchildren and deeper descendants", () => {
    const processes = [
      { pid: 1, ppid: 0, command: "init" },
      { pid: 100, ppid: 1, command: "openclaw" },
      { pid: 200, ppid: 100, command: "node" },
      { pid: 300, ppid: 200, command: "worker" },
      { pid: 400, ppid: 300, command: "sub-worker" },
    ];

    const tree = getProcessTree(processes, 100);
    expect(tree.size).toBe(4);
    expect(tree.has(100)).toBe(true);
    expect(tree.has(200)).toBe(true);
    expect(tree.has(300)).toBe(true);
    expect(tree.has(400)).toBe(true);
  });

  it("does not include unrelated processes", () => {
    const processes = [
      { pid: 1, ppid: 0, command: "init" },
      { pid: 100, ppid: 1, command: "openclaw" },
      { pid: 200, ppid: 100, command: "node" },
      { pid: 500, ppid: 1, command: "sshd" },
      { pid: 600, ppid: 500, command: "bash" },
    ];

    const tree = getProcessTree(processes, 100);
    expect(tree.has(500)).toBe(false);
    expect(tree.has(600)).toBe(false);
    expect(tree.has(1)).toBe(false);
  });

  it("handles the root PID not being present in the process list", () => {
    const processes = [
      { pid: 1, ppid: 0, command: "init" },
      { pid: 100, ppid: 1, command: "bash" },
    ];

    const tree = getProcessTree(processes, 999);
    expect(tree.size).toBe(1);
    expect(tree.has(999)).toBe(true);
  });

  it("handles empty process list", () => {
    const tree = getProcessTree([], 100);
    expect(tree.size).toBe(1);
    expect(tree.has(100)).toBe(true);
  });
});

// Mock child_process and fs/promises at the module level for ESM compatibility
const mockExec = vi.fn();
const mockReadFile = vi.fn();

vi.mock("node:child_process", () => ({
  exec: (...args: unknown[]) => mockExec(...args),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    readFile: (...args: unknown[]) => mockReadFile(...args),
  };
});

describe("ProcessMonitor", () => {
  // Import ProcessMonitor after mocks are set up
  let ProcessMonitor: typeof import("../../src/witness/process-monitor.js").ProcessMonitor;

  beforeEach(async () => {
    vi.useFakeTimers();
    mockExec.mockReset();
    mockReadFile.mockReset();
    mockReadFile.mockRejectedValue(new Error("no pid file"));

    // Dynamic import to get the version with mocked deps
    const mod = await import("../../src/witness/process-monitor.js");
    ProcessMonitor = mod.ProcessMonitor;
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

  function makePsOutput(lines: Array<{ pid: number; ppid: number; user: string; command: string }>): string {
    const header = "  PID  PPID USER     COMMAND";
    const dataLines = lines.map(
      (l) => `  ${l.pid}   ${l.ppid} ${l.user}     ${l.command}`,
    );
    return [header, ...dataLines].join("\n");
  }

  it("emits process_spawned for new PIDs on poll", async () => {
    const initialOutput = makePsOutput([
      { pid: 1, ppid: 0, user: "root", command: "init" },
    ]);
    setExecOutput(initialOutput);

    const config = makeConfig({ processPollingMs: 100 });
    const monitor = new ProcessMonitor(config);
    const events: ProcessWitnessEvent[] = [];

    await monitor.start((event) => {
      events.push(event);
    });

    // After initial scan, add a new process
    const updatedOutput = makePsOutput([
      { pid: 1, ppid: 0, user: "root", command: "init" },
      { pid: 200, ppid: 1, user: "user", command: "node" },
    ]);
    setExecOutput(updatedOutput);

    await vi.advanceTimersByTimeAsync(150);

    monitor.stop();

    const spawnEvents = events.filter((e) => e.type === "process_spawned");
    expect(spawnEvents.length).toBeGreaterThanOrEqual(1);

    const nodeSpawn = spawnEvents.find((e) => e.command === "node");
    expect(nodeSpawn).toBeDefined();
    expect(nodeSpawn!.pid).toBe(200);
    expect(nodeSpawn!.ppid).toBe(1);
  });

  it("emits process_exited for PIDs that disappear", async () => {
    const initialOutput = makePsOutput([
      { pid: 1, ppid: 0, user: "root", command: "init" },
      { pid: 200, ppid: 1, user: "user", command: "node" },
    ]);
    setExecOutput(initialOutput);

    const config = makeConfig({ processPollingMs: 100 });
    const monitor = new ProcessMonitor(config);
    const events: ProcessWitnessEvent[] = [];

    await monitor.start((event) => {
      events.push(event);
    });

    const updatedOutput = makePsOutput([
      { pid: 1, ppid: 0, user: "root", command: "init" },
    ]);
    setExecOutput(updatedOutput);

    await vi.advanceTimersByTimeAsync(150);

    monitor.stop();

    const exitEvents = events.filter((e) => e.type === "process_exited");
    expect(exitEvents.length).toBeGreaterThanOrEqual(1);

    const nodeExit = exitEvents.find((e) => e.command === "node");
    expect(nodeExit).toBeDefined();
    expect(nodeExit!.pid).toBe(200);
  });

  it("does not emit events for processes seen in initial scan", async () => {
    const output = makePsOutput([
      { pid: 1, ppid: 0, user: "root", command: "init" },
      { pid: 100, ppid: 1, user: "user", command: "bash" },
    ]);
    setExecOutput(output);

    const config = makeConfig({ processPollingMs: 100 });
    const monitor = new ProcessMonitor(config);
    const events: ProcessWitnessEvent[] = [];

    await monitor.start((event) => {
      events.push(event);
    });

    // Same process list on poll
    await vi.advanceTimersByTimeAsync(150);

    monitor.stop();

    expect(events.length).toBe(0);
  });

  it("uses PID file to find gateway PID", async () => {
    mockReadFile.mockResolvedValue("42\n");

    const output = makePsOutput([
      { pid: 1, ppid: 0, user: "root", command: "init" },
      { pid: 42, ppid: 1, user: "user", command: "openclaw" },
      { pid: 100, ppid: 42, user: "user", command: "node" },
      { pid: 500, ppid: 1, user: "user", command: "sshd" },
    ]);
    setExecOutput(output);

    const config = makeConfig({ processPollingMs: 100 });
    const monitor = new ProcessMonitor(config);

    await monitor.start(() => {});

    expect(monitor.getGatewayPid()).toBe(42);

    monitor.stop();
  });

  it("falls back to process name search when PID file is missing", async () => {
    // readFile already rejects (set in beforeEach)
    const output = makePsOutput([
      { pid: 1, ppid: 0, user: "root", command: "init" },
      { pid: 55, ppid: 1, user: "user", command: "openclaw" },
      { pid: 200, ppid: 55, user: "user", command: "node" },
    ]);
    setExecOutput(output);

    const config = makeConfig({ processPollingMs: 100 });
    const monitor = new ProcessMonitor(config);

    await monitor.start(() => {});

    expect(monitor.getGatewayPid()).toBe(55);

    monitor.stop();
  });

  it("operates in passive mode when no gateway PID is found", async () => {
    const output = makePsOutput([
      { pid: 1, ppid: 0, user: "root", command: "init" },
      { pid: 100, ppid: 1, user: "user", command: "bash" },
    ]);
    setExecOutput(output);

    const config = makeConfig({
      processPollingMs: 100,
      gateway: { pidFile: "/nonexistent/pid", processName: "nonexistent-gw" },
    });
    const monitor = new ProcessMonitor(config);
    const events: ProcessWitnessEvent[] = [];

    await monitor.start((event) => {
      events.push(event);
    });

    expect(monitor.getGatewayPid()).toBeNull();

    // Add a new process — should be tracked since passive mode includes all
    const updatedOutput = makePsOutput([
      { pid: 1, ppid: 0, user: "root", command: "init" },
      { pid: 100, ppid: 1, user: "user", command: "bash" },
      { pid: 300, ppid: 1, user: "user", command: "python" },
    ]);
    setExecOutput(updatedOutput);

    await vi.advanceTimersByTimeAsync(150);

    monitor.stop();

    const spawnEvents = events.filter((e) => e.type === "process_spawned");
    expect(spawnEvents.some((e) => e.command === "python")).toBe(true);
  });

  it("stop() clears gateway PID", async () => {
    mockReadFile.mockResolvedValue("42\n");

    const output = makePsOutput([
      { pid: 1, ppid: 0, user: "root", command: "init" },
      { pid: 42, ppid: 1, user: "user", command: "openclaw" },
    ]);
    setExecOutput(output);

    const config = makeConfig({ processPollingMs: 100 });
    const monitor = new ProcessMonitor(config);

    await monitor.start(() => {});

    expect(monitor.getGatewayPid()).toBe(42);

    monitor.stop();

    expect(monitor.getGatewayPid()).toBeNull();

    // Advancing timers after stop should not cause issues
    await vi.advanceTimersByTimeAsync(500);
  });

  it("includes user field in spawned events", async () => {
    const output = makePsOutput([
      { pid: 1, ppid: 0, user: "root", command: "init" },
    ]);
    setExecOutput(output);

    const config = makeConfig({ processPollingMs: 100 });
    const monitor = new ProcessMonitor(config);
    const events: ProcessWitnessEvent[] = [];

    await monitor.start((event) => {
      events.push(event);
    });

    const updatedOutput = makePsOutput([
      { pid: 1, ppid: 0, user: "root", command: "init" },
      { pid: 999, ppid: 1, user: "admin", command: "dangerous-tool" },
    ]);
    setExecOutput(updatedOutput);

    await vi.advanceTimersByTimeAsync(150);

    monitor.stop();

    const spawn = events.find((e) => e.type === "process_spawned" && e.pid === 999);
    expect(spawn).toBeDefined();
    expect(spawn!.user).toBe("admin");
  });
});
