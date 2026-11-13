import { describe, expect, it } from 'vitest';
import {
  backFrom,
  entryOf,
  NAV_KEY,
  payloadOf,
  pushEntry,
  sameEntry,
  topEntry,
  type HistoryLike,
  type NavEntry,
} from './navigation.js';

class FakeHistory implements HistoryLike {
  state: unknown = null;
  backCalls = 0;
  readonly stack: unknown[] = [null];

  constructor(initial: unknown = null) {
    this.state = initial;
    this.stack = [initial];
  }

  pushState(data: unknown): void {
    this.stack.push(data);
    this.state = data;
  }

  back(): void {
    this.backCalls += 1;
    if (this.stack.length > 1) this.stack.pop();
    this.state = this.stack.at(-1) ?? null;
  }
}

function session(id: string): NavEntry {
  return { view: 'session', id };
}

const settings: NavEntry = { view: 'settings' };

describe('entryOf', () => {
  it('reads a session entry the app wrote', () => {
    expect(entryOf(payloadOf(session('session-1')))).toEqual(session('session-1'));
  });

  it('reads the settings entry', () => {
    expect(entryOf(payloadOf(settings))).toEqual(settings);
  });

  it.each([
    ['null', null],
    ['a string', 'session'],
    ['an empty object', {}],
    ['a foreign key', { otro: { view: 'session', id: 'x' } }],
    ['an inner string', { [NAV_KEY]: 'session' }],
    ['an unknown view', { [NAV_KEY]: { view: 'chat', id: 'x' } }],
    ['a session without an id', { [NAV_KEY]: { view: 'session' } }],
    ['a session with an empty id', { [NAV_KEY]: { view: 'session', id: '' } }],
    ['a session with a numeric id', { [NAV_KEY]: { view: 'session', id: 7 } }],
  ])('ignores %s', (_label, state) => {
    expect(entryOf(state)).toBeUndefined();
  });
});

describe('pushEntry', () => {
  it('leaves the current entry parseable on top of the stack', () => {
    const history = new FakeHistory();
    pushEntry(history, session('session-2'));

    expect(history.stack).toHaveLength(2);
    expect(topEntry(history)).toEqual(session('session-2'));
  });
});

describe('backFrom', () => {
  it('goes back when the top entry is the one asked for', () => {
    const history = new FakeHistory();
    pushEntry(history, session('session-1'));

    expect(backFrom(history, session('session-1'))).toBe(true);
    expect(history.backCalls).toBe(1);
    expect(history.state).toBeNull();
  });

  it('does not go back when another session is on top', () => {
    const history = new FakeHistory();
    pushEntry(history, session('session-2'));

    expect(backFrom(history, session('session-1'))).toBe(false);
    expect(history.backCalls).toBe(0);
    expect(topEntry(history)).toEqual(session('session-2'));
  });

  it('does not go back when the app is on its own base entry', () => {
    const history = new FakeHistory();

    expect(backFrom(history, session('session-1'))).toBe(false);
    expect(history.backCalls).toBe(0);
  });

  it('does not go back from a foreign history state', () => {
    const history = new FakeHistory({ [NAV_KEY]: { view: 'session', id: 'session-1' } });

    expect(backFrom(history, session('session-1'))).toBe(true);

    const foreign = new FakeHistory({ otro: true });
    expect(backFrom(foreign, session('session-1'))).toBe(false);
    expect(foreign.backCalls).toBe(0);
  });

  it('handles the settings entry', () => {
    const history = new FakeHistory();
    pushEntry(history, settings);

    expect(backFrom(history, session('session-1'))).toBe(false);
    expect(backFrom(history, settings)).toBe(true);
    expect(history.backCalls).toBe(1);
  });
});

describe('sameEntry', () => {
  it('treats two settings entries as the same', () => {
    expect(sameEntry({ view: 'settings' }, { view: 'settings' })).toBe(true);
  });

  it('treats two session entries with the same id as the same', () => {
    expect(sameEntry(session('a'), session('a'))).toBe(true);
  });

  it('separates sessions by id and by kind', () => {
    expect(sameEntry(session('a'), session('b'))).toBe(false);
    expect(sameEntry(session('a'), settings)).toBe(false);
    expect(sameEntry(undefined, settings)).toBe(false);
  });
});
