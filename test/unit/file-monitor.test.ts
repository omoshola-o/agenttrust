import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { tmpdir } from "node:os";
import {
  mkdtemp,
  rm,
  writeFile,
  mkdir,
  unlink,
  appendFile,
} from "node:fs/promises";
import { join } from "node:path";
import { FileMonitor } from "../../src/witness/file-monitor.js";
import type {
  FileWitnessEvent,
  WitnessConfig,
} from "../../src/witness/types.js";
import { DEFAULT_WITNESS_CONFIG } from "../../src/witness/types.js";

function makeConfig(overrides: Partial<WitnessConfig> = {}): WitnessConfig {
  return { ...DEFAULT_WITNESS_CONFIG, ...overrides };
}

/** Collect events from a FileMonitor into an array, returning a promise
 *  that resolves once `count` events have been received (or times out). */
function collectEvents(
  monitor: FileMonitor,
  config: WitnessConfig,
  count: number,
  timeoutMs = 3000,
): Promise<FileWitnessEvent[]> {
  const events: FileWitnessEvent[] = [];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      // Resolve with whatever we have — caller can assert on length
      resolve(events);
    }, timeoutMs);

    void monitor.start((event) => {
      events.push(event);
      if (events.length >= count) {
        clearTimeout(timer);
        resolve(events);
      }
    });
  });
}

describe("FileMonitor", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "agenttrust-filemon-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("emits file_created when a new file is written", async () => {
    const config = makeConfig({
      watchPaths: [testDir],
      excludePaths: [],
    });
    const monitor = new FileMonitor(config);
    const events: FileWitnessEvent[] = [];

    await monitor.start((event) => {
      events.push(event);
    });

    // Give the watcher a moment to initialize
    await new Promise((r) => setTimeout(r, 100));

    const filePath = join(testDir, "new-file.txt");
    await writeFile(filePath, "hello world");

    // Wait for debounce + processing
    await new Promise((r) => setTimeout(r, 500));

    monitor.stop();

    expect(events.length).toBeGreaterThanOrEqual(1);
    const createEvent = events.find(
      (e) => e.type === "file_created" || e.type === "file_modified",
    );
    expect(createEvent).toBeDefined();
    expect(createEvent!.path).toContain("new-file.txt");
    expect(createEvent!.observedAt).toBeDefined();
  });

  it("includes stat with sizeBytes, mode, and mtime for created files", async () => {
    const config = makeConfig({
      watchPaths: [testDir],
      excludePaths: [],
    });
    const monitor = new FileMonitor(config);
    const events: FileWitnessEvent[] = [];

    await monitor.start((event) => {
      events.push(event);
    });

    await new Promise((r) => setTimeout(r, 100));

    const filePath = join(testDir, "stat-test.txt");
    await writeFile(filePath, "some content here");

    await new Promise((r) => setTimeout(r, 500));

    monitor.stop();

    const event = events.find((e) => e.path.includes("stat-test.txt"));
    expect(event).toBeDefined();
    expect(event!.stat).toBeDefined();
    expect(typeof event!.stat!.sizeBytes).toBe("number");
    expect(event!.stat!.sizeBytes).toBeGreaterThan(0);
    expect(typeof event!.stat!.mode).toBe("string");
    expect(event!.stat!.mode.startsWith("0")).toBe(true);
    expect(typeof event!.stat!.mtime).toBe("string");
  });

  it("includes contentHashPrefix for created/modified files", async () => {
    const config = makeConfig({
      watchPaths: [testDir],
      excludePaths: [],
    });
    const monitor = new FileMonitor(config);
    const events: FileWitnessEvent[] = [];

    await monitor.start((event) => {
      events.push(event);
    });

    await new Promise((r) => setTimeout(r, 100));

    const filePath = join(testDir, "hash-test.txt");
    await writeFile(filePath, "content for hashing");

    await new Promise((r) => setTimeout(r, 500));

    monitor.stop();

    const event = events.find((e) => e.path.includes("hash-test.txt"));
    expect(event).toBeDefined();
    expect(event!.stat).toBeDefined();
    expect(typeof event!.stat!.contentHashPrefix).toBe("string");
    // SHA-256 hex is 64 chars
    expect(event!.stat!.contentHashPrefix!.length).toBe(64);
  });

  it("emits file_modified when an existing file is changed", async () => {
    const filePath = join(testDir, "modify-test.txt");
    await writeFile(filePath, "original content");

    const config = makeConfig({
      watchPaths: [testDir],
      excludePaths: [],
    });
    const monitor = new FileMonitor(config);
    const events: FileWitnessEvent[] = [];

    await monitor.start((event) => {
      events.push(event);
    });

    await new Promise((r) => setTimeout(r, 100));

    await writeFile(filePath, "modified content");

    await new Promise((r) => setTimeout(r, 500));

    monitor.stop();

    expect(events.length).toBeGreaterThanOrEqual(1);
    const modEvent = events.find((e) => e.path.includes("modify-test.txt"));
    expect(modEvent).toBeDefined();
    // Can be file_modified or file_created depending on OS fs.watch behavior
    expect(
      modEvent!.type === "file_modified" || modEvent!.type === "file_created",
    ).toBe(true);
  });

  it("emits file_deleted when a file is removed", async () => {
    const filePath = join(testDir, "delete-test.txt");
    await writeFile(filePath, "soon to be deleted");

    const config = makeConfig({
      watchPaths: [testDir],
      excludePaths: [],
    });
    const monitor = new FileMonitor(config);
    const events: FileWitnessEvent[] = [];

    await monitor.start((event) => {
      events.push(event);
    });

    await new Promise((r) => setTimeout(r, 100));

    await unlink(filePath);

    await new Promise((r) => setTimeout(r, 500));

    monitor.stop();

    const deleteEvent = events.find(
      (e) => e.type === "file_deleted" && e.path.includes("delete-test.txt"),
    );
    expect(deleteEvent).toBeDefined();
    expect(deleteEvent!.stat).toBeUndefined();
  });

  it("skips files matching excludePaths patterns", async () => {
    const excludeDir = join(testDir, "node_modules");
    await mkdir(excludeDir, { recursive: true });

    const config = makeConfig({
      watchPaths: [testDir],
      excludePaths: [`${testDir}/node_modules/**`],
    });
    const monitor = new FileMonitor(config);
    const events: FileWitnessEvent[] = [];

    await monitor.start((event) => {
      events.push(event);
    });

    await new Promise((r) => setTimeout(r, 100));

    // Write to excluded path
    await writeFile(join(excludeDir, "excluded.txt"), "should be ignored");
    // Write to included path
    await writeFile(join(testDir, "included.txt"), "should be seen");

    await new Promise((r) => setTimeout(r, 500));

    monitor.stop();

    const excludedEvents = events.filter((e) =>
      e.path.includes("excluded.txt"),
    );
    const includedEvents = events.filter((e) =>
      e.path.includes("included.txt"),
    );
    expect(excludedEvents.length).toBe(0);
    expect(includedEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("debounces rapid changes to the same file", async () => {
    const config = makeConfig({
      watchPaths: [testDir],
      excludePaths: [],
    });
    const monitor = new FileMonitor(config);
    const events: FileWitnessEvent[] = [];

    await monitor.start((event) => {
      events.push(event);
    });

    await new Promise((r) => setTimeout(r, 100));

    const filePath = join(testDir, "debounce-test.txt");
    // Rapid writes in quick succession (within 100ms debounce window)
    await writeFile(filePath, "v1");
    await writeFile(filePath, "v2");
    await writeFile(filePath, "v3");

    // Wait for debounce to settle
    await new Promise((r) => setTimeout(r, 500));

    monitor.stop();

    // Should produce a small number of events, not one per write
    const debounceEvents = events.filter((e) =>
      e.path.includes("debounce-test.txt"),
    );
    // At most 2 events (OS may coalesce differently), but not 3+
    // The main thing: debouncing should reduce event count
    expect(debounceEvents.length).toBeLessThanOrEqual(2);
    expect(debounceEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("does not emit events after stop() is called", async () => {
    const config = makeConfig({
      watchPaths: [testDir],
      excludePaths: [],
    });
    const monitor = new FileMonitor(config);
    const events: FileWitnessEvent[] = [];

    await monitor.start((event) => {
      events.push(event);
    });

    await new Promise((r) => setTimeout(r, 100));

    monitor.stop();

    // Write after stop
    await writeFile(join(testDir, "post-stop.txt"), "should not trigger");

    await new Promise((r) => setTimeout(r, 500));

    const postStopEvents = events.filter((e) =>
      e.path.includes("post-stop.txt"),
    );
    expect(postStopEvents.length).toBe(0);
  });

  it("handles non-existent watchPaths gracefully", async () => {
    const config = makeConfig({
      watchPaths: ["/tmp/agenttrust-nonexistent-dir-" + Date.now()],
      excludePaths: [],
    });
    const monitor = new FileMonitor(config);

    // Should not throw
    await monitor.start(() => {});
    monitor.stop();
  });

  it("emits events in subdirectories (recursive watching)", async () => {
    const subDir = join(testDir, "sub", "deep");
    await mkdir(subDir, { recursive: true });

    const config = makeConfig({
      watchPaths: [testDir],
      excludePaths: [],
    });
    const monitor = new FileMonitor(config);
    const events: FileWitnessEvent[] = [];

    await monitor.start((event) => {
      events.push(event);
    });

    await new Promise((r) => setTimeout(r, 100));

    await writeFile(join(subDir, "nested.txt"), "deep content");

    await new Promise((r) => setTimeout(r, 500));

    monitor.stop();

    const nestedEvents = events.filter((e) => e.path.includes("nested.txt"));
    expect(nestedEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("sets observedAt to a valid ISO-8601 timestamp", async () => {
    const config = makeConfig({
      watchPaths: [testDir],
      excludePaths: [],
    });
    const monitor = new FileMonitor(config);
    const events: FileWitnessEvent[] = [];

    const before = new Date().toISOString();

    await monitor.start((event) => {
      events.push(event);
    });

    await new Promise((r) => setTimeout(r, 100));

    await writeFile(join(testDir, "timestamp-test.txt"), "time check");

    await new Promise((r) => setTimeout(r, 500));

    monitor.stop();

    const after = new Date().toISOString();

    expect(events.length).toBeGreaterThanOrEqual(1);
    const event = events[0]!;
    expect(event.observedAt >= before).toBe(true);
    expect(event.observedAt <= after).toBe(true);
    // Validate it parses as a Date
    expect(isNaN(new Date(event.observedAt).getTime())).toBe(false);
  });
});
