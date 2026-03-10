import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@livekit/agents', () => ({
  llm: {
    tool: vi.fn(({ execute }) => ({ execute })),
  },
}));

import { createTodoTool, getTodoStore } from '../../../src/agent-tools/todo-tool.js';

describe('createTodoTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns success with rendered todo list', async () => {
    const tool = createTodoTool();
    const result = await tool.execute({
      name: 'Deploy',
      items: [
        { todo: 'Build', state: 'finished' },
        { todo: 'Test', state: 'in_progress' },
        { todo: 'Ship', state: 'not_started' },
      ],
    });

    expect(result).toEqual({
      success: true,
      todoList: 'Deploy\n- [x] Build\n- [-] Test\n- [ ] Ship',
    });
  });

  it('returns error when validation fails', async () => {
    const tool = createTodoTool();
    const result = await tool.execute({
      name: 'Bad',
      items: [
        { todo: 'A', state: 'in_progress' },
        { todo: 'B', state: 'in_progress' },
      ],
    });

    expect(result).toEqual({
      error: 'Only one item may be in_progress at a time.',
    });
  });

  it('cleans up the list when all items are finished', async () => {
    const tool = createTodoTool();
    await tool.execute({
      name: 'Cleanup',
      items: [{ todo: 'Done', state: 'finished' }],
    });

    expect(getTodoStore().get('Cleanup')).toBeUndefined();
  });
});
