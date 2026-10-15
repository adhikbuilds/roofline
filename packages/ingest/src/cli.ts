import { Command, InvalidArgumentError } from 'commander';

export interface CliDeps {
  seed(log: (m: string) => void): Promise<void>;
  run(week: number, log: (m: string) => void, opts?: { full?: boolean }): Promise<void>;
  evalQuality(): Promise<{ ok: boolean; lines: string[] }>;
  evalDedup(): Promise<{ ok: boolean; lines: string[] }>;
  /** Stages 6-7: fit both models, pick the active one, write estimates and deals. */
  modelFit(opts: { asOf?: string; windowDays?: number }, log: (m: string) => void): Promise<void>;
  evalFairRent(): Promise<{ ok: boolean; lines: string[] }>;
  evalDeals(): Promise<{ ok: boolean; lines: string[] }>;
}

const WEEKS = 26;

const SOURCES = ['synthetic'] as const;

/** `--as-of YYYY-MM-DD` must land exactly on one of the 26 weekly as-of dates; returns the week index. */
export function weekFromAsOf(v: string, weekAsOf: (w: number) => Date): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new InvalidArgumentError('as-of must be YYYY-MM-DD');
  for (let w = 0; w < WEEKS; w++) if (weekAsOf(w).toISOString().slice(0, 10) === v) return w;
  throw new InvalidArgumentError(`as-of ${v} is not one of the ${WEEKS} weekly synthetic dates (${weekAsOf(0).toISOString().slice(0, 10)} + 7n days)`);
}

function parseWeek(v: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n >= WEEKS) throw new InvalidArgumentError(`week must be an integer 0-${WEEKS - 1}`);
  return n;
}

/** Heavy modules (pg pool, generator) load lazily so `--help` and the tests need no database. */
const defaultDeps: CliDeps = {
  async seed(log) {
    const { withAdmin, close } = await import('@roofline/db');
    const { loadReference } = await import('@roofline/db/load-reference');
    const { seedSynthetic } = await import('./seed');
    try {
      await withAdmin(async (client) => {
        const counts = await loadReference(client);
        log(`reference: ${counts.localities} localities, ${counts.aliases} aliases, ${counts.sources} sources`);
        const out = await seedSynthetic(client, log);
        log(`seeded ${out.runs} ingest runs over ${out.weeks} weeks (${out.rows} source rows, ${out.units} units)`);
        // stages 6-7 on the final week, so a fresh database already carries fair rents and deals
        const { runModelStages } = await import('./pipeline/fairrent');
        const { engineModels } = await import('./pipeline/models');
        await runModelStages(client, { models: engineModels(), log });
      });
    } finally {
      await close();
    }
  },
  async modelFit(opts, log) {
    const { withAdmin, close } = await import('@roofline/db');
    const { runModelStages } = await import('./pipeline/fairrent');
    const { engineModels } = await import('./pipeline/models');
    try {
      await withAdmin((client) =>
        runModelStages(client, { models: engineModels(), asOf: opts.asOf ? new Date(`${opts.asOf}T00:00:00Z`) : undefined, windowDays: opts.windowDays, log }),
      );
    } finally {
      await close();
    }
  },
  async evalFairRent() {
    const { withAdmin, close } = await import('@roofline/db');
    const { evalFairRent } = await import('./eval/fairrent-eval');
    try {
      return await withAdmin((client) => evalFairRent(client));
    } finally {
      await close();
    }
  },
  async evalDeals() {
    const { withAdmin, close } = await import('@roofline/db');
    const { evalDeals } = await import('./eval/deals-eval');
    try {
      return await withAdmin((client) => evalDeals(client));
    } finally {
      await close();
    }
  },
  async run(week, log, opts = {}) {
    const { withAdmin, close } = await import('@roofline/db');
    const { createSyntheticAdapters, generateSeed, weekAsOf } = await import('./adapters/synthetic');
    const { loadSeedRefs } = await import('./seed');
    const { runWeek } = await import('./pipeline');
    try {
      await withAdmin(async (client) => {
        const { refs } = await loadSeedRefs(client);
        const adapters = createSyntheticAdapters(generateSeed(refs));
        await runWeek(client, adapters, weekAsOf(week), { log, full: opts.full });
      });
    } finally {
      await close();
    }
  },
  async evalDedup() {
    const { withAdmin, close } = await import('@roofline/db');
    const { evalDedup } = await import('./eval/dedup-eval');
    try {
      return await withAdmin((client) => evalDedup(client));
    } finally {
      await close();
    }
  },
  async evalQuality() {
    const { withAdmin, close } = await import('@roofline/db');
    const { evalQuality } = await import('./eval/quality');
    try {
      return await withAdmin((client) => evalQuality(client));
    } finally {
      await close();
    }
  },
};

export function buildProgram(log: (msg: string) => void = (m) => console.log(m), deps: CliDeps = defaultDeps): Command {
  const program = new Command();
  program.name('roofline-ingest').description('Roofline ingestion CLI').exitOverride();

  program
    .command('run')
    .description('Ingest one synthetic week through the pipeline (stages 1-5)')
    .option('--source <id>', `source to ingest (${SOURCES.join(', ')})`, 'synthetic')
    .option('--week <n>', `week index 0-${WEEKS - 1}`, parseWeek)
    .option('--as-of <date>', 'weekly as-of date, YYYY-MM-DD (alternative to --week)')
    .option('--full', 'rescore every block and re-assign identities against all listings', false)
    .action(async (opts: { source: string; week?: number; asOf?: string; full: boolean }) => {
      if (!(SOURCES as readonly string[]).includes(opts.source)) throw new InvalidArgumentError(`unknown source ${opts.source}`);
      if (opts.week !== undefined && opts.asOf !== undefined) throw new InvalidArgumentError('pass either --week or --as-of, not both');
      let week = opts.week ?? 0;
      if (opts.asOf !== undefined) {
        const { weekAsOf } = await import('./adapters/synthetic/params');
        week = weekFromAsOf(opts.asOf, weekAsOf);
      }
      await deps.run(week, log, { full: opts.full });
    });

  program
    .command('seed')
    .description('Load reference data and the synthetic Bangalore seed (26 weekly runs)')
    .action(async () => deps.seed(log));

  const model = program.command('model').description('Fair-rent models (pipeline stages 6-7)');
  model
    .command('fit')
    .description('Fit both models with 5-fold CV, choose the active one, write estimates and deals')
    .option('--as-of <date>', 'fit as of this date, YYYY-MM-DD (default: latest ingest run)')
    .option('--window-days <n>', 'only fit listings first seen within n days of as-of', (v: string) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError('window-days must be a positive integer');
      return n;
    })
    .action(async (opts: { asOf?: string; windowDays?: number }) => {
      if (opts.asOf !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(opts.asOf)) throw new InvalidArgumentError('as-of must be YYYY-MM-DD');
      await deps.modelFit(opts, log);
    });

  const ev = program.command('eval').description('Run ingestion evals');
  ev.command('quality')
    .description('planted_rejects / matched / extra_rejects against seed_truth')
    .action(async () => {
      const res = await deps.evalQuality();
      for (const line of res.lines) log(line);
      if (!res.ok) process.exitCode = 1;
    });
  ev.command('dedup')
    .description('pairwise P/R, B-cubed F1, hard_negative_merges and blocking_recall against seed_truth')
    .action(async () => {
      const res = await deps.evalDedup();
      for (const line of res.lines) log(line);
      if (!res.ok) process.exitCode = 1;
    });
  ev.command('fairrent')
    .description('active model mdape vs truth and interval coverage; both models printed')
    .action(async () => {
      const res = await deps.evalFairRent();
      for (const line of res.lines) log(line);
      if (!res.ok) process.exitCode = 1;
    });
  ev.command('deals')
    .description('deal precision / recall vs seed_truth.true_deals and the too_good guard')
    .action(async () => {
      const res = await deps.evalDeals();
      for (const line of res.lines) log(line);
      if (!res.ok) process.exitCode = 1;
    });
  return program;
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  try {
    await buildProgram().parseAsync(process.argv);
  } catch (err) {
    const code = (err as { exitCode?: number }).exitCode;
    process.exit(typeof code === 'number' ? code : 1);
  }
}
