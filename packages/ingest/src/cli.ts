import { Command, InvalidArgumentError } from 'commander';

export interface CliDeps {
  seed(log: (m: string) => void): Promise<void>;
  run(week: number, log: (m: string) => void): Promise<void>;
  evalQuality(): Promise<{ ok: boolean; lines: string[] }>;
}

const WEEKS = 26;

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
      });
    } finally {
      await close();
    }
  },
  async run(week, log) {
    const { withAdmin, close } = await import('@roofline/db');
    const { createSyntheticAdapters, generateSeed, weekAsOf } = await import('./adapters/synthetic');
    const { loadSeedRefs } = await import('./seed');
    const { runWeek } = await import('./pipeline');
    try {
      await withAdmin(async (client) => {
        const { refs } = await loadSeedRefs(client);
        const adapters = createSyntheticAdapters(generateSeed(refs));
        await runWeek(client, adapters, weekAsOf(week), { log });
      });
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
    .description('Ingest one synthetic week through the pipeline (stages 1-4)')
    .option('--week <n>', `week index 0-${WEEKS - 1}`, parseWeek, 0)
    .action(async (opts: { week: number }) => deps.run(opts.week, log));

  program
    .command('seed')
    .description('Load reference data and the synthetic Bangalore seed (26 weekly runs)')
    .action(async () => deps.seed(log));

  const ev = program.command('eval').description('Run ingestion evals');
  ev.command('quality')
    .description('planted_rejects / matched / extra_rejects against seed_truth')
    .action(async () => {
      const res = await deps.evalQuality();
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
