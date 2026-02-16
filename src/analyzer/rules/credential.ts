import type { RiskRule } from "../types.js";

const SSH_PATTERNS = [/\.ssh\//, /\.pem$/, /\.key$/];

export const sshKeyAccess: RiskRule = {
  id: "cred-001",
  name: "ssh_key_access",
  category: "credential",
  severity: "critical",
  description: "Detects access to SSH keys, .pem files, or .key files",
  enabledByDefault: true,
  evaluate(entry) {
    if (entry.action.type !== "file.read") return null;
    const target = entry.action.target;
    const matched = SSH_PATTERNS.some((p) => p.test(target));
    if (matched) {
      return {
        ruleId: "cred-001",
        severity: "critical",
        reason: `SSH key accessed: ${target}`,
        riskContribution: 9,
        labels: ["data_access", "escalation"],
      };
    }
    return null;
  },
};

const ENV_PATTERNS = [/\.env/, /credentials/i, /secrets/i, /tokens/i];

export const envSecretAccess: RiskRule = {
  id: "cred-002",
  name: "env_secret_access",
  category: "credential",
  severity: "high",
  description: "Detects access to .env files, credentials, secrets, or token files",
  enabledByDefault: true,
  evaluate(entry) {
    if (entry.action.type !== "file.read") return null;
    const target = entry.action.target;
    const matched = ENV_PATTERNS.some((p) => p.test(target));
    if (matched) {
      return {
        ruleId: "cred-002",
        severity: "high",
        reason: `Environment/secret file accessed: ${target}`,
        riskContribution: 8,
        labels: ["data_access"],
      };
    }
    return null;
  },
};

const PASSWORD_PATTERNS = [/password/i, /keychain/i, /vault/i];

export const passwordStoreAccess: RiskRule = {
  id: "cred-003",
  name: "password_store_access",
  category: "credential",
  severity: "critical",
  description: "Detects access to password stores, keychains, or vaults",
  enabledByDefault: true,
  evaluate(entry) {
    if (entry.action.type !== "file.read") return null;
    const target = entry.action.target;
    const matched = PASSWORD_PATTERNS.some((p) => p.test(target));
    if (matched) {
      return {
        ruleId: "cred-003",
        severity: "critical",
        reason: `Password store accessed: ${target}`,
        riskContribution: 9,
        labels: ["data_access"],
      };
    }
    return null;
  },
};

export const credentialRules: RiskRule[] = [sshKeyAccess, envSecretAccess, passwordStoreAccess];
