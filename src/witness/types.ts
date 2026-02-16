/** File system witness event */
export interface FileWitnessEvent {
  type: "file_created" | "file_modified" | "file_deleted" | "file_accessed";
  path: string;
  /** ISO-8601 timestamp from system clock */
  observedAt: string;
  /** File stat after event (null if deleted) */
  stat?: {
    sizeBytes: number;
    mode: string;
    mtime: string;
    /** SHA-256 of first 4096 bytes (only for created/modified) */
    contentHashPrefix?: string;
  };
}

/** Process witness event */
export interface ProcessWitnessEvent {
  type: "process_spawned" | "process_exited";
  /** The command that was run */
  command: string;
  /** Process ID */
  pid: number;
  /** Parent process ID */
  ppid: number;
  /** ISO-8601 timestamp */
  observedAt: string;
  /** Exit code (only for process_exited) */
  exitCode?: number;
  /** User who ran the process */
  user?: string;
  /** Working directory */
  cwd?: string;
}

/** Network witness event */
export interface NetworkWitnessEvent {
  type: "connection_opened" | "connection_closed" | "dns_query";
  /** Remote address or hostname */
  remoteHost: string;
  /** Remote port */
  remotePort?: number;
  /** Protocol */
  protocol?: "tcp" | "udp";
  /** Process that made the connection (if identifiable) */
  pid?: number;
  command?: string;
  /** ISO-8601 timestamp */
  observedAt: string;
}

/** Union type for all witness events */
export type WitnessEvent = FileWitnessEvent | ProcessWitnessEvent | NetworkWitnessEvent;

/** Source monitor type */
export type WitnessSource = "filesystem" | "process" | "network";

/** Witness entry stored in the witness ledger */
export interface WitnessEntry {
  /** ULID — time-sortable unique ID */
  id: string;
  /** Schema version */
  v: 1;
  /** ISO-8601 timestamp — when the event was observed by the system */
  ts: string;
  /** SHA-256 hash chain (same logic as other ledgers) */
  prevHash: string;
  hash: string;
  /** Source monitor */
  source: WitnessSource;
  /** The observed event */
  event: WitnessEvent;
  /** Whether this event has been correlated with an execution entry */
  correlated: boolean;
  /** ID of the correlated execution entry (set by correlation engine) */
  correlatedEntryId?: string;
}

/** Witness daemon configuration */
export interface WitnessConfig {
  /** Whether the witness daemon is enabled */
  enabled: boolean;
  /** Directories to watch for file events */
  watchPaths: string[];
  /** Paths to exclude from file watching */
  excludePaths: string[];
  /** Process polling interval in ms (default: 500) */
  processPollingMs: number;
  /** Network polling interval in ms (default: 2000) */
  networkPollingMs: number;
  /** Maximum events to buffer before flushing to ledger (default: 50) */
  bufferSize: number;
  /** How to find the gateway process */
  gateway: {
    /** Path to PID file */
    pidFile: string;
    /** Fallback: process name to search for */
    processName: string;
  };
}

/** Default witness configuration */
export const DEFAULT_WITNESS_CONFIG: WitnessConfig = {
  enabled: true,
  watchPaths: [
    "~/.openclaw/workspace/",
    "~/Desktop/",
    "~/Documents/",
    "~/.ssh/",
  ],
  excludePaths: [
    "~/.openclaw/workspace/.agenttrust/",
    "**/node_modules/**",
    "**/.git/**",
  ],
  processPollingMs: 500,
  networkPollingMs: 2000,
  bufferSize: 50,
  gateway: {
    pidFile: "~/.openclaw/gateway.pid",
    processName: "openclaw",
  },
};

/** Stats reported by the witness daemon */
export interface DaemonStats {
  /** Whether the daemon is running */
  running: boolean;
  /** Daemon start time (ISO-8601) */
  startedAt?: string;
  /** Uptime in ms */
  uptimeMs: number;
  /** Event counts by source */
  events: {
    file: number;
    process: number;
    network: number;
  };
  /** Last event time (ISO-8601) */
  lastEventAt?: string;
  /** Number of events in buffer (not yet flushed) */
  bufferedEvents: number;
}
