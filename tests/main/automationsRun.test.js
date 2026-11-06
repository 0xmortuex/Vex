// Page automations: the runner. A fake page window (jsdom documents), a fake
// person answering the prompts. Every safety rule has a test here:
//   consequential steps pause, secrets are never filled, a missing control STOPS
//   the run (never a guess), CAPTCHAs stop it, the limits end it.
import { describe, expect, it } from 'vitest';

const M = require('../../src/renderer/js/automations-model.js');
const { createRunner } = require('../../src/main/automations-run.js');
const { createFakeDriver, recording, open } = require('../helpers/automationsFake.js');

const HOME = `<html><body>
  <h1>Grades</h1>
  <label for="q">Search term</label><input id="q" name="q" type="text">
  <button id="search" type="button" onclick="window.searched=(document.getElementById('q').value||'(none)')">Search</button>
  <button id="dl" type="button" onclick="window.downloaded=true;window.__goto='/report'">Download report</button>
  <select id="term" name="term" aria-label="Term"><option value="a">Autumn 2025</option><option value="b">Spring 2026</option></select>
  <label><input id="agree" type="checkbox"> Remember my choice</label>
  <span id="gpa">GPA: 3.7</span>
  <form method="post" action="/order"><input name="item" aria-label="Item"><input type="password" id="pw" aria-label="Password"><button type="submit" id="buy" onclick="window.bought=true;return false">Place order</button></form>
</body></html>`;
const REPORT = '<html><body><h1>Report</h1><p id="total">Total: 42 credits</p><button id="back" type="button" onclick="window.wentBack=true">Back</button></body></html>';
const CHANGED = '<html><body><button id="dl" type="button" onclick="window.downloaded=true">Export</button><button id="decoy" type="button" onclick="window.decoyClicked=true">Download</button></body></html>';
const TWINS = '<html><body><button class="t" onclick="window.first=true">Download</button><button class="t" onclick="window.second=true">Download</button></body></html>';

function setup(pages, { rec, answers = [], clock = { t: 1_000_000 }, allowLocal = true } = {}) {
  const driver = createFakeDriver(pages);
  const asked = [];
  const queue = Array.isArray(answers) ? [...answers] : answers;
  const approve = async (req) => {
    asked.push(req);
    const a = typeof queue === 'function' ? queue(req) : queue.shift();
    if (a && a.advance) clock.t += a.advance;
    return a && a.decision ? a.decision : (a || 'approve');
  };
  const runner = createRunner({ now: () => clock.t, sleep: async (ms) => { clock.t += ms; }, allowLocal });
  const stopped = { v: false };
  const go = (r) => runner.run(M.normalizeRecording(r || rec), { driver, approve, isStopped: () => stopped.v, runId: 'run1' });
  return { driver, asked, go, stopped, clock };
}
const step = (type, name, extra = {}) => ({ type, ...extra, target: { role: type === 'type' ? 'textbox' : 'button', name, tag: type === 'type' ? 'input' : 'button', ...(extra.target || {}) } });

describe('replay', () => {
  it('opens a page, types, chooses, ticks, clicks, follows the navigation and reads a value', async () => {
    const { driver, go } = setup({ '/home': HOME, '/report': REPORT });
    const r = await go(recording([
      open('http://127.0.0.1:9/home'),
      { type: 'type', value: 'maths', target: { role: 'textbox', name: 'Search term', tag: 'input', css: '#q' } },
      { type: 'select', value: 'Spring 2026', target: { role: 'combobox', name: 'Term', tag: 'select', css: '#term' } },
      { type: 'check', checked: true, target: { role: 'checkbox', name: 'Remember my choice', tag: 'input', css: '#agree' } },
      step('click', 'Search'),
      { type: 'read', as: 'gpa', target: { text: 'GPA: 3.7', name: 'GPA: 3.7' } },
      step('click', 'Download report'),
      { type: 'read', as: 'total', target: { name: 'Total: 42 credits', text: 'Total: 42 credits' } },
    ]));
    expect(r.status).toBe('ok');
    expect(r.reads.map(x => x.text)).toEqual(['GPA: 3.7', 'Total: 42 credits']);
    expect(driver.loads).toEqual(['http://127.0.0.1:9/home', 'http://127.0.0.1:9/report']);
  });

  it('PAUSES at a submit step and does nothing until the person approves (approve, skip, stop, nobody)', async () => {
    const steps = () => recording([open('http://127.0.0.1:9/home'), step('click', 'Place order'), { type: 'wait', ms: 100 }]);
    // approved
    let s = setup({ '/home': HOME }, { answers: ['approve'] });
    let r = await s.go(steps());
    expect(s.asked).toHaveLength(1);
    expect(s.asked[0]).toMatchObject({ kind: 'consequence', locked: true, consequence: 'pay', index: 1 });
    expect(s.driver.window.bought).toBe(true);
    expect(r.status).toBe('ok');
    // skipped: the run goes on, the click does not happen
    s = setup({ '/home': HOME }, { answers: ['skip'] });
    r = await s.go(steps());
    expect(s.driver.window.bought).toBeUndefined();
    expect(r.status).toBe('ok');
    expect(r.log.some(e => e.outcome === 'skipped')).toBe(true);
    // stopped
    s = setup({ '/home': HOME }, { answers: ['stop'] });
    r = await s.go(steps());
    expect(r.status).toBe('stopped');
    expect(s.driver.window.bought).toBeUndefined();
    // nobody answered: needs approval, nothing done, later steps not run
    s = setup({ '/home': HOME }, { answers: ['timeout'] });
    r = await s.go(steps());
    expect(r.status).toBe('needs-approval');
    expect(s.driver.window.bought).toBeUndefined();
    expect(r.log.some(e => e.outcome === 'ok' && e.label.startsWith('Wait'))).toBe(false);
  });

  it('a payment/delete step asks even if the file says run, and even if it was recorded as harmless', async () => {
    const raw = recording([open('http://127.0.0.1:9/home'), step('click', 'Place order', { confirm: 'run', locked: false })]);
    const s = setup({ '/home': HOME }, { answers: ['stop'] });
    const r = await s.go(raw);
    expect(s.asked).toHaveLength(1);
    expect(r.status).toBe('stopped');
    expect(s.driver.window.bought).toBeUndefined();
  });

  it('a control that BECAME consequential since the recording asks (the page is re-checked right before the click)', async () => {
    const page = '<html><body><button id="b" aria-label="Account" title="Delete account" onclick="window.gone=true">Account</button></body></html>';
    const raw = recording([open('http://127.0.0.1:9/p'), { type: 'click', target: { role: 'button', name: 'Account', tag: 'button', css: '#b' } }]);
    const rec = M.normalizeRecording(raw);
    expect(rec.steps[1].consequence).toBeUndefined();   // harmless when recorded
    const s = setup({ '/p': page }, { answers: ['stop'] });
    const r = await s.go(raw);
    expect(s.asked).toHaveLength(1);
    expect(s.asked[0].consequence).toBe('delete');
    expect(r.status).toBe('stopped');
    expect(s.driver.window.gone).toBeUndefined();
  });

  it('a form button (soft) asks by default and runs without asking when the person set it to run', async () => {
    const page = '<html><body><form method="post" action="/x"><input aria-label="Note"><button type="submit" onclick="window.sent=1;return false">Proceed</button></form></body></html>';
    const mk = (confirm) => recording([open('http://127.0.0.1:9/p'), { type: 'click', confirm, target: { role: 'button', name: 'Proceed', tag: 'button', type: 'submit', inForm: true, formMethod: 'post', formAction: 'http://127.0.0.1:9/x' } }]);
    let s = setup({ '/p': page }, { answers: ['stop'] });
    expect((await s.go(mk(undefined))).status).toBe('stopped');
    s = setup({ '/p': page }, { answers: [] });
    const r = await s.go(mk('run'));
    expect(s.asked).toHaveLength(0);
    expect(r.status).toBe('ok');
    expect(s.driver.window.sent).toBe(1);
  });
});

describe('a step that cannot be found STOPS the run', () => {
  it('names the step, the reason, keeps a screenshot, and never clicks a look-alike', async () => {
    const s = setup({ '/home': HOME, '/changed': CHANGED });
    const raw = recording([open('http://127.0.0.1:9/changed'), step('click', 'Download report'), step('click', 'Search')]);
    const r = await s.go(raw);
    expect(r.status).toBe('failed');
    expect(r.failure).toMatchObject({ index: 1, reason: 'not-found', label: expect.stringContaining('Download report') });
    expect(r.failure.screenshot).toMatch(/^data:image\/jpeg/);
    expect(r.failure.message).toMatch(/not found/i);
    expect(s.driver.window.downloaded).toBeUndefined();
    expect(s.driver.window.decoyClicked).toBeUndefined();    // "Download" is close but is not it
    expect(r.log.filter(e => e.outcome === 'ok').length).toBe(1);   // only the open
  });

  it('accepts a close spelling for an ordinary step and says so in the log, never for a consequential one', async () => {
    const page = '<html><body><button onclick="window.dl=1">Download reports</button><button onclick="window.buy=1">Place orders</button></body></html>';
    let s = setup({ '/p': page });
    let r = await s.go(recording([open('http://127.0.0.1:9/p'), step('click', 'Download report')]));
    expect(r.status).toBe('ok');
    expect(s.driver.window.dl).toBe(1);
    expect(r.log.at(-1).detail).toMatch(/similar/i);
    s = setup({ '/p': page }, { answers: ['approve'] });
    r = await s.go(recording([open('http://127.0.0.1:9/p'), step('click', 'Place order')]));
    expect(r.status).toBe('failed');
    expect(r.failure.reason).toBe('not-found');
    expect(s.driver.window.buy).toBeUndefined();
    expect(s.asked).toHaveLength(0);
  });

  it('stops on two matches rather than picking one', async () => {
    const s = setup({ '/p': TWINS });
    const r = await s.go(recording([open('http://127.0.0.1:9/p'), step('click', 'Download')]));
    expect(r.status).toBe('failed');
    expect(r.failure.reason).toBe('ambiguous');
    expect(s.driver.window.first).toBeUndefined();
    expect(s.driver.window.second).toBeUndefined();
  });

  it('tells hidden and disabled controls apart from missing ones', async () => {
    const page = '<html><body><button style="display:none" id="h">Download report</button><button disabled id="d">Search</button></body></html>';
    let s = setup({ '/p': page });
    let r = await s.go(recording([open('http://127.0.0.1:9/p'), step('click', 'Download report')]));
    expect(r.failure.reason).toBe('hidden');
    s = setup({ '/p': page });
    r = await s.go(recording([open('http://127.0.0.1:9/p'), step('click', 'Search')]));
    expect(r.failure.reason).toBe('disabled');
  });

  it('tells two same-named buttons apart by the heading above them when it can', async () => {
    const page = '<html><body><section><h2>Course A</h2><button onclick="window.a=1">Download</button></section><section><h2>Course B</h2><button onclick="window.b=1">Download</button></section></body></html>';
    const s = setup({ '/p': page });
    const r = await s.go(recording([open('http://127.0.0.1:9/p'), step('click', 'Download', { target: { near: 'Course B' } })]));
    expect(r.status).toBe('ok');
    expect(s.driver.window.b).toBe(1);
    expect(s.driver.window.a).toBeUndefined();
  });

  it('a failure in the page itself ends the run with the reason, not a hang', async () => {
    const s = setup({ '/p': HOME });
    s.driver.evaluate = async () => { throw new Error('Script failed to execute'); };
    const r = await s.go(recording([open('http://127.0.0.1:9/p'), step('click', 'Search')]));
    expect(r.status).toBe('failed');
  });
});

describe('secrets are never typed', () => {
  it('a password step asks the person, reveals the window, and types nothing', async () => {
    const raw = recording([open('http://127.0.0.1:9/home'), { type: 'type', value: 'hunter2', target: { role: 'textbox', name: 'Password', tag: 'input', type: 'password', css: '#pw' } }]);
    const s = setup({ '/home': HOME }, { answers: ['approve'] });
    const r = await s.go(raw);
    expect(s.asked[0]).toMatchObject({ kind: 'fill' });
    expect(s.driver.revealed).toBe(1);
    expect(s.driver.document.getElementById('pw').value).toBe('');
    expect(r.status).toBe('ok');
    expect(JSON.stringify(r)).not.toContain('hunter2');
  });
  it('an unattended password step that nobody answers ends as needs-approval', async () => {
    const raw = recording([open('http://127.0.0.1:9/home'), { type: 'type', target: { role: 'textbox', name: 'Password', tag: 'input', type: 'password', css: '#pw' } }]);
    const s = setup({ '/home': HOME }, { answers: ['timeout'] });
    expect((await s.go(raw)).status).toBe('needs-approval');
  });
  it('a stored text step that now points at a password field is refused (the page changed)', async () => {
    const raw = recording([open('http://127.0.0.1:9/home'), { type: 'type', value: 'maths', target: { role: 'textbox', name: 'Password', tag: 'input', css: '#q' } }]);
    // The recorded name says Password but the field is the search box; with a different page below it is a real password field:
    const page = '<html><body><label for="x">Notes</label><input id="x" type="password"></body></html>';
    const s = setup({ '/p': page });
    const r = await s.go(recording([open('http://127.0.0.1:9/p'), { type: 'type', value: 'plain', target: { role: 'textbox', name: 'Notes', tag: 'input', css: '#x' } }]));
    expect(r.status).toBe('failed');
    expect(r.failure.reason).toBe('sensitive-field');
    expect(s.driver.document.getElementById('x').value).toBe('');
    expect(raw.steps).toBeDefined();
  });
  it('never reads a secret field', async () => {
    const s = setup({ '/home': HOME });
    const r = await s.go(recording([open('http://127.0.0.1:9/home'), { type: 'read', as: 'x', target: { role: 'textbox', name: 'Password', tag: 'input', css: '#pw' } }]));
    expect(r.status).toBe('failed');
    expect(r.failure.reason).toBe('sensitive-field');
    expect(r.reads).toEqual([]);
  });
  it('redacts a card number or a code that appears in what was read', async () => {
    const page = '<html><body><p id="c">Card 4111 1111 1111 1111 and your code is 482913</p></body></html>';
    const s = setup({ '/p': page });
    const r = await s.go(recording([open('http://127.0.0.1:9/p'), { type: 'read', as: 'x', target: { css: '#c' } }]));
    expect(r.reads[0].text).not.toContain('4111');
    expect(r.reads[0].text).not.toContain('482913');
  });
});

describe('CAPTCHA and navigation', () => {
  it('stops and asks the person when a CAPTCHA widget appears; does not touch it', async () => {
    const page = '<html><body><div class="g-recaptcha" data-sitekey="k"></div><button onclick="window.clicked=1">Search</button></body></html>';
    const s = setup({ '/p': page });
    const r = await s.go(recording([open('http://127.0.0.1:9/p'), step('click', 'Search')]));
    expect(r.status).toBe('needs-you');
    expect(r.failure.reason).toBe('captcha');
    expect(s.driver.window.clicked).toBeUndefined();
  });
  it('also stops on a "verify you are human" page', async () => {
    const s = setup({ '/p': '<html><body><h1>Please verify you are human</h1></body></html>' });
    const r = await s.go(recording([open('http://127.0.0.1:9/p'), { type: 'wait', ms: 100 }]));
    expect(r.status).toBe('needs-you');
  });
  it('refuses local and private addresses unless the test switch is on, and file downloads always', async () => {
    let s = setup({ '/p': HOME }, { allowLocal: false });
    let r = await s.go(recording([open('http://192.168.0.5/p')]));
    expect(r.status).toBe('failed');
    expect(r.failure.reason).toBe('navigation-refused');
    s = setup({ '/p': HOME });
    r = await s.go(recording([open('http://127.0.0.1:9/p'), open('http://127.0.0.1:9/tool.exe')]));
    expect(r.failure.reason).toBe('navigation-refused');
  });
  it('a page that does not load is a failure with the reason', async () => {
    const s = setup({});
    const r = await s.go(recording([open('http://127.0.0.1:9/nope')]));
    expect(r.failure.reason).toBe('load-failed');
  });
});

describe('limits', () => {
  it('ends a run that takes longer than its budget, but not because it waited for the person', async () => {
    const clock = { t: 5_000_000 };
    let s = setup({ '/p': HOME }, { clock });
    let r = await s.go(recording([open('http://127.0.0.1:9/p'), { type: 'wait', ms: 25000 }, { type: 'wait', ms: 25000 }, step('click', 'Search')], { maxRunMs: 30000 }));
    expect(r.status).toBe('limit');
    expect(r.failure.reason).toBe('duration');
    // the same run, but a ten-minute wait for the person in the middle does not count
    s = setup({ '/p': HOME }, { clock: { t: 9_000_000 }, answers: [{ decision: 'approve', advance: 600000 }] });
    r = await s.go(recording([open('http://127.0.0.1:9/p'), step('click', 'Place order'), step('click', 'Search')], { maxRunMs: 30000 }));
    expect(r.status).toBe('ok');
  });
  it('Stop ends the run before the next step', async () => {
    const s = setup({ '/p': HOME });
    s.stopped.v = true;
    const r = await s.go(recording([open('http://127.0.0.1:9/p'), step('click', 'Search')]));
    expect(r.status).toBe('stopped');
    expect(s.driver.loads).toEqual([]);
  });
  it('runs every step at most once, in order (no loops)', async () => {
    const s = setup({ '/p': HOME });
    const r = await s.go(recording([open('http://127.0.0.1:9/p'), step('click', 'Search'), step('click', 'Search')]));
    expect(r.log.filter(e => e.outcome === 'ok')).toHaveLength(3);
    expect(r.stepsRun).toBe(3);
  });
  it('the summary step only flags that a summary was asked for; the runner sends nothing anywhere', async () => {
    const s = setup({ '/p': HOME });
    const r = await s.go(recording([open('http://127.0.0.1:9/p'), { type: 'read', as: 'gpa', target: { text: 'GPA: 3.7', name: 'GPA: 3.7' } }, { type: 'summarise', prompt: 'Summarise' }]));
    expect(r.summariseRequested).toBe(true);
    expect(r.reads).toHaveLength(1);
  });
});
