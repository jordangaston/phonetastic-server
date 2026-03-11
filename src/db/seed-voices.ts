import { readFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { voices } from './schema/index.js';
import { env } from '../config/env.js';

const VOICES_DIR = join(process.cwd(), 'src/config/voices');
const SNIPPET_MIME_TYPE = 'audio/wav';

const EXTERNAL_IDS: Record<string, string> = {
  Darren:   '8d110413-2f14-44a2-8203-2104db4340e9',
  Brooke:   'e07c00bc-4134-4eae-9ea4-1a55fb45746b',
  Caroline: 'f9836c6e-a0bd-460e-9d3c-f7299fa60f94',
  Cathy:    'e8e5fffb-252c-436d-b842-8879b84445b6',
  Jameson:  'a5136bf9-224c-4d76-b823-52bd5efcffcc',
  Katie:    'f786b574-daa5-4673-aa0c-cbe3e8534c02',
  Oliver:   'ee7ea9f8-c0c1-498c-9279-764d6b56d189',
  Pedro:    '15d0c2e2-8d29-44c3-be23-d585d5f154a1',
  Riya:     'faf0731e-dfb9-4cfc-8119-259a79b27e12',
  Ronald:   '5ee9feff-1265-424a-9d7f-8e4d431a12c7',
};

function nameFromFilename(filename: string): string {
  const stem = basename(filename, '.wav').replace('-preview', '');
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

async function seedVoices() {
  const { DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, DB_DATABASE } = env;
  const auth = DB_PASSWORD ? `${DB_USER}:${DB_PASSWORD}` : DB_USER;
  const client = postgres(`postgresql://${auth}@${DB_HOST}:${DB_PORT}/${DB_DATABASE}`, { max: 1 });
  const db = drizzle(client);

  const files = readdirSync(VOICES_DIR).filter(f => f.endsWith('.wav'));

  const existing = await db.select({ id: voices.id, name: voices.name }).from(voices);
  const existingByName = new Map(existing.map(v => [v.name, v.id]));

  const toInsert = files
    .filter(f => !existingByName.has(nameFromFilename(f)))
    .map(file => ({
      name: nameFromFilename(file),
      snippet: readFileSync(join(VOICES_DIR, file)),
      snippetMimeType: SNIPPET_MIME_TYPE,
      externalId: EXTERNAL_IDS[nameFromFilename(file)],
    }));

  if (toInsert.length > 0) {
    await db.insert(voices).values(toInsert);
    console.log(`Inserted ${toInsert.length} voice(s): ${toInsert.map(v => v.name).join(', ')}`);
  }

  const toUpdate = existing.filter(v => EXTERNAL_IDS[v.name]);
  for (const voice of toUpdate) {
    await db.update(voices).set({ externalId: EXTERNAL_IDS[voice.name] }).where(eq(voices.id, voice.id));
  }

  if (toUpdate.length > 0) {
    console.log(`Updated external_id for ${toUpdate.length} voice(s): ${toUpdate.map(v => v.name).join(', ')}`);
  }

  if (toInsert.length === 0 && toUpdate.length === 0) {
    console.log('Voices are up to date.');
  }

  await client.end();
}

seedVoices().catch(console.error);
