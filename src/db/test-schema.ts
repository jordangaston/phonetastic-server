import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type postgres from 'postgres';

const TEST_SCHEMA = 'test';
const MIGRATIONS_DIR = './drizzle';
const STATEMENT_SEPARATOR = '--> statement-breakpoint';

interface PgError {
  code?: string;
}

/** PG error codes that are safe to ignore in idempotent migration replay. */
const IGNORABLE_CODES: Record<string, RegExp> = {
  /** 42704 — undefined object (e.g. DROP CONSTRAINT on missing constraint). */
  '42704': /DROP /i,
  /** 42703 — undefined column (e.g. DROP COLUMN on missing column). */
  '42703': /DROP /i,
  /** 42701 — duplicate column (e.g. ADD COLUMN that already exists). */
  '42701': /ADD /i,
  /** 42710 — duplicate object (e.g. ADD CONSTRAINT that already exists). */
  '42710': /ADD /i,
  /** 42P07 — duplicate table (e.g. CREATE TABLE that already exists). */
  '42P07': /CREATE /i,
};

/**
 * Returns true when a migration statement failure is safe to skip.
 *
 * @param err - The PostgreSQL error.
 * @param sql - The SQL statement that triggered the error.
 * @returns Whether the error is idempotent and safe to ignore.
 */
function isIdempotentMigrationError(err: PgError, sql: string): boolean {
  const pattern = err.code ? IGNORABLE_CODES[err.code] : undefined;
  return pattern !== undefined && pattern.test(sql);
}

/**
 * Reads the Drizzle migration journal and returns migration tags in order.
 *
 * @returns Ordered list of migration tags from the journal.
 */
function readMigrationTags(): string[] {
  const journalPath = join(MIGRATIONS_DIR, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf-8'));
  return journal.entries.map((e: { tag: string }) => e.tag);
}

/**
 * Replaces all "public" schema references in migration SQL with the test schema.
 *
 * @param sql - Raw migration SQL.
 * @returns SQL with schema references rewritten to the test schema.
 */
function rewriteSchema(sql: string): string {
  return sql.replaceAll('"public"', `"${TEST_SCHEMA}"`);
}

/**
 * Drops and recreates the "test" PostgreSQL schema, then runs all Drizzle
 * migrations inside it. Extension types (e.g. pgvector) are resolved from
 * the public schema via the search_path.
 *
 * @precondition The database must exist with pgvector enabled in the public schema.
 * @postcondition The "test" schema exists with all tables fully migrated.
 * @param client - An active postgres.js client connection.
 */
export async function migrateTestSchema(
  client: postgres.Sql,
): Promise<void> {
  await client.unsafe(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
  await client.unsafe(`CREATE SCHEMA ${TEST_SCHEMA}`);
  await client.unsafe(`SET search_path TO ${TEST_SCHEMA}, public`);

  const tags = readMigrationTags();

  for (const tag of tags) {
    const filePath = join(MIGRATIONS_DIR, `${tag}.sql`);
    const raw = readFileSync(filePath, 'utf-8');
    const statements = rewriteSchema(raw).split(STATEMENT_SEPARATOR);

    for (const stmt of statements) {
      const trimmed = stmt.trim();
      if (trimmed) {
        try {
          await client.unsafe(trimmed);
        } catch (err: unknown) {
          if (isIdempotentMigrationError(err as PgError, trimmed)) {
            continue;
          }
          throw err;
        }
      }
    }
  }
}
