import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Options } from 'postgres';
import { env } from '../config/env.js';
import * as schema from './schema/index.js';

/**
 * Options for creating a database client.
 *
 * @param connectionString - Optional override for the database URL.
 * @param searchPath - Optional PostgreSQL search_path (e.g. "test").
 * @param postgresOptions - Optional additional postgres.js driver options.
 */
export interface CreateDbOptions {
  connectionString?: string;
  searchPath?: string;
  postgresOptions?: Options<Record<string, never>>;
}

/**
 * Creates a Drizzle ORM database client.
 *
 * @param options - Optional configuration for the database connection.
 * @param options.connectionString - Override for the database URL.
 * @param options.searchPath - PostgreSQL search_path to use (e.g. "test").
 * @param options.postgresOptions - Additional postgres.js driver options.
 * @returns A configured Drizzle database instance with schema bindings.
 */
export function createDb(options?: CreateDbOptions) {
  const url = options?.connectionString ?? buildDbUrl();
  const driverOptions: Options<Record<string, never>> = {
    ...options?.postgresOptions,
  };

  if (options?.searchPath) {
    driverOptions.connection = {
      ...driverOptions.connection,
      search_path: options.searchPath,
    };
  }

  const client = postgres(url, driverOptions);
  return drizzle(client, { schema });
}

export function buildDbUrl(): string {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const { DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, DB_DATABASE } = env;
  const auth = DB_PASSWORD ? `${DB_USER}:${DB_PASSWORD}` : DB_USER;
  return `postgresql://${auth}@${DB_HOST}:${DB_PORT}/${DB_DATABASE}`;
}

export function buildDirectDbUrl(): string {
  if (env.DIRECT_DATABASE_URL) return env.DIRECT_DATABASE_URL;
  return buildDbUrl();
}

export type Database = ReturnType<typeof createDb>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
