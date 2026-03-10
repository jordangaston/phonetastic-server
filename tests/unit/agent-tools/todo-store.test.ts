import { describe, it, expect, beforeEach } from 'vitest';
import { TodoStore, type TodoItem } from '../../../src/agent-tools/todo-store.js';

describe('TodoStore', () => {
  let store: TodoStore;

  beforeEach(() => {
    store = new TodoStore();
  });

  describe('update', () => {
    it('stores and returns the items', () => {
      const items: TodoItem[] = [
        { todo: 'Step 1', state: 'not_started' },
        { todo: 'Step 2', state: 'not_started' },
      ];
      const result = store.update('my-list', items);
      expect(result).toEqual(items);
      expect(store.get('my-list')).toEqual(items);
    });

    it('cleans up the list when all items are finished', () => {
      const items: TodoItem[] = [
        { todo: 'Step 1', state: 'finished' },
        { todo: 'Step 2', state: 'finished' },
      ];
      store.update('my-list', items);
      expect(store.get('my-list')).toBeUndefined();
    });

    it('rejects an empty items array', () => {
      expect(() => store.update('x', [])).toThrow(
        'Todo list must have at least one item.',
      );
    });

    it('rejects an invalid state', () => {
      const items = [{ todo: 'Bad', state: 'pending' as any }];
      expect(() => store.update('x', items)).toThrow(
        'Invalid state "pending".',
      );
    });

    it('rejects multiple in_progress items', () => {
      const items: TodoItem[] = [
        { todo: 'A', state: 'in_progress' },
        { todo: 'B', state: 'in_progress' },
      ];
      expect(() => store.update('x', items)).toThrow(
        'Only one item may be in_progress at a time.',
      );
    });

    it('rejects a finished item that appears after a non-finished item', () => {
      const items: TodoItem[] = [
        { todo: 'First', state: 'not_started' },
        { todo: 'Second', state: 'finished' },
      ];
      expect(() => store.update('x', items)).toThrow(
        '"Second" cannot be finished before "First".',
      );
    });

    it('allows finished items followed by non-finished items in order', () => {
      const items: TodoItem[] = [
        { todo: 'Done', state: 'finished' },
        { todo: 'Working', state: 'in_progress' },
        { todo: 'Waiting', state: 'not_started' },
      ];
      expect(() => store.update('x', items)).not.toThrow();
    });
  });

  describe('render', () => {
    it('renders items with correct bullets', () => {
      const items: TodoItem[] = [
        { todo: 'Done', state: 'finished' },
        { todo: 'Working', state: 'in_progress' },
        { todo: 'Waiting', state: 'not_started' },
      ];
      const result = store.render('My Tasks', items);
      expect(result).toBe(
        'My Tasks\n- [x] Done\n- [-] Working\n- [ ] Waiting',
      );
    });
  });
});
