import { createHash } from "node:crypto";

export interface NetworkEvidence {
  url: string;
  method?: string;
  statusCode?: number;
  responseSizeBytes?: number;
  responseHash?: string;
  durationMs?: number;
}

export interface NetworkRequest {
  url: string;
  method?: string;
}

export interface NetworkResponse {
  statusCode?: number;
  body?: string | Buffer;
  durationMs?: number;
}

export function collectNetworkEvidence(req: NetworkRequest, res?: NetworkResponse): NetworkEvidence {
  const evidence: NetworkEvidence = {
    url: req.url,
  };

  if (req.method) evidence.method = req.method;

  if (res) {
    if (res.statusCode !== undefined) evidence.statusCode = res.statusCode;
    if (res.durationMs !== undefined) evidence.durationMs = res.durationMs;

    if (res.body != null) {
      const bodyStr = typeof res.body === "string" ? res.body : res.body.toString("utf-8");
      evidence.responseSizeBytes = Buffer.byteLength(bodyStr, "utf-8");
      if (evidence.responseSizeBytes > 0) {
        evidence.responseHash = createHash("sha256").update(bodyStr).digest("hex");
      }
    }
  }

  return evidence;
}
