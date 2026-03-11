import { injectable, inject } from 'tsyringe';
import { eq, gt, asc } from 'drizzle-orm';
import { skills } from '../db/schema/skills.js';
import type { Database, Transaction } from '../db/index.js';

const DEFAULT_PAGE_SIZE = 20;

/**
 * Data access layer for skills.
 */
@injectable()
export class SkillRepository {
  constructor(@inject('Database') private db: Database) {}

  /**
   * Creates a new skill.
   *
   * @precondition `data.name`, `data.description`, and `data.instructions` must be non-empty.
   * @postcondition A new skill row is persisted.
   * @param data - The skill data to insert.
   * @param data.name - The unique skill name.
   * @param data.allowedTools - Tool names this skill grants access to.
   * @param data.description - Human-readable description.
   * @param data.instructions - Instructions injected into the system prompt.
   * @param tx - Optional transaction to run within.
   * @returns The inserted skill row.
   */
  async create(
    data: { name: string; allowedTools: string[]; description: string; instructions: string },
    tx?: Transaction,
  ) {
    const [row] = await (tx ?? this.db).insert(skills).values(data).returning();
    return row;
  }

  /**
   * Finds a skill by id.
   *
   * @param id - The skill id.
   * @param tx - Optional transaction to run within.
   * @returns The skill row or undefined.
   */
  async findById(id: number, tx?: Transaction) {
    const [row] = await (tx ?? this.db)
      .select()
      .from(skills)
      .where(eq(skills.id, id));
    return row;
  }

  /**
   * Returns a page of skills using cursor-based pagination.
   *
   * @param opts - Pagination options.
   * @param opts.pageToken - Skill id to start after (exclusive). Omit for the first page.
   * @param opts.limit - Maximum number of rows to return. Defaults to 20.
   * @param tx - Optional transaction to run within.
   * @returns Array of skill rows ordered by id ascending.
   */
  async findAll(opts?: { pageToken?: number; limit?: number }, tx?: Transaction) {
    const limit = opts?.limit ?? DEFAULT_PAGE_SIZE;
    return (tx ?? this.db)
      .select()
      .from(skills)
      .where(opts?.pageToken ? gt(skills.id, opts.pageToken) : undefined)
      .orderBy(asc(skills.id))
      .limit(limit);
  }
}
