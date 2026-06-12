import { injectable, inject } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { users } from '../db/schema/users.js';
import type { UserCallSettings } from '../types/user-call-settings.js';
import type { Database, Transaction } from '../db/index.js';
import type { User } from '../db/models.js';
import { UserSchema } from '../types/index.js';

/**
 * Data access layer for users.
 */
@injectable()
export class UserRepository {
  constructor(@inject('Database') private db: Database) { }

  /**
   * Persists a new user record.
   *
   * @param data - The user fields to insert.
   * @param tx - Optional transaction to run within.
   * @returns The created user row.
   */
  async create(data: {
    firstName: string;
    lastName?: string;
    jwtPrivateKey: string;
    jwtPublicKey: string;
    callSettings?: UserCallSettings;
  }, tx?: Transaction): Promise<User> {
    const [row] = await (tx ?? this.db).insert(users).values(data).returning();
    return UserSchema.parse(row);
  }

  /**
   * Finds a user by primary key.
   *
   * @param id - The user id.
   * @param tx - Optional transaction to run within.
   * @returns The user row, or undefined.
   */
  async findById(id: number, tx?: Transaction): Promise<User | undefined> {
    const [row] = await (tx ?? this.db).select().from(users).where(eq(users.id, id));
    return row ? UserSchema.parse(row) : undefined;
  }

  /**
   * Finds the first user belonging to a company.
   *
   * @param companyId - The company id.
   * @param tx - Optional transaction to run within.
   * @returns The user row, or undefined.
   */
  async findByCompanyId(companyId: number, tx?: Transaction): Promise<User | undefined> {
    const [row] = await (tx ?? this.db).select().from(users).where(eq(users.companyId, companyId));
    return row ? UserSchema.parse(row) : undefined;
  }

  /**
   * Updates a user's mutable fields.
   *
   * @param id - The user id.
   * @param data - The fields to update.
   * @param tx - Optional transaction to run within.
   * @returns The updated user row, or undefined if not found.
   */
  async update(id: number, data: { firstName?: string; lastName?: string; companyId?: number; callSettings?: UserCallSettings }, tx?: Transaction): Promise<User | undefined> {
    const [row] = await (tx ?? this.db).update(users).set(data).where(eq(users.id, id)).returning();
    return row ? UserSchema.parse(row) : undefined;
  }
}
