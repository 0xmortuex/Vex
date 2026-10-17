// === One place that says where AI runs, and which one answered (T2-081) =========
//
// The entry counted six overlapping keys. Read against the code:
//   vex.preferLocalAI / vex.forceCloudAI   the real mode (now merged into vex.aiRoute) (AIRouter.setPreferLocal / setForceCloud,
//                                          the three radios in Settings > AI Backend)
//   vex.preferOnDeviceAI                   on-device (browser) chat, a separate switch (js/webllm.js)
//   vex.aiRouting                          the per-feature table (a pin per feature)
//   vex.localAIModel / vex.webllmModel     which MODEL runs; not a routing choice
//   vex.aiMode                             NOT routing: the AI panel's docked/expanded layout
// The two real routing booleans are now ONE key, vex.aiRoute ('auto' | 'local' | 'cloud'), merged by a
// one-time migration in ai-router.js (AIRouter.migrateRouteKey; Always cloud wins when both were saved,
// as the router already did). What was missing is the plain naming (Fast cloud / Private local / Auto),
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
    rec.reason = this.reasonFor(rec);
    this._last = rec;
    if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('vex:ai-answered', { detail: rec }));
  },
  // callAI is wrapped, not edited: every caller goes through the exported object.
  wrap() {
    const r = this._router();
    if (r.__routeControlWrapped) return false;
    const original = r.callAI.bind(r);
    r.callAI = async (feature, request) => {
      const out = await original(feature, request);
      try { this._record(feature, out); } catch (err) { window.VexProblems?.note('AI route', 'Could not note which backend answered', err); }
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
