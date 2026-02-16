import { FileMonitor } from "./file-monitor.js";
import { ProcessMonitor } from "./process-monitor.js";
import { NetworkMonitor } from "./network-monitor.js";
import type {
  WitnessConfig,
  WitnessEvent,
  DaemonStats,
  FileWitnessEvent,
  ProcessWitnessEvent,
  NetworkWitnessEvent,
} from "./types.js";

export type WitnessEventWithSource = {
  source: "filesystem" | "process" | "network";
  event: WitnessEvent;
};

export type DaemonFlushCallback = (events: WitnessEventWithSource[]) => void | Promise<void>;

export class WitnessDaemon {
  private config: WitnessConfig;
  private fileMonitor: FileMonitor;
  private processMonitor: ProcessMonitor;
  private networkMonitor: NetworkMonitor;
  private running = false;
  private startedAt: string | null = null;
  private startTimestamp: number = 0;
  private eventBuffer: WitnessEventWithSource[] = [];
  private flushCallback: DaemonFlushCallback | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly FLUSH_INTERVAL_MS = 5000;

  private eventCounts = {
    file: 0,
    process: 0,
    network: 0,
  };
  private lastEventAt: string | null = null;

  constructor(config: WitnessConfig) {
    this.config = config;
    this.fileMonitor = new FileMonitor(config);
    this.processMonitor = new ProcessMonitor(config);
    this.networkMonitor = new NetworkMonitor(config);
  }

  /**
   * Start the witness daemon.
   * Launches all three monitors and begins buffering events.
   *
   * @param flushCallback - Called when the event buffer is flushed (for writing to witness ledger)
   */
  async start(flushCallback?: DaemonFlushCallback): Promise<void> {
    if (this.running) return;

    this.running = true;
    this.startedAt = new Date().toISOString();
    this.startTimestamp = Date.now();
    this.flushCallback = flushCallback ?? null;
    this.eventCounts = { file: 0, process: 0, network: 0 };
    this.lastEventAt = null;
    this.eventBuffer = [];

    // Start monitors — each can fail independently
    const startResults = await Promise.allSettled([
      this.startFileMonitor(),
      this.startProcessMonitor(),
      this.startNetworkMonitor(),
    ]);

    // Log any failures (don't throw — monitors are independent)
    for (const result of startResults) {
      if (result.status === "rejected") {
        // Monitor failed to start — continue with others
      }
    }

    // Start periodic flush timer
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, this.FLUSH_INTERVAL_MS);
  }

  /**
   * Stop the witness daemon.
   * Flushes remaining buffer and stops all monitors.
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    this.running = false;

    // Stop flush timer
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Flush remaining events
    await this.flush();

    // Stop all monitors
    this.fileMonitor.stop();
    this.processMonitor.stop();
    this.networkMonitor.stop();

    this.startedAt = null;
    this.startTimestamp = 0;
  }

  /**
   * Get daemon statistics.
   */
  getStats(): DaemonStats {
    return {
      running: this.running,
      startedAt: this.startedAt ?? undefined,
      uptimeMs: this.running ? Date.now() - this.startTimestamp : 0,
      events: { ...this.eventCounts },
      lastEventAt: this.lastEventAt ?? undefined,
      bufferedEvents: this.eventBuffer.length,
    };
  }

  /**
   * Force flush the event buffer.
   */
  async flush(): Promise<void> {
    if (this.eventBuffer.length === 0) return;

    const events = [...this.eventBuffer];
    this.eventBuffer = [];

    if (this.flushCallback) {
      try {
        await this.flushCallback(events);
      } catch {
        // Flush failed — events are lost (non-blocking, don't crash)
      }
    }
  }

  private async startFileMonitor(): Promise<void> {
    await this.fileMonitor.start((event: FileWitnessEvent) => {
      this.onEvent("filesystem", event);
    });
  }

  private async startProcessMonitor(): Promise<void> {
    await this.processMonitor.start((event: ProcessWitnessEvent) => {
      this.onEvent("process", event);
    });
  }

  private async startNetworkMonitor(): Promise<void> {
    const gatewayPid = this.processMonitor.getGatewayPid();
    await this.networkMonitor.start((event: NetworkWitnessEvent) => {
      this.onEvent("network", event);
    }, gatewayPid);
  }

  private onEvent(source: "filesystem" | "process" | "network", event: WitnessEvent): void {
    if (!this.running) return;

    // Update counters
    this.lastEventAt = new Date().toISOString();
    if (source === "filesystem") {
      this.eventCounts.file++;
    } else if (source === "process") {
      this.eventCounts.process++;
    } else {
      this.eventCounts.network++;
    }

    // Buffer the event
    this.eventBuffer.push({ source, event });

    // Auto-flush if buffer is full
    if (this.eventBuffer.length >= this.config.bufferSize) {
      void this.flush();
    }
  }
}
