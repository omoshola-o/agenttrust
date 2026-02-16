export { matchClaimsToExecutions } from "./matcher.js";
export { detectDivergences } from "./divergence.js";
export { computeConsistencyScore } from "./scorer.js";
export { generateReport } from "./report.js";
export type {
  ConsistencyReport,
  ConsistencyFinding,
  FindingType,
  FindingSeverity,
  MatchResult,
  MatchType,
} from "./types.js";
