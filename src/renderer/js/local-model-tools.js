// === Local model tools: which model fits MY tasks, and a warm model in MY windows ==========
//
// Two small things on top of Ollama, both for the person's own local models and neither sending anything off
// the machine.
//
//   ModelFit    (Wave 5, on request) agent-model-test.js asks four canned questions about tool calls. This is the
//               other half: the person types up to five of their OWN tasks (a summary they want, an email they
//               would write), picks models, and every model answers every task. Vex times each answer, shows it,
//               and the person marks it good or poor; the ranking is their ratings first, then speed. Nothing runs
//               on its own, it is refused while a game is running, it goes through VexJobs.heavy (so a game, low
//               memory or a tripped breaker also hold it), each model is unloaded afterwards unless it was
//               already loaded before, and a model that only makes embeddings is skipped.
//
//   WarmModel   (Wave 5, opt-in, OFF) keeps the chosen local model loaded ONLY inside the weekly windows the person
//               typed ("weekdays 09:00-12:00"). The first answer after a cold start can take a long time on a big
//               model; inside a window it does not. The model is loaded with a keep-alive that ends with the window,
//               so Ollama itself unloads it afterwards even if Vex has closed. Never while a game is running or Vex
//               is saving battery, one Ledger line per window with an Undo that unloads it, and no window means no
//               warming.
const ModelFit = {
  KEY: 'vex.modelFit',
  FEATURE: 'local-model-tools',
  MAX_TASKS: 5,
  MAX_PROMPT: 1500,
  MAX_ANSWER: 1200,

  state() {
    const raw = localStorage.getItem(this.KEY);
    if (!raw) return { tasks: [], ratings: {} };
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('Your saved model-fit tasks could not be read: ' + err.message, { cause: err }); }
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Your saved model-fit tasks could not be read');
    return { tasks: Array.isArray(v.tasks) ? v.tasks.filter(t => t && typeof t.id === 'string' && typeof t.prompt === 'string') : [], ratings: v.ratings && typeof v.ratings === 'object' ? v.ratings : {} };
  },
  _save(s) { localStorage.setItem(this.KEY, JSON.stringify(s)); },

  addTask(name, prompt) {
    const n = String(name == null ? '' : name).trim();
    const p = String(prompt == null ? '' : prompt).trim();
    if (!n || n.length > 60) throw new Error('Give the task a name of up to 60 characters');
    if (!p) throw new Error('Type what the model should be asked');
    if (p.length > this.MAX_PROMPT) throw new Error('Keep the task under ' + this.MAX_PROMPT + ' characters');
    const s = this.state();
    if (s.tasks.length >= this.MAX_TASKS) throw new Error('At most ' + this.MAX_TASKS + ' tasks');
    if (s.tasks.some(t => t.name.toLowerCase() === n.toLowerCase())) throw new Error('There is already a task called ' + n);
    const task = { id: 'mf_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: n, prompt: p };
    s.tasks.push(task);
    this._save(s);
    return task;
  },
  removeTask(id) {
    const s = this.state();
    if (!s.tasks.some(t => t.id === id)) throw new Error('That task is gone');
    s.tasks = s.tasks.filter(t => t.id !== id);
    for (const k of Object.keys(s.ratings)) if (k.endsWith('|' + id)) delete s.ratings[k];
    this._save(s);
  },
  rate(model, taskId, rating) {
    if (!['good', 'poor', ''].includes(rating)) throw new Error('Rate an answer good or poor');
    const s = this.state();
    if (!s.tasks.some(t => t.id === taskId)) throw new Error('That task is gone');
    const key = model + '|' + taskId;
    if (rating) s.ratings[key] = rating; else delete s.ratings[key];
    this._save(s);
  },

  // rows: [{ model, results: [{ taskId, seconds, error }] }] -> best first: good ratings minus poor ones, then speed.
  rank(rows, ratings) {
    const score = (r) => r.results.reduce((n, x) => n + (ratings[r.model + '|' + x.taskId] === 'good' ? 1 : ratings[r.model + '|' + x.taskId] === 'poor' ? -1 : 0), 0);
    const secs = (r) => { const ok = r.results.filter(x => !x.error); return ok.length ? ok.reduce((n, x) => n + x.seconds, 0) / ok.length : Infinity; };
    const failed = (r) => (r.results.every(x => x.error) ? 1 : 0);
    return [...rows].sort((a, b) => (failed(a) - failed(b)) || (score(b) - score(a)) || (secs(a) - secs(b)));
  },
  advice(rows, ratings) {
    const ok = rows.filter(r => r.results.some(x => !x.error));
    if (!ok.length) return ['No model answered, so there is nothing to compare.'];
    const ranked = this.rank(ok, ratings);
    const speed = (r) => { const t = r.results.filter(x => !x.error); return t.reduce((n, x) => n + x.seconds, 0) / t.length; };
    const fastest = [...ok].sort((a, b) => speed(a) - speed(b))[0];
    const lines = ['Fastest on your tasks: ' + fastest.model + ' (about ' + Math.round(speed(fastest) * 10) / 10 + ' s an answer).'];
    const rated = ok.filter(r => r.results.some(x => ratings[r.model + '|' + x.taskId]));
    if (rated.length) lines.push('Best by your ratings: ' + ranked[0].model + '.');
    else lines.push('Mark the answers good or poor to rank the models by what you think of them, not only by speed.');
    const slow = ok.filter(r => speed(r) > 3 * speed(fastest) && r !== fastest);
    if (slow.length) lines.push(slow.map(r => r.model).join(', ') + (slow.length === 1 ? ' is' : ' are') + ' more than three times slower: worth it only if the answers are clearly better.');
    return lines;
  },

  _gaming() {
    if (typeof GameMode !== 'undefined' && GameMode.gaming) return 'a game is running';
    if (typeof BatteryMode !== 'undefined' && typeof BatteryMode.holdingAi === 'function' && BatteryMode.holdingAi()) return 'Vex is saving battery';
    return '';
  },

  // The models to try: the chosen ones, else every installed chat model. -> { name, size }
  async candidates(chosen) {
    if (typeof Ollama === 'undefined') throw new Error('Ollama is not available here');
    const all = (await Ollama.listModels()).filter(m => !(typeof AgentModelTest !== 'undefined' && AgentModelTest.EMBED.test(m.name)));
    if (!all.length) throw new Error('No chat models are installed');
    if (chosen && chosen.length) {
      const picked = all.filter(m => chosen.includes(m.name));
      if (!picked.length) throw new Error('None of the chosen models is installed');
      return picked;
    }
    return all;
  },

  // Every model answers every task, one model at a time. -> rows. Throws while a game runs.
  async run(models, onProgress) {
    const why = this._gaming();
    if (why) throw new Error('Not now: ' + why + '. Every model is loaded onto the graphics card in turn.');
    const tasks = this.state().tasks;
    if (!tasks.length) throw new Error('Add at least one task first');
    if (!models.length) throw new Error('Pick at least one model');
    const wasLoaded = new Set();
    try { for (const r of await Ollama.running()) wasLoaded.add(r.name); }
    catch (err) { window.VexProblems?.note('Model fit', 'Could not read which models were already loaded; every model will be unloaded afterwards', err); }
    const rows = [];
    let step = 0;
    const total = models.length * tasks.length;
    for (const m of models) {
      const row = { model: m.name, size: m.sizeFormatted || '', loadSeconds: 0, results: [] };
      const t0 = Date.now();
      try { await Ollama.warm(m.name, 5); row.loadSeconds = Math.round((Date.now() - t0) / 100) / 10; }
      catch (err) { row.results = tasks.map(t => ({ taskId: t.id, seconds: 0, chars: 0, answer: '', error: 'The model could not be loaded: ' + ((err && err.message) || err) })); rows.push(row); continue; }
      for (const t of tasks) {
        if (onProgress) onProgress(++step, total, m.name, t.name);
        const started = Date.now();
        const res = { taskId: t.id, seconds: 0, chars: 0, answer: '', error: '' };
        try {
          const text = await Ollama.generate(m.name, t.prompt, { temperature: 0.2, maxTokens: 400 });
          res.answer = String(text).slice(0, this.MAX_ANSWER); res.chars = String(text).length;
        } catch (err) { res.error = (err && err.message) || 'The model call failed'; }
        res.seconds = Math.round((Date.now() - started) / 100) / 10;
        row.results.push(res);
      }
      if (!wasLoaded.has(m.name)) {
        try { await Ollama.unload(m.name); }
        catch (err) { window.VexProblems?.note('Model fit', 'Could not unload ' + m.name + ' after its test', err); }
      }
      rows.push(row);
    }
    return rows;
  },
  // run(), held to the same rules as other heavy local AI work.
  async runOnRequest(models, onProgress) {
    const job = () => this.run(models, onProgress);
    if (typeof VexJobs !== 'undefined' && typeof VexJobs.heavy === 'function') {
      const r = await VexJobs.heavy('Model fit', job, { kind: 'ai-ask', feature: this.FEATURE });
      if (r && r.ran === false) throw new Error('Held back: ' + (r.reason || 'the machine is busy'));
      return r.value;
    }
    return job();
  },

  async open() {
    const S = VexSettingsGroups;
    const { body } = S.dialog({ id: 'vex-model-fit', title: 'Which model fits my tasks?', sub: 'Your own tasks, your own models, on this computer. Nothing runs until you press Run.' });
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    let last = null;
    const fail = (err) => window.showToast?.((err && err.message) || String(err), 'error');
    const draw = async () => {
      body.textContent = '';
      let models = [];
      try { models = await this.candidates(); } catch (err) { body.appendChild(S.note(err.message)); return; }
      const st = this.state();
      body.appendChild(S.note('Tasks (' + st.tasks.length + ' of ' + this.MAX_TASKS + '). Each model answers each task once, at a low temperature, up to about 400 words.'));
      for (const t of st.tasks) {
        const row = el('div', 'vexsr-rule');
        row.append(el('span', 'vexsr-host', t.name + ': ' + t.prompt.slice(0, 90) + (t.prompt.length > 90 ? '...' : '')), S.button('Remove', () => { try { this.removeTask(t.id); draw(); } catch (err) { fail(err); } }, { danger: true, label: 'Remove task ' + t.name }));
        body.appendChild(row);
      }
      if (st.tasks.length < this.MAX_TASKS) {
        const name = el('input', 'set-input'); name.type = 'text'; name.placeholder = 'Task name, e.g. Summarise a long email'; name.setAttribute('aria-label', 'Task name');
        const prompt = el('textarea', 'set-input'); prompt.rows = 3; prompt.placeholder = 'What the model should be asked, with any text it needs'; prompt.setAttribute('aria-label', 'What the model should be asked');
        body.append(name, prompt, S.button('Add task', () => { try { this.addTask(name.value, prompt.value); draw(); } catch (err) { fail(err); } }, { primary: true }));
      }
      const picks = el('div');
      const boxes = models.map(m => {
        const lab = el('label', 'setting-toggle-row');
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = models.length <= 3; cb.setAttribute('aria-label', 'Try ' + m.name);
        lab.append(cb, el('span', '', ' ' + m.name + (m.sizeFormatted ? ' (' + m.sizeFormatted + ')' : '')));
        picks.appendChild(lab);
        return { cb, m };
      });
      body.append(S.note('Models to try'), picks);
      const out = el('div'); out.setAttribute('role', 'status');
      const run = S.button('Run my tasks', async () => {
        const chosen = boxes.filter(b => b.cb.checked).map(b => b.m);
        try {
          const ok = await vexConfirm({ title: 'Run ' + st.tasks.length + ' task' + (st.tasks.length === 1 ? '' : 's') + ' on ' + chosen.length + ' model' + (chosen.length === 1 ? '' : 's') + '?', message: 'The graphics card and processor stay busy until it ends, and each model is unloaded afterwards unless it was already loaded. Expect a minute or more per model.', okLabel: 'Run' });
          if (!ok) return;
          run.disabled = true;
          last = await this.runOnRequest(chosen, (i, n, model, task) => { out.textContent = 'Asking ' + model + ': ' + task + ' (' + i + ' of ' + n + ')'; });
          show();
        } catch (err) { out.textContent = ''; fail(err); } finally { run.disabled = false; }
      }, { primary: true });
      body.append(run, out);
      const results = el('div'); body.appendChild(results);
      const show = () => {
        results.textContent = '';
        if (!last) return;
        const ratings = this.state().ratings;
        for (const l of this.advice(last, ratings)) results.appendChild(S.note(l));
        for (const r of this.rank(last, ratings)) {
          results.appendChild(el('div', 'setting-label', r.model + (r.size ? ' (' + r.size + ')' : '') + (r.loadSeconds ? ' - loaded in ' + r.loadSeconds + ' s' : '')));
          for (const x of r.results) {
            const t = st.tasks.find(q => q.id === x.taskId);
            const card = el('div', 'ad-page');
            card.appendChild(el('strong', '', (t ? t.name : 'Task') + ' - ' + x.seconds + ' s'));
            card.appendChild(el('div', 'ad-url', x.error ? x.error : x.answer));
            if (!x.error) {
              const cur = ratings[r.model + '|' + x.taskId] || '';
              for (const [label, val] of [['Good', 'good'], ['Poor', 'poor']]) {
                card.appendChild(S.button(label, () => { try { this.rate(r.model, x.taskId, cur === val ? '' : val); show(); } catch (err) { fail(err); } }, { primary: cur === val, label: label + ': ' + r.model + ' on ' + (t ? t.name : 'task') }));
              }
            }
            results.appendChild(card);
          }
        }
      };
      show();
    };
    await draw();
  },
};

// ------------------------------------------------------------------------------------------------
const WarmModel = {
  KEY: 'vex.warmModel',
  FEATURE: 'local-model-tools',
  JOB: 'Warm model',
  DAYS: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
  MAX_WINDOWS: 7,
  MAX_KEEP_MIN: 480,
  _ledgerDay: '',

  prefs() {
    const raw = localStorage.getItem(this.KEY);
    let v = null;
    if (raw) {
      try { v = JSON.parse(raw); } catch (err) { throw new Error('Your warm-model settings could not be read: ' + err.message, { cause: err }); }
    }
    const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    return { enabled: o.enabled === true, model: typeof o.model === 'string' ? o.model : '', windows: Array.isArray(o.windows) ? o.windows.filter(w => this.validWindow(w)) : [], last: o.last && typeof o.last === 'object' ? o.last : null };
  },
  _save(p) { localStorage.setItem(this.KEY, JSON.stringify(p)); },
  enabled() { try { return this.prefs().enabled; } catch (err) { console.error('[WarmModel]', err.message); return false; } },
  setEnabled(on) { const p = this.prefs(); p.enabled = !!on; this._save(p); this.sync(); return p.enabled; },
  setModel(name) { const p = this.prefs(); p.model = String(name || ''); this._save(p); },

  validWindow(w) {
    return !!w && Array.isArray(w.days) && w.days.length > 0 && w.days.every(d => Number.isInteger(d) && d >= 0 && d <= 6)
      && Number.isInteger(w.from) && Number.isInteger(w.to) && w.from >= 0 && w.to > w.from && w.to <= 1440;
  },
  // "weekdays 09:00-12:00", "mon-fri 9:00-17:30", "sat,sun 10:00-14:00", "daily 08:00-09:00" -> { days:[0-6], from, to (minutes) }
  parseWindow(text) {
    const m = /^\s*([a-z]+(?:\s*[-,]\s*[a-z]+)*)\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/i.exec(String(text || ''));
    if (!m) throw new Error('Write it like "weekdays 09:00-12:00" or "mon-wed 14:00-18:00"');
    const idx = (w) => { const i = this.DAYS.indexOf(w.toLowerCase().slice(0, 3)); if (i < 0) throw new Error('"' + w + '" is not a day'); return i; };
    const spec = m[1].toLowerCase().replace(/\s+/g, '');
    let days;
    if (spec === 'daily' || spec === 'everyday') days = [0, 1, 2, 3, 4, 5, 6];
    else if (spec === 'weekdays') days = [1, 2, 3, 4, 5];
    else if (spec === 'weekends') days = [0, 6];
    else if (spec.includes(',')) days = spec.split(',').map(idx);
    else if (spec.includes('-')) {
      const [a, b] = spec.split('-').map(idx);
      days = []; for (let d = a; ; d = (d + 1) % 7) { days.push(d); if (d === b) break; }
    } else days = [idx(spec)];
    const from = Number(m[2]) * 60 + Number(m[3]);
    const to = Number(m[4]) * 60 + Number(m[5]);
    if (Number(m[2]) > 23 || Number(m[4]) > 24 || Number(m[3]) > 59 || Number(m[5]) > 59) throw new Error('That is not a time of day');
    if (to <= from) throw new Error('The window must end after it starts (a window cannot pass midnight; add two)');
    return { days: [...new Set(days)].sort(), from, to };
  },
  describe(w) {
    const pad = (n) => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
    const d = w.days.length === 7 ? 'every day' : w.days.join(',') === '1,2,3,4,5' ? 'weekdays' : w.days.map(i => this.DAYS[i]).join(', ');
    return d + ' ' + pad(w.from) + '-' + pad(w.to);
  },
  addWindow(text) {
    const p = this.prefs();
    if (p.windows.length >= this.MAX_WINDOWS) throw new Error('At most ' + this.MAX_WINDOWS + ' windows');
    const w = this.parseWindow(text);
    p.windows.push(w);
    this._save(p);
    return w;
  },
  removeWindow(i) { const p = this.prefs(); if (!p.windows[i]) throw new Error('That window is gone'); p.windows.splice(i, 1); this._save(p); },

  // Minutes left in the window the clock is in now, or 0.
  minutesLeft(now = new Date(), windows = this.prefs().windows) {
    const mins = now.getHours() * 60 + now.getMinutes();
    let best = 0;
    for (const w of windows) if (w.days.includes(now.getDay()) && mins >= w.from && mins < w.to) best = Math.max(best, w.to - mins);
    return best;
  },
  _hold() {
    if (typeof GameMode !== 'undefined' && GameMode.gaming) return 'a game is running';
    if (typeof GameWarmdown !== 'undefined' && GameWarmdown.active) return 'a game launcher is open';
    if (typeof BatteryMode !== 'undefined' && typeof BatteryMode.holdingAi === 'function' && BatteryMode.holdingAi()) return 'Vex is saving battery';
    return '';
  },

  // One pass of the job. -> { action: 'idle' | 'held' | 'warmed' | 'kept', ... }. Failures raise.
  async tick(now = new Date()) {
    const p = this.prefs();
    if (!p.enabled) return { action: 'idle', why: 'off' };
    const left = this.minutesLeft(now, p.windows);
    if (!left) return { action: 'idle', why: 'outside your windows' };
    const held = this._hold();
    if (held) return { action: 'held', why: held };
    if (typeof Ollama === 'undefined' || typeof AIRouter === 'undefined') throw new Error('Ollama is not available here');
    if (!AIRouter.isOllamaAvailable()) return { action: 'idle', why: 'Ollama is not running' };
    const model = p.model || AIRouter.getModel();
    if (!model) throw new Error('There is no local model chosen to keep warm');
    const keep = Math.min(left, this.MAX_KEEP_MIN);
    // Already loaded and good for more than ten minutes (or the rest of a shorter window): nothing to do.
    const loaded = (await Ollama.running()).find(r => r.name === model);
    if (loaded && loaded.expiresAt && Date.parse(loaded.expiresAt) - now.getTime() > Math.min(keep, 10) * 60000) return { action: 'kept', model };
    await Ollama.warm(model, keep);
    this._noteWindow(model, keep, now);
    return { action: 'warmed', model, minutes: keep };
  },
  _noteWindow(model, minutes, now) {
    const day = now.toDateString() + '|' + model;
    if (this._ledgerDay === day) return;
    this._ledgerDay = day;
    if (typeof VexLedger !== 'undefined') {
      VexLedger.note({ feature: 'local-model-tools', what: 'Loaded ' + model + ' so it answers quickly in your window', why: 'You opted in and set a window that includes now; it is kept for the ' + minutes + ' minutes left in it and unloads by itself afterwards',
        undo: { kind: 'warm-unload', model }, stop: { kind: 'warm-stop' } });
    }
  },

  _job: null,
  // Starts or stops the background pass to match the switch.
  sync() {
    const on = this.enabled();
    if (on && !this._job && typeof VexJobs !== 'undefined') {
      this._job = VexJobs.every(this.JOB, 5 * 60 * 1000, () => this.tick().catch(err => window.VexProblems?.note('Warm model', 'Could not keep the model warm', err)), { when: 'background', feature: 'local-model-tools' });
      this.tick().catch(err => window.VexProblems?.note('Warm model', 'Could not keep the model warm', err));
    } else if (!on && this._job) {
      if (typeof this._job.stop === 'function') this._job.stop();
      this._job = null;
    }
  },

  group(host) {
    const S = VexSettingsGroups;
    const el = document.createElement('div');
    host.appendChild(el);
    const draw = () => {
      el.textContent = '';
      el.appendChild(S.note('Which model fits my tasks: type up to five tasks of your own, pick models, and every model answers every task so you can mark them good or poor. It runs only when you press Run, never during a game, and nothing leaves this computer.'));
      el.appendChild(S.button('Which model fits my tasks?', () => { ModelFit.open().catch((err) => window.showToast?.(err.message, 'error')); }, { primary: true }));
      el.appendChild(S.note('Warm model: keep your local model loaded only inside the windows you type below, so the first answer is quick. Off by default. It stops by itself when a window ends, never while a game runs or Vex is saving battery.'));
      let p;
      try { p = this.prefs(); } catch (err) { el.appendChild(S.note(err.message)); return; }
      const label = document.createElement('label');
      label.className = 'setting-toggle-row';
      const box = document.createElement('input');
      box.type = 'checkbox'; box.checked = p.enabled; box.setAttribute('aria-label', 'Keep my local model warm in my windows');
      box.addEventListener('change', () => { try { this.setEnabled(box.checked); window.showToast?.(box.checked ? 'Warm model on' : 'Warm model off'); } catch (err) { box.checked = !box.checked; window.showToast?.(err.message, 'error'); } });
      label.append(box, document.createTextNode(' Keep my local model warm in my windows'));
      el.appendChild(label);
      p.windows.forEach((w, i) => {
        const row = document.createElement('div');
        row.className = 'vexsr-rule';
        const t = document.createElement('span'); t.className = 'vexsr-host'; t.textContent = this.describe(w);
        row.append(t, S.button('Remove', () => { try { this.removeWindow(i); draw(); } catch (err) { window.showToast?.(err.message, 'error'); } }, { danger: true, label: 'Remove window ' + this.describe(w) }));
        el.appendChild(row);
      });
      if (!p.windows.length) el.appendChild(S.note('No windows yet, so nothing is warmed.'));
      const input = document.createElement('input');
      input.type = 'text'; input.className = 'set-input'; input.placeholder = 'weekdays 09:00-12:00'; input.setAttribute('aria-label', 'A window in which to keep the model warm');
      el.append(input, S.button('Add window', () => { try { this.addWindow(input.value); draw(); } catch (err) { window.showToast?.(err.message, 'error'); } }));
    };
    draw();
  },

  init() {
    if (this._wired) return true;
    this._wired = true;
    if (typeof VexLedger !== 'undefined') {
      VexLedger.registerUndo('warm-unload', async (t) => { await Ollama.unload(t.model); });
      VexLedger.registerStop('warm-stop', async () => { this.setEnabled(false); });
    }
    this.sync();
    return true;
  },
};

if (typeof window !== 'undefined') {
  window.ModelFit = ModelFit;
  window.WarmModel = WarmModel;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'local-model-tools', title: 'Local model: fit and warm-up', keywords: 'local model ollama benchmark fit tasks warm keep loaded schedule window speed first answer', before: 'about', build: (el) => WarmModel.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'model-fit', label: 'Which model fits my tasks?', hint: 'Try your own tasks on your local models and compare', icon: 'brain', action: () => { ModelFit.open().catch((err) => window.showToast?.(err.message, 'error')); } });
  }
  document.addEventListener('DOMContentLoaded', () => { try { WarmModel.init(); } catch (err) { window.VexProblems?.note('Warm model', 'Could not start', err); } });
}
if (typeof module !== 'undefined' && module.exports) module.exports = { ModelFit, WarmModel };
