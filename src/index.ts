// Ledger
export { Ledger, resolveWorkspace } from "./ledger/ledger.js";
export type { LedgerConfig, LedgerStats } from "./ledger/ledger.js";

// Entry
export { createEntry, validateEntry, parseEntry } from "./ledger/entry.js";
export type { ATFEntry, CreateEntryInput } from "./ledger/entry.js";

// Hash chain
export { canonicalize, hashEntry, verifyEntryHash, verifyChain } from "./ledger/hash-chain.js";
export type { ChainVerification } from "./ledger/hash-chain.js";

// Storage
export type { StorageConfig, StorageResult } from "./ledger/storage.js";

// Integrity
export { verifyFile, verifyAll } from "./ledger/integrity.js";
export type { IntegrityReport, IntegrityError } from "./ledger/integrity.js";

// Schema
export { ACTION_TYPES, isActionType } from "./schema/action-types.js";
export type { ActionType } from "./schema/action-types.js";
export { validateContext } from "./schema/context.js";
export type { ActionContext } from "./schema/context.js";
export { validateOutcome } from "./schema/outcome.js";
export type { ActionOutcome, OutcomeStatus } from "./schema/outcome.js";
export { RISK_LABELS, validateRisk, getRiskLevel } from "./schema/risk.js";
export type { RiskLabel, RiskAssessment } from "./schema/risk.js";

// Query
export { parseTimeRange, applyFilters, getRelevantFiles } from "./query/filters.js";
export type { TimeRange, QueryFilters } from "./query/filters.js";
export { buildTimeline, findActionChain } from "./query/timeline.js";
export type { TimelineEntry } from "./query/timeline.js";

// Claims (Layer 1.5)
export { createClaim, validateClaim, parseClaim } from "./ledger/claim.js";
export type {
  ClaimEntry,
  CreateClaimInput,
  ClaimIntent,
  ClaimConstraints,
  ClaimExecution,
} from "./ledger/claim.js";

// Claims Storage (Layer 1.5)
export type { ClaimsStorageConfig } from "./ledger/claims-storage.js";

// Evidence Receipts (Layer 1.5)
export {
  collectFileEvidence,
  collectProcessEvidence,
  collectNetworkEvidence,
  collectMessageEvidence,
  createReceipt,
  validateReceipt,
} from "./proof/index.js";
export type {
  FileEvidence,
  ProcessEvidence,
  ProcessResult,
  NetworkEvidence,
  NetworkRequest,
  NetworkResponse,
  MessageEvidence,
  MessageInput,
  EvidenceReceipt,
  EvidenceType,
  CreateReceiptInput,
} from "./proof/index.js";

// Consistency Engine (Layer 1.5)
export {
  matchClaimsToExecutions,
  detectDivergences,
  computeConsistencyScore,
  generateReport,
} from "./consistency/index.js";
export type {
  ConsistencyReport,
  ConsistencyFinding,
  FindingType,
  FindingSeverity,
  MatchResult,
  MatchType,
} from "./consistency/index.js";

// Risk Rules Engine (Layer 2)
export { RuleEngine } from "./analyzer/engine.js";
export { getAllBuiltinRules, getRuleById, getRulesByCategory } from "./analyzer/rules/index.js";
export { loadRuleConfig, loadPreset, mergeConfigs } from "./analyzer/config-loader.js";
export { DEFAULT_CONFIG } from "./analyzer/types.js";
export type {
  RiskRule,
  RuleCategory,
  RuleSeverity,
  RuleContext,
  RuleMatch,
  RuleEngineConfig,
  EvaluationReport,
} from "./analyzer/types.js";

// Replay/Blame Engine (Layer 2)
export {
  buildGraph,
  getChain,
  getRoots,
  getNodesAtDepth,
  getLeafNodes,
  analyzeBlame,
  findBlameRoot,
  identifyFactors,
  generateNarrative,
  generateRecommendation,
  formatChainSummary,
} from "./replay/index.js";
export type {
  CausalNode,
  CausalGraph,
  BlameReport,
  BlameFactor,
  BuildGraphOptions,
} from "./replay/index.js";

// Watch Mode (Layer 2)
export { LedgerWatcher, renderCompact, renderDetailed, renderClaimArrival, renderWatchSummary } from "./watch/index.js";
export type { WatchOptions, WatchEvent, WatchCallback, WatcherConfig, WatchSummary } from "./watch/index.js";

// Digest Generator (Layer 2)
export {
  collectDailyData,
  collectWeeklyData,
  generateDailyDigest,
  generateWeeklyDigest,
  writeDigest,
  writeDigestForDate,
  getDigestPath,
  DEFAULT_DIGEST_CONFIG,
} from "./digest/index.js";
export type { DigestConfig, DigestData } from "./digest/index.js";

// Witness Daemon (Layer 2.5)
export {
  FileMonitor,
  ProcessMonitor,
  NetworkMonitor,
  WitnessDaemon,
  parsePsOutput,
  getProcessTree,
  parseLsofOutput,
  parseHostPort,
  DEFAULT_WITNESS_CONFIG,
  appendWitnessEntry,
  readWitnessEntries,
  listWitnessFiles,
  getLastWitnessEntry,
  parseWitnessEntry,
  getCurrentWitnessFilePath,
  getWitnessFilePathForDate,
  ensureWitnessDir,
} from "./witness/index.js";
export type {
  FileWitnessEvent,
  ProcessWitnessEvent,
  NetworkWitnessEvent,
  WitnessEvent,
  WitnessSource,
  WitnessEntry,
  WitnessConfig,
  DaemonStats,
  FileEventCallback,
  ProcessEventCallback,
  NetworkEventCallback,
  WitnessEventWithSource,
  DaemonFlushCallback,
  WitnessStorageConfig,
} from "./witness/index.js";

// Correlation Engine (Layer 2.5)
export {
  correlate,
  correlateFileEvents,
  correlateProcessEvents,
  correlateNetworkEvents,
  pathMatches,
  commandMatches,
  hostMatches,
  extractHostFromTarget,
  findUnwitnessed,
  findUnlogged,
  generateFindings,
  computeWitnessConfidence,
  computeTrustVerdict,
  getTrustLevel,
  generateExplanation,
} from "./correlation/index.js";
export type {
  CorrelationFindingType,
  CorrelationSeverity,
  CorrelationFinding,
  CorrelationMatch,
  CorrelationReport,
  TrustLevel,
  TrustVerdict,
  WitnessConfidenceContext,
} from "./correlation/index.js";
