import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import type { InfrastructurePattern } from "./types.js";

/**
 * Shape of the witness section in .agenttrust/config.yaml:
 *
 * ```yaml
 * witness:
 *   infrastructurePatterns:
 *     - host: "api.mycompany.com"
 *       label: "internal-api"
 *     - host: "*.internal.mycompany.com"
 *       port: 443
 *       label: "internal-services"
 * ```
 */
interface WitnessYamlConfig {
  witness?: {
    infrastructurePatterns?: Array<{
      host: string;
      port?: number;
      label?: string;
    }>;
  };
}

/**
 * Load custom infrastructure patterns from a config.yaml file.
 * Returns an empty array if the file doesn't exist, is unreadable,
 * or doesn't contain `witness.infrastructurePatterns`.
 *
 * This function never throws — config loading failures are non-blocking.
 */
export async function loadInfrastructurePatterns(
  configPath: string,
): Promise<InfrastructurePattern[]> {
  try {
    const content = await readFile(configPath, "utf-8");
    const parsed: unknown = parseYaml(content);
    if (!parsed || typeof parsed !== "object") return [];

    const config = parsed as WitnessYamlConfig;
    const rawPatterns = config.witness?.infrastructurePatterns;
    if (!Array.isArray(rawPatterns)) return [];

    const patterns: InfrastructurePattern[] = [];
    for (const raw of rawPatterns) {
      if (typeof raw !== "object" || raw === null) continue;
      const entry = raw as Record<string, unknown>;
      if (typeof entry["host"] !== "string" || entry["host"].length === 0) continue;

      patterns.push({
        host: entry["host"] as string,
        port: typeof entry["port"] === "number" ? entry["port"] : undefined,
        label: typeof entry["label"] === "string" ? (entry["label"] as string) : "custom",
      });
    }

    return patterns;
  } catch {
    // File doesn't exist or is invalid YAML — no custom patterns
    return [];
  }
}
