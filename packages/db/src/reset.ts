/** Drop and recreate the public and seed_truth schemas. Local development only. `pnpm db:reset` */
import { withAdmin, close, isLocalUrl } from './client.js';

const url = process.env['DATABASE_URL'] ?? '';
const isLocal = isLocalUrl(url);

async function main(): Promise<void> {
  if (!isLocal) {
    throw new Error(
      `Refusing to reset a non-local database.\n  DATABASE_URL points at: ${url.replace(/\/\/[^@]*@/, '//***:***@')}`,
    );
  }
  await withAdmin(async (client) => {
    await client.query('DROP SCHEMA IF EXISTS seed_truth CASCADE');
    await client.query('DROP SCHEMA public CASCADE');
    await client.query('CREATE SCHEMA public');
    console.log('Schemas dropped and recreated. Run `pnpm db:migrate` next.');
  });
}

main()
  .catch((error: unknown) => {
    console.error(`\n${(error as Error).message}`);
    process.exitCode = 1;
  })
  .finally(close);
