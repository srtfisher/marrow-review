import type { PullFilter } from '../core/github/types.js';
import { EFFORTS, type Effort } from '../core/review/rubric.js';
import type { SourceRequest } from '../core/source/index.js';

export interface CliArgs {
  prNumber: number | null;
  /** Set when the pull request was named by URL or `owner/repo#n`, which may be another repository. */
  prRepo: { owner: string; repo: string } | null;
  model: string;
  meatModel: string;
  dryRun: boolean;
  useApiKey: boolean;
  showHelp: boolean;
  filter: PullFilter;
  source: SourceRequest;
  effort: Effort;
  standards: string | null;
  port: number;
  open: boolean;
}

const TIERS = ['opus', 'sonnet', 'haiku'] as const;
const FILTERS: readonly PullFilter[] = ['open', 'review-requested', 'all'];
const SOURCES: readonly SourceRequest[] = ['auto', 'checkout', 'worktree', 'api'];

export function tierBelow(model: string): string {
  const i = TIERS.indexOf(model as (typeof TIERS)[number]);
  if (i === -1) return model;
  return TIERS[Math.min(i + 1, TIERS.length - 1)]!;
}

const PR_URL_RE = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/;
const PR_REF_RE = /^([\w.-]+)\/([\w.-]+)#(\d+)$/;

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], flag: string): T {
  if (value !== undefined && (allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`${flag} must be one of: ${allowed.join(', ')}`);
}

export function parseArgs(argv: string[]): CliArgs {
  let prNumber: number | null = null;
  let prRepo: CliArgs['prRepo'] = null;
  let model = 'opus';
  let meatModel: string | null = null;
  let dryRun = false;
  let useApiKey = false;
  let showHelp = false;
  let filter: PullFilter = 'open';
  let source: SourceRequest = 'auto';
  let effort: Effort = 'medium';
  let standards: string | null = null;
  let port = 0;
  let open = true;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;

    if (arg === '--dry-run') { dryRun = true; continue; }
    if (arg === '--use-api-key') { useApiKey = true; continue; }
    if (arg === '--help' || arg === '-h') { showHelp = true; continue; }
    if (arg === '--no-open') { open = false; continue; }

    if (arg === '--model') { model = argv[++i] ?? model; continue; }
    if (arg === '--meat-model') { meatModel = argv[++i] ?? null; continue; }
    if (arg === '--filter') { filter = oneOf(argv[++i], FILTERS, '--filter'); continue; }
    if (arg === '--source') { source = oneOf(argv[++i], SOURCES, '--source'); continue; }
    if (arg === '--effort') { effort = oneOf(argv[++i], EFFORTS, '--effort'); continue; }
    if (arg === '--standards') { standards = argv[++i] ?? null; continue; }
    if (arg === '--port') {
      const value = Number.parseInt(argv[++i] ?? '', 10);
      if (Number.isNaN(value) || value < 0 || value > 65535) throw new Error('--port must be a port number');
      port = value;
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    const ref = PR_URL_RE.exec(arg) ?? PR_REF_RE.exec(arg);
    if (ref) {
      prRepo = { owner: ref[1]!, repo: ref[2]! };
      prNumber = Number.parseInt(ref[3]!, 10);
      continue;
    }

    const asNumber = Number.parseInt(arg, 10);
    if (!Number.isNaN(asNumber)) { prNumber = asNumber; continue; }

    throw new Error(`Could not interpret argument: ${arg}`);
  }

  return {
    prNumber, prRepo, model, meatModel: meatModel ?? tierBelow(model), dryRun, useApiKey, showHelp,
    filter, source, effort, standards, port, open,
  };
}
