import 'dotenv/config';
import postgres from 'postgres';
import { buildDbUrl } from './index.js';
import { migrateTestSchema } from './test-schema.js';

async function run(): Promise<void> {
  const client = postgres(buildDbUrl(), { max: 1 });
  await migrateTestSchema(client);
  await client.end();
  console.log('Test schema migrated successfully.');
}

run().catch(console.error);
