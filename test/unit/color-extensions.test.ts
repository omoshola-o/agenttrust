import { describe, it, expect, beforeAll } from "vitest";
import chalk from "chalk";
import {
  colorizeSeverity,
  colorizeTrustLevel,
} from "../../cli/formatters/color.js";
import type { TrustLevel } from "../../src/correlation/types.js";
import type { CorrelationSeverity } from "../../src/correlation/types.js";

beforeAll(() => {
  chalk.level = 0;
});

describe("colorizeSeverity with CorrelationSeverity", () => {
  it("handles 'critical' severity", () => {
    const result = colorizeSeverity("critical", "phantom_process");
    expect(result).toContain("phantom_process");
  });

  it("handles 'warning' severity", () => {
    const result = colorizeSeverity("warning", "target_discrepancy");
    expect(result).toContain("target_discrepancy");
  });

  it("handles 'info' severity", () => {
    const result = colorizeSeverity("info", "timing_gap");
    expect(result).toContain("timing_gap");
  });
});

describe("colorizeTrustLevel", () => {
  const levels: TrustLevel[] = ["verified", "high", "moderate", "low", "untrusted"];

  for (const level of levels) {
    it(`handles '${level}' trust level`, () => {
      const result = colorizeTrustLevel(level, `TRUST: ${level}`);
      expect(result).toContain(`TRUST: ${level}`);
    });
  }

  it("returns the text unchanged when chalk is disabled", () => {
    // chalk.level = 0, so no ANSI codes
    expect(colorizeTrustLevel("verified", "hello")).toBe("hello");
    expect(colorizeTrustLevel("high", "hello")).toBe("hello");
    expect(colorizeTrustLevel("moderate", "hello")).toBe("hello");
    expect(colorizeTrustLevel("low", "hello")).toBe("hello");
    expect(colorizeTrustLevel("untrusted", "hello")).toBe("hello");
  });
});
