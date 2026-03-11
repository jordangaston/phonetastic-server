import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockBotSkillRepo, mockContainer } = vi.hoisted(() => {
  const mockBotSkillRepo = {
    findEnabledByBotId: vi.fn(),
  };
  const mockContainer = {
    resolve: vi.fn((token: string) => {
      if (token === 'BotSkillRepository') return mockBotSkillRepo;
      return undefined;
    }),
  };
  return { mockBotSkillRepo, mockContainer };
});

vi.mock('../../../src/config/container.js', () => ({
  container: mockContainer,
}));

vi.mock('@livekit/agents', () => ({
  llm: {
    tool: vi.fn(({ execute }) => ({ execute })),
  },
}));

vi.mock('../../../src/agent-tools/company-info-tool.js', () => ({
  createCompanyInfoTool: vi.fn(() => ({ name: 'companyInfo' })),
}));

vi.mock('../../../src/agent-tools/calendar-tools.js', () => ({
  createGetAvailabilityTool: vi.fn(() => ({ name: 'getAvailability' })),
  createBookAppointmentTool: vi.fn(() => ({ name: 'bookAppointment' })),
}));

import { createLoadToolTool } from '../../../src/agent-tools/load-tool-tool.js';
import type { ToolContext } from '../../../src/agent-tools/tool-registry.js';

const toolContext: ToolContext = { companyId: 1, userId: 2, botId: 10 };

describe('createLoadToolTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockContainer.resolve.mockImplementation((token: string) => {
      if (token === 'BotSkillRepository') return mockBotSkillRepo;
      return undefined;
    });
  });

  it('loads multiple allowed tools into the tools record', async () => {
    mockBotSkillRepo.findEnabledByBotId.mockResolvedValue([
      {
        botSkill: { id: 1, botId: 10, skillId: 5, isEnabled: true },
        skill: {
          id: 5,
          name: 'calendar_booking',
          allowedTools: ['getAvailability', 'bookAppointment'],
          description: 'Book appointments',
          instructions: 'Check availability first.',
        },
      },
    ]);

    const tools: Record<string, unknown> = {};
    const tool = createLoadToolTool(10, toolContext, tools);
    const result = await tool.execute({ tool_names: ['getAvailability', 'bookAppointment'] });

    expect(result).toEqual({ loaded: ['getAvailability', 'bookAppointment'], skipped: [] });
    expect(tools.getAvailability).toBeDefined();
    expect(tools.bookAppointment).toBeDefined();
  });

  it('skips tools not in allowed_tools', async () => {
    mockBotSkillRepo.findEnabledByBotId.mockResolvedValue([
      {
        botSkill: { id: 1, botId: 10, skillId: 5, isEnabled: true },
        skill: {
          id: 5,
          name: 'info_only',
          allowedTools: ['companyInfo'],
          description: 'Info skill',
          instructions: 'Answer questions.',
        },
      },
    ]);

    const tools: Record<string, unknown> = {};
    const tool = createLoadToolTool(10, toolContext, tools);
    const result = await tool.execute({ tool_names: ['companyInfo', 'bookAppointment'] });

    expect(result).toEqual({ loaded: ['companyInfo'], skipped: ['bookAppointment'] });
    expect(tools.companyInfo).toBeDefined();
    expect(tools.bookAppointment).toBeUndefined();
  });

  it('skips tools not in the registry', async () => {
    mockBotSkillRepo.findEnabledByBotId.mockResolvedValue([
      {
        botSkill: { id: 1, botId: 10, skillId: 5, isEnabled: true },
        skill: {
          id: 5,
          name: 'custom',
          allowedTools: ['nonexistentTool'],
          description: 'Custom skill',
          instructions: 'Do things.',
        },
      },
    ]);

    const tools: Record<string, unknown> = {};
    const tool = createLoadToolTool(10, toolContext, tools);
    const result = await tool.execute({ tool_names: ['nonexistentTool'] });

    expect(result).toEqual({ loaded: [], skipped: ['nonexistentTool'] });
  });

  it('returns empty arrays when no tools are requested', async () => {
    mockBotSkillRepo.findEnabledByBotId.mockResolvedValue([]);

    const tools: Record<string, unknown> = {};
    const tool = createLoadToolTool(10, toolContext, tools);
    const result = await tool.execute({ tool_names: [] });

    expect(result).toEqual({ loaded: [], skipped: [] });
  });
});
