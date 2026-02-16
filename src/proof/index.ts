export { collectFileEvidence } from "./file-proof.js";
export type { FileEvidence } from "./file-proof.js";

export { collectProcessEvidence } from "./process-proof.js";
export type { ProcessEvidence, ProcessResult } from "./process-proof.js";

export { collectNetworkEvidence } from "./network-proof.js";
export type { NetworkEvidence, NetworkRequest, NetworkResponse } from "./network-proof.js";

export { collectMessageEvidence } from "./message-proof.js";
export type { MessageEvidence, MessageInput } from "./message-proof.js";

export { createReceipt, validateReceipt } from "./receipt.js";
export type {
  EvidenceReceipt,
  EvidenceType,
  CreateReceiptInput,
  CreateFileReceiptInput,
  CreateProcessReceiptInput,
  CreateNetworkReceiptInput,
  CreateMessageReceiptInput,
} from "./receipt.js";
