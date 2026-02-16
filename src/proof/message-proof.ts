import { createHash } from "node:crypto";

export interface MessageEvidence {
  channel: string;
  targetHash: string;
  messageLength?: number;
  contentHash?: string;
  hasAttachments: boolean;
}

export interface MessageInput {
  channel: string;
  target: string;
  content?: string;
  hasAttachments?: boolean;
}

export function collectMessageEvidence(msg: MessageInput): MessageEvidence {
  const evidence: MessageEvidence = {
    channel: msg.channel,
    targetHash: createHash("sha256").update(msg.target).digest("hex"),
    hasAttachments: msg.hasAttachments ?? false,
  };

  if (msg.content !== undefined) {
    evidence.messageLength = msg.content.length;
    if (msg.content.length > 0) {
      evidence.contentHash = createHash("sha256").update(msg.content).digest("hex");
    }
  }

  return evidence;
}
