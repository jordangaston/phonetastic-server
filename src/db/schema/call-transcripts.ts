import { pgTable, serial, integer, text, timestamp } from 'drizzle-orm/pg-core';
import { calls } from './calls';

export const callTranscripts = pgTable('call_transcripts', {
  id: serial('id').primaryKey(),
  callId: integer('call_id').notNull().references(() => calls.id),
  transcript: text('transcript').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
