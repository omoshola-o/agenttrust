import type { FileEvidence } from "./file-proof.js";
import type { ProcessEvidence, ProcessResult } from "./process-proof.js";
import type { NetworkEvidence, NetworkRequest, NetworkResponse } from "./network-proof.js";
import type { MessageEvidence, MessageInput } from "./message-proof.js";
import { collectFileEvidence } from "./file-proof.js";
import { collectProcessEvidence } from "./process-proof.js";
import { collectNetworkEvidence } from "./network-proof.js";
import { collectMessageEvidence } from "./message-proof.js";

export type EvidenceType = "file" | "process" | "network" | "message";

export interface EvidenceReceipt {
  receiptVersion: 1;
  type: EvidenceType;
  evidence: FileEvidence | ProcessEvidence | NetworkEvidence | MessageEvidence;
  collectedAt: string;
}

export interface CreateFileReceiptInput {
  type: "file";
  filePath: string;
  actionType: "file.read" | "file.write" | "file.delete";
  existedBefore?: boolean;
}

export interface CreateProcessReceiptInput {
  type: "process";
  command: string;
  result: ProcessResult;
}

export interface CreateNetworkReceiptInput {
  type: "network";
  request: NetworkRequest;
  response?: NetworkResponse;
}

export interface CreateMessageReceiptInput {
  type: "message";
  message: MessageInput;
}

export type CreateReceiptInput =
  | CreateFileReceiptInput
  | CreateProcessReceiptInput
  | CreateNetworkReceiptInput
  | CreateMessageReceiptInput;

export async function createReceipt(input: CreateReceiptInput): Promise<EvidenceReceipt> {
  const collectedAt = new Date().toISOString();

  switch (input.type) {
    case "file": {
      const evidence = await collectFileEvidence(input.filePath, input.actionType, input.existedBefore);
      return { receiptVersion: 1, type: "file", evidence, collectedAt };
    }
    case "process": {
      const evidence = collectProcessEvidence(input.command, input.result);
      return { receiptVersion: 1, type: "process", evidence, collectedAt };
    }
    case "network": {
      const evidence = collectNetworkEvidence(input.request, input.response);
      return { receiptVersion: 1, type: "network", evidence, collectedAt };
    }
    case "message": {
      const evidence = collectMessageEvidence(input.message);
      return { receiptVersion: 1, type: "message", evidence, collectedAt };
    }
  }
}

export function validateReceipt(receipt: unknown): receipt is EvidenceReceipt {
  if (typeof receipt !== "object" || receipt === null) return false;
  const obj = receipt as Record<string, unknown>;
  if (obj["receiptVersion"] !== 1) return false;
  if (typeof obj["type"] !== "string") return false;
  if (!["file", "process", "network", "message"].includes(obj["type"] as string)) return false;
  if (typeof obj["evidence"] !== "object" || obj["evidence"] === null) return false;
  if (typeof obj["collectedAt"] !== "string") return false;
  return true;
}
