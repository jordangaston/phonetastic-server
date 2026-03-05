import { pgTable, serial, integer, text, timestamp } from 'drizzle-orm/pg-core';
import { callTranscripts } from './call-transcripts';
import { endUsers } from './end-users';
import { bots } from './bots';
import { users } from './users';

export const callTranscriptEntries = pgTable('call_transcript_entries', {
  id: serial('id').primaryKey(),
  transcriptId: integer('transcript_id').notNull().references(() => callTranscripts.id),
  text: text('text').notNull(),
  endUserId: integer('end_user_id').references(() => endUsers.id),
  botId: integer('bot_id').references(() => bots.id),
  userId: integer('user_id').references(() => users.id),
  sequenceNumber: integer('sequence_number').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
