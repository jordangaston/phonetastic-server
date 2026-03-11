import { llm } from '@livekit/agents';
import { container } from '../config/container.js';
import type { BotSkillRepository } from '../repositories/bot-skill-repository.js';
import { toolRegistry, type ToolContext } from './tool-registry.js';

/**
 * Creates a tool that dynamically loads one or more tool definitions into the
 * agent's active tools at runtime.
 *
 * When invoked, the tool validates each requested tool name against the bot's
 * enabled skills' `allowed_tools` lists. Only tools that appear in at least one
 * enabled skill and exist in the tool registry are loaded.
 *
 * @precondition The bot must have skills with `allowed_tools` configured.
 * @postcondition Matching tools are added to the `tools` record and become
 *   available for the agent to invoke on subsequent turns.
 * @param botId - The bot whose skills determine tool access.
 * @param toolContext - Context needed to construct tools (companyId, userId, botId).
 * @param tools - The mutable tools record the agent reads from.
 * @returns An LLM tool the agent can invoke to load tools by name.
 */
export function createLoadToolTool(
  botId: number,
  toolContext: ToolContext,
  tools: Record<string, unknown>,
) {
  return llm.tool({
    description:
      'Loads one or more tools by name into the active tool set. ' +
      'Use this when a skill specifies allowed_tools that are not yet available.',
    parameters: {
      type: 'object',
      properties: {
        tool_names: {
          type: 'array',
          items: { type: 'string' },
          description: 'Names of the tools to load.',
        },
      },
      required: ['tool_names'],
    },
    execute: async (params: { tool_names: string[] }) => {
      const botSkillRepo = container.resolve<BotSkillRepository>('BotSkillRepository');
      const rows = await botSkillRepo.findEnabledByBotId(botId);

      const allowedSet = new Set(rows.flatMap((r) => r.skill.allowedTools));

      const loaded: string[] = [];
      const skipped: string[] = [];

      for (const name of params.tool_names) {
        if (!allowedSet.has(name)) {
          skipped.push(name);
          continue;
        }
        const factory = toolRegistry[name];
        if (!factory) {
          skipped.push(name);
          continue;
        }
        tools[name] = factory(toolContext);
        loaded.push(name);
      }

      return { loaded, skipped };
    },
  });
}
