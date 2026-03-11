import { llm } from '@livekit/agents';
import { container } from '../config/container.js';
import type { BotSkillRepository } from '../repositories/bot-skill-repository.js';

/**
 * Creates a tool that loads a skill's instructions into the agent's system prompt.
 *
 * When invoked, the tool looks up the skill by name among the bot's enabled skills.
 * If found, it returns the skill's instructions and allowed tools so the agent
 * can incorporate them into its behaviour.
 *
 * @precondition The bot must have skills assigned and enabled.
 * @postcondition The skill instructions are returned for injection into the prompt.
 * @param botId - The bot whose skills to search.
 * @returns An LLM tool the agent can invoke to load a skill.
 */
export function createLoadSkillTool(botId: number) {
  return llm.tool({
    description:
      'Loads a skill by name, returning its instructions and allowed tools. ' +
      'Use this when you need to activate a specific capability.',
    parameters: {
      type: 'object',
      properties: {
        skill_name: {
          type: 'string',
          description: 'The name of the skill to load.',
        },
      },
      required: ['skill_name'],
    },
    execute: async (params: { skill_name: string }) => {
      const botSkillRepo = container.resolve<BotSkillRepository>('BotSkillRepository');
      const rows = await botSkillRepo.findEnabledByBotId(botId);
      const match = rows.find((r) => r.skill.name === params.skill_name);

      if (!match) {
        return { loaded: false, message: `Skill "${params.skill_name}" not found or not enabled.` };
      }

      return {
        loaded: true,
        skill: {
          name: match.skill.name,
          instructions: match.skill.instructions,
          allowed_tools: match.skill.allowedTools,
        },
      };
    },
  });
}
