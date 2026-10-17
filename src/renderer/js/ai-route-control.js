// === One place that says where AI runs, and which one answered (T2-081) =========
//
// The entry counted six overlapping keys. Read against the code:
//   vex.preferLocalAI / vex.forceCloudAI   the real mode (AIRouter.setPreferLocal / setForceCloud,
//                                          the three radios in Settings > AI Backend)
//   vex.preferOnDeviceAI                   on-device (browser) chat, a separate switch (js/webllm.js)
//   vex.aiRouting                          the per-feature table (a pin per feature)
//   vex.localAIModel / vex.webllmModel     which MODEL runs; not a routing choice
//   vex.aiMode                             NOT routing: the AI panel's docked/expanded layout
// So the single control already exists as the radios, and nothing here adds a seventh key or
// moves a saved value. What was missing is the plain naming (Fast cloud / Private local / Auto),
// one line that says what is in force once everything is read together, a warning when two saved
// choices disagree, and the reason an answer came from the backend it did. This adds those.
//
//   AIRouteControl.mode()      -> 'auto' | 'local' | 'cloud' | 'conflict'
//   AIRouteControl.setMode(m)  -> the same setters the radios use; nothing else changes
//   AIRouteControl.summary()   -> { mode, label, lines: [...] } what is in force
//   AIRouteControl.lastAnswer()-> { feature, backend, model, at, reason } of the latest AI answer
const AIRouteControl = {
  LABEL: { auto: 'Auto', local: 'Private local', cloud: 'Fast cloud' },
  _last: null,

  _router() {
    if (typeof AIRouter === 'undefined') throw new Error('The AI router is not loaded');
    return AIRouter;
  },

  mode() {
    const s = this._router().getOllamaStatus();
    if (s.preferLocal && s.forceCloud) return 'conflict';
    if (s.forceCloud) return 'cloud';
    if (s.preferLocal) return 'local';
    return 'auto';
  },

  // The radios in Settings are the control; use them when they are on screen so the two never disagree.
  setMode(mode) {
    if (!['auto', 'local', 'cloud'].includes(mode)) throw new Error('The AI route is Auto, Private local or Fast cloud');
    const r = this._router();
    if (mode === 'auto') { r.setPreferLocal(false); r.setForceCloud(false); }
    else if (mode === 'local') { r.setForceCloud(false); r.setPreferLocal(true); }
    else { r.setPreferLocal(false); r.setForceCloud(true); }
    const radio = typeof document !== 'undefined' ? document.querySelector('input[name="ai-mode"][value="' + mode + '"]') : null;
    if (radio) radio.checked = true;
    this._changed();
    return mode;
  },

  // The router's own defaults (js/ai-router.js DEFAULT_ROUTING), copied here only to tell a pin from
  // a default. History search is accepted either way: it moved from cloud to local in 2026-10.
  DEFAULTS: { chat: 'auto', summarize: 'auto', translate: 'cloud', explain: 'auto', historyIndex: 'local', agent: 'cloud', multiTab: 'cloud', groupTabs: 'auto', digest: 'local' },
  // What the person set per feature that differs from the defaults.
  pins() {
    const r = this._router().getRoutingPrefs();
    return Object.entries(r).filter(([k, v]) => k !== 'historySearch' ? (k in this.DEFAULTS ? this.DEFAULTS[k] !== v : v !== 'auto') : (v !== 'cloud' && v !== 'local')).map(([k, v]) => ({ feature: k, to: v }));
  },
  onDevice() { return typeof WebLLM !== 'undefined' && typeof WebLLM.preferred === 'function' && WebLLM.preferred(); },

  summary() {
    const r = this._router();
    const m = this.mode();
    const s = r.getOllamaStatus();
    const lines = [];
    if (m === 'conflict') lines.push('Both "Prefer local" and "Always cloud" are saved (from a sync or an older version). Vex follows Always cloud. Pick one below; nothing was changed for you.');
    else if (m === 'cloud') lines.push('Fast cloud: every feature uses the AI Worker, even when a local model is running' + (this.onDevice() ? ', and this overrides on-device AI' : '') + '.');
    else if (m === 'local') lines.push('Private local: features stay on your Ollama model while it is running' + (s.available ? ' (it is)' : ' (it is not right now, so features set to Cloud still use the AI Worker)') + '.');
    else lines.push('Auto: the AI Worker when it is set up and online, otherwise your local model.');
    if (this.onDevice() && m !== 'cloud') lines.push('On-device AI is on: chat runs in this browser once its model is loaded.');
    const pins = this.pins();
    if (pins.length) lines.push(pins.length + ' feature' + (pins.length === 1 ? ' is' : 's are') + ' pinned in the table below: ' + pins.map(p => p.feature + ' → ' + p.to).join(', ') + '.');
    return { mode: m, label: this.LABEL[m] || 'Conflict', lines };
  },

  // ---- which one answered, and why ----------------------------------------------------------
  reasonFor(rec) {
    if (rec.backend === 'extractive') return 'No AI backend could answer (' + (rec.failedWith || 'all failed') + '), so Vex picked the most relevant sentences from the text itself. No model wrote this.';
    if (rec.fellBackFrom) return (rec.fellBackFrom === 'cloud' ? 'The cloud AI' : rec.fellBackFrom === 'local' ? 'Your local model' : 'On-device AI') + ' failed, so ' + rec.backend + ' answered.';
    if (rec.routedBecause) return 'Spend routing: ' + rec.routedBecause + '.';
    if (rec.mode === 'cloud') return 'You chose Fast cloud.';
    if (rec.backend === 'ondevice') return 'On-device AI is switched on for chat.';
    if (rec.mode === 'local' && rec.backend === 'local') return 'You chose Private local.';
    if (rec.pinned && rec.pinned !== 'auto') return 'This feature is pinned to ' + rec.pinned + ' in the per-feature table' + (rec.pinned === rec.backend ? '.' : ', but ' + rec.backend + ' answered.');
    return 'Auto picked it.';
  },
  lastAnswer() { return this._last ? { ...this._last } : null; },
  _record(feature, out) {
    if (!out || !out.backend) return;
    const r = this._router();
    let pinned = '';
    try { pinned = r.getRoutingPrefs()[feature] || ''; } catch { pinned = ''; }
    const rec = { feature, backend: out.backend, model: out.model || '', at: Date.now(), mode: this.mode(), pinned };
    if (out.fellBackFrom) rec.fellBackFrom = out.fellBackFrom;
    if (out.routedBecause) rec.routedBecause = out.routedBecause;
    if (out.degradedFrom) rec.failedWith = out.degradedFrom;
    rec.reason = this.reasonFor(rec);
    this._last = rec;
    if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('vex:ai-answered', { detail: rec }));
    return rec;
  },

  // ---- the degrade ladder (T3-004) ---------------------------------------------------------------
  // cloud -> local -> (WebLLM, when the person turned it on) -> extractive. The router already does the
  // first steps and refuses to send what the sensitivity gate holds back. The last rung is new: when
  // every backend failed, a request that carries text gets the most relevant sentences of that text,
  // chosen by a small word-frequency score on this machine, labelled as extracted. It is off until the
  // person switches on "AI fallback ladder" (vex.aiLadder = 'true'), and an answer from it says so.
  LADDER_KEY: 'vex.aiLadder',
  EXTRACTIVE_FEATURES: ['chat', 'summarize', 'explain', 'digest'],
  ladderOn() { try { return localStorage.getItem(this.LADDER_KEY) === 'true'; } catch (err) { throw new Error('Could not read the AI fallback ladder switch: ' + err.message); } },
  setLadder(on) {
    localStorage.setItem(this.LADDER_KEY, on ? 'true' : 'false');
    this._changed();
    this.drawLine();
    return !!on;
  },
  STOP_WORDS: new Set('the a an and or but if then so of to in on at for from by with as is are was were be been being it its this that these those i you he she we they them his her our your their not no do does did have has had will would can could should may might about into over than also just more most very'.split(' ')),
  // The text a request carries: selection first, otherwise the page.
  _sourceText(request) {
    const r = request || {};
    if (r.selectedText && String(r.selectedText).trim().length > 40) return String(r.selectedText);
    if (r.pageContext && r.pageContext.text && String(r.pageContext.text).trim().length > 40) return String(r.pageContext.text);
    return '';
  },
  // The `count` most useful sentences of `text`, in their original order. With a query, sentences that
  // share its words come first. Pure and bounded: 60,000 characters in, nothing leaves the machine.
  extract(text, query, count) {
    const clean = String(text || '').slice(0, 60000).replace(/\s+/g, ' ').trim();
    if (!clean) return [];
    const sentences = (clean.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || []).map(x => x.trim()).filter(x => x.length >= 25 && x.length <= 600);
    if (!sentences.length) return [];
    const words = (x) => (String(x).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).filter(w => !this.STOP_WORDS.has(w));
    const freq = new Map();
    for (const s of sentences) for (const w of words(s)) freq.set(w, (freq.get(w) || 0) + 1);
    const q = new Set(query ? words(query) : []);
    const scored = sentences.map((s, i) => {
      const ws = words(s);
      let score = 0;
      for (const w of new Set(ws)) { score += (freq.get(w) || 0); if (q.has(w)) score += 12; }
      score = ws.length ? score / Math.sqrt(ws.length) : 0;
      if (i < 2) score *= 1.15; // the lead of a page usually says what it is
      return { s, i, score };
    });
    const n = Math.max(1, Math.min(8, Number(count) || 4));
    return scored.sort((a, b) => b.score - a.score).slice(0, n).sort((a, b) => a.i - b.i).map(x => x.s);
  },
  // The answer for a failed request, or null when this request cannot be answered from its own text.
  degrade(feature, request, err) {
    if (!this.ladderOn() || !this.EXTRACTIVE_FEATURES.includes(feature)) return null;
    const text = this._sourceText(request);
    if (!text) return null;
    const picked = this.extract(text, feature === 'chat' || feature === 'explain' ? request.message : '', feature === 'summarize' || feature === 'digest' ? 5 : 3);
    if (!picked.length) return null;
    const why = String((err && err.message) || err || 'no backend').slice(0, 140);
    const note = 'Extracted, not written by a model: no AI backend answered (' + why + ').';
    let result;
    if (feature === 'summarize' || feature === 'digest') result = JSON.stringify({ title: 'Extract', summary: picked.slice(0, 2).join(' '), keyPoints: picked.slice(2), reply: note });
    else result = note + '\n\n' + picked.map(x => '- ' + x).join('\n');
    return { result, backend: 'extractive', model: '', degradedFrom: why };
  },

  // ---- the persistent "running on" line -----------------------------------------------------------
  runningOn() {
    if (this._last && this._last.backend === 'extractive') return 'Running on: no AI backend (the last answer was extracted from the text).';
    const r = this._router();
    const s = r.getOllamaStatus();
    const m = this.mode();
    const cloudUp = typeof r.cloudWorkerUrl === 'function' && !!r.cloudWorkerUrl() && (typeof r.isOnline !== 'function' || r.isOnline());
    const modelName = typeof r.getModel === 'function' ? r.getModel() : '';
    const local = 'your local model' + (modelName ? ' (' + modelName + ')' : '');
    let now;
    if (this.onDevice() && m !== 'cloud') now = 'on-device AI (chat), otherwise ' + (cloudUp ? 'the cloud AI' : s.available ? local : 'nothing');
    else if (m === 'cloud') now = cloudUp ? 'the cloud AI' : 'the cloud AI (not reachable right now)';
    else if (m === 'local') now = s.available ? local : 'nothing (your local model is not running)';
    else now = cloudUp ? 'the cloud AI' : s.available ? local : 'nothing (no cloud AI set up and no local model running)';
    return 'Running on: ' + now + '.';
  },
  drawLine() {
    if (typeof document === 'undefined') return null;
    let el = document.getElementById('ai-running-on');
    if (!this.ladderOn()) { if (el) el.remove(); return null; }
    if (!el) {
      const head = document.querySelector('#ai-panel .ai-header');
      if (!head) return null;
      el = document.createElement('div');
      el.id = 'ai-running-on';
      el.className = 'setting-info muted';
      el.setAttribute('role', 'status');
      el.style.padding = '2px 12px';
      el.style.fontSize = '11px';
      head.after(el);
    }
    el.textContent = this.runningOn() + (this._last && this._last.fellBackFrom ? ' Last answer fell back from ' + this._last.fellBackFrom + '.' : '');
    return el;
  },

  // callAI is wrapped, not edited: every caller goes through the exported object.
  wrap() {
    const r = this._router();
    if (r.__routeControlWrapped) return false;
    const original = r.callAI.bind(r);
    r.callAI = async (feature, request) => {
      const t0 = Date.now();
      let out;
      try { out = await original(feature, request); }
      catch (err) {
        if (request && request.signal && request.signal.aborted) throw err;
        if (err && err.code === 'vex-sensitive') throw err;
        const rung = this.degrade(feature, request, err);
        if (!rung) throw err;
        out = rung;
      }
      try {
        const rec = this._record(feature, out);
        if (rec) {
          out.because = rec.reason;
          if (typeof VexAISpend !== 'undefined') {
            if (out.fellBackFrom) VexAISpend.recordOutcome(feature, out.fellBackFrom, false);
            VexAISpend.recordOutcome(feature, out.backend, true, Date.now() - t0);
          }
          this.drawLine();
        }
      } catch (err) { window.VexProblems?.note('AI route', 'Could not note which backend answered', err); }
      return out;
    };
    r.__routeControlWrapped = true;
    return true;
  },

  _changed() { if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('vex:ai-route-changed')); },

  // ---- Settings ---------------------------------------------------------------------------------
  group(section) {
    const el = document.createElement('div');
    section.appendChild(el);
    const draw = () => {
      el.textContent = '';
      const sum = this.summary();
      const head = document.createElement('p');
      head.className = 'setting-info';
      head.textContent = 'In force: ' + sum.label;
      el.appendChild(head);
      for (const l of sum.lines) { const p = document.createElement('p'); p.className = 'setting-info muted'; p.textContent = l; el.appendChild(p); }
      const row = document.createElement('div');
      row.className = 'setting-toggle-row';
      for (const m of ['auto', 'local', 'cloud']) {
        const b = VexSettingsGroups.button(this.LABEL[m], () => { try { this.setMode(m); window.showToast?.('AI route: ' + this.LABEL[m]); } catch (err) { window.showToast?.(err.message, 'error'); } draw(); }, { primary: sum.mode === m });
        row.appendChild(b);
      }
      el.appendChild(row);
      const lrow = document.createElement('label');
      lrow.className = 'setting-toggle-row';
      const lbox = document.createElement('input');
      lbox.type = 'checkbox'; lbox.checked = this.ladderOn(); lbox.id = 'ai-ladder-switch';
      lbox.addEventListener('change', () => { try { this.setLadder(lbox.checked); window.showToast?.(lbox.checked ? 'AI fallback ladder on' : 'AI fallback ladder off'); } catch (err) { window.showToast?.(err.message, 'error'); } });
      lrow.append(lbox, document.createTextNode(' Fallback ladder: show "Running on" in the AI panel, and when no AI answers, pick the best sentences from the text itself'));
      el.appendChild(lrow);
      const last = this.lastAnswer();
      const p = document.createElement('p');
      p.className = 'setting-info muted';
      p.textContent = last ? 'Last answer (' + last.feature + '): ' + last.backend + (last.model ? ' · ' + last.model : '') + '. ' + last.reason : 'No answer yet in this session.';
      el.appendChild(p);
    };
    draw();
    document.addEventListener('vex:ai-answered', () => { if (el.isConnected) draw(); });
    document.addEventListener('vex:ai-route-changed', () => { if (el.isConnected) draw(); });
  },

  init() {
    if (this._wired) return false;
    this._wired = true;
    // The router is loaded before the window finishes starting; a window without it has no AI to route.
    if (typeof AIRouter !== 'undefined') this.wrap();
    if (typeof document !== 'undefined') {
      document.addEventListener('vex:ai-route-changed', () => this.drawLine());
      document.addEventListener('vex:ai-fallback', () => this.drawLine());
      this.drawLine();
    }
    return true;
  },
};

if (typeof window !== 'undefined') {
  window.AIRouteControl = AIRouteControl;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({
      id: 'ai-route', title: 'Where AI runs',
      keywords: 'ai route cloud local private auto ollama on-device answered backend which model fast',
      before: 'about',
      build: (el) => AIRouteControl.group(el),
    });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({
      id: 'ai-answered-by', label: 'Which AI answered?', hint: 'The backend and model behind the latest AI answer, and why',
      icon: 'sparkles',
      action: () => { const l = AIRouteControl.lastAnswer(); window.showToast?.(l ? l.feature + ': ' + l.backend + (l.model ? ' (' + l.model + ')' : '') + '. ' + l.reason : 'No AI answer yet in this session', 'info', 8000); },
    });
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => AIRouteControl.init());
    else AIRouteControl.init();
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { AIRouteControl };
