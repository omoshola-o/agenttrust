import { createHash } from "node:crypto";

export interface ProcessEvidence {
  command: string;
  exitCode?: number;
  stdoutHash?: string;
  stdoutLength?: number;
  hadStderr: boolean;
  pid?: number;
}

export interface ProcessResult {
  stdout?: string | Buffer;
  stderr?: string | Buffer;
  exitCode?: number;
  pid?: number;
}

export function collectProcessEvidence(command: string, result: ProcessResult): ProcessEvidence {
  const stdout = result.stdout != null ? String(result.stdout) : undefined;
  const stderr = result.stderr != null ? String(result.stderr) : undefined;

  const evidence: ProcessEvidence = {
    command,
    hadStderr: stderr != null && stderr.length > 0,
  };

  if (result.exitCode !== undefined) evidence.exitCode = result.exitCode;
  if (result.pid !== undefined) evidence.pid = result.pid;

  if (stdout !== undefined) {
    evidence.stdoutLength = stdout.length;
    if (stdout.length > 0) {
      evidence.stdoutHash = createHash("sha256").update(stdout).digest("hex");
    }
  }

  return evidence;
}
