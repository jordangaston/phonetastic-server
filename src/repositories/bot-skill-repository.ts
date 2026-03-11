import { injectable, inject } from 'tsyringe';
import { eq, and } from 'drizzle-orm';
import { botSkills } from '../db/schema/bot-skills.js';
import { skills } from '../db/schema/skills.js';
import type { Database, Transaction } from '../db/index.js';

/**
 * Data access layer for bot skills.
 */
@injectable()
export class BotSkillRepository {
  constructor(@inject('Database') private db: Database) {}

  /**
   * Assigns a skill to a bot.
   *
   * @precondition The skill and bot must exist.
   * @postcondition A new bot_skill row is persisted.
   * @param data - The bot skill data.
   * @param data.botId - The bot id.
   * @param data.skillId - The skill id.
   * @param data.isEnabled - Whether the skill is enabled. Defaults to false.
   * @param tx - Optional transaction to run within.
   * @returns The inserted bot skill row.
   */
  async create(
    data: { botId: number; skillId: number; isEnabled?: boolean },
    tx?: Transaction,
  ) {
    const [row] = await (tx ?? this.db).insert(botSkills).values(data).returning();
    return row;
  }

  /**
   * Finds all skills assigned to a bot, joined with skill details.
   *
   * @param botId - The bot id.
   * @param tx - Optional transaction to run within.
   * @returns Array of bot skill rows with joined skill data.
   */
  async findByBotId(botId: number, tx?: Transaction) {
    return (tx ?? this.db)
      .select({ botSkill: botSkills, skill: skills })
      .from(botSkills)
      .innerJoin(skills, eq(botSkills.skillId, skills.id))
      .where(eq(botSkills.botId, botId));
  }

  /**
   * Finds enabled skills for a bot, joined with skill details.
   *
   * @param botId - The bot id.
   * @param tx - Optional transaction to run within.
   * @returns Array of enabled bot skill rows with joined skill data.
   */
  async findEnabledByBotId(botId: number, tx?: Transaction) {
    return (tx ?? this.db)
      .select({ botSkill: botSkills, skill: skills })
      .from(botSkills)
      .innerJoin(skills, eq(botSkills.skillId, skills.id))
      .where(and(eq(botSkills.botId, botId), eq(botSkills.isEnabled, true)));
  }

  /**
   * Finds an enabled bot skill by bot id and skill name.
   *
   * @precondition The skill name must exist in the `skills` table.
   * @param botId - The bot id.
   * @param skillName - The skill name.
   * @param tx - Optional transaction to run within.
   * @returns The bot skill row if enabled, or undefined.
   */
  async findEnabledByBotIdAndSkillName(
    botId: number,
    skillName: string,
    tx?: Transaction,
  ) {
    const [row] = await (tx ?? this.db)
      .select({ botSkill: botSkills })
      .from(botSkills)
      .innerJoin(skills, eq(botSkills.skillId, skills.id))
      .where(
        and(
          eq(botSkills.botId, botId),
          eq(skills.name, skillName),
          eq(botSkills.isEnabled, true),
        ),
      );
    return row?.botSkill;
  }

  /**
   * Updates the is_enabled flag for a bot skill.
   *
   * @param id - The bot skill id.
   * @param isEnabled - The new enabled state.
   * @param tx - Optional transaction to run within.
   * @returns The updated bot skill row or undefined.
   */
  async updateEnabled(id: number, isEnabled: boolean, tx?: Transaction) {
    const [row] = await (tx ?? this.db)
      .update(botSkills)
      .set({ isEnabled })
      .where(eq(botSkills.id, id))
      .returning();
    return row;
  }
}
