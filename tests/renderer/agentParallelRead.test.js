// @vitest-environment jsdom
//
// Reading several sources at once. Research used to be one page at a time —
// six sources, six waits. What must hold: the reads really do overlap, one bad
// source does not take the others down, and the agent cannot be talked into
// reading fifty pages in one call.
import { describe, it, expect, vi, beforeEach } from 'vitest';
const { AgentTools } = require('../../src/renderer/js/agent-tools.js');

beforeEach(() => { window.vex = {}; });

const html = (title, body) => ({
  ok: true, status: 200,
  headers: { 'content-type': 'text/html' },
  body: `<html><head><title>${title}</title></head><body><p>${body}</p></body></html>`,
});

describe('read_many', () => {
  it('reads every address and hands each one back with its text', async () => {
    window.vex.apiRequest = vi.fn(async ({ url }) => html('Page ' + url.slice(-1), 'The text of ' + url.slice(-1)));
    const out = await AgentTools.readMany(['https://a.example/1', 'https://b.example/2']);
    expect(out.map(p => p.url)).toEqual(['https://a.example/1', 'https://b.example/2']);
    expect(out.every(p => p.ok)).toBe(true);
    expect(out[0].text).toContain('The text of 1');
  });

  it('reads them at the same time, not one after another', async () => {
    let live = 0, most = 0;
    window.vex.apiRequest = vi.fn(async ({ url }) => {
      most = Math.max(most, ++live);
      await new Promise(r => setTimeout(r, 15));
      live--;
      return html('T', 'body of ' + url);
    });
    await AgentTools.readMany(['https://a.example/1', 'https://b.example/2', 'https://c.example/3']);
    expect(most).toBeGreaterThan(1);
  });

  it('one source failing does not lose the others', async () => {
    window.vex.apiRequest = vi.fn(async ({ url }) => (/bad/.test(url)
      ? { ok: false, error: 'net::ERR_NAME_NOT_RESOLVED' }
      : html('Good', 'the good text')));
    const out = await AgentTools.readMany(['https://bad.example/x', 'https://good.example/y']);
    expect(out[0]).toMatchObject({ ok: false });
    expect(out[0].error).toMatch(/ERR_NAME_NOT_RESOLVED/);
    expect(out[1]).toMatchObject({ ok: true });
  });

  it('a private address is refused like anywhere else', async () => {
    window.vex.apiRequest = vi.fn(async () => html('T', 'x'));
    const out = await AgentTools.readMany(['http://192.168.1.1/admin']);
    expect(out[0].ok).toBe(false);
    expect(window.vex.apiRequest).not.toHaveBeenCalled();
  });

  it('takes a handful at a time, not a list of fifty', async () => {
    window.vex.apiRequest = vi.fn(async () => html('T', 'x'));
    const many = Array.from({ length: 50 }, (_, i) => 'https://e.example/' + i);
    const out = await AgentTools.readMany(many);
    expect(out).toHaveLength(AgentTools.MAX_PARALLEL);
  });

  it('an empty list is a mistake worth saying out loud', async () => {
    await expect(AgentTools.readMany([])).rejects.toThrow(/needs a list/);
    await expect(AgentTools.readMany(null)).rejects.toThrow(/needs a list/);
  });
});
