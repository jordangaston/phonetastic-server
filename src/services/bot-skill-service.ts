import { injectable, inject } from 'tsyringe';
import { BotSkillRepository } from '../repositories/bot-skill-repository.js';
import type { Transaction } from '../db/index.js';

/**
 * Business logic layer for bot skills.
 */
@injectable()
export class BotSkillService {
  constructor(
    @inject('BotSkillRepository') private botSkillRepo: BotSkillRepository,
  ) {}

  /**
   * Assigns a skill to a bot.
   *
   * @precondition The skill and bot must exist.
   * @postcondition A new bot_skill row is persisted.
   * @param data - The assignment data.
   * @param tx - Optional transaction to run within.
   * @returns The created bot skill row.
   */
  async assign(
    data: { botId: number; skillId: number; isEnabled?: boolean },
    tx?: Transaction,
  ) {
    return this.botSkillRepo.create(data, tx);
  }

  /**
   * Returns all skills assigned to a bot with skill details.
   *
   * @param botId - The bot id.
   * @param tx - Optional transaction to run within.
   * @returns Array of bot skill rows with skill data.
   */
  async findByBotId(botId: number, tx?: Transaction) {
    return this.botSkillRepo.findByBotId(botId, tx);
  }

  /**
   * Returns enabled skills for a bot with skill details.
   *
   * @param botId - The bot id.
   * @param tx - Optional transaction to run within.
   * @returns Array of enabled bot skill rows with skill data.
   */
  async findEnabledByBotId(botId: number, tx?: Transaction) {
    return this.botSkillRepo.findEnabledByBotId(botId, tx);
  }

  /**
   * Updates the enabled state of a bot skill.
   *
   * @param id - The bot skill id.
   * @param isEnabled - The new enabled state.
   * @param tx - Optional transaction to run within.
   * @returns The updated bot skill row or undefined.
   */
  async updateEnabled(id: number, isEnabled: boolean, tx?: Transaction) {
    return this.botSkillRepo.updateEnabled(id, isEnabled, tx);
  }
}
