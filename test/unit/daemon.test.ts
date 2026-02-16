import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import type {
  WitnessConfig,
  FileWitnessEvent,
  ProcessWitnessEvent,
  NetworkWitnessEvent,
} from "../../src/witness/types.js";
import { DEFAULT_WITNESS_CONFIG } from "../../src/witness/types.js";
import type { WitnessEventWithSource, DaemonFlushCallback } from "../../src/witness/daemon.js";

// Capture the callbacks registered by the daemon so we can simulate events
let fileStartCallback: ((event: FileWitnessEvent) => void) | null = null;
let processStartCallback: ((event: ProcessWitnessEvent) => void) | null = null;
let networkStartCallback: ((event: NetworkWitnessEvent) => void) | null = null;

// Track stop calls
let fileStopCalled = false;
let processStopCalled = false;
let networkStopCalled = false;

// Control whether start() rejects
let fileStartShouldFail = false;
let processStartShouldFail = false;
let networkStartShouldFail = false;

vi.mock("../../src/witness/file-monitor.js", () => ({
  FileMonitor: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockImplementation(async (cb: (event: FileWitnessEvent) => void) => {
      if (fileStartShouldFail) throw new Error("FileMonitor start failed");
      fileStartCallback = cb;
    }),
    stop: vi.fn().mockImplementation(() => {
      fileStopCalled = true;
    }),
  })),
}));

vi.mock("../../src/witness/process-monitor.js", () => ({
  ProcessMonitor: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockImplementation(async (cb: (event: ProcessWitnessEvent) => void) => {
      if (processStartShouldFail) throw new Error("ProcessMonitor start failed");
      processStartCallback = cb;
    }),
    stop: vi.fn().mockImplementation(() => {
      processStopCalled = true;
    }),
    getGatewayPid: vi.fn().mockReturnValue(null),
  })),
}));

vi.mock("../../src/witness/network-monitor.js", () => ({
  NetworkMonitor: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockImplementation(async (cb: (event: NetworkWitnessEvent) => void) => {
      if (networkStartShouldFail) throw new Error("NetworkMonitor start failed");
      networkStartCallback = cb;
    }),
    stop: vi.fn().mockImplementation(() => {
      networkStopCalled = true;
    }),
  })),
}));

function makeConfig(overrides: Partial<WitnessConfig> = {}): WitnessConfig {
  return { ...DEFAULT_WITNESS_CONFIG, ...overrides };
}

function makeFileEvent(overrides: Partial<FileWitnessEvent> = {}): FileWitnessEvent {
  return {
    type: "file_created",
    path: "/tmp/test.txt",
    observedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeProcessEvent(overrides: Partial<ProcessWitnessEvent> = {}): ProcessWitnessEvent {
  return {
    type: "process_spawned",
    command: "node",
    pid: 123,
    ppid: 1,
    observedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeNetworkEvent(overrides: Partial<NetworkWitnessEvent> = {}): NetworkWitnessEvent {
  return {
    type: "connection_opened",
    remoteHost: "93.184.216.34",
    remotePort: 443,
    protocol: "tcp",
    pid: 100,
    observedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("WitnessDaemon", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fileStartCallback = null;
    processStartCallback = null;
    networkStartCallback = null;
    fileStopCalled = false;
    processStopCalled = false;
    networkStopCalled = false;
    fileStartShouldFail = false;
    processStartShouldFail = false;
    networkStartShouldFail = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Import dynamically to apply mocks
  async function createDaemon(config?: WitnessConfig) {
    const { WitnessDaemon } = await import("../../src/witness/daemon.js");
    return new WitnessDaemon(config ?? makeConfig());
  }

  it("start() initializes all three monitors", async () => {
    const daemon = await createDaemon();

    await daemon.start();

    expect(fileStartCallback).not.toBeNull();
    expect(processStartCallback).not.toBeNull();
    expect(networkStartCallback).not.toBeNull();

    await daemon.stop();
  });

  it("getStats() reports running state after start", async () => {
    const daemon = await createDaemon();

    const statsBefore = daemon.getStats();
    expect(statsBefore.running).toBe(false);
    expect(statsBefore.uptimeMs).toBe(0);

    await daemon.start();

    const statsAfter = daemon.getStats();
    expect(statsAfter.running).toBe(true);
    expect(statsAfter.startedAt).toBeDefined();

    await daemon.stop();
  });

  it("buffers file events from the file monitor", async () => {
    const flushed: WitnessEventWithSource[][] = [];
    const daemon = await createDaemon();

    await daemon.start((events) => {
      flushed.push(events);
    });

    // Simulate file events
    fileStartCallback!(makeFileEvent({ path: "/tmp/a.txt" }));
    fileStartCallback!(makeFileEvent({ path: "/tmp/b.txt" }));

    const stats = daemon.getStats();
    expect(stats.bufferedEvents).toBe(2);
    expect(stats.events.file).toBe(2);

    await daemon.stop();
  });

  it("buffers process events from the process monitor", async () => {
    const daemon = await createDaemon();

    await daemon.start();

    processStartCallback!(makeProcessEvent({ command: "python" }));

    const stats = daemon.getStats();
    expect(stats.bufferedEvents).toBe(1);
    expect(stats.events.process).toBe(1);

    await daemon.stop();
  });

  it("buffers network events from the network monitor", async () => {
    const daemon = await createDaemon();

    await daemon.start();

    networkStartCallback!(makeNetworkEvent({ remoteHost: "example.com" }));

    const stats = daemon.getStats();
    expect(stats.bufferedEvents).toBe(1);
    expect(stats.events.network).toBe(1);

    await daemon.stop();
  });

  it("flushes buffer when it reaches bufferSize", async () => {
    const flushed: WitnessEventWithSource[][] = [];
    const config = makeConfig({ bufferSize: 3 });
    const daemon = await createDaemon(config);

    await daemon.start((events) => {
      flushed.push([...events]);
    });

    // Send exactly bufferSize events
    fileStartCallback!(makeFileEvent({ path: "/tmp/1.txt" }));
    fileStartCallback!(makeFileEvent({ path: "/tmp/2.txt" }));
    fileStartCallback!(makeFileEvent({ path: "/tmp/3.txt" }));

    // flush() is called with void (async), so give microtasks a chance
    await vi.advanceTimersByTimeAsync(0);

    expect(flushed.length).toBeGreaterThanOrEqual(1);
    const totalFlushed = flushed.reduce((sum, batch) => sum + batch.length, 0);
    expect(totalFlushed).toBe(3);

    await daemon.stop();
  });

  it("flushes buffer periodically (every 5 seconds)", async () => {
    const flushed: WitnessEventWithSource[][] = [];
    const daemon = await createDaemon();

    await daemon.start((events) => {
      flushed.push([...events]);
    });

    // Add one event (not enough to trigger bufferSize flush)
    fileStartCallback!(makeFileEvent());

    // Advance 5 seconds to trigger periodic flush
    await vi.advanceTimersByTimeAsync(5000);

    expect(flushed.length).toBe(1);
    expect(flushed[0]!.length).toBe(1);

    await daemon.stop();
  });

  it("stop() flushes remaining buffer", async () => {
    const flushed: WitnessEventWithSource[][] = [];
    const daemon = await createDaemon();

    await daemon.start((events) => {
      flushed.push([...events]);
    });

    // Add events without triggering auto-flush
    fileStartCallback!(makeFileEvent());
    processStartCallback!(makeProcessEvent());

    expect(daemon.getStats().bufferedEvents).toBe(2);

    await daemon.stop();

    // Should have flushed during stop
    const totalFlushed = flushed.reduce((sum, batch) => sum + batch.length, 0);
    expect(totalFlushed).toBe(2);
  });

  it("stop() calls stop on all three monitors", async () => {
    const daemon = await createDaemon();

    await daemon.start();

    await daemon.stop();

    expect(fileStopCalled).toBe(true);
    expect(processStopCalled).toBe(true);
    expect(networkStopCalled).toBe(true);
  });

  it("getStats() returns correct event counts by source", async () => {
    const daemon = await createDaemon();

    await daemon.start();

    fileStartCallback!(makeFileEvent());
    fileStartCallback!(makeFileEvent());
    processStartCallback!(makeProcessEvent());
    networkStartCallback!(makeNetworkEvent());
    networkStartCallback!(makeNetworkEvent());
    networkStartCallback!(makeNetworkEvent());

    const stats = daemon.getStats();
    expect(stats.events.file).toBe(2);
    expect(stats.events.process).toBe(1);
    expect(stats.events.network).toBe(3);
    expect(stats.bufferedEvents).toBe(6);

    await daemon.stop();
  });

  it("getStats() tracks lastEventAt", async () => {
    const daemon = await createDaemon();

    await daemon.start();

    const statsBefore = daemon.getStats();
    expect(statsBefore.lastEventAt).toBeUndefined();

    fileStartCallback!(makeFileEvent());

    const statsAfter = daemon.getStats();
    expect(statsAfter.lastEventAt).toBeDefined();
    expect(typeof statsAfter.lastEventAt).toBe("string");

    await daemon.stop();
  });

  it("flush callback receives events with correct source tags", async () => {
    const flushed: WitnessEventWithSource[][] = [];
    const daemon = await createDaemon();

    await daemon.start((events) => {
      flushed.push([...events]);
    });

    fileStartCallback!(makeFileEvent());
    processStartCallback!(makeProcessEvent());
    networkStartCallback!(makeNetworkEvent());

    await daemon.flush();

    expect(flushed).toHaveLength(1);
    const batch = flushed[0]!;
    expect(batch).toHaveLength(3);
    expect(batch[0]!.source).toBe("filesystem");
    expect(batch[1]!.source).toBe("process");
    expect(batch[2]!.source).toBe("network");
  });

  it("survives a monitor failing to start", async () => {
    fileStartShouldFail = true;

    const daemon = await createDaemon();

    // Should not throw even though FileMonitor.start() rejects
    await daemon.start();

    const stats = daemon.getStats();
    expect(stats.running).toBe(true);

    // Process and network monitors should still work
    processStartCallback!(makeProcessEvent());
    expect(daemon.getStats().events.process).toBe(1);

    await daemon.stop();
  });

  it("survives a flush callback that throws", async () => {
    const daemon = await createDaemon();

    await daemon.start(() => {
      throw new Error("flush failed");
    });

    fileStartCallback!(makeFileEvent());

    // Trigger flush — should not throw
    await daemon.flush();

    // Daemon should still be functional
    const stats = daemon.getStats();
    expect(stats.events.file).toBe(1);
    // Buffer should be cleared even though callback threw
    expect(stats.bufferedEvents).toBe(0);

    await daemon.stop();
  });

  it("does not emit events after stop() is called", async () => {
    const flushed: WitnessEventWithSource[][] = [];
    const daemon = await createDaemon();

    await daemon.start((events) => {
      flushed.push([...events]);
    });

    await daemon.stop();

    // Capture the file callback before nullification by daemon
    // The callback was set during start; calling it after stop should be a no-op
    // because onEvent checks this.running
    const savedCallback = fileStartCallback;
    if (savedCallback) {
      savedCallback(makeFileEvent());
    }

    const stats = daemon.getStats();
    // Should not count events after stop
    expect(stats.events.file).toBe(0);
  });

  it("start() is idempotent when already running", async () => {
    const daemon = await createDaemon();

    await daemon.start();
    const firstStartedAt = daemon.getStats().startedAt;

    // Calling start again should be a no-op
    await daemon.start();
    const secondStartedAt = daemon.getStats().startedAt;

    expect(firstStartedAt).toBe(secondStartedAt);

    await daemon.stop();
  });

  it("stop() is idempotent when not running", async () => {
    const daemon = await createDaemon();

    // Stopping without starting should not throw
    await daemon.stop();
    await daemon.stop();

    const stats = daemon.getStats();
    expect(stats.running).toBe(false);
  });
});
