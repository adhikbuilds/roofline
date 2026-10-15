/** Numbered SQL migrations, checksummed. `pnpm db:migrate` */
import { withAdmin, close, isPooledEndpoint, isRemote, describeTarget } from './client.js';
import { runMigrations } from './migrator.js';

async function main(): Promise<void> {
  if (isPooledEndpoint) {
    throw new Error(
      `Refusing to migrate through a pooled endpoint (${describeTarget()}). Use the direct connection string.`,
    );
  }
  console.log(`\n  target: ${describeTarget()}${isRemote ? '  \x1b[33m(remote)\x1b[0m' : ''}\n`);
  await withAdmin((client) => runMigrations(client, { log: (l) => console.log(l) }));
}

main()
  .catch((error: unknown) => {
    console.error(`\nMigration failed: ${(error as Error).message}`);
    process.exitCode = 1;
  })
  .finally(close);
