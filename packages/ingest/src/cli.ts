import { Command } from 'commander';

const NOT_IMPLEMENTED = 'not implemented until Phase 1';

export function buildProgram(log: (msg: string) => void = (m) => console.log(m)): Command {
  const program = new Command();
  program.name('roofline-ingest').description('Roofline ingestion CLI').exitOverride();

  for (const [name, description] of [
    ['run', 'Run the ingest pipeline for a source adapter'],
    ['seed', 'Load the synthetic Bangalore seed'],
    ['eval', 'Run ingestion evals'],
  ] as const) {
    program
      .command(name)
      .description(description)
      .action(() => log(`${name}: ${NOT_IMPLEMENTED}`));
  }
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
