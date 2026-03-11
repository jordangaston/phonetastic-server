import { customType, pgTable, serial, varchar, text } from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export const voices = pgTable('voices', {
  id: serial('id').primaryKey(),
  supportedLanguages: text('supported_languages').array().notNull().default(['en']),
  name: varchar('name', { length: 255 }).notNull(),
  snippet: bytea('snippet').notNull(),
  snippetMimeType: varchar('snippet_mime_type', { length: 255 }).notNull(),
  externalId: varchar('external_id', { length: 255 }).notNull()
});
