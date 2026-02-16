import { describe, it, expect } from "vitest";
import { isActionType, ACTION_TYPES } from "../../src/schema/action-types.js";

describe("action-types", () => {
  it("ACTION_TYPES contains 23 types", () => {
    expect(ACTION_TYPES).toHaveLength(23);
  });

  it("isActionType returns true for all canonical types", () => {
    for (const t of ACTION_TYPES) {
      expect(isActionType(t)).toBe(true);
    }
  });

  it("isActionType returns false for invalid types", () => {
    expect(isActionType("invalid")).toBe(false);
    expect(isActionType("")).toBe(false);
    expect(isActionType("file")).toBe(false);
    expect(isActionType("FILE.READ")).toBe(false);
  });

  it("all types use dot notation", () => {
    for (const t of ACTION_TYPES) {
      expect(t).toMatch(/^[a-z]+\.[a-z]+$/);
    }
  });
});
