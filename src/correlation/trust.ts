import type { TrustVerdict, TrustLevel } from "./types.js";

/**
 * Compute the combined trust verdict from all three engines.
 *
 * trustScore = weighted average of:
 *   integrity         × 0.30  (tamper-evidence is foundational)
 *   consistency       × 0.35  (intent-execution alignment is core innovation)
 *   witnessConfidence × 0.35  (independent verification)
 */
export function computeTrustVerdict(
  integrity: number,
  consistency: number,
  witnessConfidence: number,
): TrustVerdict {
  const trustScore = Math.round(
    integrity * 0.30 + consistency * 0.35 + witnessConfidence * 0.35,
  );

  const components = {
    integrity,
    consistency,
    witnessConfidence,
  };

  const level = getTrustLevel(trustScore, components);
  const explanation = generateExplanation(level, components);

  return {
    trustScore,
    components,
    level,
    explanation,
  };
}

/**
 * Determine trust level from score and component values.
 *
 * verified:   all components >= 95
 * high:       average >= 85, no component below 70
 * moderate:   average >= 65, no component below 40
 * low:        average >= 40
 * untrusted:  average < 40 or any component = 0
 */
export function getTrustLevel(
  score: number,
  components: { integrity: number; consistency: number; witnessConfidence: number },
): TrustLevel {
  const { integrity, consistency, witnessConfidence } = components;

  // Check for untrusted first
  if (integrity === 0 || consistency === 0 || witnessConfidence === 0) {
    return "untrusted";
  }
  if (score < 40) {
    return "untrusted";
  }

  // Verified: all components >= 95
  if (integrity >= 95 && consistency >= 95 && witnessConfidence >= 95) {
    return "verified";
  }

  // High: average >= 85, no component below 70
  const minComponent = Math.min(integrity, consistency, witnessConfidence);
  if (score >= 85 && minComponent >= 70) {
    return "high";
  }

  // Moderate: average >= 65, no component below 40
  if (score >= 65 && minComponent >= 40) {
    return "moderate";
  }

  // Low: average >= 40 (already checked untrusted above)
  return "low";
}

/**
 * Generate human-readable explanation for the trust verdict.
 */
export function generateExplanation(
  level: TrustLevel,
  components: { integrity: number; consistency: number; witnessConfidence: number },
): string {
  const parts: string[] = [];

  // Integrity commentary
  if (components.integrity === 100) {
    parts.push("Hash chains are intact across all ledger files.");
  } else if (components.integrity >= 80) {
    parts.push("Hash chain integrity is mostly preserved with minor issues.");
  } else if (components.integrity > 0) {
    parts.push("Hash chain integrity failures detected. Ledger may have been tampered with.");
  } else {
    parts.push("Hash chain verification failed completely. Ledger integrity cannot be confirmed.");
  }

  // Consistency commentary
  if (components.consistency >= 95) {
    parts.push("Agent actions are fully consistent with declared claims.");
  } else if (components.consistency >= 70) {
    parts.push("Minor inconsistencies between claims and executions detected.");
  } else if (components.consistency >= 40) {
    parts.push("Significant claim-execution mismatches found. Review recommended.");
  } else {
    parts.push("Agent behavior diverges significantly from its declared intentions.");
  }

  // Witness commentary
  if (components.witnessConfidence >= 95) {
    parts.push("Independent witness corroborates all observed agent actions.");
  } else if (components.witnessConfidence >= 70) {
    parts.push("Most agent actions are corroborated by the witness. Some observations unaccounted for.");
  } else if (components.witnessConfidence >= 40) {
    parts.push("Witness found discrepancies with agent logs. Some actions may be fabricated or omitted.");
  } else {
    parts.push("Witness findings indicate significant unreported or fabricated activity.");
  }

  // Level summary
  switch (level) {
    case "verified":
      parts.push("All verification systems confirm agent trustworthiness.");
      break;
    case "high":
      parts.push("Agent behavior is largely trustworthy with minor concerns.");
      break;
    case "moderate":
      parts.push("Some trust issues detected. Manual review is recommended.");
      break;
    case "low":
      parts.push("Significant trust issues. Restrict agent permissions and review thoroughly.");
      break;
    case "untrusted":
      parts.push("Agent cannot be trusted. Immediate investigation required.");
      break;
  }

  return parts.join(" ");
}
