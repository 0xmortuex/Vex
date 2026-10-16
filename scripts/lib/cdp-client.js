// A small DevTools-protocol client for Vex probes (used by the smoke matrix).
// Node's global WebSocket and fetch; no dependencies. Mirrors the helpers inside
// scripts/check-ui.js, which keeps its own copies.
'use strict';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function waitForTarget(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = 'no response';
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      const page = list.find(t => t.type === 'page' && /src\/renderer\/index\.html$/.test((t.url || '').split('?')[0]));
      if (page && page.webSocketDebuggerUrl) return page;
      last = 'renderer window not listed yet (' + list.length + ' targets)';
    } catch (err) { last = err.message; }
    await sleep(400);
  }
  throw new Error('timed out waiting for the Vex renderer on the debugging port: ' + last);
}

// -> { send(method, params), on(event, handler), close() }
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    const handlers = new Map();
    let nextId = 1, open = false;
    const failAll = (err) => { for (const p of pending.values()) p.reject(err); pending.clear(); };
    ws.addEventListener('open', () => { open = true; resolve({ send, on, close: () => ws.close() }); });
    ws.addEventListener('error', () => { const err = new Error('CDP websocket error'); if (!open) reject(err); else failAll(err); });
    ws.addEventListener('close', () => failAll(new Error('CDP websocket closed')));
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
        return;
      }
      if (msg.method) for (const h of handlers.get(msg.method) || []) h(msg.params || {});
    });
    function send(method, params) {
      return new Promise((res, rej) => { const id = nextId++; pending.set(id, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id, method, params: params || {} })); });
    }
    function on(event, handler) { handlers.set(event, (handlers.get(event) || []).concat(handler)); }
  });
}

async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error('page threw: ' + ((d.exception && d.exception.description) || d.text));
  }
  return r.result.value;
}

// The renderer announces its target long before its ~100 scripts have run.
async function waitForRenderer(cdp, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = 'never evaluated';
  while (Date.now() < deadline) {
    const state = await evaluate(cdp, `(() => ({
      ready: document.readyState,
      gui: !!(window.VexGuiStyle && window.VexGuiStyle.styles),
      theme: !!(window.ThemeManager && window.ThemeManager.availableThemes),
      onboarding: !!(window.Onboarding && window.Onboarding.finish),
      chrome: !!document.querySelector('#top-bar'),
      tabs: document.querySelectorAll('.top-tab, .tab-item').length
    }))()`);
    if (state.ready === 'complete' && state.gui && state.theme && state.onboarding && state.chrome && state.tabs > 0) return state;
    last = JSON.stringify(state);
    await sleep(300);
  }
  throw new Error('the renderer never finished starting up: ' + last);
}

// The chrome lays itself out more than once while Vex starts; wait for 1.5 s of stillness.
async function waitForStable(cdp, timeoutMs) {
  await evaluate(cdp, `(() => {
    if (window.__vexSmokeMoves) return;
    const st = window.__vexSmokeMoves = { last: performance.now() };
    const bump = () => { st.last = performance.now(); };
    const ro = new ResizeObserver(bump);
    for (const el of document.querySelectorAll('#top-bar, #top-bar *, #top-tab-bar, #top-tab-bar *, #icon-sidebar, #icon-sidebar *')) ro.observe(el);
    addEventListener('resize', bump);
    new MutationObserver(bump).observe(document.body, { attributes: true });
  })()`);
  const QUIET = 1500;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const quiet = await evaluate(cdp, 'performance.now() - window.__vexSmokeMoves.last');
    if (quiet >= QUIET) return;
    await sleep(Math.max(100, QUIET - quiet));
  }
  throw new Error('the chrome never stopped moving for ' + Math.round(timeoutMs / 1000) + 's');
}

// A profile past first run: the wizard, tour, legal and Game-mode questions are answered, so
// no first-run sheet covers the window. Same keys as SEEDED_PREFERENCES in scripts/check-ui.js.
function seededPreferences() {
  return {
    'vex.onboardingDone': 'true',
    'vex.tourSeen': '1',
    'vex.privacyDefaults': '1',
    'vex.legalAcceptedVersion': String(require('../../src/renderer/js/legal.js').VexLegal.VERSION),
    'vex.hasRunBefore': 'true',
    'vex.gameMode': 'off',
  };
}

async function assertNothingCovers(cdp) {
  const state = await evaluate(cdp, `(() => {
    const bar = document.querySelector('#top-bar');
    const r = bar ? bar.getBoundingClientRect() : null;
    const hit = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
    const top = hit && !(bar.contains(hit) || hit.contains(bar)) ? hit.closest('body > *') || hit : null;
    return { done: !!(window.Onboarding && window.Onboarding.done()), cover: top ? ((top.id ? '#' + top.id : '') + '.' + String(top.className || top.tagName)).slice(0, 80) : null };
  })()`);
  if (!state.done) throw new Error('the seeded profile did not mark onboarding done');
  if (state.cover) throw new Error('something covers the toolbar (' + state.cover + ') in a profile seeded past first run');
}

module.exports = { sleep, waitForTarget, connect, evaluate, waitForRenderer, waitForStable, seededPreferences, assertNothingCovers };
