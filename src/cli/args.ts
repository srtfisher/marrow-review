import type { PullFilter } from '../core/github/types.js';

export interface CliArgs {
  prNumber: number | null;
  model: string;
  meatModel: string;
  dryRun: boolean;
  useApiKey: boolean;
  showHelp: boolean;
  filter: PullFilter;
  /** Syntax colouring in the diff's code column. */
  highlight: boolean;
}

const TIERS = ['opus', 'sonnet', 'haiku'] as const;

export function tierBelow(model: string): string {
  const i = TIERS.indexOf(model as (typeof TIERS)[number]);
  if (i === -1) return model;
  return TIERS[Math.min(i + 1, TIERS.length - 1)]!;
}

const PR_URL_RE = /github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/;

export function parseArgs(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
): CliArgs {
  let prNumber: number | null = null;
  let model = 'opus';
  let meatModel: string | null = null;
  let dryRun = false;
  let useApiKey = false;
  let showHelp = false;
  let filter: PullFilter = 'open';
  // NO_COLOR is a convention marrow has no business arguing with, and a
  // terminal that cannot show colour cannot show syntax colouring either.
  let highlight = (env.NO_COLOR ?? '') === '';

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;

    if (arg === '--dry-run') { dryRun = true; continue; }
    if (arg === '--use-api-key') { useApiKey = true; continue; }
    if (arg === '--help' || arg === '-h') { showHelp = true; continue; }
    if (arg === '--no-highlight') { highlight = false; continue; }

    if (arg === '--model') { model = argv[++i] ?? model; continue; }
    if (arg === '--meat-model') { meatModel = argv[++i] ?? null; continue; }
    if (arg === '--filter') { filter = (argv[++i] ?? 'open') as PullFilter; continue; }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    const fromUrl = PR_URL_RE.exec(arg);
    if (fromUrl) { prNumber = Number.parseInt(fromUrl[1]!, 10); continue; }

    const asNumber = Number.parseInt(arg, 10);
    if (!Number.isNaN(asNumber)) { prNumber = asNumber; continue; }

    throw new Error(`Could not interpret argument: ${arg}`);
  }

  return {
    prNumber,
    model,
    meatModel: meatModel ?? tierBelow(model),
    dryRun,
    useApiKey,
    showHelp,
    filter,
    highlight,
  };
}
