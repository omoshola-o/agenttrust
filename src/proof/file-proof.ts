import { stat, open } from "node:fs/promises";
import { createHash } from "node:crypto";

export interface FileEvidence {
  path: string;
  existedBefore: boolean;
  existsAfter: boolean;
  sizeBytes?: number;
  contentHashPrefix?: string;
  mode?: string;
  mtime?: string;
  inode?: number;
}

const PREFIX_BYTES = 4096;

async function hashFilePrefix(filePath: string): Promise<string | undefined> {
  let fh;
  try {
    fh = await open(filePath, "r");
    const buf = Buffer.alloc(PREFIX_BYTES);
    const { bytesRead } = await fh.read(buf, 0, PREFIX_BYTES, 0);
    if (bytesRead === 0) return undefined;
    return createHash("sha256").update(buf.subarray(0, bytesRead)).digest("hex");
  } catch {
    return undefined;
  } finally {
    await fh?.close();
  }
}

async function fileStat(filePath: string): Promise<{ exists: boolean; stat?: Awaited<ReturnType<typeof stat>> }> {
  try {
    const s = await stat(filePath);
    return { exists: true, stat: s };
  } catch {
    return { exists: false };
  }
}

export async function collectFileEvidence(
  filePath: string,
  actionType: "file.read" | "file.write" | "file.delete",
  existedBefore?: boolean,
): Promise<FileEvidence> {
  const afterStat = await fileStat(filePath);
  const existsAfter = afterStat.exists;

  const evidence: FileEvidence = {
    path: filePath,
    existedBefore: existedBefore ?? (actionType === "file.write" ? false : true),
    existsAfter,
  };

  const s = afterStat.stat;
  if (s) {
    evidence.sizeBytes = Number(s.size);
    evidence.mode = "0" + (Number(s.mode) & 0o777).toString(8);
    evidence.mtime = s.mtime.toISOString();
    evidence.inode = Number(s.ino);
    evidence.contentHashPrefix = await hashFilePrefix(filePath);
  }

  return evidence;
}
