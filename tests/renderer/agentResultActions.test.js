// @vitest-environment jsdom
//
// An agent's answer can become a calendar entry (.ics, at a time the user
// types) or a new email in their own mail app — the answer, not a retyping.
import { describe, it, expect, vi, beforeEach } from 'vitest';
require('../../src/renderer/js/vex-utils.js');
const { AgentLoop } = require('../../src/renderer/js/agent-loop.js');
const { VexQuickReminder } = require('../../src/renderer/js/quick-reminder.js');
const { mailtoUrl, MAX_URL } = require('../../src/main/mail-draft.js');

let saved;
beforeEach(() => {
  document.body.innerHTML = '<div id="ai-messages"></div>';
  globalThis.VexQuickReminder = VexQuickReminder;
  saved = [];
  window.showToast = vi.fn();
  window.vex = {
    saveTextFile: vi.fn(async (name, text, kind) => { saved.push({ name, text, kind }); return { ok: true, path: 'C:/x/' + name }; }),
    composeMail: vi.fn(async () => ({ ok: true })),
  };
});

describe('the answer\'s buttons', () => {
  it('are there under every final answer', () => {
    AgentLoop._renderFinal('The venue is **free** on Friday.', 'Find a venue');
    const acts = [...document.querySelectorAll('.agent-final-actions button')].map(b => b.dataset.act);
    expect(acts).toEqual(['note', 'copy', 'calendar', 'mail']);
  });

  it('Add to calendar asks when, and saves an .ics with the goal as its title and the answer inside', async () => {
    globalThis.vexPrompt = vi.fn(async () => 'in 2 days');
    const path = await AgentLoop.toCalendar('Find a venue', 'The venue is free on Friday.');
    expect(path).toMatch(/\.ics$/);
    expect(saved[0].kind).toBe('ics');
    const ics = saved[0].text.replace(/\r\n /g, '');
    expect(ics).toContain('SUMMARY:Find a venue');
    expect(ics).toContain('DESCRIPTION:Find a venue\\n\\nThe venue is free on Friday.');
  });

  it('a time it cannot read is said, and nothing is saved; cancelling saves nothing either', async () => {
    globalThis.vexPrompt = vi.fn(async () => 'whenever');
    await expect(AgentLoop.toCalendar('g', 's')).rejects.toThrow(/Could not read/);
    globalThis.vexPrompt = vi.fn(async () => null);
    expect(await AgentLoop.toCalendar('g', 's')).toBeNull();
    expect(saved).toEqual([]);
  });

  it('Email draft hands the goal and answer to the mail app', async () => {
    await AgentLoop.toMail('Find a venue\nmore', 'The answer');
    expect(window.vex.composeMail).toHaveBeenCalledWith('Find a venue', 'The answer');
  });
});

describe('the mailto: link', () => {
  it('has no recipient, and carries the subject and body', () => {
    const u = mailtoUrl('Venue & dates', 'Line one\nLine two');
    expect(u.startsWith('mailto:?subject=')).toBe(true);
    const q = new URLSearchParams(u.slice('mailto:?'.length));
    expect(q.get('subject')).toBe('Venue & dates');
    expect(q.get('body')).toBe('Line one\r\nLine two');
  });

  it('shortens a long body to fit, and says so', () => {
    const u = mailtoUrl('s', 'word '.repeat(2000));
    expect(u.length).toBeLessThanOrEqual(MAX_URL);
    expect(decodeURIComponent(u)).toMatch(/\[Shortened: the full text is in Vex\.\]$/);
  });
});
