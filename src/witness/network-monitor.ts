import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { NetworkWitnessEvent, WitnessConfig } from "./types.js";
import { parsePsOutput, getProcessTree } from "./process-monitor.js";

const execAsync = promisify(exec);

export type NetworkEventCallback = (event: NetworkWitnessEvent) => void;

interface ConnectionInfo {
  protocol: "tcp" | "udp";
  remoteHost: string;
  remotePort: number;
  pid: number;
  command: string;
}

/**
 * Connection key for tracking open/close state.
 */
function connectionKey(conn: ConnectionInfo): string {
  return `${conn.protocol}:${conn.remoteHost}:${conn.remotePort}:${conn.pid}`;
}

/**
 * Parse `lsof -i -n -P` output into structured connection info.
 *
 * Example output:
 * COMMAND   PID   USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
 * node    12345  user   20u  IPv4 0x1234      0t0  TCP 192.168.1.100:52341->93.184.216.34:443 (ESTABLISHED)
 * node    12345  user   21u  IPv6 0x5678      0t0  TCP [::1]:3000->[::1]:52342 (ESTABLISHED)
 */
export function parseLsofOutput(output: string): ConnectionInfo[] {
  const lines = output.trim().split("\n");
  const results: ConnectionInfo[] = [];

  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;

    // Split on whitespace
    const parts = line.split(/\s+/);
    if (parts.length < 9) continue;

    const command = parts[0] ?? "";
    const pid = parseInt(parts[1] ?? "", 10);
    if (isNaN(pid)) continue;

    // Node type (TCP/UDP) is typically at index 7
    const node = parts[7];
    let protocol: "tcp" | "udp";
    if (node?.toUpperCase() === "TCP") {
      protocol = "tcp";
    } else if (node?.toUpperCase() === "UDP") {
      protocol = "udp";
    } else {
      continue;
    }

    // Name field is the last part — contains the connection info
    // Format: local->remote (STATE) or just address:port
    const name = parts.slice(8).join(" ");

    // Parse connection: look for -> (outbound connection)
    const arrowIdx = name.indexOf("->");
    if (arrowIdx === -1) continue; // Not an established outbound connection

    const remotePart = name.slice(arrowIdx + 2);

    // Remote part may be followed by (STATE)
    const stateIdx = remotePart.indexOf(" ");
    const remote = stateIdx > -1 ? remotePart.slice(0, stateIdx) : remotePart;

    // Parse remote host:port — handle IPv6 [addr]:port
    const parsed = parseHostPort(remote);
    if (!parsed) continue;

    // Skip localhost connections
    if (isLocalhost(parsed.host)) continue;

    results.push({
      protocol,
      remoteHost: parsed.host,
      remotePort: parsed.port,
      pid,
      command,
    });
  }

  return results;
}

/**
 * Parse host:port from lsof output.
 * Handles both IPv4 (1.2.3.4:80) and IPv6 ([::1]:80) formats.
 */
export function parseHostPort(
  addr: string,
): { host: string; port: number } | null {
  // IPv6 format: [addr]:port
  if (addr.startsWith("[")) {
    const closeBracket = addr.indexOf("]");
    if (closeBracket === -1) return null;
    const host = addr.slice(1, closeBracket);
    const portStr = addr.slice(closeBracket + 2); // skip ]:
    const port = parseInt(portStr, 10);
    if (isNaN(port)) return null;
    return { host, port };
  }

  // IPv4 format: host:port
  const lastColon = addr.lastIndexOf(":");
  if (lastColon === -1) return null;
  const host = addr.slice(0, lastColon);
  const port = parseInt(addr.slice(lastColon + 1), 10);
  if (isNaN(port)) return null;
  return { host, port };
}

/**
 * Check if an address is a localhost address.
 */
function isLocalhost(host: string): boolean {
  return (
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "localhost" ||
    host === "0.0.0.0"
  );
}

export class NetworkMonitor {
  private config: WitnessConfig;
  private callback: NetworkEventCallback | null = null;
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private activeConnections = new Map<string, ConnectionInfo>();
  private gatewayPid: number | null = null;

  constructor(config: WitnessConfig) {
    this.config = config;
  }

  /**
   * Start monitoring network connections.
   */
  async start(
    callback: NetworkEventCallback,
    gatewayPid?: number | null,
  ): Promise<void> {
    this.callback = callback;
    this.running = true;
    this.gatewayPid = gatewayPid ?? null;

    // Initial scan to populate known connections
    await this.initialScan();

    // Start polling
    this.pollTimer = setInterval(() => {
      void this.poll();
    }, this.config.networkPollingMs);
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
    this.activeConnections.clear();
    this.gatewayPid = null;
  }

  /**
   * Update the gateway PID (e.g., when process monitor discovers it).
   */
  setGatewayPid(pid: number | null): void {
    this.gatewayPid = pid;
  }

  /**
   * Initial scan: populate known connections without emitting events.
   */
  private async initialScan(): Promise<void> {
    try {
      const connections = await this.getConnections();
      for (const conn of connections) {
        this.activeConnections.set(connectionKey(conn), conn);
      }
    } catch {
      // Initial scan failed
    }
  }

  /**
   * Poll for connection changes.
   */
  private async poll(): Promise<void> {
    if (!this.running || !this.callback) return;

    try {
      const connections = await this.getConnections();

      // Build current connection map
      const currentMap = new Map<string, ConnectionInfo>();
      for (const conn of connections) {
        currentMap.set(connectionKey(conn), conn);
      }

      // Detect new connections (opened)
      for (const [key, conn] of currentMap) {
        if (!this.activeConnections.has(key)) {
          const event: NetworkWitnessEvent = {
            type: "connection_opened",
            remoteHost: conn.remoteHost,
            remotePort: conn.remotePort,
            protocol: conn.protocol,
            pid: conn.pid,
            command: conn.command,
            observedAt: new Date().toISOString(),
          };
          this.callback(event);
        }
      }

      // Detect closed connections
      for (const [key, conn] of this.activeConnections) {
        if (!currentMap.has(key)) {
          const event: NetworkWitnessEvent = {
            type: "connection_closed",
            remoteHost: conn.remoteHost,
            remotePort: conn.remotePort,
            protocol: conn.protocol,
            pid: conn.pid,
            command: conn.command,
            observedAt: new Date().toISOString(),
          };
          this.callback(event);
        }
      }

      // Update tracked connections
      this.activeConnections = currentMap;
    } catch {
      // Poll failed — skip this cycle
    }
  }

  /**
   * Get current outbound connections, filtered to the gateway process tree.
   *
   * When a gateway PID is known, queries the full process tree (gateway +
   * all descendant PIDs) and only returns connections owned by those PIDs.
   * This prevents Chrome, VS Code, Weather, etc. from being captured.
   */
  private async getConnections(): Promise<ConnectionInfo[]> {
    try {
      if (this.gatewayPid !== null) {
        // Get all process info to build the tree
        const treePids = await this.getGatewayTreePids();

        if (treePids.size === 0) {
          return [];
        }

        // lsof -p accepts comma-separated PID list
        const pidList = [...treePids].join(",");
        const cmd = `lsof -i -n -P -a -p ${pidList}`;
        const { stdout } = await execAsync(cmd, { timeout: 10000 });
        return parseLsofOutput(stdout);
      } else {
        // No gateway — get all connections (passive mode)
        const { stdout } = await execAsync("lsof -i -n -P", { timeout: 10000 });
        return parseLsofOutput(stdout);
      }
    } catch {
      return [];
    }
  }

  /**
   * Get all PIDs in the gateway process tree (gateway + descendants).
   */
  private async getGatewayTreePids(): Promise<Set<number>> {
    if (this.gatewayPid === null) return new Set();

    try {
      const { stdout } = await execAsync("ps -axo pid,ppid,user,comm", { timeout: 5000 });
      const processes = parsePsOutput(stdout);

      // Verify gateway is still running
      const gatewayExists = processes.some((p) => p.pid === this.gatewayPid);
      if (!gatewayExists) return new Set();

      return getProcessTree(processes, this.gatewayPid!);
    } catch {
      // Fallback: just use the single gateway PID
      return new Set([this.gatewayPid!]);
    }
  }
}
