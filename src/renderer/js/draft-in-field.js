// === Draft into the field I am typing in, with a diff and a tone check (T2-034) ===
//
// Ctrl+K › "Draft into the field I'm typing in" works on the box you are
// typing in on a web page (a comment, a reply, a form message):
//
//   1. Vex reads that one box (or the part of it you selected), only when you
//      run the command. Password, card, one-time-code and hidden boxes are
//      refused outright.
//   2. You say what you want (improve, shorter, friendlier, more formal,
//      translate, or your own words). Your local model writes it. Nothing goes
//      to the cloud: there is no cloud path in this file.
//   3. You see exactly what would change, as a word-by-word diff, and a tone
//      check (measured in code: long sentences, shouting, exclamation marks,
//      hedging, curtness) next to the model's one-line read of the tone.
//   4. Nothing is written until you press "Put it in the box". Then the text is
//      set in that box like typing would, nothing is sent, no form is
//      submitted and no key is pressed. "Put my original back" undoes it.
//
// The page script is built here as text and run in the page you are looking
// at (the same way the page reader does); the pure parts (diff, tone, the
// refusal rule, the scripts) have no DOM and are tested in
// tests/renderer/draftInField.test.js.

const VexDraftField = {
  FEATURE: 'draft-in-field',
  KEY_ENABLED: 'vex.draftField.enabled',
  MAX_WORDS: 1200,
  PRESETS: [
    { id: 'improve', label: 'Improve it', ask: 'Fix spelling and grammar and make it clearer. Keep my meaning, my voice and my language.' },
    { id: 'shorter', label: 'Shorter', ask: 'Make it shorter. Keep every important point. Keep my language.' },
    { id: 'friendlier', label: 'Friendlier', ask: 'Make the tone warmer and friendlier without changing the meaning. Keep my language.' },
    { id: 'formal', label: 'More formal', ask: 'Make the tone more formal and professional without changing the meaning. Keep my language.' },
    { id: 'english', label: 'Into English', ask: 'Translate it into natural English. Keep the tone.' },
  ],

  enabled() { try { return localStorage.getItem(this.KEY_ENABLED) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    try { localStorage.setItem(this.KEY_ENABLED, on ? 'on' : 'off'); }
    catch (err) { throw new Error('The setting could not be saved: ' + err.message, { cause: err }); }
    this._registerCommands();
  },

  // ---- which boxes may be touched (pure) ---------------------------------------------
  // info: what the page script reported about the focused element.
  refusal(info) {
    if (info && info.inFrame) return 'That box is inside an embedded frame, which Vex does not reach into.';
    if (!info || typeof info !== 'object' || !info.kind) return 'Click into the box you want to write in first, then run this again.';
    if (info.disabled || info.readOnly) return 'That box cannot be edited.';
    const t = String(info.type || '').toLowerCase();
    if (['password', 'hidden', 'file', 'checkbox', 'radio', 'number', 'date', 'datetime-local', 'time', 'month', 'week', 'range', 'color', 'email', 'url', 'tel', 'search'].includes(t)) {
      return t === 'password' ? 'That is a password box. Vex never reads or writes those.' : 'That box takes a special kind of value, not free writing.';
    }
    const hint = (String(info.autocomplete || '') + ' ' + String(info.name || '') + ' ' + String(info.id || '') + ' ' + String(info.label || '')).toLowerCase();
    if (/(current-password|new-password|one-time-code|cc-|\botp\b|\bcvv\b|\bcvc\b|iban|card.?number|passcode|\bssn\b|security.?code|pin.?code)/.test(hint)) return 'That box looks like it holds a password, a code or a card number. Vex stays out of it.';
    return null;
  },

  // ---- the page scripts (pure: they return text) -------------------------------------------
  // Runs in the page. Reports the focused editable and remembers it so the same
  // element is written to later; it changes nothing in the page.
  probeScript() {
    return '(function(){try{' +
      'var a=document.activeElement;var inFrame=false;' +
      'if(a&&(a.tagName==="IFRAME"||a.tagName==="FRAME")){return JSON.stringify({kind:"",inFrame:true});}' +
      'if(!a||a===document.body){return JSON.stringify({kind:""});}' +
      'var tag=a.tagName,kind="";' +
      'if(tag==="TEXTAREA")kind="textarea";else if(tag==="INPUT")kind="input";else if(a.isContentEditable)kind="editable";' +
      'if(!kind)return JSON.stringify({kind:""});' +
      'var value,selected="";' +
      'if(kind==="editable"){value=a.innerText||"";var s=window.getSelection();selected=s&&a.contains(s.anchorNode)?String(s.toString()):"";}' +
      'else{value=a.value||"";if(a.selectionStart!=null&&a.selectionEnd>a.selectionStart)selected=value.slice(a.selectionStart,a.selectionEnd);}' +
      'var lab="";try{lab=(a.labels&&a.labels[0]&&a.labels[0].innerText)||a.getAttribute("aria-label")||a.placeholder||"";}catch(e){}' +
      'window.__vexDraftTarget=a;' +
      'return JSON.stringify({kind:kind,type:a.type||"",name:a.name||"",id:a.id||"",autocomplete:a.getAttribute("autocomplete")||"",label:String(lab).slice(0,80),disabled:!!a.disabled,readOnly:!!a.readOnly,value:value,selected:selected,host:location.hostname});' +
      '}catch(e){return JSON.stringify({kind:"",error:String(e&&e.message||e)});}})()';
  },

  // Runs in the page. Writes `text` into the remembered element, the way typing
  // would (value set natively, then input and change events). It never presses a
  // key, never submits a form. mode "all" replaces the whole box, "selection"
  // replaces what was selected.
  applyScript(text, mode) {
    const t = JSON.stringify(String(text));
    const m = JSON.stringify(mode === 'selection' ? 'selection' : 'all');
    return '(function(){try{' +
      'var a=window.__vexDraftTarget;if(!a||!a.isConnected)return JSON.stringify({ok:false,error:"The box is gone from the page."});' +
      'if(document.activeElement!==a){try{a.focus();}catch(e){}}' +
      'var text=' + t + ',mode=' + m + ';' +
      'if(a.isContentEditable){' +
        'if(mode==="all"){var r=document.createRange();r.selectNodeContents(a);var s=window.getSelection();s.removeAllRanges();s.addRange(r);}' +
        'var ok=document.execCommand("insertText",false,text);' +
        'if(!ok){a.textContent=text;a.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:text}));}' +
        'return JSON.stringify({ok:true});}' +
      'var proto=a.tagName==="TEXTAREA"?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;' +
      'var setter=Object.getOwnPropertyDescriptor(proto,"value").set;' +
      'var cur=a.value||"";var next=text;' +
      'if(mode==="selection"&&a.selectionEnd>a.selectionStart){next=cur.slice(0,a.selectionStart)+text+cur.slice(a.selectionEnd);}' +
      'setter.call(a,next);' +
      'a.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:text}));' +
      'a.dispatchEvent(new Event("change",{bubbles:true}));' +
      'return JSON.stringify({ok:true});' +
      '}catch(e){return JSON.stringify({ok:false,error:String(e&&e.message||e)});}})()';
  },

  // ---- the diff (pure) ---------------------------------------------------------------------------
  _tokens(s) { return String(s).match(/\s+|[^\s]+/g) || []; },

  // Word-by-word, longest common subsequence. -> [{ t: 'same'|'del'|'add', text }]
  diff(before, after) {
    const a = this._tokens(before), b = this._tokens(after);
    if (a.length > 4000 || b.length > 4000) throw new Error('That is too long to compare word by word (over ' + this.MAX_WORDS + ' words).');
    const n = a.length, m = b.length;
    const w = m + 1;
    const dp = new Uint16Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
      }
    }
    const out = [];
    const push = (t, text) => { const last = out[out.length - 1]; if (last && last.t === t) last.text += text; else out.push({ t, text }); };
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { push('same', a[i]); i++; j++; }
      else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) { push('del', a[i]); i++; }
      else { push('add', b[j]); j++; }
    }
    while (i < n) push('del', a[i++]);
    while (j < m) push('add', b[j++]);
    return out;
  },

  // ---- the tone check (pure) -----------------------------------------------------------------------
  // Measured, not guessed: each note says what was counted.
  toneCheck(text) {
    const s = String(text == null ? '' : text).trim();
    const notes = [];
    if (!s) return { notes: ['The box is empty.'], words: 0 };
    const words = s.split(/\s+/).filter(Boolean);
    const sentences = s.split(/(?<=[.!?…])\s+/).filter(x => x.trim());
    const longest = sentences.reduce((mx, x) => Math.max(mx, x.split(/\s+/).filter(Boolean).length), 0);
    if (longest > 30) notes.push('One sentence has ' + longest + ' words; the reader may lose the thread.');
    const bang = (s.match(/!/g) || []).length;
    if (bang >= 3) notes.push(bang + ' exclamation marks can read as shouting or as pressure.');
    const caps = words.filter(wd => wd.length > 3 && wd === wd.toUpperCase() && /[A-ZÇĞİÖŞÜ]/.test(wd)).length;
    if (caps >= 2) notes.push(caps + ' words in capitals read as shouting.');
    const hedges = (s.match(/\b(just|sorry|maybe|perhaps|i think|i guess|kind of|sort of|a bit|probably|belki|galiba)\b/gi) || []).length;
    if (hedges >= 4) notes.push('Hedging words ' + hedges + ' times (just, sorry, maybe...); it may sound unsure.');
    if (words.length <= 5 && !/[?!]/.test(s) && !/\b(please|thanks|thank you|lütfen|teşekkür)/i.test(s)) notes.push('Very short and without please or thanks; it may sound curt.');
    const rep = new Map();
    for (const wd of words.map(x => x.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')).filter(x => x.length > 4)) rep.set(wd, (rep.get(wd) || 0) + 1);
    const again = [...rep].filter(([, c]) => c >= 4).map(([wd]) => wd);
    if (again.length) notes.push('The word "' + again[0] + '" is repeated ' + rep.get(again[0]) + ' times.');
    if (!notes.length) notes.push('Nothing stands out: sentences are a normal length and the tone markers are calm.');
    return { notes, words: words.length, longest };
  },

  // ---- the model call (local only) -----------------------------------------------------------------------
  buildPrompt(text, ask) {
    return 'You rewrite text that the user is about to post. ' + ask + '\n' +
      'Return ONLY JSON: {"text": "the rewritten text", "tone": "one short sentence on the tone of the result", "changed": "one short sentence on what you changed"}.\n' +
      'Do not add facts, greetings or sign-offs that were not there. Do not answer the text; rewrite it.\n\nText:\n' + text;
  },

  parseReply(result) {
    if (result == null) throw new Error('The local model returned nothing.');
    let o = result;
    if (typeof result === 'string') {
      const raw = result.trim();
      const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try { o = JSON.parse(raw.slice(start, end + 1)); }
        catch (err) { throw new Error('The local model did not answer in the expected shape. Try again.', { cause: err }); }
      } else throw new Error('The local model did not answer in the expected shape. Try again.');
    }
    const text = String(o.text || o.reply || '').trim();
    if (!text) throw new Error('The local model returned an empty text. Try again.');
    return { text, tone: String(o.tone || '').trim(), changed: String(o.changed || '').trim() };
  },

  async draft(text, ask, { signal } = {}) {
    if (typeof AIRouter === 'undefined' || typeof AIRouter.callOn !== 'function') throw new Error('The local AI is not available here.');
    if (typeof GameMode !== 'undefined' && GameMode.gaming) throw new Error('A game is running, so the local model is left alone. Try again when you are done playing.');
    const words = String(text).split(/\s+/).filter(Boolean).length;
    if (words > this.MAX_WORDS) throw new Error('That box holds ' + words + ' words; the limit is ' + this.MAX_WORDS + '. Select the part you want changed.');
    let res;
    try { res = await AIRouter.callOn('local', 'chat', { message: this.buildPrompt(text, ask), conversationHistory: [], signal }); }
    catch (err) {
      if (signal && signal.aborted) throw err;
      throw new Error('Your local model could not answer: ' + String((err && err.message) || err).replace(/\.$/, '') + '. Nothing was sent to the cloud.', { cause: err });
    }
    return this.parseReply(res && res.result);
  },

  // ---- running it in the page ------------------------------------------------------------------------------
  _webview() { return (typeof WebviewManager !== 'undefined') ? WebviewManager.getActiveWebview() : null; },
  async _run(wv, script) {
    const raw = await wv.executeJavaScript(script);
    let o;
    try { o = JSON.parse(raw); } catch (err) { throw new Error('The page gave an unexpected answer.', { cause: err }); }
    return o;
  },

  async probe(wv) {
    if (!wv) throw new Error('No page is open.');
    if (window.VexTabPolicy && !window.VexTabPolicy.canReadWebview(wv)) throw new Error('This is a private, Tor or routed tab, so Vex does not read it.');
    const info = await this._run(wv, this.probeScript());
    if (info.error) throw new Error('The page would not tell which box you are in: ' + info.error);
    const why = this.refusal(info);
    if (why) throw new Error(why);
    return info;
  },

  async apply(wv, text, mode) {
    const r = await this._run(wv, this.applyScript(text, mode));
    if (!r.ok) throw new Error(r.error || 'The box could not be written to.');
  },

  // ---- the dialog --------------------------------------------------------------------------------------------------
  async open() {
    if (!this.enabled()) { window.showToast?.('Draft into the field is switched off in Settings', 'warn'); return null; }
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    const wv = this._webview();
    let info;
    try { info = await this.probe(wv); }
    catch (err) { window.showToast?.(err.message, 'warn'); return null; }
    const mode = info.selected && info.selected.trim() ? 'selection' : 'all';
    const original = mode === 'selection' ? info.selected : info.value;
    const dlg = VexSettingsGroups.dialog({ id: 'vex-draft-field', title: 'Draft into the field', sub: (info.label ? info.label + ' on ' : 'A box on ') + (info.host || 'this page') + ' · ' + (mode === 'selection' ? 'your selection' : 'the whole box') + ' · local model, nothing is sent' });
    const body = dlg.body;
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const ask = el('input', 'vexsr-input');
    ask.type = 'text'; ask.placeholder = original.trim() ? 'What should change? Or pick one below' : 'What should it say? Describe the message'; ask.maxLength = 300;
    ask.setAttribute('aria-label', 'What to do with the text');
    const presets = el('div'); presets.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin:8px 0';
    const msg = el('div', 'vex-platform-note'); msg.setAttribute('role', 'status'); msg.setAttribute('aria-live', 'polite');
    const result = el('div');
    body.append(ask, presets, msg, result);
    let ctl = null, drafted = null, inserted = false;
    const say = (t) => { msg.textContent = t || ''; };
    const run = async (instruction) => {
      if (ctl) ctl.abort();
      ctl = new AbortController();
      result.textContent = ''; drafted = null;
      say('Writing with your local model…');
      try {
        const source = original.trim() ? original : '(empty box: write it from my instruction)';
        const r = await this.draft(source, instruction, { signal: ctl.signal });
        drafted = r;
        show(r);
        say('Check it, then press "Put it in the box". Nothing has been changed yet.');
      } catch (err) {
        if (ctl.signal.aborted) return;
        say(err.message);
        VexProblems?.note('Draft into the field', 'The local model failed', err);
      }
    };
    const show = (r) => {
      result.textContent = '';
      const dBox = el('div'); dBox.style.cssText = 'white-space:pre-wrap;padding:10px;border:1px solid var(--border);border-radius:8px;margin-top:6px;max-height:240px;overflow:auto';
      dBox.setAttribute('aria-label', 'What will change');
      if (original.trim()) {
        for (const seg of this.diff(original, r.text)) {
          const sp = el('span', null, seg.text);
          if (seg.t === 'del') { sp.style.cssText = 'text-decoration:line-through;color:var(--danger,#ef4444);opacity:.85'; sp.setAttribute('aria-label', 'removed: ' + seg.text); }
          if (seg.t === 'add') { sp.style.cssText = 'background:color-mix(in srgb,var(--primary,#3b82f6) 22%,transparent);border-radius:3px'; sp.setAttribute('aria-label', 'added: ' + seg.text); }
          dBox.appendChild(sp);
        }
      } else dBox.textContent = r.text;
      result.append(el('div', 'vexsr-sub', 'What will change (struck through is removed, highlighted is added)'), dBox);
      const tone = el('div', 'vex-platform-note');
      const before = original.trim() ? this.toneCheck(original).notes : [];
      const after = this.toneCheck(r.text).notes;
      tone.textContent = 'Tone check. ' + (before.length ? 'Before: ' + before.join(' ') + ' ' : '') + 'After: ' + after.join(' ') + (r.tone ? ' The model reads it as: ' + r.tone : '') + (r.changed ? ' Changed: ' + r.changed : '');
      result.appendChild(tone);
      const bar = el('div'); bar.style.cssText = 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap';
      const put = VexSettingsGroups.button('Put it in the box', async () => {
        try {
          await this.apply(wv, r.text, mode);
          inserted = true;
          say('Done. It is in the box; it has not been sent. Press "Put my original back" to undo.');
          put.disabled = true; back.disabled = false;
        } catch (err) { say(err.message); }
      }, { primary: true });
      const back = VexSettingsGroups.button('Put my original back', async () => {
        try {
          // The selection is gone after the first write, so the original goes back over the whole box when only a part was replaced.
          const whole = mode === 'selection' ? info.value : original;
          await this.apply(wv, whole, 'all');
          inserted = false; say('Your original is back.'); back.disabled = true; put.disabled = false;
        } catch (err) { say(err.message); }
      });
      back.disabled = true;
      const copy = VexSettingsGroups.button('Copy the new text', async () => {
        try { await navigator.clipboard.writeText(r.text); window.showToast?.('Copied'); }
        catch (err) { say('Could not copy: ' + err.message); }
      });
      bar.append(put, back, copy);
      result.appendChild(bar);
    };
    for (const p of this.PRESETS) {
      const b = VexSettingsGroups.button(p.label, () => run(p.ask));
      if (!original.trim() && p.id !== 'english') b.disabled = true;
      presets.appendChild(b);
    }
    const go = VexSettingsGroups.button('Write it', () => {
      const t = ask.value.trim();
      if (!t) { say('Say what you want first.'); ask.focus(); return; }
      run(t);
    }, { primary: true });
    presets.appendChild(go);
    ask.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go.click(); } });
    ask.focus({ preventScroll: true });
    // Closing the dialog stops a running request; an inserted text stays (it is in the page now).
    const obs = new MutationObserver(() => { if (!document.getElementById('vex-draft-field')) { if (ctl) ctl.abort(); obs.disconnect(); } });
    obs.observe(document.body, { childList: true });
    return { inserted: () => inserted, drafted: () => drafted };
  },

  _registerCommands() {
    if (typeof CommandBar === 'undefined' || !Array.isArray(CommandBar.commands)) return;
    CommandBar.commands = CommandBar.commands.filter(c => c.id !== 'draft-in-field');
    if (!this.enabled()) return;
    CommandBar.commands.push({
      id: 'draft-in-field', label: "Draft into the field I'm typing in",
      hint: 'Rewrite or write the text in the box you clicked, with a diff and a tone check. Local model; never sends.',
      icon: 'edit', action: () => this.open(),
    });
  },

  init() { this._registerCommands(); },

  renderSettings(el) {
    el.appendChild(VexSettingsGroups.note('Ctrl+K › "Draft into the field I\'m typing in" rewrites or writes the text of the box you clicked, with your local model. You see a word-by-word diff and a tone check first, and nothing is written until you press the button. It never sends, submits or presses a key, and it refuses password, card and code boxes.'));
    const row = document.createElement('label');
    row.className = 'setting-toggle-row';
    const span = document.createElement('span'); span.textContent = 'Draft into the field';
    const wrap = document.createElement('span'); wrap.className = 'toggle';
    const box = document.createElement('input'); box.type = 'checkbox'; box.checked = this.enabled(); box.setAttribute('aria-label', 'Draft into the field');
    const sl = document.createElement('span'); sl.className = 'toggle-slider';
    wrap.append(box, sl); row.append(span, wrap);
    box.addEventListener('change', () => { try { this.setEnabled(box.checked); } catch (err) { window.showToast?.(err.message, 'error'); } });
    el.appendChild(row);
  },
};

if (typeof window !== 'undefined') window.VexDraftField = VexDraftField;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexDraftField };
if (typeof VexSettingsGroups !== 'undefined') {
  VexSettingsGroups.register({ id: 'draft-in-field', title: 'Draft into the field', keywords: 'rewrite write text box diff tone check comment reply', render: (el) => VexDraftField.renderSettings(el) });
}
