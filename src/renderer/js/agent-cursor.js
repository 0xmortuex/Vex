// === Watching the AI work ===================================================
//
// The agent used to act on a page invisibly: a click was a script that found
// the element and fired its events at once, and typing arrived all at once.
// The only trace was the list of steps in the AI panel. Asked for (2026-09-27):
// "I want to see the process of what he is doing and how he is doing it, maybe
// give him a cursor I can see".
//
// So on the page itself, while the agent works:
//   a cursor  glides to each thing before it is clicked, typed into or chosen,
//             and taps it (a ripple where the click lands);
//   a ring    around the element it is about to act on;
//   a caption beside the cursor saying what it is doing, in its own words;
//   typing    appears a few characters at a time instead of all at once.
//
// All of it lives in a closed shadow root that ignores the mouse, so the page
// cannot style it and the user's own clicks go straight through it. It costs
// about half a second per action, which is what makes it watchable; Settings ›
// AI turns it off for anyone who would rather have the speed. Scheduled runs,
// which happen while nobody is looking, never show it.

// Runs INSIDE the page (sent as text by AgentExecutor). It is a real function
// here so that nothing in it is written inside a template literal, where a
// backslash quietly disappears.
function installVexAgentCursor() {
  if (window.__vexCursor && window.__vexCursor.alive()) return;
  const ACCENT = '#6d4aff';
  const host = document.createElement('div');
  host.setAttribute('data-vex-agent-cursor', '');
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'closed' });
  const ease = 'cubic-bezier(.3,.7,.2,1)';
  root.innerHTML = '<style>'
    + ':host{all:initial}'
    + '.c{position:fixed;left:0;top:0;width:24px;height:24px;transition:transform .45s ' + ease + ',opacity .25s;filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))}'
    + '.tag{position:fixed;left:0;top:0;max-width:300px;padding:4px 10px;border-radius:10px;background:' + ACCENT + ';color:#fff;'
    + 'font:600 12px/1.4 "Segoe UI",system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
    + 'box-shadow:0 2px 10px rgba(0,0,0,.25);transition:transform .45s ' + ease + ',opacity .25s}'
    + '.ring{position:fixed;left:0;top:0;border:2px solid ' + ACCENT + ';border-radius:6px;box-shadow:0 0 0 4px rgba(109,74,255,.2);opacity:0;transition:opacity .2s}'
    + '.tap{position:fixed;left:0;top:0;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;background:rgba(109,74,255,.4);opacity:0}'
    + '.tap.go{animation:vexTap .45s ease-out}'
    + '@keyframes vexTap{from{transform:scale(.2);opacity:1}to{transform:scale(1.7);opacity:0}}'
    + '</style>'
    + '<div class="ring"></div><div class="tap"></div>'
    + '<svg class="c" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 2 20 11.5 13 13.1 9.4 20Z" fill="' + ACCENT + '" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>'
    + '<div class="tag">Vex</div>';
  (document.body || document.documentElement).appendChild(host);
  const cursor = root.querySelector('.c'), tag = root.querySelector('.tag');
  const ring = root.querySelector('.ring'), tap = root.querySelector('.tap');
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  let x = Math.round(innerWidth * 0.5), y = Math.round(innerHeight * 0.3), idle = null;

  const place = (ms) => {
    for (const el of [cursor, tag]) el.style.transitionDuration = ms + 'ms, 250ms';
    cursor.style.transform = 'translate(' + (x - 4) + 'px,' + (y - 2) + 'px)';
    // The caption sits to the right of the cursor, or to its left near the edge.
    const right = x + 330 < innerWidth;
    tag.style.transform = 'translate(' + (right ? x + 20 : Math.max(4, x - 310)) + 'px,' + (y + 16) + 'px)';
  };
  const wake = () => {
    host.style.display = '';
    cursor.style.opacity = '1'; tag.style.opacity = '1';
    clearTimeout(idle);
    // Nothing for a while: it has finished or is thinking; get out of the way.
    idle = setTimeout(() => api.finish(), 30000);
  };

  const api = {
    alive: () => host.isConnected,
    say(text) { wake(); tag.textContent = String(text || 'Vex').slice(0, 120); },
    async moveTo(el, text) {
      wake();
      if (text) api.say(text);
      try { el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' }); } catch (_) {}
      const r = el.getBoundingClientRect();
      const nx = Math.round(r.left + Math.min(r.width / 2, Math.max(r.width - 6, 6)));
      const ny = Math.round(r.top + r.height / 2);
      const ms = Math.round(Math.max(260, Math.min(650, Math.hypot(nx - x, ny - y) * 0.9)));
      x = nx; y = ny;
      ring.style.left = (r.left - 4) + 'px'; ring.style.top = (r.top - 4) + 'px';
      ring.style.width = (r.width + 4) + 'px'; ring.style.height = (r.height + 4) + 'px';
      ring.style.opacity = '1';
      place(ms);
      await sleep(ms + 80);
    },
    async tap() {
      tap.style.left = x + 'px'; tap.style.top = y + 'px';
      tap.classList.remove('go'); void tap.offsetWidth; tap.classList.add('go');
      await sleep(180);
    },
    finish() {
      clearTimeout(idle);
      ring.style.opacity = '0'; cursor.style.opacity = '0'; tag.style.opacity = '0';
      setTimeout(() => { if (cursor.style.opacity === '0') host.style.display = 'none'; }, 300);
    },
  };
  place(0);
  window.__vexCursor = api;
}

const AgentCursor = {
  KEY: 'vex.agentShowCursor',
  GUEST: '(' + installVexAgentCursor.toString() + ')();',

  enabled() {
    try { return localStorage.getItem(this.KEY) !== 'off'; } catch { return true; }
  },
  setEnabled(on) {
    try { localStorage.setItem(this.KEY, on ? 'on' : 'off'); } catch (err) { console.warn('[AgentCursor] could not save:', err.message); }
    return !!on;
  },

  // A caption from the model's own words for this step ("Click the Search
  // button"), short enough to sit beside a cursor.
  caption(thought) {
    const t = String(thought || '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    const first = t.split(/(?<=[.!?])\s/)[0];
    return first.length > 90 ? first.slice(0, 87) + '…' : first;
  },

  // Fade it out when the run ends. A page that has gone, or never had a
  // cursor, has nothing to fade.
  finish(webview) {
    if (!webview || typeof window.vexGuestEval !== 'function') return;
    window.vexGuestEval(webview, 'window.__vexCursor && window.__vexCursor.finish(); true', false, 2000).catch(() => {});
  },

  wireSetting() {
    const box = document.getElementById('setting-agent-cursor');
    if (!box || box.dataset.wired) return;
    box.dataset.wired = '1';
    box.checked = this.enabled();
    box.addEventListener('change', () => this.setEnabled(box.checked));
  },
};

if (typeof window !== 'undefined') {
  window.AgentCursor = AgentCursor;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => AgentCursor.wireSetting());
    else AgentCursor.wireSetting();
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { AgentCursor, installVexAgentCursor };
