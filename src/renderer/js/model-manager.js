// === The local models, and the card they run on ============================
//
// Installing, updating and removing an Ollama model meant a terminal. Which
// ones fit is not obvious either: an 8 GB card holds one 9 GB model badly and
// two comfortably at 4 GB each, and a model that does not fit is not refused —
// it runs on the processor, ten to a hundred times slower, with no sign except
// answers that take minutes.
//
// So: what is installed, what is loaded right now and where it is running,
// how much of the card is free, and whether each model fits. Plus the one
// button that matters while gaming — hand the video memory back.
const ModelManager = {
  // A rough working-set figure: the file plus the context it is asked for.
  // Ollama's own overhead is a few hundred MB more, so this errs high.
  fitMB(sizeBytes, numCtx) {
    const model = (sizeBytes || 0) / (1024 * 1024);
    const context = ((numCtx || 16384) / 1024) * 60;     // ~60 MB per 1K tokens at this size
    return Math.round(model + context + 400);
  },

  async state() {
    const out = { ok: false, models: [], loaded: [], gpu: null, error: null };
    try { out.gpu = (window.vex && window.vex.gpu) ? await window.vex.gpu() : null; } catch { out.gpu = null; }
    try {
      if (!(await Ollama.ping())) { out.error = 'Ollama is not running'; return out; }
      out.ok = true;
      out.models = await Ollama.listModels();
      out.loaded = await Ollama.running();
    } catch (err) { out.error = err.message; }
    const numCtx = (typeof AIRouter !== 'undefined' && AIRouter.agentNumCtx) ? AIRouter.agentNumCtx() : 16384;
    const freeMB = out.gpu ? out.gpu.freeMB : null;
    const totalMB = out.gpu ? out.gpu.totalMB : null;
    out.models = out.models.map(m => {
      const needMB = this.fitMB(m.size, numCtx);
      const live = out.loaded.find(l => l.name === m.name);
      return {
        ...m, needMB, live: !!live, onGpu: live ? live.onGpu : null,
        // "Fits" is against the whole card, not what is free right now: a game
        // that ends gives the memory back.
        fits: totalMB == null ? null : needMB <= totalMB,
        fitsNow: freeMB == null ? null : needMB <= freeMB,
      };
    });
    return out;
  },

  // Hand the card back: unloads every loaded model (about 5.5 GB here). Ollama
  // keeps running, and the next request loads the model again.
  async freeGpu() {
    const loaded = await Ollama.running();
    if (!loaded.length) return { freed: 0, models: [] };
    let freedMB = 0;
    const names = [];
    for (const m of loaded) {
      try { await Ollama.unload(m.name); freedMB += m.vramMB || 0; names.push(m.name); }
      catch (err) { VexProblems?.note('Local AI', 'Could not unload ' + m.name, err); }
    }
    return { freed: freedMB, models: names };
  },

  // ---- the Settings panel ---------------------------------------------------
  async render(host) {
    host = host || document.getElementById('model-manager');
    if (!host) return;
    host.innerHTML = '<div class="mm-empty">Reading the models…</div>';
    const s = await this.state();
    if (!s.ok) {
      host.innerHTML = '<div class="mm-empty"></div>';
      host.querySelector('.mm-empty').textContent = (s.error || 'Ollama is not running') + ' — start it with the button above, or install it from the guide.';
      return;
    }
    const gb = (mb) => (mb / 1024).toFixed(1) + ' GB';
    host.innerHTML = `
      <div class="mm-card">${s.gpu ? `${this._esc(s.gpu.name)} — ${gb(s.gpu.usedMB)} of ${gb(s.gpu.totalMB)} in use, ${s.gpu.utilization}% busy` : 'No NVIDIA card found — models run on the processor.'}</div>
      <div class="mm-list"></div>
      <div class="mm-actions">
        <input type="text" id="mm-pull-name" class="mm-input" placeholder="Install a model, e.g. qwen3.5:latest" spellcheck="false">
        <button class="btn-secondary" id="mm-pull">Install</button>
        <button class="btn-secondary" id="mm-free">Free the graphics card</button>
      </div>
      <div class="mm-progress" id="mm-progress" hidden></div>`;

    const list = host.querySelector('.mm-list');
    if (!s.models.length) list.innerHTML = '<div class="mm-empty">No models installed yet. Install one below — qwen3.5:latest is a good default.</div>';
    for (const m of s.models) {
      const row = document.createElement('div');
      row.className = 'mm-row' + (m.live ? ' live' : '');
      const where = m.live ? (m.onGpu ? 'loaded on the card' : 'loaded on the PROCESSOR — slow') : '';
      // A model that is already loaded plainly fits — saying it 'will not fit'
      // because the card is full OF IT reads as a contradiction.
      const fit = m.fits === false ? 'too big for this card' : (!m.live && m.fitsNow === false ? 'will not fit until the card frees up' : '');
      row.innerHTML = `
        <div class="mm-name"></div>
        <div class="mm-meta"></div>
        <div class="mm-row-actions">
          ${m.live ? '<button class="mm-btn" data-unload>Unload</button>' : ''}
          <button class="mm-btn" data-use>Use</button>
          <button class="mm-btn mm-danger" data-delete>Delete</button>
        </div>`;
      row.querySelector('.mm-name').textContent = m.name;
      row.querySelector('.mm-meta').textContent = [m.sizeFormatted, 'needs about ' + gb(m.needMB), where, fit].filter(Boolean).join(' · ');
      row.querySelector('[data-use]').addEventListener('click', () => {
        AIRouter.setModel(m.name);
        window.showToast?.('Vex will use ' + m.name);
        this.render(host);
      });
      row.querySelector('[data-unload]')?.addEventListener('click', async () => {
        try { await Ollama.unload(m.name); window.showToast?.('Unloaded ' + m.name + ' — the card is free'); }
        catch (err) { window.showToast?.('Could not unload it: ' + err.message, 'error'); }
        this.render(host);
      });
      row.querySelector('[data-delete]').addEventListener('click', async () => {
        const ok = await vexConfirm({ title: 'Delete ' + m.name + '?', message: 'This removes the model from your disk (' + m.sizeFormatted + '). You can install it again later.', okLabel: 'Delete', danger: true });
        if (!ok) return;
        try { await Ollama.deleteModel(m.name); window.showToast?.('Deleted ' + m.name); }
        catch (err) { window.showToast?.('Could not delete it: ' + err.message, 'error'); }
        this.render(host);
      });
      list.appendChild(row);
    }

    host.querySelector('#mm-free').addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try {
        const r = await this.freeGpu();
        window.showToast?.(r.models.length ? `Freed about ${gb(r.freed)} — unloaded ${r.models.join(', ')}` : 'Nothing was loaded');
      } catch (err) { window.showToast?.('Could not free it: ' + err.message, 'error'); }
      this.render(host);
    });
    host.querySelector('#mm-pull').addEventListener('click', () => this.pull(host));
    host.querySelector('#mm-pull-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.pull(host); });
  },

  async pull(host) {
    const input = host.querySelector('#mm-pull-name');
    const name = (input.value || '').trim();
    if (!name) { input.focus(); return; }
    const bar = host.querySelector('#mm-progress');
    const btn = host.querySelector('#mm-pull');
    bar.hidden = false; btn.disabled = true;
    bar.textContent = 'Starting…';
    try {
      await Ollama.pullModel(name, (e) => {
        const pct = (e.total ? Math.round((e.completed || 0) / e.total * 100) : null);
        bar.textContent = (e.status || 'working') + (pct != null ? ` — ${pct}%` : '');
      });
      window.showToast?.('Installed ' + name);
      input.value = '';
      this.render(host);
    } catch (err) {
      bar.textContent = 'Could not install it: ' + err.message;
      VexProblems?.note('Local AI', 'Could not install ' + name, err);
    } finally { btn.disabled = false; }
  },

  _esc(s) { return window.escapeHtml ? window.escapeHtml(String(s)) : String(s); },
};

if (typeof window !== 'undefined') window.ModelManager = ModelManager;
if (typeof module !== 'undefined' && module.exports) module.exports = { ModelManager };
