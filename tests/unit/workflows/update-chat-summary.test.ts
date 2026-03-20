import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@dbos-inc/dbos-sdk', () => ({
  DBOS: {
    step: () => (_t: unknown, _k: string, d: PropertyDescriptor) => d,
    workflow: () => (_t: unknown, _k: string, d: PropertyDescriptor) => d,
    transaction: () => (_t: unknown, _k: string, d: PropertyDescriptor) => d,
    drizzleClient: { update: vi.fn() },
    logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
  },
  WorkflowQueue: vi.fn(),
}));

const mockContainer = vi.hoisted(() => ({
  container: { resolve: vi.fn() },
}));
vi.mock('tsyringe', () => mockContainer);

const mockB = vi.hoisted(() => ({
  SummarizeChat: vi.fn(),
}));
vi.mock('../../../src/baml_client/index.js', () => ({ b: mockB }));

import { UpdateChatSummary } from '../../../src/workflows/update-chat-summary.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('UpdateChatSummary.loadContext', () => {
  it('returns null when chat not found', async () => {
    const chatRepo = { findById: vi.fn().mockResolvedValue(undefined) };
    mockContainer.container.resolve.mockReturnValueOnce(chatRepo);

    expect(await UpdateChatSummary.loadContext(999)).toBeNull();
  });

  it('returns messages and existing summary', async () => {
    const chatRepo = { findById: vi.fn().mockResolvedValue({ id: 1, summary: 'Previous summary' }) };
    const emailRepo = {
      findAllByChatId: vi.fn().mockResolvedValue([
        { direction: 'inbound', bodyText: 'Help me' },
        { direction: 'outbound', bodyText: 'Sure thing' },
      ]),
    };
    mockContainer.container.resolve
      .mockReturnValueOnce(chatRepo)
      .mockReturnValueOnce(emailRepo);

    const result = await UpdateChatSummary.loadContext(1);

    expect(result).toEqual({
      messages: [
        { direction: 'inbound', text: 'Help me' },
        { direction: 'outbound', text: 'Sure thing' },
      ],
      existingSummary: 'Previous summary',
    });
  });

  it('defaults bodyText to empty string when null', async () => {
    const chatRepo = { findById: vi.fn().mockResolvedValue({ id: 1, summary: null }) };
    const emailRepo = {
      findAllByChatId: vi.fn().mockResolvedValue([{ direction: 'inbound', bodyText: null }]),
    };
    mockContainer.container.resolve
      .mockReturnValueOnce(chatRepo)
      .mockReturnValueOnce(emailRepo);

    const result = await UpdateChatSummary.loadContext(1);

    expect(result!.messages[0].text).toBe('');
  });
});

describe('UpdateChatSummary.generateSummary', () => {
  it('formats transcript and calls BAML SummarizeChat', async () => {
    mockB.SummarizeChat.mockResolvedValue('Customer asked about billing.');

    const result = await UpdateChatSummary.generateSummary(
      [
        { direction: 'inbound', text: 'What is my balance?' },
        { direction: 'outbound', text: 'Your balance is $50.' },
      ],
      null,
    );

    expect(result).toBe('Customer asked about billing.');
    expect(mockB.SummarizeChat).toHaveBeenCalledWith(
      'Customer: What is my balance?\nSupport: Your balance is $50.',
      null,
    );
  });

  it('passes existing summary to BAML for incremental updates', async () => {
    mockB.SummarizeChat.mockResolvedValue('Updated summary');

    await UpdateChatSummary.generateSummary(
      [{ direction: 'inbound', text: 'Follow up' }],
      'Old summary',
    );

    expect(mockB.SummarizeChat).toHaveBeenCalledWith(
      'Customer: Follow up',
      'Old summary',
    );
  });
});

describe('UpdateChatSummary.run', () => {
  it('skips when chat not found', async () => {
    const chatRepo = { findById: vi.fn().mockResolvedValue(undefined) };
    mockContainer.container.resolve.mockReturnValue(chatRepo);

    await UpdateChatSummary.run(999);

    expect(mockB.SummarizeChat).not.toHaveBeenCalled();
  });
});
