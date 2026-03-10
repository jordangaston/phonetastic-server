import 'dotenv/config';
import postgres from 'postgres';
import { buildDbUrl } from '../../src/db/index.js';
import { migrateTestSchema } from '../../src/db/test-schema.js';

/**
 * Vitest global setup that creates the "test" PostgreSQL schema and
 * runs all Drizzle migrations inside it. Runs once before all test files.
 *
 * @precondition The database specified by env vars must exist with pgvector enabled.
 * @postcondition The "test" schema exists with all tables fully migrated.
 */
export async function setup(): Promise<void> {
  const client = postgres(buildDbUrl(), { max: 1 });
  await migrateTestSchema(client);
  await client.end();
}
