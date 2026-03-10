/**
 * Valid states for a todo item.
 *
 * - `not_started` – work has not begun
 * - `in_progress` – actively being worked on
 * - `finished` – completed
 */
export type TodoState = 'not_started' | 'in_progress' | 'finished';

/**
 * A single item in a todo list.
 *
 * @param todo - Human-readable description of the task.
 * @param state - Current state of the task.
 */
export interface TodoItem {
  todo: string;
  state: TodoState;
}

const VALID_STATES: ReadonlySet<string> = new Set([
  'not_started',
  'in_progress',
  'finished',
]);

/**
 * In-memory store for named todo lists.
 *
 * @precondition List names are non-empty strings.
 * @postcondition Lists are automatically removed once every item is finished.
 */
export class TodoStore {
  private lists = new Map<string, TodoItem[]>();

  /**
   * Update (or create) a named todo list.
   *
   * @param name - The name of the todo list.
   * @param items - The full set of todo items to store.
   * @returns The validated, stored items.
   * @throws Error when validation fails.
   */
  update(name: string, items: TodoItem[]): TodoItem[] {
    this.validate(items);
    this.lists.set(name, items);
    if (items.every((i) => i.state === 'finished')) {
      this.lists.delete(name);
    }
    return items;
  }

  /**
   * Retrieve a named todo list.
   *
   * @param name - The name of the todo list.
   * @returns The items, or `undefined` if the list does not exist.
   */
  get(name: string): TodoItem[] | undefined {
    return this.lists.get(name);
  }

  /**
   * Render a todo list as a human-readable string.
   *
   * @param name - The list name (used as a heading).
   * @param items - The items to render.
   * @returns A formatted string with checkbox-style bullets.
   */
  render(name: string, items: TodoItem[]): string {
    const lines = items.map((i) => `${bullet(i.state)} ${i.todo}`);
    return `${name}\n${lines.join('\n')}`;
  }

  private validate(items: TodoItem[]): void {
    if (items.length === 0) {
      throw new Error('Todo list must have at least one item.');
    }
    for (const item of items) {
      if (!VALID_STATES.has(item.state)) {
        throw new Error(`Invalid state "${item.state}".`);
      }
    }
    this.validateSingleInProgress(items);
    this.validateOrder(items);
  }

  private validateSingleInProgress(items: TodoItem[]): void {
    const count = items.filter((i) => i.state === 'in_progress').length;
    if (count > 1) {
      throw new Error('Only one item may be in_progress at a time.');
    }
  }

  private validateOrder(items: TodoItem[]): void {
    let seenNonFinished = false;
    for (const item of items) {
      if (item.state !== 'finished') {
        seenNonFinished = true;
      }
      if (seenNonFinished && item.state === 'finished') {
        const prev = items.find((i) => i.state !== 'finished');
        throw new Error(
          `"${item.todo}" cannot be finished before "${prev!.todo}".`,
        );
      }
    }
  }
}

function bullet(state: TodoState): string {
  switch (state) {
    case 'not_started': return '- [ ]';
    case 'in_progress': return '- [-]';
    case 'finished': return '- [x]';
  }
}
