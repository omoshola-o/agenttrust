import { watch as fsWatch, stat, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { resolve, normalize } from "node:path";
import type { FileWitnessEvent, WitnessConfig } from "./types.js";

export type FileEventCallback = (event: FileWitnessEvent) => void;

function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return resolve(homedir(), p.slice(2));
  }
  return p;
}

function matchesGlob(path: string, pattern: string): boolean {
  const expanded = expandHome(pattern);
  // Simple glob matching: ** matches any, * matches within segment
  const escaped = expanded
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{DOUBLESTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\{\{DOUBLESTAR\}\}/g, ".*");
  return new RegExp(`^${escaped}`).test(path);
}

async function hashFilePrefix(filePath: string): Promise<string | undefined> {
  try {
    const buf = await readFile(filePath);
    const prefix = buf.subarray(0, 4096);
    if (prefix.length === 0) return undefined;
    return createHash("sha256").update(prefix).digest("hex");
  } catch {
    return undefined;
  }
}

async function getFileStat(
  filePath: string,
): Promise<FileWitnessEvent["stat"] | undefined> {
  try {
    const s = await stat(filePath);
    const result: FileWitnessEvent["stat"] = {
      sizeBytes: Number(s.size),
      mode: "0" + (Number(s.mode) & 0o777).toString(8),
      mtime: s.mtime.toISOString(),
    };
    return result;
  } catch {
    return undefined;
  }
}

export class FileMonitor {
  private config: WitnessConfig;
  private callback: FileEventCallback | null = null;
  private running = false;
  private abortController: AbortController | null = null;
  private debounceMap = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly DEBOUNCE_MS = 100;

  constructor(config: WitnessConfig) {
    this.config = config;
  }

  /**
   * Start monitoring file system events.
   */
  async start(callback: FileEventCallback): Promise<void> {
    this.callback = callback;
    this.running = true;
    this.abortController = new AbortController();

    const watchPaths = this.config.watchPaths
      .map(expandHome)
      .map((p) => normalize(p));

    for (const watchPath of watchPaths) {
      this.watchDirectory(watchPath).catch(() => {
        // Directory may not exist — that's fine
      });
    }
  }

  /**
   * Stop monitoring.
   */
  stop(): void {
    this.running = false;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    for (const timer of this.debounceMap.values()) {
      clearTimeout(timer);
    }
    this.debounceMap.clear();
  }

  private async watchDirectory(dirPath: string): Promise<void> {
    if (!this.running || !this.abortController) return;
    const signal = this.abortController.signal;

    try {
      const watcher = fsWatch(dirPath, { recursive: true, signal });
      for await (const event of watcher) {
        if (!this.running) break;
        const filename = event.filename;
        if (!filename) continue;

        const fullPath = resolve(dirPath, filename);

        // Check exclusions
        if (this.isExcluded(fullPath)) continue;

        // Debounce
        this.debouncedEmit(fullPath, event.eventType);
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      // Watch failed — could be permissions, missing dir, etc.
    }
  }

  private isExcluded(path: string): boolean {
    for (const pattern of this.config.excludePaths) {
      if (matchesGlob(path, pattern)) return true;
    }
    return false;
  }

  private debouncedEmit(path: string, eventType: string): void {
    const existing = this.debounceMap.get(path);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.debounceMap.delete(path);
      void this.emitEvent(path, eventType);
    }, this.DEBOUNCE_MS);

    this.debounceMap.set(path, timer);
  }

  private async emitEvent(path: string, eventType: string): Promise<void> {
    if (!this.callback || !this.running) return;

    const fileStat = await getFileStat(path);
    let witnessType: FileWitnessEvent["type"];

    if (!fileStat) {
      witnessType = "file_deleted";
    } else if (eventType === "rename") {
      // rename can mean created or deleted — check if file exists
      witnessType = "file_created";
    } else {
      witnessType = "file_modified";
    }

    const event: FileWitnessEvent = {
      type: witnessType,
      path: normalize(path),
      observedAt: new Date().toISOString(),
    };

    if (fileStat) {
      event.stat = { ...fileStat };
      // Compute content hash for created/modified
      if (witnessType === "file_created" || witnessType === "file_modified") {
        const hash = await hashFilePrefix(path);
        if (hash) {
          event.stat.contentHashPrefix = hash;
        }
      }
    }

    this.callback(event);
  }
}
