import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseDuration } from "../../cli/utils/duration.js";

describe("parseDuration", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  // ─── Valid inputs ──────────────────────────────────────────────

  it("parses minutes (30m)", () => {
    const before = Date.now();
    const result = parseDuration("30m");
    const after = Date.now();
    expect(result.valid).toBe(true);
    // cutoff should be ~30min ago
    const expected = before - 30 * 60 * 1000;
    expect(result.cutoff).toBeGreaterThanOrEqual(expected - 10);
    expect(result.cutoff).toBeLessThanOrEqual(after - 30 * 60 * 1000 + 10);
  });

  it("parses hours (24h)", () => {
    const result = parseDuration("24h");
    expect(result.valid).toBe(true);
    const expected = Date.now() - 24 * 60 * 60 * 1000;
    expect(Math.abs(result.cutoff - expected)).toBeLessThan(50);
  });

  it("parses days (7d)", () => {
    const result = parseDuration("7d");
    expect(result.valid).toBe(true);
    const expected = Date.now() - 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(result.cutoff - expected)).toBeLessThan(50);
  });

  it("parses weeks (4w)", () => {
    const result = parseDuration("4w");
    expect(result.valid).toBe(true);
    const expected = Date.now() - 4 * 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(result.cutoff - expected)).toBeLessThan(50);
  });

  it("parses single digit (1h)", () => {
    const result = parseDuration("1h");
    expect(result.valid).toBe(true);
  });

  it("parses large numbers (365d)", () => {
    const result = parseDuration("365d");
    expect(result.valid).toBe(true);
  });

  it("does not warn on valid input", () => {
    parseDuration("24h");
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  // ─── Invalid inputs ────────────────────────────────────────────

  it("warns on invalid format and returns valid=false", () => {
    const result = parseDuration("invalid");
    expect(result.valid).toBe(false);
    expect(stderrSpy).toHaveBeenCalledTimes(1);
  });

  it("warns on empty string", () => {
    const result = parseDuration("");
    expect(result.valid).toBe(false);
    expect(stderrSpy).toHaveBeenCalled();
  });

  it("falls back to 24h on invalid input", () => {
    const result = parseDuration("xyz");
    const expected = Date.now() - 24 * 60 * 60 * 1000;
    expect(Math.abs(result.cutoff - expected)).toBeLessThan(50);
  });

  it("warns on unsupported unit (s for seconds)", () => {
    const result = parseDuration("30s");
    expect(result.valid).toBe(false);
    expect(stderrSpy).toHaveBeenCalled();
  });

  it("warns on unsupported unit (y for years)", () => {
    const result = parseDuration("1y");
    expect(result.valid).toBe(false);
    expect(stderrSpy).toHaveBeenCalled();
  });

  it("warns on missing number", () => {
    const result = parseDuration("h");
    expect(result.valid).toBe(false);
    expect(stderrSpy).toHaveBeenCalled();
  });

  it("warns on negative number", () => {
    const result = parseDuration("-1h");
    expect(result.valid).toBe(false);
    expect(stderrSpy).toHaveBeenCalled();
  });

  it("warns on decimal number", () => {
    const result = parseDuration("1.5h");
    expect(result.valid).toBe(false);
    expect(stderrSpy).toHaveBeenCalled();
  });

  it("includes the invalid input in the warning message", () => {
    parseDuration("2days");
    const msg = stderrSpy.mock.calls[0]?.[0] as string;
    expect(msg).toContain("2days");
  });

  it("includes valid format examples in the warning", () => {
    parseDuration("bad");
    const msg = stderrSpy.mock.calls[0]?.[0] as string;
    expect(msg).toContain("24h");
    expect(msg).toContain("7d");
  });

  it("mentions defaulting to 24h in the warning", () => {
    parseDuration("bad");
    const msg = stderrSpy.mock.calls[0]?.[0] as string;
    expect(msg).toContain("24h");
  });
});
