// @vitest-environment jsdom
//
// The agent task runner: the plan is checked before it is shown, and a run
// cannot write without a confirmation, cannot touch a secret field, and stops
// at its budgets, the kill switch and Stop. Page steps run against a local
// stand-in page in jsdom (no network, no real site).

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { AgentSafety, AgentBudget } = require('../../src/renderer/js/agent-safety.js');
const { AgentTaskRunner, TaskRun, AgentActionLog } = require('../../src/renderer/js/agent-task-runner.js');

const guestEval = (code) => Promise.resolve((0, eval)(code));
const PAGE = 'https://shop.example/';

beforeEach(() => {
  localStorage.clear();
  AgentSafety._listeners.clear();
  AgentSafety.setEnabled(true);
  window.VexTabPolicy = { canReadWebview: () => true };
  delete globalThis.Recall;
  document.body.innerHTML = '';
  Element.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 80, height: 20, right: 80, bottom: 20 });
  Element.prototype.scrollIntoView = () => {};
});

function steps(list) {
  const p = AgentTaskRunner.parsePlan(JSON.stringify(list), { maxSteps: 50 });
  expect(p.errors).toEqual([]);
  return p.steps;
}

function harness(over = {}, budget = {}) {
  const order = [];
  const deps = {
    safety: AgentSafety,
    tab: () => ({ webview: { id: 'wv' }, url: PAGE }),
    probe: async () => ({ found: true, tag: 'input', type: 'text', name: 'q', label: 'Search', pageOrigin: 'https://shop.example' }),
    exec: async (step) => { order.push('exec:' + step.op); return { ok: true, result: 'done', summary: 'ok', text: step.op === 'read_url' ? 'LAPTOP A costs 900' : undefined, title: 'Page' }; },
    confirm: async () => { order.push('confirm'); return 'allow'; },
    confirmFresh: async () => { order.push('fresh'); return true; },
    summarize: async () => 'A is cheapest',
    ...over,
  };
  const run = (list, b = {}) => new TaskRun({ goal: 'compare', steps: steps(list), deps, budget: new AgentBudget({ maxSteps: 25, ...budget, ...b }) });
  return { deps, order, run };
}

describe('the plan', () => {
  it('lists read and write steps and always ends by writing the answer', () => {
    const p = AgentTaskRunner.parsePlan('Here you go:\n```json\n[{"op":"search","query":"laptops"},{"op":"read_url","url":"https://a.example/x"},{"op":"click","target":"Add to compare"}]\n```');
    expect(p.errors).toEqual([]);
    expect(p.steps.map(s => s.op)).toEqual(['search', 'read_url', 'click', 'summarize']);
    expect(p.steps.map(s => s.kind)).toEqual(['read', 'read', 'write', 'read']);
    expect(p.steps.map(s => s.id)).toEqual([1, 2, 3, 4]);
  });
  it('refuses the whole plan for an op outside the vocabulary', () => {
    for (const op of ['download_file', 'sign_in', 'eval', 'new_tab', 'press_key']) {
      const p = AgentTaskRunner.parsePlan(JSON.stringify([{ op: 'search', query: 'x' }, { op, url: 'https://a.example/' }]));
      expect(p.steps).toEqual([]);
      expect(p.errors.join(' ')).toMatch(/not something the agent can do/);
    }
  });
  it('refuses a plan that downloads, goes to the local network, or visits an excluded site', () => {
    globalThis.Recall = { isExcluded: (u) => /bank\.example/.test(u) };
    for (const url of ['https://a.example/setup.exe', 'http://192.168.0.1/', 'https://bank.example/', 'file:///etc/passwd']) {
      const p = AgentTaskRunner.parsePlan(JSON.stringify([{ op: 'navigate', url }]));
      expect(p.steps).toEqual([]);
      expect(p.errors.length).toBe(1);
    }
  });
  it('refuses a plan that types a password, a card number or a code', () => {
    for (const s of [
      { op: 'type', target: 'Password', text: 'hunter2' },
      { op: 'type', target: 'Search', text: '4111 1111 1111 1111' },
      { op: 'type', target: 'Code', text: '482913' },
      { op: 'select', target: 'Card number', value: 'x' },
    ]) {
      const p = AgentTaskRunner.parsePlan(JSON.stringify([s]));
      expect(p.steps).toEqual([]);
    }
  });
  it('trims to the budget and still ends with the answer', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ op: 'read_url', url: 'https://a.example/' + i }));
    const p = AgentTaskRunner.parsePlan(JSON.stringify(many), { maxSteps: 25 });
    expect(p.steps.length).toBe(25);
    expect(p.steps[24].op).toBe('summarize');
    expect(p.trimmed).toBe(6);
  });
  it('says what it cannot read', () => {
    expect(AgentTaskRunner.parsePlan('no plan here').errors[0]).toMatch(/plan I can read/);
    expect(AgentTaskRunner.parsePlan('[]').errors[0]).toMatch(/no steps/);
  });
  it('describes a write step with the exact element and value', () => {
    const s = steps([{ op: 'type', target: 'Search', text: 'thinkpad' }])[0];
    const text = AgentTaskRunner.describeStep(s, { found: true, tag: 'input', type: 'text', label: 'Search' });
    expect(text).toContain('"thinkpad"');
    expect(text).toContain('<input type=text>');
    expect(text).toContain('"Search"');
    expect(text).toMatch(/nothing is submitted/);
  });
});

describe('a run never writes without a confirmation', () => {
  it('read steps run after the one approval; the write step waits for Allow, and runs after it', async () => {
    const h = harness();
    const r = await h.run([{ op: 'search', query: 'a' }, { op: 'read_url', url: 'https://a.example/' }, { op: 'type', target: 'Search', text: 'thinkpad' }, { op: 'summarize' }]).run();
    expect(r.status).toBe('done');
    expect(h.order).toEqual(['exec:search', 'exec:read_url', 'confirm', 'exec:type']);
    expect(r.answer).toBe('A is cheapest');
  });
  it('every write op is confirmed before it is executed', async () => {
    for (const s of [{ op: 'type', target: 'Search', text: 'x' }, { op: 'select', target: 'Size', value: 'L' }, { op: 'click', target: 'Next' }]) {
      const h = harness({ probe: async () => ({ found: true, tag: 'button', text: 'Next', pageOrigin: 'https://shop.example' }) });
      await h.run([s]).run();
      expect(h.order.indexOf('confirm')).toBeGreaterThanOrEqual(0);
      expect(h.order.indexOf('confirm')).toBeLessThan(h.order.indexOf('exec:' + s.op));
    }
  });
  it('Skip does not execute it and the run goes on', async () => {
    const h = harness({ confirm: async () => 'skip' });
    const r = await h.run([{ op: 'click', target: 'Buy' }, { op: 'read_page' }]).run();
    expect(h.order).toEqual(['exec:read_page']);
    expect(r.steps[0].status).toBe('skipped');
    expect(r.status).toBe('done');
  });
  it('Stop ends the task and runs nothing after', async () => {
    const h = harness({ confirm: async () => 'stop' });
    const r = await h.run([{ op: 'click', target: 'Buy' }, { op: 'read_page' }]).run();
    expect(h.order).toEqual([]);
    expect(r.status).toBe('stopped');
    expect(r.steps.every(s => s.status === 'skipped')).toBe(true);
  });
  it('a write step whose element is not found fails without asking', async () => {
    const h = harness({ probe: async () => ({ found: false }) });
    const r = await h.run([{ op: 'click', target: 'Ghost' }]).run();
    expect(h.order).toEqual([]);
    expect(r.steps[0].status).toBe('failed');
  });
});

describe('secrets and places that are never touched', () => {
  it('a password / payment field found on the page is refused, and nothing is asked or done', async () => {
    const h = harness({ probe: async () => ({ found: true, tag: 'input', type: 'password', name: 'pw', pageOrigin: 'https://shop.example' }) });
    const r = await h.run([{ op: 'type', target: 'Search', text: 'hello' }, { op: 'read_page' }]).run();
    expect(r.status).toBe('blocked');
    expect(r.reason).toMatch(/never types or reads/);
    expect(h.order).toEqual([]);
  });
  it('a button of a login or payment form is refused', async () => {
    const h = harness({ probe: async () => ({ found: true, tag: 'button', text: 'Pay', submits: true, formHasSensitive: true, pageOrigin: 'https://shop.example' }) });
    const r = await h.run([{ op: 'click', target: 'Pay' }]).run();
    expect(r.status).toBe('blocked');
    expect(h.order).toEqual([]);
  });
  it('a link that downloads is refused', async () => {
    const h = harness({ probe: async () => ({ found: true, tag: 'a', text: 'Get it', href: 'https://shop.example/app.exe', pageOrigin: 'https://shop.example' }) });
    const r = await h.run([{ op: 'click', target: 'Get it' }]).run();
    expect(r.status).toBe('blocked');
    expect(r.reason).toMatch(/download/);
  });
  it('never works in a private, Tor or routed tab', async () => {
    window.VexTabPolicy = { canReadWebview: () => false };
    const h = harness();
    const r = await h.run([{ op: 'read_page' }]).run();
    expect(r.status).toBe('blocked');
    expect(h.order).toEqual([]);
    // ...but a search that opens no tab is not tied to one
    window.VexTabPolicy = { canReadWebview: () => true };
  });
  it('never acts on a page on the exclude list, even if the person navigated there', async () => {
    globalThis.Recall = { isExcluded: (u) => /bank\.example/.test(u) };
    const h = harness({ tab: () => ({ webview: {}, url: 'https://bank.example/account' }) });
    const r = await h.run([{ op: 'click', target: 'Transfer' }]).run();
    expect(r.status).toBe('blocked');
    expect(h.order).toEqual([]);
  });
  it('re-checks the tab right before acting: it moved to a private page while you read', async () => {
    let calls = 0;
    const h = harness({ tab: () => { calls++; return { webview: { n: calls }, url: PAGE }; }, confirm: async () => { window.VexTabPolicy = { canReadWebview: () => false }; return 'allow'; } });
    const r = await h.run([{ op: 'click', target: 'Next' }]).run();
    expect(r.status).toBe('blocked');
    expect(h.order).toEqual([]);
  });
  it('a form posted to another site needs its own fresh confirmation', async () => {
    const probe = async () => ({ found: true, tag: 'button', text: 'Send', submits: true, formActionOrigin: 'https://evil.example', pageOrigin: 'https://shop.example' });
    const no = harness({ probe, confirmFresh: async () => false });
    const r1 = await no.run([{ op: 'click', target: 'Send' }]).run();
    expect(no.order).toEqual(['confirm']);
    expect(r1.status).toBe('stopped');
    const yes = harness({ probe });
    await yes.run([{ op: 'click', target: 'Send' }]).run();
    expect(yes.order).toEqual(['confirm', 'fresh', 'exec:click']);
  });
});

describe('budgets, pause, stop, kill', () => {
  it('stops at the step budget', async () => {
    const h = harness();
    const r = await h.run(Array.from({ length: 6 }, (_, i) => ({ op: 'read_url', url: 'https://a.example/' + i })), { maxSteps: 3 }).run();
    expect(r.status).toBe('stopped');
    expect(r.reason).toMatch(/step budget/);
    expect(h.order.length).toBe(3);
  });
  it('stops at the time budget, but waiting for a person is not counted', async () => {
    let t = 0;
    const h = harness({ exec: async (s) => { t += 6 * 60000; return { ok: true, summary: 'ok' }; } });
    const r = await h.run(Array.from({ length: 4 }, (_, i) => ({ op: 'read_url', url: 'https://a.example/' + i })), { maxMs: 10 * 60000, now: () => t }).run();
    expect(r.status).toBe('stopped');
    expect(r.reason).toMatch(/time budget/);
    t = 0;
    const slow = harness({ confirm: async () => { t += 3600000; return 'allow'; } });
    const r2 = await slow.run([{ op: 'click', target: 'Next' }], { maxMs: 10 * 60000, now: () => t }).run();
    expect(r2.status).toBe('done');
  });
  it('Stop mid-run skips the rest', async () => {
    let run, n = 0;
    const h = harness({ exec: async () => { n++; run.stop('You stopped it'); return { ok: true }; } });
    run = h.run([{ op: 'read_url', url: 'https://a.example/1' }, { op: 'read_url', url: 'https://a.example/2' }]);
    await run.run();
    expect(run.status).toBe('stopped');
    expect(n).toBe(1);
  });
  it('the kill switch stops a run that is waiting for a confirmation, and switches the agent off', async () => {
    let run;
    const h = harness({ confirm: () => new Promise(() => { /* nobody answers */ }) });
    run = h.run([{ op: 'click', target: 'Next' }, { op: 'read_page' }]);
    const p = run.run();
    await new Promise(r => setTimeout(r, 10));
    AgentSafety.kill('test kill');
    const done = await p;
    expect(done.status).toBe('killed');
    expect(h.order).toEqual([]);
    expect(AgentSafety.enabled()).toBe(false);
  });
  it('switching the agent off between steps ends the run', async () => {
    let n = 0;
    const h = harness({ exec: async () => { n++; AgentSafety.setEnabled(false); return { ok: true }; } });
    const r = await h.run([{ op: 'read_url', url: 'https://a.example/1' }, { op: 'read_url', url: 'https://a.example/2' }]).run();
    expect(r.status).toBe('killed');
    expect(n).toBe(1);
  });
  it('pause holds the next step until resume', async () => {
    let run;
    let n = 0;
    const h = harness({ exec: async () => { n++; if (n === 1) { run.pause(); setTimeout(() => run.resume(), 30); } return { ok: true }; } });
    run = h.run([{ op: 'read_url', url: 'https://a.example/1' }, { op: 'read_url', url: 'https://a.example/2' }]);
    const t0 = Date.now();
    await run.run();
    expect(run.status).toBe('done');
    expect(n).toBe(2);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(25);
  });
});

describe('what is kept', () => {
  it('the local action log keeps redacted steps and no page text', async () => {
    const h = harness({ exec: async () => ({ ok: true, summary: 'card 4111 1111 1111 1111 seen', text: 'SECRET PAGE TEXT' }) });
    const r = await h.run([{ op: 'read_url', url: 'https://a.example/' }]).run();
    AgentActionLog.upsert(r.snapshot());
    const raw = localStorage.getItem('vex.agentTask.log');
    expect(raw).toContain('[card number removed]');
    expect(raw).not.toContain('4111');
    expect(raw).not.toContain('SECRET PAGE TEXT');
    expect(AgentActionLog.all()[0].goal).toBe('compare');
  });
  it('the log is capped and can be cleared', () => {
    for (let i = 0; i < AgentActionLog.MAX_RUNS + 5; i++) AgentActionLog.upsert({ id: 'r' + i, goal: 'g', steps: [] });
    expect(AgentActionLog.all().length).toBe(AgentActionLog.MAX_RUNS);
    AgentActionLog.clear();
    expect(AgentActionLog.all()).toEqual([]);
  });
});

describe('against a stand-in page', () => {
  const PAGE_HTML = `
    <form id="search" action="/find"><label for="q">Search products</label><input id="q" name="q" type="text"><button type="submit">Go</button></form>
    <form id="login" action="/signin"><label for="u">Email</label><input id="u" name="email" autocomplete="username"><label for="p">Your word</label><input id="p" name="pw" type="password"><button type="submit">Sign in</button></form>
    <form id="pay" action="https://pay.example/charge"><label for="c">Number on front</label><input id="c" name="card" autocomplete="cc-number"><button type="submit">Pay now</button></form>
    <a href="/next" id="next">Next page</a>
    <a href="https://shop.example/tool.exe" id="dl">Get the tool</a>
    <select id="size" name="size"><option value="s">Small</option><option value="l">Large</option></select>`;

  function pageDeps(extra = {}) {
    const h = harness({
      probe: async (step) => { step._nonce = 'n1'; return guestEval(AgentTaskRunner.probeCode(step, 'n1')); },
      exec: async (step) => guestEval(AgentTaskRunner.writeCode(step, 'n1')),
      ...extra,
    });
    return h;
  }

  it('types into an ordinary field after Allow, and never submits', async () => {
    document.head.innerHTML = '<base href="https://shop.example/">';
    document.body.innerHTML = PAGE_HTML;
    const submitted = vi.fn();
    document.getElementById('search').addEventListener('submit', (e) => { e.preventDefault(); submitted(); });
    const h = pageDeps();
    const r = await h.run([{ op: 'type', target: 'Search products', text: 'thinkpad' }]).run();
    expect(r.status).toBe('done');
    expect(document.getElementById('q').value).toBe('thinkpad');
    expect(submitted).not.toHaveBeenCalled();
    expect(document.querySelector('[data-vex-agent-target]')).toBeNull();
  });
  it('refuses the password field, the username field and the card field: values stay empty', async () => {
    document.head.innerHTML = '<base href="https://shop.example/">';
    document.body.innerHTML = PAGE_HTML;
    for (const target of ['Your word', 'Email', 'Number on front']) {
      const h = pageDeps();
      const r = await h.run([{ op: 'type', target, text: 'hello' }]).run();
      expect(r.status).toBe('blocked');
      expect(h.order).toEqual([]);
    }
    expect(document.getElementById('p').value).toBe('');
    expect(document.getElementById('u').value).toBe('');
    expect(document.getElementById('c').value).toBe('');
  });
  it('refuses the sign-in and pay buttons, and a link to an installer', async () => {
    document.head.innerHTML = '<base href="https://shop.example/">';
    document.body.innerHTML = PAGE_HTML;
    for (const target of ['Sign in', 'Pay now', 'Get the tool']) {
      const h = pageDeps();
      const r = await h.run([{ op: 'click', target }]).run();
      expect(r.status, target).toBe('blocked');
      expect(h.order, target).toEqual([]);
    }
  });
  it('shows the exact element when asking, then clicks only that element', async () => {
    document.head.innerHTML = '<base href="https://shop.example/">';
    document.body.innerHTML = PAGE_HTML;
    const clicked = vi.fn();
    document.getElementById('next').addEventListener('click', (e) => { e.preventDefault(); clicked(); });
    let shown = '';
    const h = pageDeps({ confirm: async (info) => { shown = info.text; return 'allow'; } });
    const r = await h.run([{ op: 'click', target: 'Next page' }]).run();
    expect(shown).toContain('Click "Next page"');
    expect(shown).toContain('<a>');
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(r.status).toBe('done');
  });
  it('chooses an option in a dropdown after Allow', async () => {
    document.head.innerHTML = '<base href="https://shop.example/">';
    document.body.innerHTML = PAGE_HTML;
    const h = pageDeps();
    await h.run([{ op: 'select', target: 'size', value: 'Large' }]).run();
    expect(document.getElementById('size').value).toBe('l');
  });
  it('the page-reading code returns what is shown, never what a field holds', async () => {
    document.body.innerHTML = '<main><h1>Prices</h1><p>Laptop A 900</p><input value="hunter2"><textarea>my pin 1234</textarea></main>';
    const r = await guestEval(AgentTaskRunner.readPageCode());
    expect(r.text).toContain('Laptop A 900');
    expect(r.text).not.toContain('hunter2');
    expect(r.text).not.toContain('1234');
  });
  it('write code refuses a sensitive element even if it was marked by something else', async () => {
    document.body.innerHTML = '<input id="p" type="password" data-vex-agent-target="zz">';
    const out = await guestEval(AgentTaskRunner.writeCode({ op: 'type', text: 'x' }, 'zz'));
    expect(out.ok).toBe(false);
    expect(document.getElementById('p').value).toBe('');
  });
});
