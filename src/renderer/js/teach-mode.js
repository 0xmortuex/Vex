// === Show Vex once, and it can do it again =================================
//
// Macros used to come only from an agent run: to get repeatable steps you had
// to ask the AI to do the thing first, and hope it did it your way. Most tasks
// worth repeating are ones you already know how to do — the monthly invoice
// download, the six clicks into a dashboard, the same form every week.
//
// Teach mode records those clicks as you make them and saves them as a macro,
// which replays without the model at all (AgentLoop.runMacro).
//
// What it will not record: anything typed into a password, one-time-code or
// card field. The click on the field is kept so the replay stops in the right
// place, but the value never leaves the page. A recording is also a list of
// what you did, so it is only ever made when you ask for one.
const TeachMode = {
  MAX_STEPS: 60,

  recording: false,
  steps: [],
  _webview: null,
  _name: '',
  _secretSeen: false,

  _tab() {
    const wv = typeof WebviewManager !== 'undefined' ? WebviewManager.getActiveWebview() : null;
    let url = '';
    try { url = (wv && wv.getURL && wv.getURL()) || ''; } catch { url = ''; }
    if (!wv || !/^https?:/i.test(url)) throw new Error('Open the page you want to teach Vex on first');
    return { wv, url };
  },

  // A step from the page → the agent tool call that repeats it. Text is
  // preferred over a selector: a button is still "Continue" after a redesign,
  // while its class is not.
  toCall(step, lastUrl) {
    if (!step) return null;
    if (step.kind === 'navigate') return { tool: 'navigate', parameters: { url: step.url } };
    if (step.kind === 'click') {
      if (step.text && step.tag !== 'input') return { tool: 'click_text', parameters: { text: step.text } };
      return step.selector ? { tool: 'click', parameters: { selector: step.selector } } : null;
    }
    if (step.kind === 'type') {
      return step.selector ? { tool: 'type_text', parameters: { selector: step.selector, text: step.value } } : null;
    }
    if (step.kind === 'secret') {
      // The replay stops here and hands the page back: nobody's password is in
      // a macro, so nobody's password can be replayed out of one.
      return { tool: 'hand_over', parameters: { why: 'This step is a password or a code — type it yourself, then press Continue' } };
    }
    void lastUrl;
    return null;
  },

  // Two clicks on the same thing in a row is a double click, not two steps;
  // and typing into one field ends with one value, not a step per keystroke.
  fold(steps) {
    const out = [];
    for (const step of steps) {
      const last = out[out.length - 1];
      if (last && step.kind === 'type' && last.kind === 'type' && last.selector === step.selector) { out[out.length - 1] = step; continue; }
      if (last && step.kind === 'click' && last.kind === 'click' && last.selector === step.selector && last.text === step.text) continue;
      out.push(step);
    }
    return out;
  },

  record(step) {
    if (!this.recording) return null;
    if (this.steps.length >= this.MAX_STEPS) return null;
    if (step && step.kind === 'secret') this._secretSeen = true;
    this.steps.push(step);
    this._paint();
    return step;
  },

  // --- the recording session ----------------------------------------------

  _send(on) {
    try { this._webview && this._webview.send && this._webview.send('vex-teach', !!on); } catch { /* the tab went */ }
  },

  start(name) {
    if (this.recording) throw new Error('Already recording — stop that one first');
    const t = this._tab();
    this.recording = true;
    this.steps = [];
    this._secretSeen = false;
    this._name = String(name || '').trim();
    this._webview = t.wv;
    this.steps.push({ kind: 'navigate', url: t.url });
    this._send(true);
    this._paint();
    window.showToast?.('Recording — do the task once, then press Done');
    return true;
  },

  cancel() {
    if (!this.recording) return false;
    this._send(false);
    this.recording = false;
    this.steps = [];
    this._webview = null;
    this._paint();
    window.showToast?.('Recording thrown away');
    return true;
  },

  // Saves what was recorded as a macro the agent can repeat.
  stop(name) {
    if (!this.recording) throw new Error('Nothing is being recorded');
    this._send(false);
    this.recording = false;
    this._webview = null;
    const steps = this.fold(this.steps);
    const calls = steps.map(s => this.toCall(s)).filter(Boolean);
    this._paint();
    if (calls.length < 2) { this.steps = []; throw new Error('That recording has nothing in it to repeat'); }
    if (typeof AgentLoop === 'undefined') throw new Error('The agent is not available to save it to');
    const macro = AgentLoop.saveMacroFromSteps(String(name || this._name || 'Taught task'), calls, steps[0] && steps[0].url);
    this.steps = [];
    window.showToast?.('Saved "' + macro.name + '" — ' + calls.length + ' steps, repeat it from Ctrl+K › Repeat a Saved Task'
      + (this._secretSeen ? '. A password step will hand the page back to you.' : ''));
    return macro;
  },

  // A quiet marker on the window while it is recording, so a recording is
  // never running without the user knowing.
  _paint() {
    document.body.classList.toggle('teach-recording', this.recording);
    const el = document.getElementById('teach-badge');
    if (this.recording && !el) {
      const badge = document.createElement('div');
      badge.id = 'teach-badge';
      badge.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:18px;z-index:10001;display:flex;align-items:center;gap:9px;'
        + 'background:var(--bg);border:1px solid var(--danger,#ef4444);color:var(--text);border-radius:999px;padding:6px 12px;font-size:12px;'
        + 'box-shadow:0 10px 30px var(--vex-shadow-color,rgba(0,0,0,0.4))';
      badge.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:var(--danger,#ef4444)"></span>'
        + '<span data-count></span>'
        + '<button data-done type="button" style="font-size:11.5px;border:1px solid var(--border);background:none;color:var(--text);border-radius:6px;padding:2px 8px;cursor:pointer">Done</button>'
        + '<button data-cancel type="button" style="font-size:11.5px;border:none;background:none;color:var(--text-muted);cursor:pointer">Throw away</button>';
      badge.querySelector('[data-done]').addEventListener('click', async () => {
        try {
          const name = await window.vexPrompt({ title: 'Name this task', label: 'What is it called', value: this._name, okLabel: 'Save' });
          if (name === null) return;
          this.stop(name);
        } catch (err) { window.showToast?.(err.message, 'error'); }
      });
      badge.querySelector('[data-cancel]').addEventListener('click', () => this.cancel());
      document.body.appendChild(badge);
    }
    if (!this.recording) { el?.remove(); return; }
    const count = document.querySelector('#teach-badge [data-count]');
    if (count) count.textContent = 'Recording — ' + this.steps.length + ' step' + (this.steps.length === 1 ? '' : 's');
  },

  // Steps arrive on the webview's own channel; a page that navigates mid-task
  // records the new address so the replay goes there too.
  attach(webview) {
    const on = (webview && webview._lifecycle)
      ? (ev, fn) => webview._lifecycle.listen(webview, ev, fn)
      : (ev, fn) => webview.addEventListener(ev, fn);
    on('ipc-message', (e) => {
      if (e.channel !== 'vex-teach-step' || !this.recording || webview !== this._webview) return;
      this.record((e.args && e.args[0]) || null);
    });
    on('did-navigate', (e) => {
      if (!this.recording || webview !== this._webview) return;
      this.record({ kind: 'navigate', url: e.url });
      this._send(true);          // a new document needs telling again
    });
  },
};

if (typeof window !== 'undefined') window.TeachMode = TeachMode;
if (typeof module !== 'undefined' && module.exports) module.exports = { TeachMode };
