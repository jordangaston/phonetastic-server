import { injectable, inject } from 'tsyringe';
import { SkillRepository } from '../repositories/skill-repository.js';
import type { Transaction } from '../db/index.js';

/**
 * Business logic layer for skills.
 */
@injectable()
export class SkillService {
  constructor(
    @inject('SkillRepository') private skillRepo: SkillRepository,
  ) {}

  /**
   * Creates a new skill.
   *
   * @precondition `data.name`, `data.description`, and `data.instructions` must be non-empty.
   * @postcondition A new skill row is persisted.
   * @param data - The skill data.
   * @param tx - Optional transaction to run within.
   * @returns The created skill row.
   */
  async create(
    data: { name: string; allowedTools: string[]; description: string; instructions: string },
    tx?: Transaction,
  ) {
    return this.skillRepo.create(data, tx);
  }

  /**
   * Finds a skill by id.
   *
   * @param id - The skill id.
   * @param tx - Optional transaction to run within.
   * @returns The skill row or undefined.
   */
  async findById(id: number, tx?: Transaction) {
    return this.skillRepo.findById(id, tx);
  }

  /**
   * Returns a paginated list of skills.
   *
   * @param opts - Pagination options.
   * @param opts.pageToken - Skill id to start after (exclusive).
   * @param opts.limit - Maximum number of rows to return.
   * @param tx - Optional transaction to run within.
   * @returns Array of skill rows.
   */
  async findAll(opts?: { pageToken?: number; limit?: number }, tx?: Transaction) {
    return this.skillRepo.findAll(opts, tx);
  }
}
