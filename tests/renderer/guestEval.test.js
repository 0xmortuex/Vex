// @vitest-environment jsdom
//
// The AI agent sat at "Agent started: …" for ever — no step, no error. Its
// first act is to read the page, and a bare `await webview.executeJavaScript`
// never settles on a tab with no committed document: Electron holds the call
// until the page loads, and a tab whose only navigation became a download (or
// any 204) never loads one. Nothing is thrown, so try/catch did nothing.
// vexGuestEval answers at once for such a tab and gives every other page a
// deadline.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { vexGuestEval } = require('../../src/renderer/js/vex-utils.js');
const never = () => new Promise(() => {});

afterEach(() => { vi.useRealTimers(); });

describe('vexGuestEval', () => {
  it('answers at once for a tab with no page loaded', async () => {
    const wv = { getURL: () => '', isLoading: () => false, executeJavaScript: vi.fn(never) };
    await expect(vexGuestEval(wv, '1')).rejects.toThrow(/no page loaded \(a download link/);
    expect(wv.executeJavaScript).not.toHaveBeenCalled();
  });

  it('gives a page that is still loading its chance, with a deadline', async () => {
    vi.useFakeTimers();
    const wv = { getURL: () => '', isLoading: () => true, executeJavaScript: vi.fn(never) };
    const p = vexGuestEval(wv, '1');
    const caught = p.catch(e => e.message);
    await vi.advanceTimersByTimeAsync(8000);
    expect(await caught).toBe('The page did not answer within 8 s');
    expect(wv.executeJavaScript).toHaveBeenCalledTimes(1);
  });

  it('passes the script, the gesture flag and the answer through', async () => {
    const wv = { getURL: () => 'https://x.example/', isLoading: () => false, executeJavaScript: vi.fn(async () => ({ ok: 1 })) };
    expect(await vexGuestEval(wv, 'document.title', true)).toEqual({ ok: 1 });
    expect(wv.executeJavaScript).toHaveBeenCalledWith('document.title', true);
    wv.executeJavaScript = vi.fn(async () => { throw new Error('Script failed'); });
    await expect(vexGuestEval(wv, 'x')).rejects.toThrow('Script failed');
  });

  it('honours its own deadline and copes with a minimal webview', async () => {
    vi.useFakeTimers();
    const wv = { executeJavaScript: vi.fn(never) };              // no getURL / isLoading at all
    const caught = vexGuestEval(wv, '1', false, 2000).catch(e => e.message);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await caught).toBe('The page did not answer within 2 s');
    await expect(vexGuestEval(null, '1')).rejects.toThrow(/No page to read/);
  });
});

describe('the AI paths use it', () => {
  it('no bare guest call is left in the extractors or the agent executor', () => {
    for (const f of ['dom-extractor.js', 'page-context.js', 'agent-executor.js']) {
      const src = readFileSync(join(__dirname, '../../src/renderer/js', f), 'utf8');
      expect(src, f).not.toMatch(/\.executeJavaScript\(/);
      expect(src, f).toMatch(/window\.vexGuestEval\(/);
    }
  });
});
