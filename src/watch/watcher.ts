import { open, stat, watch as fsWatch } from "node:fs/promises";
import { join } from "node:path";
import { parseEntry } from "../ledger/entry.js";
import { parseClaim } from "../ledger/claim.js";
import type { ATFEntry } from "../ledger/entry.js";
import type { ClaimEntry } from "../ledger/claim.js";
import type { RuleMatch, RuleCategory } from "../analyzer/types.js";
import { RuleEngine } from "../analyzer/engine.js";
import type { RuleEngineConfig } from "../analyzer/types.js";

export interface WatchOptions {
  /** Only show entries matching these risk levels */
  minSeverity?: "low" | "medium" | "high" | "critical";

  /** Only show entries matching these rule categories */
  categories?: RuleCategory[];

  /** Only show entries that trigger rules */
  riskOnly: boolean;

  /** Show claims as they arrive too */
  showClaims: boolean;

  /** Compact output (one line per entry) vs detailed */
  compact: boolean;
}

export interface WatchEvent {
  type: "entry" | "claim";
  entry?: ATFEntry;
  claim?: ClaimEntry;
  ruleMatches: RuleMatch[];
}

export type WatchCallback = (event: WatchEvent) => void;

function formatDateUTC(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getLedgerFilePath(ledgerDir: string, date: Date): string {
  return join(ledgerDir, `${formatDateUTC(date)}.agenttrust.jsonl`);
}

function getClaimsFilePath(claimsDir: string, date: Date): string {
  return join(claimsDir, `${formatDateUTC(date)}.claims.jsonl`);
}

export interface WatcherConfig {
  ledgerDir: string;
  claimsDir: string;
  engineConfig?: Partial<RuleEngineConfig>;
  pollIntervalMs?: number;
}

export interface WatchSummary {
  entriesSeen: number;
  claimsSeen: number;
  rulesTriggered: number;
  bySeverity: { critical: number; high: number; medium: number; low: number };
  durationMs: number;
}

export class LedgerWatcher {
  private ledgerDir: string;
  private claimsDir: string;
  private engine: RuleEngine;
  private pollIntervalMs: number;
  private running = false;
  private ledgerOffset = 0;
  private claimsOffset = 0;
  private currentDate: string;
  private callback: WatchCallback | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;
  private startTime = 0;

  // Summary tracking
  private summary: WatchSummary = {
    entriesSeen: 0,
    claimsSeen: 0,
    rulesTriggered: 0,
    bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
    durationMs: 0,
  };

  // Context for rules engine (sliding window)
  private recentEntries: ATFEntry[] = [];
  private knownTargets = new Set<string>();

  constructor(config: WatcherConfig) {
    this.ledgerDir = config.ledgerDir;
    this.claimsDir = config.claimsDir;
    this.engine = new RuleEngine(undefined, config.engineConfig);
    this.pollIntervalMs = config.pollIntervalMs ?? 500;
    this.currentDate = formatDateUTC(new Date());
  }

  /**
   * Start watching for new entries.
   */
  async watch(options: WatchOptions, callback: WatchCallback): Promise<void> {
    this.callback = callback;
    this.running = true;
    this.startTime = Date.now();
    this.abortController = new AbortController();

    // Initialize offsets to end of current files
    await this.initializeOffsets();

    // Try native fs.watch first, fall back to polling
    try {
      await this.watchWithNative(options);
    } catch {
      // Fall back to polling
      this.watchWithPolling(options);
    }
  }

  /**
   * Stop watching.
   */
  stop(): WatchSummary {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.summary.durationMs = Date.now() - this.startTime;
    return { ...this.summary };
  }

  getSummary(): WatchSummary {
    return {
      ...this.summary,
      durationMs: Date.now() - this.startTime,
    };
  }

  private async initializeOffsets(): Promise<void> {
    const ledgerPath = getLedgerFilePath(this.ledgerDir, new Date());
    try {
      const s = await stat(ledgerPath);
      this.ledgerOffset = Number(s.size);
    } catch {
      this.ledgerOffset = 0;
    }

    const claimsPath = getClaimsFilePath(this.claimsDir, new Date());
    try {
      const s = await stat(claimsPath);
      this.claimsOffset = Number(s.size);
    } catch {
      this.claimsOffset = 0;
    }
  }

  private async watchWithNative(options: WatchOptions): Promise<void> {
    const signal = this.abortController!.signal;

    // Watch ledger directory for changes
    const watcher = fsWatch(this.ledgerDir, { signal });

    // Also start polling as a backup (some filesystems don't support watch)
    this.watchWithPolling(options);

    try {
      for await (const _event of watcher) {
        if (!this.running) break;
        await this.checkForNewEntries(options);
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      // Native watch failed, polling is already running as backup
    }
  }

  private watchWithPolling(options: WatchOptions): void {
    if (this.pollTimer) return; // Already polling
    this.pollTimer = setInterval(async () => {
      if (!this.running) return;
      // Check for day rollover
      const nowDate = formatDateUTC(new Date());
      if (nowDate !== this.currentDate) {
        this.currentDate = nowDate;
        this.ledgerOffset = 0;
        this.claimsOffset = 0;
      }
      await this.checkForNewEntries(options);
    }, this.pollIntervalMs);
  }

  private async checkForNewEntries(options: WatchOptions): Promise<void> {
    // Check ledger file
    const ledgerPath = getLedgerFilePath(this.ledgerDir, new Date());
    const newEntries = await this.readNewLines(ledgerPath, this.ledgerOffset);
    if (newEntries.data.length > 0) {
      this.ledgerOffset = newEntries.newOffset;
      for (const line of newEntries.data) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const entry = parseEntry(trimmed);
          if (!entry) continue;
          this.processEntry(entry, options);
        } catch {
          // Skip unparseable lines
        }
      }
    }

    // Check claims file if requested
    if (options.showClaims) {
      const claimsPath = getClaimsFilePath(this.claimsDir, new Date());
      const newClaims = await this.readNewLines(claimsPath, this.claimsOffset);
      if (newClaims.data.length > 0) {
        this.claimsOffset = newClaims.newOffset;
        for (const line of newClaims.data) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const claim = parseClaim(trimmed);
            if (!claim) continue;
            this.processClaim(claim);
          } catch {
            // Skip unparseable lines
          }
        }
      }
    }
  }

  private async readNewLines(
    filePath: string,
    offset: number,
  ): Promise<{ data: string[]; newOffset: number }> {
    try {
      const s = await stat(filePath);
      const fileSize = Number(s.size);
      if (fileSize <= offset) {
        return { data: [], newOffset: offset };
      }

      const fh = await open(filePath, "r");
      try {
        const buf = Buffer.alloc(fileSize - offset);
        await fh.read(buf, 0, buf.length, offset);
        const text = buf.toString("utf-8");
        const lines = text.split("\n").filter((l) => l.trim().length > 0);
        return { data: lines, newOffset: fileSize };
      } finally {
        await fh.close();
      }
    } catch {
      return { data: [], newOffset: offset };
    }
  }

  private processEntry(entry: ATFEntry, options: WatchOptions): void {
    // Update context
    this.recentEntries.push(entry);
    const now = new Date(entry.ts).getTime();
    const oneHourAgo = now - 3_600_000;
    this.recentEntries = this.recentEntries.filter(
      (e) => new Date(e.ts).getTime() >= oneHourAgo,
    );

    // Run rules engine
    const context = {
      sessionHistory: this.recentEntries.filter((e) => e.session === entry.session),
      recentEntries: this.recentEntries,
      knownTargets: new Set(this.knownTargets),
      config: this.engine.getConfig(),
    };

    const matches = this.engine.evaluate(entry, context);
    this.knownTargets.add(entry.action.target);

    // Apply filters
    if (options.riskOnly && matches.length === 0) return;

    if (options.categories && options.categories.length > 0) {
      const enabledRules = this.engine.getAllRules();
      const categoryRuleIds = new Set(
        enabledRules
          .filter((r) => options.categories!.includes(r.category))
          .map((r) => r.id),
      );
      const relevantMatches = matches.filter((m) => categoryRuleIds.has(m.ruleId));
      if (options.riskOnly && relevantMatches.length === 0) return;
    }

    if (options.minSeverity) {
      const severityRank: Record<string, number> = {
        critical: 0,
        high: 1,
        medium: 2,
        low: 3,
      };
      const minRank = severityRank[options.minSeverity] ?? 3;
      const hasMatch = matches.some(
        (m) => (severityRank[m.severity] ?? 3) <= minRank,
      );
      if (options.riskOnly && !hasMatch) return;
    }

    // Update summary
    this.summary.entriesSeen++;
    if (matches.length > 0) {
      this.summary.rulesTriggered += matches.length;
      for (const m of matches) {
        if (m.severity === "critical") this.summary.bySeverity.critical++;
        else if (m.severity === "high") this.summary.bySeverity.high++;
        else if (m.severity === "medium") this.summary.bySeverity.medium++;
        else this.summary.bySeverity.low++;
      }
    }

    // Emit event
    if (this.callback) {
      this.callback({
        type: "entry",
        entry,
        ruleMatches: matches,
      });
    }
  }

  private processClaim(claim: ClaimEntry): void {
    this.summary.claimsSeen++;
    if (this.callback) {
      this.callback({
        type: "claim",
        claim,
        ruleMatches: [],
      });
    }
  }
}
