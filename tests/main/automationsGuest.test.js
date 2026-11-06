// Page automations: the code that runs inside the page (finder, recorder, CAPTCHA check), run in jsdom.
import { describe, expect, it } from 'vitest';
const { JSDOM } = require('jsdom');
const G = require('../../src/renderer/js/automations-guest.js');
const M = require('../../src/renderer/js/automations-model.js');

function page(html) {
  const dom = new JSDOM('<!doctype html><body>' + html + '</body>', { url: 'https://example.com/', runScripts: 'dangerously', pretendToBeVisual: true });
  const call = (method, ...args) => dom.window.eval(G.call(method, args));
  return { dom, doc: dom.window.document, call };
}

describe('finding a control', () => {
  it('prefers role + name, then text, then the label of a field', () => {
    const p = page('<label for="a">Student ID</label><input id="a"><button>Search</button><a href="/x">Search</a>');
    expect(p.call('probe', { target: { role: 'button', name: 'Search' } })).toMatchObject({ status: 'found', how: 'role+name', desc: { tag: 'button' } });
    expect(p.call('probe', { target: { role: 'link', name: 'Search' } })).toMatchObject({ status: 'found', how: 'role+name', desc: { tag: 'a' } });
    expect(p.call('probe', { target: { label: 'Student ID' } })).toMatchObject({ status: 'found', how: 'label', desc: { tag: 'input' } });
    expect(p.call('probe', { target: { text: 'Search', role: 'menuitem' } }).status).toBe('ambiguous');   // two things read "Search" and the role is wrong for both
  });
  it('does not accept a recorded selector when the control\'s name no longer agrees', () => {
    const p = page('<button id="b">Export</button>');
    const r = p.call('probe', { target: { role: 'button', name: 'Download report', css: '#b', tag: 'button' }, exact: true });
    expect(r.status).toBe('none');
    // a name that is close (a plural) is accepted for an ordinary step, never for an exact one
    const q = page('<button id="b">Download reports</button>');
    expect(q.call('probe', { target: { role: 'button', name: 'Download report', css: '#nothing' } })).toMatchObject({ status: 'found', how: 'similar' });
    expect(q.call('probe', { target: { role: 'button', name: 'Download report', css: '#nothing' }, exact: true }).status).toBe('none');
  });
  it('a similar name needs a clear winner', () => {
    const p = page('<button>Download reports</button><button>Download report 2</button>');
    expect(p.call('probe', { target: { role: 'button', name: 'Download report' } }).status).toBe('ambiguous');
  });
  it('folds Turkish letters and case when comparing names', () => {
    const p = page('<button>GÖNDER</button><button>Satın Al</button>');
    expect(p.call('probe', { target: { role: 'button', name: 'gönder' } }).status).toBe('found');
    expect(p.call('probe', { target: { role: 'button', name: 'satin al' } }).status).toBe('found');
    expect(p.call('probe', { target: { role: 'button', name: 'gonder' } }).consequence.level).toBe('locked');
  });
  it('re-classifies the control it found, from the page itself', () => {
    const p = page('<form method="post" action="/checkout/pay"><input type="password" aria-label="Password"><button type="submit">Go</button></form>');
    const r = p.call('probe', { target: { role: 'button', name: 'Go' } });
    expect(r.consequence.level).toBe('locked');
    expect(r.desc.formHasSensitive).toBe(true);
    expect(p.call('probe', { target: { role: 'textbox', name: 'Password' } }).sensitive).toBe(true);
  });
  it('reports a password manager\'s filled field and password-looking names as sensitive', () => {
    const p = page('<input aria-label="Entry" autocomplete="one-time-code"><input aria-label="Entry two" data-lpignore="true"><input aria-label="City">');
    expect(p.call('probe', { target: { name: 'Entry' } }).sensitive).toBe(true);
    expect(p.call('probe', { target: { name: 'Entry two' } }).sensitive).toBe(true);
    expect(p.call('probe', { target: { name: 'City' } }).sensitive).toBe(false);
  });
});

describe('acting', () => {
  it('types into a field the way a person would (input and change events), selects, ticks and presses Enter', () => {
    const p = page('<input id="q" aria-label="Search term"><select aria-label="Term"><option>Autumn 2025</option><option>Spring 2026</option></select><label><input type="checkbox" id="c"> Remember</label><form id="f" onsubmit="window.sent=1;return false"><input aria-label="Query"></form>');
    const w = p.dom.window;
    const seen = [];
    p.doc.getElementById('q').addEventListener('input', () => seen.push('input'));
    p.doc.getElementById('q').addEventListener('change', () => seen.push('change'));
    expect(p.call('act', { type: 'type', value: 'hello', target: { name: 'Search term' } }, { approvedLevel: 0 }).ok).toBe(true);
    expect(p.doc.getElementById('q').value).toBe('hello');
    expect(seen).toContain('change');
    expect(p.call('act', { type: 'select', value: 'Spring 2026', target: { name: 'Term' } }, {}).ok).toBe(true);
    expect(p.doc.querySelector('select').selectedIndex).toBe(1);
    expect(p.call('act', { type: 'select', value: 'Winter', target: { name: 'Term' } }, {})).toMatchObject({ ok: false, reason: 'option-not-found' });
    expect(p.call('act', { type: 'check', checked: true, target: { role: 'checkbox', name: 'Remember' } }, {}).ok).toBe(true);
    expect(p.doc.getElementById('c').checked).toBe(true);
    void w;
  });
  it('refuses to act above the approved level, to type into a secret, and to act on a disabled control', () => {
    const p = page('<button onclick="window.hit=1">Delete</button><input type="password" aria-label="Password"><button disabled>Search</button>');
    expect(p.call('act', { type: 'click', target: { role: 'button', name: 'Delete' } }, { approvedLevel: 0 })).toMatchObject({ ok: false, reason: 'not-approved' });
    expect(p.dom.window.hit).toBeUndefined();
    expect(p.call('act', { type: 'click', target: { role: 'button', name: 'Delete' } }, { approvedLevel: 2 }).ok).toBe(true);
    expect(p.dom.window.hit).toBe(1);
    expect(p.call('act', { type: 'type', value: 'x', target: { name: 'Password' } }, {})).toMatchObject({ ok: false, reason: 'sensitive-field' });
    expect(p.doc.querySelector('input').value).toBe('');
    expect(p.call('act', { type: 'click', target: { role: 'button', name: 'Search' } }, {})).toMatchObject({ ok: false, reason: 'disabled' });
  });
  it('reads the text of a control and never a secret field', () => {
    const p = page('<p id="g">GPA 3.7</p><input type="password" id="p" aria-label="Password" value="topsecret">');
    expect(p.call('read', { target: { css: '#g' } }, 4000)).toMatchObject({ ok: true, text: 'GPA 3.7' });
    expect(p.call('read', { target: { name: 'Password', role: 'textbox' } }, 4000)).toMatchObject({ ok: false, reason: 'sensitive-field' });
  });
});

describe('the CAPTCHA check', () => {
  it('sees a widget or the wording of a challenge page', () => {
    expect(page('<div class="g-recaptcha"></div>').call('captcha').found).toBe(true);
    expect(page('<iframe src="https://challenges.cloudflare.com/x"></iframe>').call('captcha').found).toBe(true);
    expect(page('<h1>Are you a robot?</h1>').call('captcha').found).toBe(true);
    expect(page('<h1>Welcome back</h1><p>Your grades</p>').call('captcha').found).toBe(false);
  });
});

describe('the recorder', () => {
  // Calls the listeners the recorder put on the document, with events that claim to be a person's.
  function recorder(html) {
    const p = page(html);
    const listeners = [];
    const add = p.doc.addEventListener.bind(p.doc);
    p.doc.addEventListener = (type, fn, cap) => { listeners.push({ type, fn }); add(type, fn, cap); };
    expect(p.call('recStart')).toBe('ok');
    const fire = (type, target, extra = {}) => {
      const ev = { isTrusted: true, target, preventDefault() { this.stopped = true; }, stopPropagation() {}, ...extra };
      for (const l of listeners.filter(x => x.type === type)) l.fn(ev);
      return ev;
    };
    return { ...p, fire, events: () => p.call('recDrain') };
  }
  it('turns what a person does into events: typing, a secret, a fill nobody typed, a choice, a tick, a click and Enter', () => {
    const r = recorder('<form method="post" action="/x"><label for="u">Student ID</label><input id="u"><label for="pw">Password</label><input id="pw" type="password"><label for="cc">Notes</label><input id="cc"><select aria-label="Term"><option>A</option><option>B</option></select><label><input type="checkbox" id="k"> Remember</label><button id="go" type="submit">Continue</button></form>');
    const el = (id) => r.doc.getElementById(id);
    el('u').value = 'S-1234'; r.fire('input', el('u'), { inputType: 'insertText' }); r.fire('change', el('u'));
    el('pw').value = 'hunter2'; r.fire('input', el('pw'), { inputType: 'insertText' }); r.fire('change', el('pw'));
    el('cc').value = 'filled by a manager'; r.fire('change', el('cc'));          // no typing happened
    r.doc.querySelector('select').selectedIndex = 1; r.fire('change', r.doc.querySelector('select'));
    el('k').checked = true; r.fire('change', el('k'));
    r.fire('click', el('go'));
    r.fire('keydown', el('u'), { key: 'Enter' });
    const ev = r.events();
    expect(ev.map(e => e.t)).toEqual(['type', 'ask', 'ask', 'select', 'check', 'click', 'enter']);
    expect(ev[0]).toMatchObject({ value: 'S-1234', target: { name: 'Student ID' } });
    expect(JSON.stringify(ev)).not.toContain('hunter2');
    expect(JSON.stringify(ev)).not.toContain('filled by a manager');
    expect(ev[5].target).toMatchObject({ name: 'Continue', inForm: true, formMethod: 'post' });
    // and the steps they become
    const steps = M.stepsFromEvents([{ t: 'open', url: 'https://example.com/' }, ...ev]);
    expect(steps.map(s => s.type)).toEqual(['open', 'type', 'type', 'type', 'select', 'check', 'click', 'enter']);
    expect(steps[2].ask).toBe(true);
    expect(steps[3].ask).toBe(true);
    expect(steps[6].confirm).toBe('ask');          // a form button inside a POST form
    expect(JSON.stringify(steps)).not.toContain('hunter2');
  });
  it('ignores a click the page made by script, and does not record Enter in a password field', () => {
    const r = recorder('<button id="b">Go</button><input id="pw" type="password">');
    r.fire('click', r.doc.getElementById('b'), { isTrusted: false });
    r.fire('keydown', r.doc.getElementById('pw'), { key: 'Enter' });
    expect(r.events()).toEqual([]);
  });
  it('"Read a value" takes the next click instead of letting it through', () => {
    const r = recorder('<span id="gpa">3.7</span><button id="b" onclick="window.hit=1">Go</button>');
    r.call('recPick', true);
    const ev = r.fire('click', r.doc.getElementById('gpa'));
    expect(ev.stopped).toBe(true);
    expect(r.events().map(e => e.t)).toEqual(['read']);
    r.fire('click', r.doc.getElementById('b'));
    expect(r.events().map(e => e.t)).toEqual(['click']);
  });
  it('with a token every event leaves the page at once as a console line (a click that navigates cannot take it along)', () => {
    const p = page('<button id="b">Go</button><span id="gpa">3.7</span>');
    const lines = [];
    p.dom.window.console.log = (m) => lines.push(m);
    const listeners = [];
    const add = p.doc.addEventListener.bind(p.doc);
    p.doc.addEventListener = (type, fn, cap) => { listeners.push({ type, fn }); add(type, fn, cap); };
    expect(p.call('recStart', 'tok123')).toBe('ok');
    for (const l of listeners.filter(x => x.type === 'click')) l.fn({ isTrusted: true, target: p.doc.getElementById('b'), preventDefault() {}, stopPropagation() {} });
    expect(lines).toHaveLength(1);
    expect(lines[0].startsWith('__vexrec:tok123:')).toBe(true);
    expect(JSON.parse(lines[0].slice('__vexrec:tok123:'.length))).toMatchObject({ t: 'click', target: { name: 'Go' } });
    expect(p.call('recDrain')).toEqual([]);
    // a read value is found by its id, never by the text it shows today
    p.call('recPick', true);
    for (const l of listeners.filter(x => x.type === 'click')) l.fn({ isTrusted: true, target: p.doc.getElementById('gpa'), preventDefault() {}, stopPropagation() {} });
    const read = JSON.parse(lines[1].slice('__vexrec:tok123:'.length));
    expect(read).toMatchObject({ t: 'read', as: 'gpa', target: { name: '', text: '', css: '#gpa' } });
  });
  it('stops cleanly and a second start reports the first', () => {
    const r = recorder('<button id="b">Go</button>');
    expect(r.call('recStart')).toBe('already');
    r.fire('click', r.doc.getElementById('b'));
    expect(r.call('recStop')).toHaveLength(1);
    expect(r.call('recDrain')).toEqual([]);
  });
});
