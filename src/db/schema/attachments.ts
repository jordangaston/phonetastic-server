import { pgTable, serial, integer, varchar, text, timestamp } from 'drizzle-orm/pg-core';
import { attachmentStatusEnum } from './enums';
import { emails } from './emails';

export const attachments = pgTable('attachments', {
  id: serial('id').primaryKey(),
  emailId: integer('email_id').notNull().references(() => emails.id),
  externalAttachmentId: varchar('external_attachment_id', { length: 255 }),
  filename: varchar('filename', { length: 512 }).notNull(),
  contentType: varchar('content_type', { length: 255 }).notNull(),
  sizeBytes: integer('size_bytes'),
  storageKey: varchar('storage_key', { length: 1024 }),
  status: attachmentStatusEnum('status').notNull().default('pending'),
  summary: text('summary'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
