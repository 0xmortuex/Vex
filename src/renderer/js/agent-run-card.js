// === One card per agent run =================================================
//
// Every step of a run used to be its own chat bubble: the model's thought with
// the raw tool call under it (→ click({"selector":"[data-vex-id=\"vex-2\"]"})),
// then the result in another, the token cost in another, every warning in
// another. A twelve-step task was about forty bubbles, and the answer was
// somewhere below them. Asked for (2026-09-27): "categorized properly, not all
// of them displayed in chat, structured, clean, neat and organized".
//
// Now a run is ONE card:
//   header    status, time, how many steps; the goal; one live "Now:" line
//   steps     collapsed until opened, one line each in plain words, with a
//             category chip row to filter them (Clicks & typing, Pages & tabs,
//             Reading, Web search, Vex, Problems, You)
//   details   each line opens to the model's reasoning, the exact action it
//             ran, the full result and what that step cost
//   footer    steps, thinking time, tokens
// What needs the user stays a message of its own: a question to them, a plan
// to approve, a hand-over, and the answer.
//
// It reads the same {type, text, style} records a run saves, so a saved run
// shown again (AgentLoop.showRun) comes back as the same card.

const AgentRunCard = (() => {
  const CATS = {
    act:     { label: 'Clicks & typing', icon: 'target' },
    browse:  { label: 'Pages & tabs', icon: 'globe' },
    read:    { label: 'Reading', icon: 'eye' },
    web:     { label: 'Web search', icon: 'search' },
    vex:     { label: 'Vex', icon: 'sparkles' },
    problem: { label: 'Problems', icon: 'warning' },
    you:     { label: 'You', icon: 'user' },
  };
  const TOOL_CAT = {
    click: 'act', click_text: 'act', type_text: 'act', press_key: 'act', select_option: 'act', scroll: 'act', wait: 'act',
    navigate: 'browse', go_back: 'browse', go_forward: 'browse', reload: 'browse', new_tab: 'browse', close_tab: 'browse', switch_tab: 'browse', list_tabs: 'browse',
    extract_elements: 'read', extract_text: 'read', screenshot: 'read', search_in_page: 'read', read_url: 'read', read_many: 'read', read_tab: 'read',
    web_search: 'web',
  };
  const VERB = {
    click: 'Click', click_text: 'Click', type_text: 'Type', press_key: 'Press a key', select_option: 'Choose an option', scroll: 'Scroll', wait: 'Wait',
    navigate: 'Open a page', go_back: 'Go back', go_forward: 'Go forward', reload: 'Reload', new_tab: 'Open a tab', close_tab: 'Close a tab', switch_tab: 'Switch tab', list_tabs: 'List the tabs',
    extract_elements: 'Look at the page', extract_text: 'Read the page', screenshot: 'Look at the page', search_in_page: 'Find on the page', read_url: 'Read a page', read_many: 'Read pages', read_tab: 'Read a tab',
    web_search: 'Search the web',
  };

  const esc = (s) => (window.escapeHtml ? window.escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const icon = (name, size) => (typeof VexIcons !== 'undefined' && VexIcons.has && VexIcons.has(name)) ? VexIcons.svg(name, { size: size || 13 }) : '';
  const short = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const clock = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const humanTool = (tool) => VERB[tool] || (tool ? tool.charAt(0).toUpperCase() + tool.slice(1).replace(/_/g, ' ') : 'Step');

  // "thought\n→ tool({...})" (or "→ tool({...})") → its parts.
  function parseAction(text) {
    const s = String(text || '');
    const at = s.lastIndexOf('→ ');
    const thought = at > 0 ? s.slice(0, at).trim() : '';
    const call = at >= 0 ? s.slice(at + 2) : s;
    const m = call.match(/^([a-z_]+)\(([\s\S]*)\)\s*$/);
    let params = {};
    if (m) { try { params = JSON.parse(m[2] || '{}') || {}; } catch { params = {}; } }
    return { thought, tool: m ? m[1] : '', params, call: call.trim() };
  }

  // What the step is about, from its parameters: the text clicked, the words
  // typed, the address, the search.
  function subject(tool, p) {
    p = p || {};
    const v = p.text || p.query || p.url || p.value || p.key || p.direction || p.title || p.name || p.message || p.request || '';
    if (Array.isArray(p.urls)) return p.urls.length + ' pages';
    if (!v) return '';
    if (tool === 'type_text') return '"' + short(v, 40) + '"';
    if (p.url && !p.text && !p.query) { try { const u = new URL(p.url); return u.hostname.replace(/^www\./, '') + (u.pathname.length > 1 ? short(u.pathname, 28) : ''); } catch { return short(p.url, 40); } }
    return '"' + short(v, 40) + '"';
  }

  function create(container, goal, { replay = false } = {}) {
    const started = Date.now();
    const el = document.createElement('div');
    el.className = 'ai-msg assistant agent-run-card running';
    el.innerHTML =
      '<div class="arc-head">'
      + '<span class="arc-status"><span class="ai-spinner"></span></span>'
      + '<span class="arc-title">Working on it</span><span class="arc-time"></span>'
      + '<button type="button" class="arc-toggle" aria-expanded="false"><span class="arc-count">0 steps</span>' + icon('chevron-right', 12) + '</button>'
      + '</div>'
      + '<div class="arc-goal"></div>'
      + '<div class="arc-live"></div>'
      + '<div class="arc-body" hidden><div class="arc-chips" role="tablist"></div><ol class="arc-steps"></ol></div>'
      + '<div class="arc-foot" hidden></div>';
    el.querySelector('.arc-goal').textContent = short(goal, 160);
    container.appendChild(el);

    const q = (s) => el.querySelector(s);
    const rows = [];
    let pending = null, filter = 'all', finished = false, stepNo = 0;
    const counts = {};

    const toggle = q('.arc-toggle'), body = q('.arc-body');
    toggle.addEventListener('click', () => {
      const open = body.hidden;
      body.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      el.classList.toggle('open', open);
    });

    const timer = replay ? null : setInterval(() => { q('.arc-time').textContent = clock(Date.now() - started); }, 1000);

    function paintChips() {
      const chips = q('.arc-chips');
      const order = ['act', 'browse', 'read', 'web', 'vex', 'problem', 'you'].filter(c => counts[c]);
      chips.innerHTML = '';
      const add = (key, label, n) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'arc-chip' + (filter === key ? ' on' : '') + (key === 'problem' ? ' problem' : '');
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(filter === key));
        b.innerHTML = (key === 'all' ? '' : icon(CATS[key].icon, 12)) + '<span>' + esc(label) + '</span><b>' + n + '</b>';
        b.addEventListener('click', () => { filter = key; paintChips(); applyFilter(); });
        chips.appendChild(b);
      };
      add('all', 'All', rows.length);
      for (const c of order) add(c, CATS[c].label, counts[c]);
    }
    function applyFilter() { for (const r of rows) r.li.hidden = !(filter === 'all' || r.cat === filter); }
    function paintCount() {
      const n = rows.filter(r => r.kind === 'step').length;
      q('.arc-count').textContent = n + ' step' + (n === 1 ? '' : 's');
    }
    function stick() {
      const near = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
      if (near || !replay) container.scrollTop = container.scrollHeight;
    }

    // One line in the list. Details open under it on a click.
    function addRow(cat, title, outcome, detail, kind) {
      const li = document.createElement('li');
      li.className = 'arc-step cat-' + cat;
      li.innerHTML = '<button type="button" class="arc-row">'
        + '<span class="arc-ico">' + icon(CATS[cat].icon, 13) + '</span>'
        + '<span class="arc-what"></span><span class="arc-out"></span>'
        + '<span class="arc-at">' + (replay ? '' : clock(Date.now() - started)) + '</span></button>'
        + '<div class="arc-detail" hidden></div>';
      li.querySelector('.arc-what').textContent = title;
      li.querySelector('.arc-out').textContent = outcome || '';
      const row = { li, cat, kind: kind || 'note', detail: detail || {} };
      li.querySelector('.arc-row').addEventListener('click', () => {
        const d = li.querySelector('.arc-detail');
        if (d.hidden) paintDetail(row);
        d.hidden = !d.hidden;
        li.classList.toggle('expanded', !d.hidden);
      });
      q('.arc-steps').appendChild(li);
      rows.push(row);
      counts[cat] = (counts[cat] || 0) + 1;
      paintChips(); applyFilter(); paintCount();
      return row;
    }
    function paintDetail(row) {
      const d = row.li.querySelector('.arc-detail');
      const x = row.detail;
      const part = (label, value, mono) => value ? '<div class="arc-d"><span>' + esc(label) + '</span>' + (mono ? '<code>' + esc(value) + '</code>' : '<p>' + esc(value) + '</p>') + '</div>' : '';
      d.innerHTML = part('Why', x.thought) + part('Did', x.call, true) + part('Result', x.result) + part('Took', x.cost);
    }
    function live(text, thinking) {
      const box = q('.arc-live');
      box.innerHTML = '';
      if (!text) return;
      const line = document.createElement('div');
      // The existing streaming code rewrites the element with this class as
      // the model's reply arrives (AgentLoop._streamStep / _streamThought).
      line.className = 'arc-now' + (thinking ? ' agent-step-thinking' : '');
      line.innerHTML = '<span class="arc-now-label">Now</span> ' + esc(text) + (thinking ? ' <span class="ai-spinner"></span>' : '');
      box.appendChild(line);
    }

    const api = {
      el,
      step(type, text, style) {
        text = String(text || '');
        switch (type) {
          case 'thinking':
            live(/^Thinking/.test(text) ? 'Deciding what to do next' : text, true);
            break;
          case 'action': {
            const a = parseAction(text);
            stepNo++;
            const cat = TOOL_CAT[a.tool] || 'vex';
            const about = subject(a.tool, a.params);
            const title = humanTool(a.tool) + (about ? ' ' + about : '');
            const caption = (typeof AgentCursor !== 'undefined' && AgentCursor.caption) ? AgentCursor.caption(a.thought) : short(a.thought, 90);
            live(caption || title + '…');
            pending = addRow(cat, title, '', { thought: a.thought, call: a.call }, 'step');
            pending.li.classList.add('pending');
            break;
          }
          case 'result': {
            const r = pending; pending = null;
            const failed = style === 'error' || /^Failed:/.test(text);
            const clean = text.replace(/^Failed:\s*/, '');
            if (!r) { addRow(failed ? 'problem' : 'vex', short(clean, 80), '', { result: clean }); break; }
            r.li.classList.remove('pending');
            r.detail.result = clean;
            // "Clicked "Search" — new on the page: ..." → title / outcome.
            const cut = clean.indexOf(' — ');
            const head = cut > 0 ? clean.slice(0, cut) : clean;
            const tail = cut > 0 ? clean.slice(cut + 3) : '';
            if (failed) {
              r.li.classList.add('failed');
              r.li.querySelector('.arc-out').textContent = short(clean.split(/[.:—]\s/)[0], 70);
              counts[r.cat]--; r.cat = 'problem'; counts.problem = (counts.problem || 0) + 1;
              r.li.className = r.li.className.replace(/cat-\w+/, 'cat-problem');
              r.li.querySelector('.arc-ico').innerHTML = icon('warning', 13);
              paintChips(); applyFilter();
            } else {
              // An action's own words ("Clicked "Search"") replace the title;
              // anything else ("1 interactive elements") is what it found.
              const said = tail.replace(/^new on the page: /, 'now shows ').replace(/^now on /, 'opened ');
              if (/^(Clicked|Typed|Pressed|Selected|Scrolled|Navigated|Opened|Went|Reloaded|Switched|Closed|Created|Renamed|Saved|Added|Set|Started)\b/.test(head) && head.length < 90) {
                r.li.querySelector('.arc-what').textContent = head;
                r.li.querySelector('.arc-out').textContent = short(said, 70);
              } else {
                r.li.querySelector('.arc-out').textContent = short(head === 'Done' ? said : head + (said ? ' — ' + said : ''), 70);
              }
            }
            break;
          }
          case 'cost': {
            const last = rows.filter(x => x.kind === 'step').pop();
            if (last) last.detail.cost = text.replace(/^↳\s*/, '');
            break;
          }
          case 'loop-prevent': case 'stall': case 'repair': case 'slow':
            addRow('problem', short(text, 90), '', { result: text });
            if (type === 'stall') live('Stopping and writing what it found', true);
            break;
          case 'error':
            addRow('problem', short(text.replace(/^Error:\s*/, ''), 90), '', { result: text });
            if (!/Out of steps/.test(text)) el.classList.add('failed');
            break;
          case 'paused': case 'resumed': case 'nudge':
            addRow('you', short(text, 90), '', { result: text });
            live(type === 'paused' ? 'Paused — waiting for you' : '');
            break;
          case 'denied': case 'stopped':
            addRow('you', short(text, 90), '', { result: text });
            el.classList.add('stopped');
            break;
          case 'end':
            api.finish(text);
            break;
          default:
            addRow(style === 'error' ? 'problem' : 'vex', short(text, 90), '', { result: text });
        }
        stick();
      },
      finish(endText) {
        if (finished) return;
        finished = true;
        if (timer) clearInterval(timer);
        if (pending) { pending.li.classList.remove('pending'); pending = null; }
        live('');
        el.classList.remove('running');
        const stopped = el.classList.contains('stopped'), failed = el.classList.contains('failed');
        const problems = counts.problem || 0;
        q('.arc-status').innerHTML = icon(stopped ? 'stop' : failed ? 'x' : 'check', 14);
        q('.arc-title').textContent = stopped ? 'Stopped' : failed ? 'Did not finish' : 'Done';
        if (!replay) q('.arc-time').textContent = clock(Date.now() - started);
        // "Agent finished — 12 steps, 20.8 s thinking, ..." → the footer.
        // The step count is in the header; the footer's "27 steps" counted
        // rounds of thinking, refused ones included, and disagreed with it.
        const foot = String(endText || '').replace(/^Agent finished\s*(—\s*)?/, '').replace(/^\d+ steps?,\s*/, '');
        const f = q('.arc-foot');
        f.textContent = [foot, problems ? problems + ' problem' + (problems === 1 ? '' : 's') + ' along the way' : ''].filter(Boolean).join(' · ');
        f.hidden = !f.textContent;
      },
      alive: () => !finished,
    };
    return api;
  }

  return { create, parseAction, subject, CATS, TOOL_CAT };
})();

if (typeof window !== 'undefined') window.AgentRunCard = AgentRunCard;
if (typeof module !== 'undefined' && module.exports) module.exports = { AgentRunCard };
