import { sql } from 'drizzle-orm';
import type { Database } from '../../src/db/index.js';
import { voiceFactory } from '../factories/index.js';

/**
 * Truncates all application tables in the correct order to respect FK constraints,
 * then seeds the default voice required by user creation.
 *
 * @param db - The Drizzle database instance.
 */
export async function cleanDatabase(db: Database): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE
      attachments,
      emails,
      chats,
      email_addresses,
      calendars,
      call_transcript_entries,
      call_transcripts,
      call_participants,
      call_settings,
      calls,
      bot_skills,
      bot_settings,
      bots,
      sms_messages,
      end_users,
      voices,
      users,
      phone_numbers,
      skills,
      companies
    CASCADE
  `);

  await voiceFactory.create({ name: 'alloy', snippet: '', snippetMimeType: 'audio/mp3' });
}
