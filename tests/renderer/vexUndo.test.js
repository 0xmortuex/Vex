// @vitest-environment jsdom
//
// Undo instead of "Are you sure?" (js/vex-undo.js): the shared offer on the
// one toast system, its keyboard path, what happens when it runs out, and
// putting list records back exactly where they were.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { VexUndo } = require('../../src/renderer/js/vex-undo.js');

let toasts;
beforeEach(() => {
  document.body.innerHTML = '';
  toasts = [];
  // The shape app.js showToast has: opts.action / opts.onExpire, returns { dismiss }.
  window.showToast = vi.fn((message, type, duration, opts) => {
    const t = { message, type, duration, opts, dismissed: false, dismiss() { t.dismissed = true; } };
    toasts.push(t);
    return t;
  });
  // Nothing left on offer from an earlier test.
  while (VexUndo.pending().length) VexUndo.undoLatest();
  toasts = [];
});

const ctrlZ = (target = document.body, extra = {}) => {
  const ev = new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true, ...extra });
  target.dispatchEvent(ev);
  return ev;
};

describe('an offer', () => {
  it('shows one toast with an Undo button for about ten seconds', () => {
    VexUndo.offer({ message: 'Deleted “A”', undo: () => {} });
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe('Deleted “A”');
    expect(toasts[0].type).toBe('undo');
    expect(toasts[0].duration).toBe(10000);
    expect(toasts[0].opts.action.label).toBe('Undo');
    expect(toasts[0].opts.action.title).toMatch(/Ctrl\+Z/);
  });

  it('Undo runs once, takes the toast down, and is not committed after', async () => {
    const undo = vi.fn(), commit = vi.fn();
    VexUndo.offer({ message: 'x', undo, commit });
    toasts[0].opts.action.run();
    toasts[0].opts.action.run();
    await Promise.resolve();
    expect(undo).toHaveBeenCalledTimes(1);
    expect(toasts[0].dismissed).toBe(true);
    toasts[0].opts.onExpire();
    await Promise.resolve();
    expect(commit).not.toHaveBeenCalled();
    expect(VexUndo.pending()).toHaveLength(0);
  });

  it('running out keeps it done and runs the deferred step once; Undo is then gone', async () => {
    const undo = vi.fn(), commit = vi.fn();
    VexUndo.offer({ message: 'x', undo, commit });
    toasts[0].opts.onExpire();
    toasts[0].opts.onExpire();
    await Promise.resolve(); await Promise.resolve();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(VexUndo.undoLatest()).toBe(null);
    expect(undo).not.toHaveBeenCalled();
  });

  it('an Undo that fails says so, in an error toast', async () => {
    VexUndo.offer({ message: 'x', undo: () => { throw new Error('it is gone'); } });
    const ok = await VexUndo.undoLatest();
    expect(ok).toBe(false);
    expect(toasts.at(-1)).toMatchObject({ type: 'error', message: 'Could not undo: it is gone' });
  });

  it('a deferred step that fails says so', async () => {
    VexUndo.offer({ message: 'x', undo: () => {}, commit: async () => { throw new Error('locked'); } });
    toasts[0].opts.onExpire();
    await new Promise(r => setTimeout(r, 0));
    expect(toasts.at(-1)).toMatchObject({ type: 'error', message: 'Could not finish: locked' });
  });

  it('the window going settles every offer', async () => {
    const commit = vi.fn();
    VexUndo.offer({ message: 'x', undo: () => {}, commit });
    window.dispatchEvent(new Event('pagehide'));
    await Promise.resolve(); await Promise.resolve();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(VexUndo.pending()).toHaveLength(0);
  });

  it('refuses an offer it could not honour', () => {
    expect(() => VexUndo.offer({ message: '', undo: () => {} })).toThrow(/message/);
    expect(() => VexUndo.offer({ message: 'x' })).toThrow(/undo/);
  });
});

describe('Ctrl+Z', () => {
  it('undoes the newest offer first', async () => {
    const a = vi.fn(), b = vi.fn();
    VexUndo.offer({ message: 'a', undo: a });
    VexUndo.offer({ message: 'b', undo: b });
    const ev = ctrlZ();
    await Promise.resolve();
    expect(ev.defaultPrevented).toBe(true);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
    ctrlZ();
    await Promise.resolve();
    expect(a).toHaveBeenCalledTimes(1);
  });

  it('is the text box’s own in a text box, and does nothing with nothing on offer', async () => {
    const undo = vi.fn();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    VexUndo.offer({ message: 'a', undo });
    const ev = ctrlZ(input);
    expect(ev.defaultPrevented).toBe(false);
    expect(undo).not.toHaveBeenCalled();
    input.blur();
    VexUndo.undoLatest();
    const idle = ctrlZ();
    expect(idle.defaultPrevented).toBe(false);
  });

  it('works on the toast itself, even with a dialog open; a dialog otherwise owns the keys', async () => {
    const undo = vi.fn();
    VexUndo.offer({ message: 'a', undo });
    const dialog = document.createElement('div');
    dialog.className = 'vex-dialog-overlay';
    document.body.appendChild(dialog);
    ctrlZ();
    expect(undo).not.toHaveBeenCalled();
    const container = document.createElement('div');
    container.id = 'toast-container';
    const btn = document.createElement('button');
    container.appendChild(btn);
    document.body.appendChild(container);
    btn.focus();
    ctrlZ(btn);
    await Promise.resolve();
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+Shift+Z is not Undo', () => {
    const undo = vi.fn();
    VexUndo.offer({ message: 'a', undo });
    ctrlZ(document.body, { shiftKey: true });
    expect(undo).not.toHaveBeenCalled();
  });
});

describe('putting records back', () => {
  const ids = (list) => list.map(x => x.id);

  it('beside the record that was before it', () => {
    const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const removed = VexUndo.takeOut(list, x => x.id === 'b');
    expect(ids(list)).toEqual(['a', 'c']);
    list.unshift({ id: 'new' });          // something added meanwhile
    VexUndo.putBack(list, removed);
    expect(ids(list)).toEqual(['new', 'a', 'b', 'c']);
  });

  it('before the one after it when the one before went too, else at its old place', () => {
    const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const removed = VexUndo.takeOut(list, x => x.id === 'b');
    list.splice(0, 1);                    // 'a' went meanwhile
    VexUndo.putBack(list, removed);
    expect(ids(list)).toEqual(['b', 'c']);
    const lone = [{ id: 'x' }];
    const r2 = VexUndo.takeOut(lone, () => true);
    VexUndo.putBack(lone, r2);
    expect(ids(lone)).toEqual(['x']);
  });

  it('never twice', () => {
    const list = [{ id: 'a' }, { id: 'b' }];
    const removed = VexUndo.takeOut(list, x => x.id === 'a');
    list.push({ id: 'a' });               // came back by sync
    VexUndo.putBack(list, removed);
    expect(ids(list)).toEqual(['b', 'a']);
  });

  it('several at once, each in its place', () => {
    const list = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id }));
    const removed = VexUndo.takeOutAll(list, x => ['b', 'c', 'e'].includes(x.id));
    expect(ids(list)).toEqual(['a', 'd']);
    VexUndo.putBackAll(list, removed);
    expect(ids(list)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('records a store moved to the top go back where they were', () => {
    const list = ['a', 'b', 'c', 'd'].map(id => ({ id }));
    const removed = VexUndo.takeOutAll(list, x => x.id === 'c');
    const merged = [{ id: 'c' }, { id: 'a' }, { id: 'b' }, { id: 'd' }];
    VexUndo.reposition(merged, removed);
    expect(ids(merged)).toEqual(['a', 'b', 'c', 'd']);
  });
});
