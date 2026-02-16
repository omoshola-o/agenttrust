import { icons } from "../formatters/color.js";

/**
 * Supported time-range units for CLI commands.
 *
 * - `m` — minutes
 * - `h` — hours
 * - `d` — days
 * - `w` — weeks
 */
const DURATION_PATTERN = /^(\d+)([mhdw])$/;

export interface ParsedDuration {
  /** Timestamp (epoch ms) that represents the start of the window */
  cutoff: number;
  /** Whether the input was valid */
  valid: boolean;
}

/**
 * Parse a human-readable duration string into an epoch-ms cutoff.
 *
 * Valid formats: `30m`, `1h`, `24h`, `7d`, `4w`.
 *
 * If the input is invalid, a warning is printed to stderr and
 * the function falls back to 24h.
 */
export function parseDuration(dur: string): ParsedDuration {
  const now = Date.now();
  const match = DURATION_PATTERN.exec(dur);

  if (!match) {
    console.error(
      `${icons.warn} Invalid duration "${dur}". Valid formats: <number>m|h|d|w (e.g. 30m, 24h, 7d, 4w). Defaulting to 24h.`,
    );
    return { cutoff: now - 24 * 60 * 60 * 1000, valid: false };
  }

  const val = parseInt(match[1]!, 10);
  const unit = match[2]!;

  let ms: number;
  switch (unit) {
    case "m":
      ms = val * 60 * 1000;
      break;
    case "h":
      ms = val * 60 * 60 * 1000;
      break;
    case "d":
      ms = val * 24 * 60 * 60 * 1000;
      break;
    case "w":
      ms = val * 7 * 24 * 60 * 60 * 1000;
      break;
    default:
      ms = 24 * 60 * 60 * 1000;
      break;
  }

  return { cutoff: now - ms, valid: true };
}
