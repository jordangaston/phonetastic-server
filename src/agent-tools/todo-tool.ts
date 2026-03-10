import { llm } from '@livekit/agents';
import { TodoStore, type TodoItem } from './todo-store.js';

const store = new TodoStore();

/**
 * Creates a tool that manages a named todo list.
 *
 * The agent should use this tool whenever it needs to complete a task that
 * requires multiple tools to be chained together. Before starting multi-step
 * work, call this tool to create a todo list that tracks each step. Update the
 * list as steps are completed so progress is always visible.
 *
 * @precondition Each call must include the full list of items with current states.
 * @postcondition The list is stored in memory and cleaned up when all items finish.
 * @returns An LLM tool the agent can invoke to manage todo lists.
 */
export function createTodoTool() {
  return llm.tool({
    description:
      'Manage a todo list to track progress on multi-step tasks. ' +
      'Use this tool whenever you need to chain multiple tools together ' +
      'to accomplish a goal. Create a list before starting, then update ' +
      'item states as you complete each step. ' +
      'Only one item may be in_progress at a time and earlier items ' +
      'must be finished before later ones.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The name of the todo list.',
        },
        items: {
          type: 'array',
          description: 'The full list of todo items with current states.',
          items: {
            type: 'object',
            properties: {
              todo: {
                type: 'string',
                description: 'Description of the task.',
              },
              state: {
                type: 'string',
                enum: ['not_started', 'in_progress', 'finished'],
                description: 'Current state of the task.',
              },
            },
            required: ['todo', 'state'],
          },
        },
      },
      required: ['name', 'items'],
    },
    execute: async (params: { name: string; items: TodoItem[] }) => {
      try {
        const items = store.update(params.name, params.items);
        return { success: true, todoList: store.render(params.name, items) };
      } catch (err: any) {
        return { error: err.message };
      }
    },
  });
}

/**
 * Returns the shared TodoStore instance used by the tool.
 *
 * @returns The module-level TodoStore singleton.
 */
export function getTodoStore(): TodoStore {
  return store;
}
