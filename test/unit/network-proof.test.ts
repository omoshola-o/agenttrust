import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { collectNetworkEvidence } from "../../src/proof/network-proof.js";

describe("collectNetworkEvidence", () => {
  it("collects evidence for a successful request", () => {
    const evidence = collectNetworkEvidence(
      { url: "https://api.example.com/users", method: "GET" },
      { statusCode: 200, body: '{"users":[]}', durationMs: 150 },
    );

    expect(evidence.url).toBe("https://api.example.com/users");
    expect(evidence.method).toBe("GET");
    expect(evidence.statusCode).toBe(200);
    expect(evidence.durationMs).toBe(150);
    expect(evidence.responseSizeBytes).toBe(Buffer.byteLength('{"users":[]}', "utf-8"));

    const expectedHash = createHash("sha256").update('{"users":[]}').digest("hex");
    expect(evidence.responseHash).toBe(expectedHash);
  });

  it("handles request without response", () => {
    const evidence = collectNetworkEvidence({ url: "https://example.com/timeout" });

    expect(evidence.url).toBe("https://example.com/timeout");
    expect(evidence.statusCode).toBeUndefined();
    expect(evidence.responseSizeBytes).toBeUndefined();
    expect(evidence.responseHash).toBeUndefined();
  });

  it("handles request with method only", () => {
    const evidence = collectNetworkEvidence(
      { url: "https://api.example.com/data", method: "POST" },
      { statusCode: 201 },
    );

    expect(evidence.method).toBe("POST");
    expect(evidence.statusCode).toBe(201);
    expect(evidence.responseSizeBytes).toBeUndefined();
  });

  it("handles empty response body", () => {
    const evidence = collectNetworkEvidence(
      { url: "https://example.com/empty" },
      { statusCode: 204, body: "" },
    );

    expect(evidence.statusCode).toBe(204);
    expect(evidence.responseSizeBytes).toBe(0);
    expect(evidence.responseHash).toBeUndefined();
  });

  it("handles Buffer response body", () => {
    const body = Buffer.from("binary data");
    const evidence = collectNetworkEvidence(
      { url: "https://example.com/file" },
      { statusCode: 200, body },
    );

    expect(evidence.responseSizeBytes).toBe(Buffer.byteLength("binary data", "utf-8"));
    expect(evidence.responseHash).toBeDefined();
  });

  it("omits method when not provided", () => {
    const evidence = collectNetworkEvidence({ url: "https://example.com" });

    expect(evidence.method).toBeUndefined();
  });
});
