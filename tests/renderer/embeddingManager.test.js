// @vitest-environment jsdom
//
// T2-021: js/embedding-manager.js lists suitable models, says which are installed and
// in use, and only downloads or switches after asking.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { VexEmbedManager: E } = require('../../src/renderer/js/embedding-manager.js');

beforeEach(() => {
  localStorage.clear();
  delete globalThis.Ollama; delete globalThis.Recall; delete globalThis.vexConfirm;
});

describe('rows and the status line', () => {
  it('marks installed and active models, tolerating :latest', () => {
    const rows = E.rows([{ name: 'nomic-embed-text:latest', size: 274e6 }], 'nomic-embed-text');
    const nomic = rows.find(r => r.name === 'nomic-embed-text');
    expect(nomic.installed).toBe(true);
    expect(nomic.active).toBe(true);
    expect(rows.find(r => r.name === 'all-minilm').installed).toBe(false);
  });
  it('shows a model set by hand that is not in the list', () => {
    const rows = E.rows([], 'my-own-embed');
    expect(rows[rows.length - 1]).toMatchObject({ name: 'my-own-embed', custom: true, active: true, installed: false });
  });
  it('says the fallback when nothing is chosen, and when the model is missing', () => {
    expect(E.statusLine('', [], null)).toMatch(/keyword search/);
    expect(E.statusLine('nomic-embed-text', [], null)).toMatch(/not installed/);
    expect(E.statusLine('nomic-embed-text', [{ name: 'nomic-embed-text:latest' }], { understood: 10, pages: 50 })).toMatch(/10 of 50 pages understood, 40 to go/);
  });
  it('sizes read as MB or GB', () => { expect(E.sizeText(274)).toBe('274 MB'); expect(E.sizeText(1200)).toBe('1.2 GB'); });
});

describe('actions ask first', () => {
  it('does not download when the person says no', async () => {
    const pull = vi.fn();
    globalThis.Ollama = { pullModel: pull };
    globalThis.vexConfirm = vi.fn(async () => false);
    expect(await E.install({ name: 'nomic-embed-text', mb: 274 })).toBe(false);
    expect(pull).not.toHaveBeenCalled();
    expect(globalThis.vexConfirm.mock.calls[0][0].message).toMatch(/274 MB/);
  });
  it('downloads with progress after a yes', async () => {
    const pull = vi.fn(async (name, cb) => { cb({ status: 'pulling', total: 10, completed: 5 }); });
    globalThis.Ollama = { pullModel: pull };
    globalThis.vexConfirm = vi.fn(async () => true);
    const seen = [];
    expect(await E.install({ name: 'all-minilm', mb: 46 }, { onProgress: e => seen.push(e.completed) })).toBe(true);
    expect(seen).toEqual([5]);
  });
  it('refuses to use a model that is not installed', async () => {
    globalThis.Recall = { meaningModel: () => '', setMeaningModel: vi.fn() };
    await expect(E.use({ name: 'bge-m3', installed: false })).rejects.toThrow(/Install bge-m3 first/);
  });
  it('switches the model only after a yes, and says the numbers are rebuilt', async () => {
    const set = vi.fn();
    globalThis.Recall = { meaningModel: () => 'old-model', setMeaningModel: set };
    globalThis.vexConfirm = vi.fn(async () => false);
    expect(await E.use({ name: 'all-minilm', installed: true })).toBe(false);
    expect(set).not.toHaveBeenCalled();
    expect(globalThis.vexConfirm.mock.calls[0][0].message).toMatch(/deleted and rebuilt/);
    globalThis.vexConfirm = vi.fn(async () => true);
    expect(await E.use({ name: 'all-minilm', installed: true })).toBe(true);
    expect(set).toHaveBeenCalledWith('all-minilm');
  });
  it('turning it off asks and clears the model', async () => {
    const set = vi.fn();
    globalThis.Recall = { meaningModel: () => 'x', setMeaningModel: set };
    globalThis.vexConfirm = vi.fn(async () => true);
    await E.turnOff();
    expect(set).toHaveBeenCalledWith('');
  });
});

describe('state', () => {
  it('says Ollama is not running instead of pretending', async () => {
    globalThis.Ollama = { ping: async () => false };
    const s = await E.state();
    expect(s.ok).toBe(false);
    expect(s.error).toMatch(/not running/);
  });
});
