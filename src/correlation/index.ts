// Correlation types
export type {
  CorrelationFindingType,
  CorrelationSeverity,
  CorrelationFinding,
  CorrelationMatch,
  CorrelationReport,
  InfrastructurePattern,
  TrustLevel,
  TrustVerdict,
} from "./types.js";

// File correlator
export { correlateFileEvents, pathMatches } from "./file-correlator.js";

// Process correlator
export { correlateProcessEvents, commandMatches } from "./process-correlator.js";

// Network correlator
export {
  correlateNetworkEvents,
  hostMatches,
  extractHostFromTarget,
} from "./network-correlator.js";

// Correlation engine
export {
  correlate,
  findUnwitnessed,
  findUnlogged,
  generateFindings,
  classifyUnloggedObservations,
  isSystemProcess,
  SYSTEM_PROCESS_EXCLUSIONS,
  isInfrastructureTraffic,
  matchesInfrastructurePattern,
  KNOWN_INFRASTRUCTURE_PATTERNS,
} from "./engine.js";
export type { CorrelateOptions, ClassifiedObservations } from "./engine.js";

// Config loader (infrastructure patterns from config.yaml)
export { loadInfrastructurePatterns } from "./config.js";

// Scorer
export { computeWitnessConfidence } from "./scorer.js";
export type { WitnessConfidenceContext } from "./scorer.js";

// Trust verdict
export {
  computeTrustVerdict,
  getTrustLevel,
  generateExplanation,
} from "./trust.js";
