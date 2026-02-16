// Witness types
export type {
  FileWitnessEvent,
  ProcessWitnessEvent,
  NetworkWitnessEvent,
  WitnessEvent,
  WitnessSource,
  WitnessEntry,
  WitnessConfig,
  DaemonStats,
} from "./types.js";
export { DEFAULT_WITNESS_CONFIG } from "./types.js";

// File monitor
export { FileMonitor } from "./file-monitor.js";
export type { FileEventCallback } from "./file-monitor.js";

// Process monitor
export { ProcessMonitor, parsePsOutput, getProcessTree } from "./process-monitor.js";
export type { ProcessEventCallback } from "./process-monitor.js";

// Network monitor
export { NetworkMonitor, parseLsofOutput, parseHostPort } from "./network-monitor.js";
export type { NetworkEventCallback } from "./network-monitor.js";

// Daemon
export { WitnessDaemon } from "./daemon.js";
export type { WitnessEventWithSource, DaemonFlushCallback } from "./daemon.js";

// Witness storage
export {
  appendWitnessEntry,
  readWitnessEntries,
  listWitnessFiles,
  getLastWitnessEntry,
  parseWitnessEntry,
  getCurrentWitnessFilePath,
  getWitnessFilePathForDate,
  ensureWitnessDir,
} from "./witness-storage.js";
export type { WitnessStorageConfig } from "./witness-storage.js";
