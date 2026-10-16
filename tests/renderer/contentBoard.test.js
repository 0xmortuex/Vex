// @vitest-environment jsdom
//
// js/content-board.js (T3-061): stages, due dates in the calendar, checklists that tick from an upload page.
import { describe, it, expect, beforeEach, vi } from 'vitest';

globalThis.VexMediaKit = require('../../src/renderer/js/media-kit.js').VexMediaKit;
const { VexContentBoard } = require('../../src/renderer/js/content-board.js');

beforeEach(() => {
  localStorage.clear();
  VexContentBoard.setEnabled(true);
  globalThis.TabManager = { activeTabId: 't1', getActiveTab: () => ({ url: 'https://studio.example/upload', title: 'Upload' }) };
  globalThis.WebviewManager = { webviews: new Map([['t1', { getURL: () => 'https://studio.example/upload' }]]) };
  window.VexTabPolicy = { isPrivateWindow: false, canReadWebview: () => true };
  window.vexGuestEval = vi.fn(async () => []);
});

describe('the cards', () => {
  it('adds a card at a stage with a due date, moves it, and refuses nonsense', () => {
    const c = VexContentBoard.add({ title: 'Weekly recap', due: 5000 });
    expect(c.stage).toBe('Idea');
    expect(VexContentBoard.update(c.id, { stage: 'Draft' }).stage).toBe('Draft');
    expect(() => VexContentBoard.update(c.id, { stage: 'Soon' })).toThrow(/Unknown stage/);
    expect(() => VexContentBoard.add({ title: ' ' })).toThrow(/title/);
    expect(() => VexContentBoard.update('nope', { stage: 'Edit' })).toThrow(/not on the board/);
    VexContentBoard.remove(c.id);
    expect(VexContentBoard.cards()).toEqual([]);
  });
  it('throws, rather than starting again, when the saved board is damaged', () => {
    localStorage.setItem('vex.contentBoard', 'oops');
    expect(() => VexContentBoard.cards()).toThrow(/not readable/);
  });
  it('shows due dates of unpublished cards in the calendar only', () => {
    const a = VexContentBoard.add({ title: 'A', due: 1000 });
    VexContentBoard.add({ title: 'B', due: 2000, stage: 'Published' });
    VexContentBoard.add({ title: 'C', due: 9000 });
    const ev = VexContentBoard.calendarEvents(0, 5000);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ summary: 'A (Idea)', start: 1000, calendar: 'Content' });
    expect(a.id).toBeTruthy();
  });
});

describe('the checklists', () => {
  it('gives a platform its starting list, once, and keeps ticks and added lines', () => {
    const c = VexContentBoard.add({ title: 'Video' });
    VexContentBoard.addPlatform(c.id, 'YouTube');
    expect(() => VexContentBoard.addPlatform(c.id, 'YouTube')).toThrow(/already/);
    expect(() => VexContentBoard.addPlatform(c.id, 'MySpace')).toThrow(/Choose/);
    VexContentBoard.tick(c.id, 'YouTube', 0, true);
    VexContentBoard.addCheck(c.id, 'YouTube', 'Pin a comment');
    const p = VexContentBoard.cards()[0].platforms[0];
    expect(p.items[0].done).toBe(true);
    expect(p.items[p.items.length - 1].label).toBe('Pin a comment');
  });
  it('ticks the lines whose field is filled in on the page, and no others', () => {
    const items = VexContentBoard.TEMPLATES.YouTube.map(([label, words]) => ({ label, words, done: false }));
    const ticks = VexContentBoard.autoTick(items, [{ label: 'Add a title that describes your video', filled: true }, { label: 'Description', filled: false }, { label: 'Tags', filled: true }]);
    expect(ticks.map(i => items[i].label)).toEqual(['Title', 'Tags']);
  });
  it('reads the open upload page when asked and ticks from it', async () => {
    const c = VexContentBoard.add({ title: 'Video' });
    VexContentBoard.addPlatform(c.id, 'YouTube');
    window.vexGuestEval = vi.fn(async () => [{ label: 'Title', filled: true }, { label: 'Description', filled: true }]);
    expect(await VexContentBoard.checkPage(c.id, 'YouTube')).toBe(2);
    expect(VexContentBoard.cards()[0].platforms[0].items.filter(i => i.done).map(i => i.label)).toEqual(['Title', 'Description']);
  });
  it('never reads a private or protected tab', async () => {
    const c = VexContentBoard.add({ title: 'Video' });
    VexContentBoard.addPlatform(c.id, 'YouTube');
    window.VexTabPolicy.canReadWebview = () => false;
    await expect(VexContentBoard.checkPage(c.id, 'YouTube')).rejects.toThrow(/cannot be read/);
    expect(window.vexGuestEval).not.toHaveBeenCalled();
  });
  it('refuses a bad match pattern instead of ignoring the line', () => {
    expect(() => VexContentBoard.autoTick([{ label: 'x', words: '(', done: false }], [])).toThrow(/bad match pattern/);
  });
});

describe('sources', () => {
  it('keeps a page once, as an http(s) address only', () => {
    const c = VexContentBoard.add({ title: 'Article' });
    VexContentBoard.addSource(c.id, 'https://a.example/x', 'A');
    expect(() => VexContentBoard.addSource(c.id, 'https://a.example/x', 'A')).toThrow(/already/);
    expect(() => VexContentBoard.addSource(c.id, 'file:///c:/x', 'A')).toThrow(/Only a web address/);
    expect(VexContentBoard.cards()[0].sources).toHaveLength(1);
  });
});
