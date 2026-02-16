import { exec } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { ProcessWitnessEvent, WitnessConfig } from "./types.js";

const execAsync = promisify(exec);

export type ProcessEventCallback = (event: ProcessWitnessEvent) => void;

function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return resolve(homedir(), p.slice(2));
  }
  return p;
}

interface ProcessInfo {
  pid: number;
  ppid: number;
  command: string;
  user?: string;
}

/**
 * Parse `ps` output into structured process info.
 * Expected format: `ps -axo pid,ppid,user,comm`
 * Lines: "  PID  PPID USER     COMMAND"
 */
export function parsePsOutput(output: string): ProcessInfo[] {
  const lines = output.trim().split("\n");
  const results: ProcessInfo[] = [];

  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;

    // Split on whitespace: PID PPID USER COMMAND (command may contain spaces)
    const parts = line.split(/\s+/);
    if (parts.length < 4) continue;

    const pid = parseInt(parts[0] ?? "", 10);
    const ppid = parseInt(parts[1] ?? "", 10);
    const user = parts[2] ?? "";
    const command = parts.slice(3).join(" ");

    if (isNaN(pid) || isNaN(ppid)) continue;

    results.push({ pid, ppid, command, user });
  }

  return results;
}

/**
 * Build the set of PIDs in the process tree rooted at `rootPid`.
 * Includes rootPid itself and all descendants.
 */
export function getProcessTree(
  processes: ProcessInfo[],
  rootPid: number,
): Set<number> {
  const tree = new Set<number>();
  tree.add(rootPid);

  // Iteratively find children until no more are added
  let changed = true;
  while (changed) {
    changed = false;
    for (const proc of processes) {
      if (!tree.has(proc.pid) && tree.has(proc.ppid)) {
        tree.add(proc.pid);
        changed = true;
      }
    }
  }

  return tree;
}

export class ProcessMonitor {
  private config: WitnessConfig;
  private callback: ProcessEventCallback | null = null;
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private seenPids = new Map<number, ProcessInfo>();
  private gatewayPid: number | null = null;

  constructor(config: WitnessConfig) {
    this.config = config;
  }

  /**
   * Start monitoring processes.
   * Attempts to find the gateway PID, then polls process tree.
   */
  async start(callback: ProcessEventCallback): Promise<void> {
    this.callback = callback;
    this.running = true;

    // Attempt to find gateway PID
    this.gatewayPid = await this.findGatewayPid();

    // Do initial scan to populate known PIDs (no events emitted for existing processes)
    await this.initialScan();

    // Start polling
    this.pollTimer = setInterval(() => {
      void this.poll();
    }, this.config.processPollingMs);
  }

  /**
   * Stop monitoring.
   */
  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.seenPids.clear();
    this.gatewayPid = null;
  }

  /**
   * Get the current gateway PID (for testing/inspection).
   */
  getGatewayPid(): number | null {
    return this.gatewayPid;
  }

  /**
   * Find the gateway process PID.
   * First tries the PID file, then searches by process name.
   */
  private async findGatewayPid(): Promise<number | null> {
    // Try PID file first
    const pidPath = expandHome(this.config.gateway.pidFile);
    try {
      const content = await readFile(pidPath, "utf-8");
      const pid = parseInt(content.trim(), 10);
      if (!isNaN(pid) && pid > 0) {
        return pid;
      }
    } catch {
      // PID file not found or unreadable
    }

    // Fallback: search by process name
    try {
      const processes = await this.getProcessList();
      const match = processes.find(
        (p) =>
          p.command.includes(this.config.gateway.processName) &&
          p.pid !== process.pid, // Exclude ourselves
      );
      if (match) {
        return match.pid;
      }
    } catch {
      // Could not list processes
    }

    return null;
  }

  /**
   * Initial scan: populate known PIDs without emitting events.
   */
  private async initialScan(): Promise<void> {
    try {
      const processes = await this.getProcessList();
      const relevantPids = this.getRelevantPids(processes);

      for (const proc of processes) {
        if (relevantPids.has(proc.pid)) {
          this.seenPids.set(proc.pid, proc);
        }
      }
    } catch {
      // Initial scan failed — will catch up on next poll
    }
  }

  /**
   * Poll for process changes.
   */
  private async poll(): Promise<void> {
    if (!this.running || !this.callback) return;

    try {
      const processes = await this.getProcessList();
      const relevantPids = this.getRelevantPids(processes);

      // Build a map of current relevant processes
      const currentMap = new Map<number, ProcessInfo>();
      for (const proc of processes) {
        if (relevantPids.has(proc.pid)) {
          currentMap.set(proc.pid, proc);
        }
      }

      // Detect new processes (spawned)
      for (const [pid, proc] of currentMap) {
        if (!this.seenPids.has(pid)) {
          const event: ProcessWitnessEvent = {
            type: "process_spawned",
            command: proc.command,
            pid: proc.pid,
            ppid: proc.ppid,
            observedAt: new Date().toISOString(),
            user: proc.user,
          };
          this.callback(event);
        }
      }

      // Detect exited processes
      for (const [pid, proc] of this.seenPids) {
        if (!currentMap.has(pid)) {
          const event: ProcessWitnessEvent = {
            type: "process_exited",
            command: proc.command,
            pid: proc.pid,
            ppid: proc.ppid,
            observedAt: new Date().toISOString(),
            user: proc.user,
          };
          this.callback(event);
        }
      }

      // Update seen PIDs
      this.seenPids = currentMap;
    } catch {
      // Poll failed — skip this cycle
    }
  }

  /**
   * Get the set of PIDs we should track.
   * If gateway PID is known, only track its process tree.
   * Otherwise, track all processes (passive mode).
   */
  private getRelevantPids(processes: ProcessInfo[]): Set<number> {
    if (this.gatewayPid !== null) {
      // Check if gateway is still running
      const gatewayExists = processes.some(
        (p) => p.pid === this.gatewayPid,
      );
      if (gatewayExists) {
        return getProcessTree(processes, this.gatewayPid);
      }
    }

    // Passive mode: return all PIDs (no gateway filtering)
    return new Set(processes.map((p) => p.pid));
  }

  /**
   * Get the current process list from the system.
   */
  private async getProcessList(): Promise<ProcessInfo[]> {
    try {
      const { stdout } = await execAsync("ps -axo pid,ppid,user,comm", {
        timeout: 5000,
      });
      return parsePsOutput(stdout);
    } catch {
      return [];
    }
  }
}
