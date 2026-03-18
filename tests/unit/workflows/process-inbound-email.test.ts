import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDbos = vi.hoisted(() => ({
  DBOS: {
    step: () => (_t: unknown, _k: string, d: PropertyDescriptor) => d,
    workflow: () => (_t: unknown, _k: string, d: PropertyDescriptor) => d,
    transaction: () => (_t: unknown, _k: string, d: PropertyDescriptor) => d,
    startWorkflow: vi.fn(),
    workflowID: 'test-wf-id',
    drizzleClient: { update: vi.fn() },
  },
  WorkflowQueue: vi.fn(),
}));
vi.mock('@dbos-inc/dbos-sdk', () => mockDbos);

const mockContainer = vi.hoisted(() => ({
  container: { resolve: vi.fn() },
}));
vi.mock('tsyringe', () => mockContainer);

const mockB = vi.hoisted(() => ({
  SummarizeTextAttachment: vi.fn(),
  SummarizeImageAttachment: vi.fn(),
  EmailAgentTurn: vi.fn(),
}));
vi.mock('../../../src/baml_client/index.js', () => ({ b: mockB }));

vi.mock('@boundaryml/baml', () => ({
  Image: { fromBase64: vi.fn().mockReturnValue('mock-image') },
}));

import { ProcessInboundEmail } from '../../../src/workflows/process-inbound-email.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProcessInboundEmail.loadPendingAttachments', () => {
  it('returns only pending attachment ids', async () => {
    const mockRepo = {
      findAllByEmailId: vi.fn().mockResolvedValue([
        { id: 1, status: 'pending' },
        { id: 2, status: 'stored' },
        { id: 3, status: 'pending' },
      ]),
    };
    mockContainer.container.resolve.mockReturnValue(mockRepo);

    const result = await ProcessInboundEmail.loadPendingAttachments(10);

    expect(result).toEqual([{ id: 1 }, { id: 3 }]);
  });

  it('returns empty array when no pending attachments', async () => {
    const mockRepo = {
      findAllByEmailId: vi.fn().mockResolvedValue([{ id: 1, status: 'stored' }]),
    };
    mockContainer.container.resolve.mockReturnValue(mockRepo);

    const result = await ProcessInboundEmail.loadPendingAttachments(10);

    expect(result).toEqual([]);
  });
});

describe('ProcessInboundEmail.markAttachmentFailed', () => {
  it('updates attachment status to failed', async () => {
    const mockRepo = { update: vi.fn().mockResolvedValue(undefined) };
    mockContainer.container.resolve.mockReturnValue(mockRepo);

    await ProcessInboundEmail.markAttachmentFailed(5);

    expect(mockRepo.update).toHaveBeenCalledWith(5, { status: 'failed' });
  });
});

describe('ProcessInboundEmail.loadChat', () => {
  it('returns chat from repository', async () => {
    const chat = { id: 1, botEnabled: true };
    const mockRepo = { findById: vi.fn().mockResolvedValue(chat) };
    mockContainer.container.resolve.mockReturnValue(mockRepo);

    expect(await ProcessInboundEmail.loadChat(1)).toBe(chat);
  });
});

describe('ProcessInboundEmail.countEmails', () => {
  it('returns count of emails in chat', async () => {
    const mockRepo = { findAllByChatId: vi.fn().mockResolvedValue([{}, {}, {}]) };
    mockContainer.container.resolve.mockReturnValue(mockRepo);

    expect(await ProcessInboundEmail.countEmails(1)).toBe(3);
  });
});

describe('ProcessInboundEmail.loadUnsummarizedAttachments', () => {
  it('filters to stored attachments without summaries within size limit', async () => {
    const mockRepo = {
      findAllByEmailId: vi.fn().mockResolvedValue([
        { id: 1, status: 'stored', summary: null, storageKey: 'k1', sizeBytes: 100, contentType: 'text/plain', filename: 'a.txt', createdAt: new Date('2026-01-01') },
        { id: 2, status: 'stored', summary: 'already done', storageKey: 'k2', sizeBytes: 100, contentType: 'text/plain', filename: 'b.txt', createdAt: new Date('2026-01-01') },
        { id: 3, status: 'pending', summary: null, storageKey: null, sizeBytes: null, contentType: 'text/plain', filename: 'c.txt', createdAt: new Date('2026-01-01') },
        { id: 4, status: 'stored', summary: null, storageKey: 'k4', sizeBytes: 20 * 1024 * 1024, contentType: 'text/plain', filename: 'd.txt', createdAt: new Date('2026-01-01') },
      ]),
    };
    mockContainer.container.resolve.mockReturnValue(mockRepo);

    const result = await ProcessInboundEmail.loadUnsummarizedAttachments(10);

    expect(result).toEqual([
      { id: 1, storageKey: 'k1', contentType: 'text/plain', filename: 'a.txt', createdAt: new Date('2026-01-01') },
    ]);
  });
});

describe('ProcessInboundEmail.loadEmailText', () => {
  it('returns email body text', async () => {
    const mockRepo = { findById: vi.fn().mockResolvedValue({ bodyText: 'Hello there' }) };
    mockContainer.container.resolve.mockReturnValue(mockRepo);

    expect(await ProcessInboundEmail.loadEmailText(1)).toBe('Hello there');
  });

  it('returns empty string when email not found', async () => {
    const mockRepo = { findById: vi.fn().mockResolvedValue(undefined) };
    mockContainer.container.resolve.mockReturnValue(mockRepo);

    expect(await ProcessInboundEmail.loadEmailText(999)).toBe('');
  });
});

describe('ProcessInboundEmail.summarizeOneAttachment', () => {
  it('summarizes a text attachment via BAML', async () => {
    const mockStorage = { getObject: vi.fn().mockResolvedValue(Buffer.from('doc content')) };
    const mockAttRepo = { update: vi.fn() };
    mockContainer.container.resolve
      .mockReturnValueOnce(mockStorage)
      .mockReturnValueOnce(mockAttRepo);
    mockB.SummarizeTextAttachment.mockResolvedValue('Summary of doc');

    const result = await ProcessInboundEmail.summarizeOneAttachment(1, 'key', 'text/plain', 'email body');

    expect(mockB.SummarizeTextAttachment).toHaveBeenCalledWith('doc content', 'email body');
    expect(mockAttRepo.update).toHaveBeenCalledWith(1, { summary: 'Summary of doc' });
    expect(result).toBe('Summary of doc');
  });

  it('summarizes an image attachment via BAML multimodal', async () => {
    const mockStorage = { getObject: vi.fn().mockResolvedValue(Buffer.from('png-bytes')) };
    const mockAttRepo = { update: vi.fn() };
    mockContainer.container.resolve
      .mockReturnValueOnce(mockStorage)
      .mockReturnValueOnce(mockAttRepo);
    mockB.SummarizeImageAttachment.mockResolvedValue('A photo of a cat');

    const result = await ProcessInboundEmail.summarizeOneAttachment(1, 'key', 'image/png', 'see attached');

    expect(mockB.SummarizeImageAttachment).toHaveBeenCalledWith('mock-image', 'see attached');
    expect(result).toBe('A photo of a cat');
  });
});

describe('ProcessInboundEmail.loadAgentContext', () => {
  it('returns agent context with company name and chat summary', async () => {
    const mockChatRepo = { findById: vi.fn().mockResolvedValue({ id: 1, summary: 'Prior context' }) };
    const mockCompanyRepo = { findById: vi.fn().mockResolvedValue({ id: 5, name: 'Acme Corp' }) };
    mockContainer.container.resolve
      .mockReturnValueOnce(mockChatRepo)
      .mockReturnValueOnce(mockCompanyRepo);

    const result = await ProcessInboundEmail.loadAgentContext(1, 5);

    expect(result).toEqual({
      chatId: 1,
      companyId: 5,
      companyName: 'Acme Corp',
      chatSummary: 'Prior context',
    });
  });

  it('returns null when chat not found', async () => {
    const mockChatRepo = { findById: vi.fn().mockResolvedValue(undefined) };
    mockContainer.container.resolve.mockReturnValueOnce(mockChatRepo);

    expect(await ProcessInboundEmail.loadAgentContext(999, 1)).toBeNull();
  });

  it('defaults company name to Unknown', async () => {
    const mockChatRepo = { findById: vi.fn().mockResolvedValue({ id: 1, summary: null }) };
    const mockCompanyRepo = { findById: vi.fn().mockResolvedValue(undefined) };
    mockContainer.container.resolve
      .mockReturnValueOnce(mockChatRepo)
      .mockReturnValueOnce(mockCompanyRepo);

    const result = await ProcessInboundEmail.loadAgentContext(1, 999);

    expect(result!.companyName).toBe('Unknown');
  });
});

describe('ProcessInboundEmail.agentTurn', () => {
  const agentCtx = { chatId: 1, companyId: 5, companyName: 'Acme', chatSummary: null };
  const emptySummaries: never[] = [];

  const setupAgentTurnMocks = () => {
    const toolCallRepo = { create: vi.fn() };
    const emailRepo = { findAllByChatId: vi.fn().mockResolvedValue([]) };
    const botToolCallRepo = { findAllByChatId: vi.fn().mockResolvedValue([]) };

    mockContainer.container.resolve
      .mockReturnValueOnce(toolCallRepo)
      .mockReturnValueOnce(emailRepo)
      .mockReturnValueOnce(botToolCallRepo);

    return { toolCallRepo, emailRepo, botToolCallRepo };
  };

  it('returns reply text when agent produces a reply tool call', async () => {
    const { toolCallRepo } = setupAgentTurnMocks();
    mockB.EmailAgentTurn.mockResolvedValue({ tool_name: 'reply', text: 'Thanks for contacting us!' });

    const result = await ProcessInboundEmail.agentTurn(agentCtx, emptySummaries);

    expect(result).toEqual({ replyText: 'Thanks for contacting us!', done: true });
    expect(toolCallRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'reply', input: { text: 'Thanks for contacting us!' } }),
    );
  });

  it('executes company_info tool and returns done=false to continue loop', async () => {
    const { toolCallRepo } = setupAgentTurnMocks();
    mockB.EmailAgentTurn.mockResolvedValue({ tool_name: 'company_info', query: 'pricing' });

    const mockEmbedding = { embed: vi.fn().mockResolvedValue([[0.1, 0.2]]) };
    const mockFaqRepo = {
      searchByEmbedding: vi.fn().mockResolvedValue([{ question: 'Price?', answer: '$39' }]),
    };
    mockContainer.container.resolve
      .mockReturnValueOnce(mockEmbedding)
      .mockReturnValueOnce(mockFaqRepo);

    const result = await ProcessInboundEmail.agentTurn(agentCtx, emptySummaries);

    expect(result).toEqual({ replyText: null, done: false });
    expect(toolCallRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'company_info',
        input: { query: 'pricing' },
        output: { found: true, results: [{ question: 'Price?', answer: '$39' }] },
      }),
    );
  });

  it('propagates errors instead of swallowing them', async () => {
    setupAgentTurnMocks();
    mockB.EmailAgentTurn.mockRejectedValue(new Error('LLM timeout'));

    await expect(ProcessInboundEmail.agentTurn(agentCtx, emptySummaries))
      .rejects.toThrow('LLM timeout');
  });
});

describe('ProcessInboundEmail.agentLoop', () => {
  const agentCtx = { chatId: 1, companyId: 5, companyName: 'Acme', chatSummary: null };

  it('returns reply on first turn when agent replies immediately', async () => {
    const toolCallRepo = { create: vi.fn() };
    const emailRepo = { findAllByChatId: vi.fn().mockResolvedValue([]) };
    const botToolCallRepo = { findAllByChatId: vi.fn().mockResolvedValue([]) };
    mockContainer.container.resolve
      .mockReturnValueOnce(toolCallRepo)
      .mockReturnValueOnce(emailRepo)
      .mockReturnValueOnce(botToolCallRepo);

    mockB.EmailAgentTurn.mockResolvedValue({ tool_name: 'reply', text: 'Hello!' });

    const result = await ProcessInboundEmail.agentLoop(agentCtx, []);

    expect(result).toBe('Hello!');
  });

  it('throws when all turns exhausted without reply', async () => {
    const setupTurn = () => {
      const toolCallRepo = { create: vi.fn() };
      const emailRepo = { findAllByChatId: vi.fn().mockResolvedValue([]) };
      const botToolCallRepo = { findAllByChatId: vi.fn().mockResolvedValue([]) };
      const embedService = { embed: vi.fn().mockResolvedValue([[0.1]]) };
      const faqRepo = { searchByEmbedding: vi.fn().mockResolvedValue([]) };

      mockContainer.container.resolve
        .mockReturnValueOnce(toolCallRepo)
        .mockReturnValueOnce(emailRepo)
        .mockReturnValueOnce(botToolCallRepo)
        .mockReturnValueOnce(embedService)
        .mockReturnValueOnce(faqRepo);
    };

    mockB.EmailAgentTurn.mockResolvedValue({ tool_name: 'company_info', query: 'q' });

    for (let i = 0; i < 5; i++) setupTurn();

    await expect(ProcessInboundEmail.agentLoop(agentCtx, []))
      .rejects.toThrow('Agent loop exhausted all turns without producing a reply');
  });
});

describe('ProcessInboundEmail.summarizeAttachments', () => {
  it('returns results with summaries for successful attachments', async () => {
    const attRepo = {
      findAllByEmailId: vi.fn().mockResolvedValue([
        { id: 1, status: 'stored', summary: null, storageKey: 'k1', sizeBytes: 100, contentType: 'text/plain', filename: 'a.txt', createdAt: new Date('2026-03-01') },
      ]),
    };
    const emailRepo = { findById: vi.fn().mockResolvedValue({ bodyText: 'context' }) };
    const storage = { getObject: vi.fn().mockResolvedValue(Buffer.from('content')) };
    const attRepoForUpdate = { update: vi.fn() };

    mockContainer.container.resolve
      .mockReturnValueOnce(attRepo)
      .mockReturnValueOnce(emailRepo)
      .mockReturnValueOnce(storage)
      .mockReturnValueOnce(attRepoForUpdate);

    mockB.SummarizeTextAttachment.mockResolvedValue('A text file summary');

    const results = await ProcessInboundEmail.summarizeAttachments(10);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: 1,
      filename: 'a.txt',
      summary: 'A text file summary',
      error: null,
      createdAt: new Date('2026-03-01'),
    });
  });

  it('captures errors per attachment without blocking others', async () => {
    const attRepo = {
      findAllByEmailId: vi.fn().mockResolvedValue([
        { id: 1, status: 'stored', summary: null, storageKey: 'k1', sizeBytes: 100, contentType: 'text/plain', filename: 'good.txt', createdAt: new Date('2026-03-01') },
        { id: 2, status: 'stored', summary: null, storageKey: 'k2', sizeBytes: 100, contentType: 'text/plain', filename: 'bad.txt', createdAt: new Date('2026-03-01') },
      ]),
    };
    const emailRepo = { findById: vi.fn().mockResolvedValue({ bodyText: '' }) };

    mockContainer.container.resolve
      .mockReturnValueOnce(attRepo)
      .mockReturnValueOnce(emailRepo);

    const storageGood = { getObject: vi.fn().mockResolvedValue(Buffer.from('ok')) };
    const attRepoGood = { update: vi.fn() };
    mockContainer.container.resolve
      .mockReturnValueOnce(storageGood)
      .mockReturnValueOnce(attRepoGood);

    const storageBad = { getObject: vi.fn().mockRejectedValue(new Error('not found')) };
    mockContainer.container.resolve.mockReturnValueOnce(storageBad);

    mockB.SummarizeTextAttachment.mockResolvedValue('Good summary');

    const results = await ProcessInboundEmail.summarizeAttachments(10);

    expect(results).toHaveLength(2);
    expect(results[0].summary).toBe('Good summary');
    expect(results[0].error).toBeNull();
    expect(results[1].summary).toBeNull();
    expect(results[1].error).toBe('Summarization failed for bad.txt');
  });
});

describe('ProcessInboundEmail.sendReply', () => {
  it('sends email via Resend using replyTo from latest inbound email', async () => {
    const chatRepo = {
      findById: vi.fn().mockResolvedValue({ id: 1, endUserId: 2, companyId: 5, subject: 'Q' }),
      update: vi.fn(),
    };
    const emailRepo = {
      findAllByChatId: vi.fn().mockResolvedValue([
        { direction: 'inbound', replyTo: 'help@acme.com', messageId: '<prev@m.com>', referenceIds: ['<r1>'] },
      ]),
      create: vi.fn(),
    };
    const companyRepo = { findById: vi.fn() };
    const endUserRepo = { findById: vi.fn().mockResolvedValue({ id: 2, email: 'user@test.com' }) };
    const botRepo = { findByUserId: vi.fn().mockResolvedValue({ id: 10 }) };
    const resendService = {
      sendEmail: vi.fn().mockResolvedValue({ id: 'r-1', messageId: '<new@m.com>' }),
    };

    mockContainer.container.resolve
      .mockReturnValueOnce(chatRepo)
      .mockReturnValueOnce(emailRepo)
      .mockReturnValueOnce(companyRepo)
      .mockReturnValueOnce(endUserRepo)
      .mockReturnValueOnce(botRepo)
      .mockReturnValueOnce(resendService);

    await ProcessInboundEmail.sendReply(1, 5, 'Here is your answer');

    expect(resendService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'help@acme.com',
        to: 'user@test.com',
        replyTo: 'help@acme.com',
        text: 'Here is your answer',
      }),
    );
    expect(companyRepo.findById).not.toHaveBeenCalled();
    expect(emailRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 1,
        direction: 'outbound',
        botId: 10,
        bodyText: 'Here is your answer',
        status: 'sent',
      }),
    );
    expect(chatRepo.update).toHaveBeenCalledWith(1, expect.objectContaining({ updatedAt: expect.any(Date) }));
  });

  it('falls back to company emails when no replyTo', async () => {
    const chatRepo = {
      findById: vi.fn().mockResolvedValue({ id: 1, endUserId: 2, companyId: 5, subject: 'Q' }),
      update: vi.fn(),
    };
    const emailRepo = {
      findAllByChatId: vi.fn().mockResolvedValue([
        { direction: 'inbound', replyTo: null, messageId: '<prev@m.com>', referenceIds: [] },
      ]),
      create: vi.fn(),
    };
    const companyRepo = { findById: vi.fn().mockResolvedValue({ id: 5, emails: ['support@acme.com'] }) };
    const endUserRepo = { findById: vi.fn().mockResolvedValue({ id: 2, email: 'user@test.com' }) };
    const botRepo = { findByUserId: vi.fn().mockResolvedValue({ id: 10 }) };
    const resendService = {
      sendEmail: vi.fn().mockResolvedValue({ id: 'r-1', messageId: '<new@m.com>' }),
    };

    mockContainer.container.resolve
      .mockReturnValueOnce(chatRepo)
      .mockReturnValueOnce(emailRepo)
      .mockReturnValueOnce(companyRepo)
      .mockReturnValueOnce(endUserRepo)
      .mockReturnValueOnce(botRepo)
      .mockReturnValueOnce(resendService);

    await ProcessInboundEmail.sendReply(1, 5, 'Reply');

    expect(resendService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'support@acme.com' }),
    );
  });

  it('returns early when chat not found', async () => {
    const chatRepo = { findById: vi.fn().mockResolvedValue(undefined) };
    const emailRepo = { findAllByChatId: vi.fn(), create: vi.fn() };
    const companyRepo = { findById: vi.fn() };
    const endUserRepo = { findById: vi.fn() };
    const botRepo = { findByUserId: vi.fn() };
    const resendService = { sendEmail: vi.fn() };

    mockContainer.container.resolve
      .mockReturnValueOnce(chatRepo)
      .mockReturnValueOnce(emailRepo)
      .mockReturnValueOnce(companyRepo)
      .mockReturnValueOnce(endUserRepo)
      .mockReturnValueOnce(botRepo)
      .mockReturnValueOnce(resendService);

    await ProcessInboundEmail.sendReply(999, 1, 'text');

    expect(resendService.sendEmail).not.toHaveBeenCalled();
  });

  it('returns early when end user has no email', async () => {
    const chatRepo = { findById: vi.fn().mockResolvedValue({ id: 1, endUserId: 2, companyId: 5 }) };
    const emailRepo = { findAllByChatId: vi.fn(), create: vi.fn() };
    const companyRepo = { findById: vi.fn() };
    const endUserRepo = { findById: vi.fn().mockResolvedValue({ id: 2, email: null }) };
    const botRepo = { findByUserId: vi.fn() };
    const resendService = { sendEmail: vi.fn() };

    mockContainer.container.resolve
      .mockReturnValueOnce(chatRepo)
      .mockReturnValueOnce(emailRepo)
      .mockReturnValueOnce(companyRepo)
      .mockReturnValueOnce(endUserRepo)
      .mockReturnValueOnce(botRepo)
      .mockReturnValueOnce(resendService);

    await ProcessInboundEmail.sendReply(1, 5, 'text');

    expect(resendService.sendEmail).not.toHaveBeenCalled();
  });
});

describe('ProcessInboundEmail.run', () => {
  it('skips agent loop when bot is disabled', async () => {
    const attRepo = { findAllByEmailId: vi.fn().mockResolvedValue([]) };
    const chatRepo = { findById: vi.fn().mockResolvedValue({ id: 1, botEnabled: false }) };

    mockContainer.container.resolve
      .mockReturnValueOnce(attRepo)
      .mockReturnValueOnce(chatRepo);

    mockDbos.DBOS.startWorkflow.mockReturnValue({ run: vi.fn() });

    await ProcessInboundEmail.run(1, 10, 5, 'ext-email');

    expect(mockB.EmailAgentTurn).not.toHaveBeenCalled();
  });
});

describe('ProcessInboundEmail.processAttachments', () => {
  it('starts a child workflow for each pending attachment', async () => {
    const attRepo = {
      findAllByEmailId: vi.fn().mockResolvedValue([
        { id: 1, status: 'pending' },
        { id: 2, status: 'pending' },
      ]),
      update: vi.fn(),
    };
    mockContainer.container.resolve.mockReturnValue(attRepo);

    const runMock = vi.fn().mockResolvedValue(undefined);
    mockDbos.DBOS.startWorkflow.mockReturnValue({ run: runMock });

    await ProcessInboundEmail.processAttachments(10, 'ext-email', 5);

    expect(mockDbos.DBOS.startWorkflow).toHaveBeenCalledTimes(2);
    expect(runMock).toHaveBeenCalledWith(1, 'ext-email', 5);
    expect(runMock).toHaveBeenCalledWith(2, 'ext-email', 5);
  });

  it('does not mark attachments failed when all child workflows succeed', async () => {
    const attRepo = {
      findAllByEmailId: vi.fn().mockResolvedValue([
        { id: 1, status: 'pending' },
        { id: 2, status: 'pending' },
      ]),
      update: vi.fn(),
    };
    mockContainer.container.resolve.mockReturnValue(attRepo);

    const handle = { getResult: vi.fn() };
    mockDbos.DBOS.startWorkflow.mockReturnValue({ run: vi.fn().mockResolvedValue(handle) });

    await ProcessInboundEmail.processAttachments(10, 'ext-email', 5);

    expect(attRepo.update).not.toHaveBeenCalled();
  });

  it('does nothing when no pending attachments', async () => {
    const attRepo = {
      findAllByEmailId: vi.fn().mockResolvedValue([{ id: 1, status: 'stored' }]),
      update: vi.fn(),
    };
    mockContainer.container.resolve.mockReturnValue(attRepo);

    await ProcessInboundEmail.processAttachments(10, 'ext-email', 5);

    expect(mockDbos.DBOS.startWorkflow).not.toHaveBeenCalled();
  });
});
