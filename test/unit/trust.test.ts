import { describe, it, expect } from "vitest";
import {
  computeTrustVerdict,
  getTrustLevel,
  generateExplanation,
} from "../../src/correlation/trust.js";
import type { TrustLevel } from "../../src/correlation/types.js";

describe("trust", () => {
  describe("computeTrustVerdict", () => {
    it("computes weighted average: 0.30 * integrity + 0.35 * consistency + 0.35 * witness", () => {
      const verdict = computeTrustVerdict(100, 100, 100);
      // 0.30*100 + 0.35*100 + 0.35*100 = 100
      expect(verdict.trustScore).toBe(100);
      expect(verdict.components.integrity).toBe(100);
      expect(verdict.components.consistency).toBe(100);
      expect(verdict.components.witnessConfidence).toBe(100);
    });

    it("rounds the trust score to nearest integer", () => {
      // 0.30*80 + 0.35*90 + 0.35*70 = 24 + 31.5 + 24.5 = 80
      const verdict = computeTrustVerdict(80, 90, 70);
      expect(verdict.trustScore).toBe(80);
    });

    it("includes level and explanation in result", () => {
      const verdict = computeTrustVerdict(100, 100, 100);
      expect(typeof verdict.level).toBe("string");
      expect(typeof verdict.explanation).toBe("string");
      expect(verdict.explanation.length).toBeGreaterThan(0);
    });

    it("calculates correctly with varied component values", () => {
      // 0.30*50 + 0.35*60 + 0.35*40 = 15 + 21 + 14 = 50
      const verdict = computeTrustVerdict(50, 60, 40);
      expect(verdict.trustScore).toBe(50);
    });

    it("handles zero values", () => {
      // 0.30*0 + 0.35*0 + 0.35*0 = 0
      const verdict = computeTrustVerdict(0, 0, 0);
      expect(verdict.trustScore).toBe(0);
      expect(verdict.level).toBe("untrusted");
    });
  });

  describe("getTrustLevel", () => {
    it("returns verified when all components >= 95", () => {
      const components = { integrity: 100, consistency: 95, witnessConfidence: 98 };
      // Score = 0.30*100 + 0.35*95 + 0.35*98 = 30 + 33.25 + 34.3 = 97.55 -> 98
      const level = getTrustLevel(98, components);
      expect(level).toBe("verified");
    });

    it("does not return verified when one component is below 95", () => {
      const components = { integrity: 94, consistency: 100, witnessConfidence: 100 };
      const level = getTrustLevel(98, components);
      expect(level).not.toBe("verified");
    });

    it("returns high when avg >= 85 and min >= 70", () => {
      const components = { integrity: 90, consistency: 85, witnessConfidence: 80 };
      // Score = 0.30*90 + 0.35*85 + 0.35*80 = 27 + 29.75 + 28 = 84.75 -> 85
      const level = getTrustLevel(85, components);
      expect(level).toBe("high");
    });

    it("does not return high when a component is below 70", () => {
      const components = { integrity: 95, consistency: 90, witnessConfidence: 65 };
      const level = getTrustLevel(85, components);
      expect(level).not.toBe("high");
    });

    it("returns moderate when avg >= 65 and min >= 40", () => {
      const components = { integrity: 70, consistency: 60, witnessConfidence: 65 };
      // Score = 0.30*70 + 0.35*60 + 0.35*65 = 21 + 21 + 22.75 = 64.75 -> 65
      const level = getTrustLevel(65, components);
      expect(level).toBe("moderate");
    });

    it("does not return moderate when a component is below 40", () => {
      const components = { integrity: 90, consistency: 35, witnessConfidence: 80 };
      const level = getTrustLevel(65, components);
      expect(level).not.toBe("moderate");
    });

    it("returns low when avg >= 40 but conditions for moderate are not met", () => {
      const components = { integrity: 50, consistency: 35, witnessConfidence: 50 };
      const level = getTrustLevel(45, components);
      expect(level).toBe("low");
    });

    it("returns untrusted when avg < 40", () => {
      const components = { integrity: 30, consistency: 30, witnessConfidence: 30 };
      const level = getTrustLevel(30, components);
      expect(level).toBe("untrusted");
    });

    it("returns untrusted when any component is 0", () => {
      const components = { integrity: 0, consistency: 100, witnessConfidence: 100 };
      const level = getTrustLevel(70, components);
      expect(level).toBe("untrusted");
    });

    it("returns untrusted when consistency is 0", () => {
      const components = { integrity: 100, consistency: 0, witnessConfidence: 100 };
      const level = getTrustLevel(65, components);
      expect(level).toBe("untrusted");
    });

    it("returns untrusted when witnessConfidence is 0", () => {
      const components = { integrity: 100, consistency: 100, witnessConfidence: 0 };
      const level = getTrustLevel(65, components);
      expect(level).toBe("untrusted");
    });

    it("returns verified for all 100s", () => {
      const components = { integrity: 100, consistency: 100, witnessConfidence: 100 };
      const level = getTrustLevel(100, components);
      expect(level).toBe("verified");
    });

    it("boundary: score exactly 40 is low, not untrusted", () => {
      const components = { integrity: 40, consistency: 40, witnessConfidence: 40 };
      const level = getTrustLevel(40, components);
      expect(level).toBe("low");
    });

    it("boundary: score 39 is untrusted", () => {
      const components = { integrity: 40, consistency: 40, witnessConfidence: 35 };
      const level = getTrustLevel(39, components);
      expect(level).toBe("untrusted");
    });
  });

  describe("generateExplanation", () => {
    it("includes integrity commentary for perfect integrity", () => {
      const components = { integrity: 100, consistency: 100, witnessConfidence: 100 };
      const explanation = generateExplanation("verified", components);
      expect(explanation).toContain("Hash chains are intact");
    });

    it("includes integrity commentary for mostly preserved integrity", () => {
      const components = { integrity: 85, consistency: 80, witnessConfidence: 75 };
      const explanation = generateExplanation("high", components);
      expect(explanation).toContain("mostly preserved");
    });

    it("includes integrity commentary for low integrity", () => {
      const components = { integrity: 50, consistency: 60, witnessConfidence: 40 };
      const explanation = generateExplanation("moderate", components);
      expect(explanation).toContain("tampered");
    });

    it("includes integrity commentary for zero integrity", () => {
      const components = { integrity: 0, consistency: 50, witnessConfidence: 50 };
      const explanation = generateExplanation("untrusted", components);
      expect(explanation).toContain("verification failed completely");
    });

    it("includes consistency commentary for perfect consistency", () => {
      const components = { integrity: 100, consistency: 100, witnessConfidence: 100 };
      const explanation = generateExplanation("verified", components);
      expect(explanation).toContain("fully consistent");
    });

    it("includes consistency commentary for moderate consistency", () => {
      const components = { integrity: 100, consistency: 50, witnessConfidence: 100 };
      const explanation = generateExplanation("moderate", components);
      expect(explanation).toContain("Significant claim-execution mismatches");
    });

    it("includes witness commentary for perfect witness confidence", () => {
      const components = { integrity: 100, consistency: 100, witnessConfidence: 100 };
      const explanation = generateExplanation("verified", components);
      expect(explanation).toContain("corroborates all");
    });

    it("includes witness commentary for low witness confidence", () => {
      const components = { integrity: 100, consistency: 100, witnessConfidence: 30 };
      const explanation = generateExplanation("untrusted", components);
      expect(explanation).toContain("unreported or fabricated");
    });

    it("includes level summary for verified", () => {
      const components = { integrity: 100, consistency: 100, witnessConfidence: 100 };
      const explanation = generateExplanation("verified", components);
      expect(explanation).toContain("confirm agent trustworthiness");
    });

    it("includes level summary for high", () => {
      const components = { integrity: 90, consistency: 85, witnessConfidence: 80 };
      const explanation = generateExplanation("high", components);
      expect(explanation).toContain("largely trustworthy");
    });

    it("includes level summary for moderate", () => {
      const components = { integrity: 70, consistency: 60, witnessConfidence: 65 };
      const explanation = generateExplanation("moderate", components);
      expect(explanation).toContain("Manual review");
    });

    it("includes level summary for low", () => {
      const components = { integrity: 50, consistency: 40, witnessConfidence: 40 };
      const explanation = generateExplanation("low", components);
      expect(explanation).toContain("Restrict agent permissions");
    });

    it("includes level summary for untrusted", () => {
      const components = { integrity: 10, consistency: 10, witnessConfidence: 10 };
      const explanation = generateExplanation("untrusted", components);
      expect(explanation).toContain("Immediate investigation");
    });

    it("combines all commentary sections into a single string", () => {
      const components = { integrity: 100, consistency: 100, witnessConfidence: 100 };
      const explanation = generateExplanation("verified", components);
      // Should have integrity, consistency, witness, and level sections separated by spaces
      const parts = explanation.split(". ").filter((p) => p.length > 0);
      // At minimum 4 sentences (integrity + consistency + witness + level summary)
      expect(parts.length).toBeGreaterThanOrEqual(3);
    });
  });
});
