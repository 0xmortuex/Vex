// === Toolbox workbench =====================================================
//
// The shared shell every serious tool is built on. Before this, a tool was a
// textarea, two buttons and a div: Base64 could only do standard Base64 of a
// UTF-8 string, with no way to say Base64URL, no unpadded input, no binary
// output, and no idea why a paste failed.
//
// The shell owns everything that is the same in every tool — a settings column,
// live re-running as you type, remembering your options and input, swapping
// input and output, copying, and showing an error as an error — so each tool
// only has to describe its options and do its one job.
//
// Spec:
//   { id, title, icon, blurb,
//     inputLabel, outputLabel, placeholder, sample,
//     options: [ {id, label, type:'select'|'toggle'|'text', options, default, hint, when} ],
//     swap: (input, output, opt) => ({ input, opt })   // optional
//     run: ({ input, opt }) => string | {output, note, mono, error} }
//
// `run` may throw: the message is shown to the user rather than swallowed, so a
// tool never silently produces nothing.
const ToolboxWorkbench = (() => {
  const KEY = (id) => `vex.tool.${id}`;
  const esc = (s) => (window.escapeHtml ? window.escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s));
  const icon = (name, size) => (window.VexIcons && VexIcons.has(name)) ? VexIcons.svg(name, { size: size || 14 }) : '';

  function loadState(id) {
    try { const raw = JSON.parse(localStorage.getItem(KEY(id)) || 'null'); return (raw && typeof raw === 'object') ? raw : {}; }
    catch { return {}; }
  }
  // Returns false when it could not be written, so a caller can say so rather
  // than claim a preference was saved.
  function saveState(id, state) {
    try { localStorage.setItem(KEY(id), JSON.stringify(state)); return true; } catch { return false; }
  }

  function optionControl(o, value) {
    const id = `wb-opt-${esc(o.id)}`;
    if (o.type === 'toggle') {
      return `<label class="wb-toggle" for="${id}">
          <input type="checkbox" id="${id}" data-opt="${esc(o.id)}" ${value ? 'checked' : ''}>
          <span class="wb-toggle-track"><span class="wb-toggle-dot"></span></span>
          <span class="wb-toggle-label">${esc(o.label)}</span>
        </label>`;
    }
    if (o.type === 'text') {
      return `<div class="wb-field">
          <label class="wb-label" for="${id}">${esc(o.label)}</label>
          <input class="wb-text" id="${id}" data-opt="${esc(o.id)}" value="${esc(value == null ? '' : value)}"
                 placeholder="${esc(o.placeholder || '')}" spellcheck="false">
          ${o.hint ? `<div class="wb-hint">${esc(o.hint)}</div>` : ''}
        </div>`;
    }
    const opts = (o.options || []).map(([v, label]) =>
      `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(label)}</option>`).join('');
    return `<div class="wb-field">
        <label class="wb-label" for="${id}">${esc(o.label)}</label>
        <select class="wb-select" id="${id}" data-opt="${esc(o.id)}">${opts}</select>
        ${o.hint ? `<div class="wb-hint">${esc(o.hint)}</div>` : ''}
      </div>`;
  }

  // The reference panel, shown only in full screen.
  //
  // `details` is a list of sections: { title, rows: [[term, description], …] }
  // or { title, text }. An example row is clickable — it drops itself into the
  // input, which is the fastest way to understand what a format looks like.
  function referenceHtml(spec) {
    const sections = spec.details || [];
    if (!sections.length) return '';
    const body = sections.map(sec => {
      if (sec.text) return `<section class="wb-ref-sec"><h4>${esc(sec.title)}</h4><p>${esc(sec.text)}</p></section>`;
      const rows = (sec.rows || []).map(([a, b]) => `<tr>
          <th${sec.examples ? ' class="wb-ref-ex" role="button" tabindex="0" data-example="' + esc(a) + '"' : ''}>${esc(a)}</th>
          <td>${esc(b)}</td></tr>`).join('');
      return `<section class="wb-ref-sec"><h4>${esc(sec.title)}</h4><table class="wb-ref-table">${rows}</table></section>`;
    }).join('');
    return `<div class="wb-ref-inner">${body}</div>`;
  }

  function open(spec) {
    if (!spec || typeof spec.run !== 'function') throw new Error('a workbench tool needs a run()');
    document.getElementById('vex-workbench')?.remove();

    const saved = loadState(spec.id);
    const opts = spec.options || [];
    const state = {};
    for (const o of opts) {
      state[o.id] = Object.prototype.hasOwnProperty.call(saved.opt || {}, o.id) ? saved.opt[o.id] : o.default;
    }
    const autoUpdate = saved.auto !== false;          // on unless turned off
    const remember = saved.remember === true;         // off unless asked for

    const m = document.createElement('div');
    m.id = 'vex-workbench';
    m.className = 'wb-overlay';
    m.innerHTML = `
      <div class="wb-shell" role="dialog" aria-label="${esc(spec.title)}">
        <div class="wb-head">
          <span class="wb-head-icon">${icon(spec.icon || 'toolbox', 16)}</span>
          <span class="wb-head-title">${esc(spec.title)}</span>
          <span class="wb-head-blurb">${esc(spec.blurb || '')}</span>
          <button class="wb-icon-btn" id="wb-expand" title="Full screen" aria-label="Full screen">${icon('maximize', 14)}</button>
          <button class="wb-icon-btn" id="wb-close" title="Close" aria-label="Close">${icon('x', 15)}</button>
        </div>
        <div class="wb-main">
          <aside class="wb-side">
            <button class="wb-run" id="wb-run">${esc(spec.runLabel || 'Run')}</button>
            <label class="wb-toggle" for="wb-auto">
              <input type="checkbox" id="wb-auto" ${autoUpdate ? 'checked' : ''}>
              <span class="wb-toggle-track"><span class="wb-toggle-dot"></span></span>
              <span class="wb-toggle-label">Auto update</span>
            </label>
            <label class="wb-toggle" for="wb-remember">
              <input type="checkbox" id="wb-remember" ${remember ? 'checked' : ''}>
              <span class="wb-toggle-track"><span class="wb-toggle-dot"></span></span>
              <span class="wb-toggle-label">Remember input</span>
            </label>
            <div class="wb-opts" id="wb-opts">${opts.map(o => optionControl(o, state[o.id])).join('')}</div>
          </aside>
          <section class="wb-panes">
            <div class="wb-pane">
              <div class="wb-pane-head">
                <span>${esc(spec.inputLabel || 'Input')}</span>
                <span class="wb-pane-actions">
                  ${spec.sample ? `<button class="wb-icon-btn" id="wb-sample" title="Insert an example">${icon('bulb', 13)}</button>` : ''}
                  <button class="wb-icon-btn" id="wb-swap" title="Use the output as the input">${icon('swap', 13)}</button>
                  <button class="wb-icon-btn" id="wb-clear" title="Clear">${icon('trash', 13)}</button>
                </span>
              </div>
              <textarea class="wb-io" id="wb-in" spellcheck="false" placeholder="${esc(spec.placeholder || '')}"></textarea>
              <div class="wb-count" id="wb-in-count"></div>
            </div>
            <div class="wb-pane">
              <div class="wb-pane-head">
                <span>${esc(spec.outputLabel || 'Output')}</span>
                <span class="wb-pane-actions">
                  <button class="wb-icon-btn" id="wb-copy" title="Copy the output">${icon('copy', 13)}</button>
                </span>
              </div>
              <div class="wb-io wb-out" id="wb-out" tabindex="0"></div>
              <div class="wb-count" id="wb-note"></div>
            </div>
          </section>
          <!-- Reference material. Full screen is not just a bigger box: it is
               where the tool can show everything it knows — the formats it
               accepts, worked examples, and the rules behind them. -->
          <aside class="wb-ref" id="wb-ref">${referenceHtml(spec)}</aside>
        </div>
      </div>`;
    document.body.appendChild(m);

    const $ = (sel) => m.querySelector(sel);
    const inEl = $('#wb-in'), outEl = $('#wb-out'), noteEl = $('#wb-note'), countEl = $('#wb-in-count');
    if (remember && typeof saved.input === 'string') inEl.value = saved.input;

    const close = () => m.remove();
    m.addEventListener('mousedown', (e) => { if (e.target === m) close(); });
    $('#wb-close').addEventListener('click', close);
    m.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });

    const persist = () => saveState(spec.id, {
      opt: state,
      auto: $('#wb-auto').checked,
      remember: $('#wb-remember').checked,
      full: m.classList.contains('wb-full'),
      input: $('#wb-remember').checked ? inEl.value.slice(0, 20000) : undefined,
    });

    // Options whose `when` says they do not apply right now are hidden rather
    // than left there doing nothing.
    const syncVisibility = () => {
      for (const o of opts) {
        if (typeof o.when !== 'function') continue;
        const field = m.querySelector(`[data-opt="${o.id}"]`)?.closest('.wb-field, .wb-toggle');
        if (field) field.hidden = !o.when(state);
      }
    };

    // Two sizes. Compact is the panel you get by default; full screen fills the
    // window and brings out the reference column, so it is a place to work
    // rather than a bigger dialog. The choice is remembered per tool.
    const setFull = (on, persistIt) => {
      m.classList.toggle('wb-full', !!on);
      const b = $('#wb-expand');
      b.title = on ? 'Exit full screen' : 'Full screen';
      b.setAttribute('aria-label', b.title);
      b.innerHTML = icon(on ? 'compress' : 'maximize', 14);
      b.classList.toggle('active', !!on);
      if (persistIt) persist();
    };
    $('#wb-expand').addEventListener('click', () => setFull(!m.classList.contains('wb-full'), true));

    // An example in the reference drops straight into the input — the quickest
    // way to see what a format actually looks like.
    $('#wb-ref')?.addEventListener('click', (e) => {
      const ex = e.target.closest('[data-example]');
      if (!ex) return;
      inEl.value = ex.dataset.example;
      run();
      persist();
    });

    let lastOutput = '';
    const run = () => {
      const input = inEl.value;
      countEl.textContent = input ? `${input.length.toLocaleString()} characters` : '';
      if (!input.trim()) { outEl.textContent = ''; outEl.classList.remove('wb-error'); noteEl.textContent = ''; lastOutput = ''; return; }
      try {
        const r = spec.run({ input, opt: { ...state } });
        const res = (r && typeof r === 'object' && !Array.isArray(r)) ? r : { output: r };
        if (res.error) throw new Error(res.error);
        lastOutput = String(res.output == null ? '' : res.output);
        outEl.textContent = lastOutput;
        outEl.classList.remove('wb-error');
        noteEl.textContent = res.note || (lastOutput ? `${lastOutput.length.toLocaleString()} characters` : '');
      } catch (err) {
        // An error is shown, never swallowed: a tool that quietly produces
        // nothing is indistinguishable from one that is broken.
        lastOutput = '';
        outEl.textContent = (err && err.message) || 'That input could not be processed.';
        outEl.classList.add('wb-error');
        noteEl.textContent = '';
      }
    };

    let debounce = 0;
    const maybeRun = () => {
      persist();
      if (!$('#wb-auto').checked) return;
      clearTimeout(debounce);
      debounce = setTimeout(run, 120);
    };

    inEl.addEventListener('input', maybeRun);
    $('#wb-run').addEventListener('click', run);
    $('#wb-auto').addEventListener('change', () => { persist(); if ($('#wb-auto').checked) run(); });
    $('#wb-remember').addEventListener('change', persist);

    m.querySelectorAll('[data-opt]').forEach(el => {
      el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
        state[el.dataset.opt] = el.type === 'checkbox' ? el.checked : el.value;
        syncVisibility();
        persist();
        run();          // an option change always re-runs, auto-update or not
      });
    });

    $('#wb-clear').addEventListener('click', () => { inEl.value = ''; run(); persist(); inEl.focus(); });
    if (spec.sample) $('#wb-sample')?.addEventListener('click', () => { inEl.value = spec.sample; run(); persist(); });
    $('#wb-swap').addEventListener('click', () => {
      if (!lastOutput) { window.showToast?.('Nothing in the output to swap in'); return; }
      const next = (typeof spec.swap === 'function') ? spec.swap(inEl.value, lastOutput, { ...state }) : { input: lastOutput };
      inEl.value = next && typeof next.input === 'string' ? next.input : lastOutput;
      if (next && next.opt) {
        Object.assign(state, next.opt);
        for (const [k, v] of Object.entries(next.opt)) {
          const el = m.querySelector(`[data-opt="${k}"]`);
          if (!el) continue;
          if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
        }
        syncVisibility();
      }
      persist();
      run();
    });
    $('#wb-copy').addEventListener('click', async () => {
      if (!lastOutput) { window.showToast?.('Nothing to copy yet'); return; }
      try { await navigator.clipboard.writeText(lastOutput); window.showToast?.('Copied'); }
      catch (err) { window.showToast?.('Could not copy: ' + ((err && err.message) || 'clipboard unavailable'), 'error'); }
    });

    syncVisibility();
    setFull(saved.full === true, false);
    run();
    setTimeout(() => inEl.focus(), 40);
    return { root: m, close, run, state };
  }

  return { open, _loadState: loadState, _saveState: saveState };
})();

if (typeof window !== 'undefined') window.ToolboxWorkbench = ToolboxWorkbench;
if (typeof module !== 'undefined' && module.exports) module.exports = { ToolboxWorkbench };
