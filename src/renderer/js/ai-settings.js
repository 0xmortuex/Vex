// === Vex Phase 14: AI Backend settings UI ===

const AISettings = (() => {

  function toast(m, k) { if (typeof window.showToast === 'function') window.showToast(m, k); }
  function escapeHtml(s) { return window.escapeHtml(s); }

  async function renderAISettings() {
    await refreshStatus();
    await populateModels();
    renderRoutingGrid();
    wireHandlers();
    // What is installed, what is loaded, and what fits (js/model-manager.js).
    if (typeof ModelManager !== 'undefined') ModelManager.render().catch(err => VexProblems?.note('Local AI', 'Could not list the models', err));
  }

  async function refreshStatus() {
    const status = AIRouter.getOllamaStatus();

    const cloudEl = document.getElementById('cloud-status');
    if (cloudEl) {
      // "Online" used to mean nothing more than navigator.onLine, so a profile
      // with no Worker URL still read "Online \u2713" right up until every request
      // failed with "Cloud AI is not configured".
      const configured = !!(AIRouter.cloudWorkerUrl && AIRouter.cloudWorkerUrl());
      if (!configured) {
        cloudEl.textContent = 'Not configured';
        cloudEl.className = 'status-badge offline';
      } else if (status.online) {
        cloudEl.textContent = 'Ready';
        cloudEl.className = 'status-badge online';
      } else {
        cloudEl.textContent = 'Offline (no internet)';
        cloudEl.className = 'status-badge offline';
      }
    }
    const localEl = document.getElementById('local-status');
    if (localEl) {
      if (status.available) {
        localEl.textContent = `Running (${status.model})`;
        localEl.className = 'status-badge online';
      } else {
        localEl.textContent = 'Not running';
        localEl.className = 'status-badge offline';
      }
    }
    let mode = 'auto';
    if (status.preferLocal) mode = 'local';
    else if (status.forceCloud) mode = 'cloud';
    const radio = document.querySelector(`input[name="ai-mode"][value="${mode}"]`);
    if (radio) radio.checked = true;
  }

  async function populateModels() {
    const select = document.getElementById('local-model-select');
    if (!select) return;
    if (!AIRouter.isOllamaAvailable()) {
      select.innerHTML = '<option value="">Ollama not running</option>';
      select.disabled = true;
      return;
    }
    select.disabled = false;
    const models = await Ollama.listModels();
    const current = AIRouter.getModel();
    if (!models.length) {
      select.innerHTML = '<option value="">No models installed &mdash; see install guide</option>';
      return;
    }
    select.innerHTML = models.map(m => `
      <option value="${escapeHtml(m.name)}" ${m.name === current ? 'selected' : ''}>
        ${escapeHtml(m.name)} (${escapeHtml(m.sizeFormatted)})
      </option>
    `).join('');
  }

  function renderRoutingGrid() {
    const container = document.getElementById('routing-grid');
    if (!container) return;
    const features = [
      { id: 'chat', label: 'Chat', desc: 'General conversation with AI' },
      { id: 'summarize', label: 'Summarize page', desc: 'Page summaries' },
      { id: 'translate', label: 'Translate', desc: 'Language translation' },
      { id: 'explain', label: 'Explain text', desc: 'Right-click \u2192 Explain' },
      { id: 'historyIndex', label: 'History indexing', desc: 'Background page summaries' },
      { id: 'historySearch', label: 'History search', desc: 'AI-powered history queries' },
      { id: 'agent', label: 'Agent mode', desc: 'Browser automation (cloud only)' },
      { id: 'multiTab', label: 'Multi-tab AI', desc: 'Cross-tab reasoning' },
      // Was routable in the router but had no row here, so the only way to
      // change it was editing localStorage by hand.
      { id: 'groupTabs', label: 'Group tabs', desc: 'AI tab grouping suggestions' }
    ];
    const prefs = AIRouter.getRoutingPrefs();
    container.innerHTML = features.map(f => `
      <div class="routing-item">
        <div class="routing-label">
          <strong>${escapeHtml(f.label)}</strong>
          <span>${escapeHtml(f.desc)}</span>
        </div>
        <select data-feature="${f.id}" ${f.id === 'agent' ? 'disabled' : ''}>
          <option value="auto" ${prefs[f.id] === 'auto' ? 'selected' : ''}>Auto</option>
          <option value="cloud" ${prefs[f.id] === 'cloud' ? 'selected' : ''}>Cloud</option>
          <option value="local" ${prefs[f.id] === 'local' ? 'selected' : ''}>Local</option>
        </select>
      </div>
    `).join('');
  }

  // The AI-mode radios, the model select and the refresh/install buttons live in
  // the static index.html markup, so they survive every re-render — wiring them
  // on each Settings open stacked one more listener per open (N toasts per
  // click, and concurrent "Checking…" runs that restored the wrong button
  // label). Only the routing grid is rebuilt, so only it is re-wired.
  let _staticWired = false;

  function wireHandlers() {
    if (!_staticWired) { _staticWired = true; wireStaticHandlers(); }
    wireRoutingGrid();
  }

  function wireRoutingGrid() {
    document.querySelectorAll('#routing-grid select').forEach(sel => {
      sel.addEventListener('change', () => {
        const prefs = AIRouter.getRoutingPrefs();
        prefs[sel.dataset.feature] = sel.value;
        AIRouter.setRoutingPrefs(prefs);
        // Choosing Local while Ollama is down makes that feature fail on every
        // use. Say so here rather than at the moment the user needs it.
        if (sel.value === 'local' && !AIRouter.isOllamaAvailable()) {
          toast('Saved — but Ollama is not running, so this feature will fail until you start it', 'warn');
        } else {
          toast('Routing updated', 'success');
        }
      });
    });
  }

  function wireStaticHandlers() {
    document.querySelectorAll('input[name="ai-mode"]').forEach(radio => {
      radio.addEventListener('change', () => {
        const v = radio.value;
        console.log('[AISettings] Mode changed to:', v);
        if (v === 'auto') {
          AIRouter.setPreferLocal(false);
          AIRouter.setForceCloud(false);
        } else if (v === 'local') {
          AIRouter.setPreferLocal(true);
          AIRouter.setForceCloud(false); // belt-and-suspenders: clear opposite at call site
        } else if (v === 'cloud') {
          AIRouter.setForceCloud(true);
          AIRouter.setPreferLocal(false);
        }
        console.log('[AISettings] New router state:', AIRouter.getOllamaStatus());
        toast('AI mode updated', 'success');
      });
    });
    document.getElementById('local-model-select')?.addEventListener('change', (e) => {
      if (e.target.value) {
        AIRouter.setModel(e.target.value);
        toast(`Model set to ${e.target.value}`, 'success');
      }
    });
    const refreshOllama = async (btn) => {
      const orig = btn ? btn.innerHTML : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
      const available = await AIRouter.ollamaUp();          // starts it when it is not running
      console.log('[AISettings] Refresh → Ollama available:', available);
      await refreshStatus();
      await populateModels();
      if (typeof ModelManager !== 'undefined') await ModelManager.render().catch(() => {});
      if (btn) { btn.disabled = false; btn.innerHTML = orig; }
      toast(available ? 'Ollama is running' : 'Ollama still not detected', available ? 'success' : 'error');
    };
    document.getElementById('btn-refresh-ollama')?.addEventListener('click', (e) => refreshOllama(e.currentTarget));
    document.getElementById('btn-refresh-ollama-inline')?.addEventListener('click', (e) => refreshOllama(e.currentTarget));
    document.getElementById('btn-install-ollama')?.addEventListener('click', showOllamaInstallDialog);

    const autoStart = document.getElementById('setting-ollama-autostart');
    if (autoStart) {
      autoStart.checked = AIRouter.ollamaAutoStart();
      autoStart.addEventListener('change', () => AIRouter.setOllamaAutoStart(autoStart.checked));
    }
    const ctxSelect = document.getElementById('agent-numctx-select');
    if (ctxSelect) {
      ctxSelect.value = String(AIRouter.agentNumCtx());
      ctxSelect.addEventListener('change', () => {
        try { localStorage.setItem('vex.agentNumCtx', JSON.stringify(Number(ctxSelect.value))); toast('Agent context size set to ' + ctxSelect.selectedOptions[0].textContent.split(' ')[0], 'success'); }
        catch (err) { toast('Could not save the context size: ' + ((err && err.message) || ''), 'error'); }
      });
    }
    document.getElementById('btn-test-agent-model')?.addEventListener('click', (e) => testAgentModel(e.currentTarget));
    document.getElementById('btn-test-all-models')?.addEventListener('click', (e) => testAllModels(e.currentTarget).catch(err => window.showToast?.('Could not list your models: ' + ((err && err.message) || ''), 'error')));
    renderTrustedSites();
  }

  // The agent's "Always on github.com" list, each with Remove.
  function renderTrustedSites() {
    const host = document.getElementById('agent-trusted-sites');
    if (!host || typeof AgentLoop === 'undefined') return;
    const sites = AgentLoop.trustedSites();
    host.innerHTML = '';
    if (!sites.length) { host.textContent = 'None — the agent asks before acting on any site you did not name.'; host.style.fontSize = '12px'; host.style.color = 'var(--text-muted)'; return; }
    for (const s of sites) {
      const row = document.createElement('div');
      row.className = 'setting-toggle-row';
      row.innerHTML = '<span></span><button type="button" class="btn-secondary">Remove</button>';
      row.querySelector('span').textContent = s.replace(/^https?:\/\//, '');
      row.querySelector('button').addEventListener('click', () => { AgentLoop.untrustSite(s); renderTrustedSites(); });
      host.appendChild(row);
    }
  }

  // Four canned agent turns against the chosen local model (js/agent-model-test.js).
  async function testAgentModel(btn) {
    const box = document.getElementById('agent-test-result');
    const model = document.getElementById('local-model-select')?.value || AIRouter.getModel();
    const orig = btn.textContent;
    btn.disabled = true;
    box.hidden = false;
    box.textContent = 'Asking ' + model + '…';
    try {
      const r = await AgentModelTest.run(model, (i, n, name) => { btn.textContent = 'Testing ' + i + '/' + n + '…'; box.textContent = 'Asking ' + model + ' — ' + name; });
      box.textContent = '';
      const head = document.createElement('div');
      head.className = 'agent-test-head ' + (r.passed === r.cases.length ? 'good' : r.passed === r.cases.length - 1 ? 'fair' : 'poor');
      head.textContent = r.model + ': ' + r.verdict + ' (' + r.passed + '/' + r.cases.length + ')';
      box.appendChild(head);
      for (const c of r.cases) {
        const row = document.createElement('div');
        row.className = 'agent-test-row ' + (c.ok ? 'ok' : 'bad');
        row.textContent = (c.ok ? 'Passed' : 'Failed') + ' · ' + c.name + ' · ' + c.seconds + ' s' + (c.ok ? '' : ' — ' + c.error);
        box.appendChild(row);
      }
      const facts = document.createElement('div');
      facts.className = 'agent-test-facts';
      facts.textContent = [r.vision ? 'Can see screenshots' : 'Cannot see screenshots (no vision)', 'agent context ' + r.numCtx.toLocaleString() + ' tokens', r.contextLength ? 'model limit ' + r.contextLength.toLocaleString() : '', Math.max(0, ...r.cases.map(c => c.promptTokens)) ? 'an empty turn uses ' + Math.max(...r.cases.map(c => c.promptTokens)).toLocaleString() : ''].filter(Boolean).join(' · ');
      box.appendChild(facts);
      if (r.warning) { const w = document.createElement('div'); w.className = 'agent-test-row bad'; w.textContent = r.warning; box.appendChild(w); }
    } catch (err) {
      box.textContent = 'The test could not run: ' + ((err && err.message) || 'unknown error');
    } finally { btn.disabled = false; btn.textContent = orig; }
  }

  // The same four turns on every installed model, ranked.
  async function testAllModels(btn) {
    const box = document.getElementById('agent-test-result');
    const models = (await Ollama.listModels()).filter(m => !AgentModelTest.EMBED.test(m.name));
    const ok = await vexConfirm({ title: 'Test every model?', message: `Each of your ${models.length} models answers the same four turns, one model at a time, and is unloaded afterwards. Expect about a minute per model, with the graphics card busy throughout.`, okLabel: 'Test them all' });
    if (!ok) return;
    const orig = btn.textContent;
    btn.disabled = true;
    box.hidden = false;
    try {
      const rows = await AgentModelTest.runAll((i, n, model) => { btn.textContent = 'Testing ' + i + '/' + n + '…'; box.textContent = 'Testing ' + model + ' (' + i + ' of ' + n + ')…'; });
      box.textContent = '';
      const head = document.createElement('div');
      head.className = 'agent-test-head';
      head.textContent = 'Best agent models here, best first';
      box.appendChild(head);
      rows.forEach((r, i) => {
        const row = document.createElement('div');
        row.className = 'agent-test-row ' + (r.error ? 'bad' : r.passed === r.total ? 'ok' : r.passed === r.total - 1 ? '' : 'bad');
        row.textContent = r.error
          ? r.model + ' — could not be tested: ' + r.error
          : (i + 1) + '. ' + r.model + ' — ' + r.passed + '/' + r.total + ' · ' + r.seconds + ' s' + (r.vision ? ' · sees screenshots' : '');
        box.appendChild(row);
      });
    } catch (err) {
      box.textContent = 'The test could not run: ' + ((err && err.message) || 'unknown error');
    } finally { btn.disabled = false; btn.textContent = orig; }
  }

  function showOllamaInstallDialog() {
    // Only ever one install dialog: pressing the button twice used to stack
    // overlays that all carried the same element ids, so the second one's
    // buttons wired the first and it could not be closed at all.
    document.querySelectorAll('.sync-modal-overlay[data-ollama-install]').forEach(e => e.remove());
    const overlay = document.createElement('div');
    overlay.className = 'sync-modal-overlay';
    overlay.dataset.ollamaInstall = '';
    overlay.innerHTML = `
      <div class="sync-modal-card" style="max-width:600px;max-height:80vh;overflow-y:auto">
        <h2 style="margin-top:0;color:var(--primary)">Install Ollama for Local AI</h2>
        <h3 style="font-size:13px;margin:14px 0 6px">Step 1: Download Ollama</h3>
        <p style="font-size:13px">Ollama is a free tool that runs AI models on your computer.</p>
        <button class="btn-primary" id="open-ollama-site">Open ollama.com</button>
        <h3 style="font-size:13px;margin:16px 0 6px">Step 2: Install it</h3>
        <p style="font-size:13px">Run the installer. It sets up a background service automatically.</p>
        <h3 style="font-size:13px;margin:16px 0 6px">Step 3: Pull a model</h3>
        <p style="font-size:13px">Open a terminal and run:</p>
        <pre style="background:var(--bg);padding:10px;border-radius:6px;overflow-x:auto;font-size:12px"><code>ollama pull llama3.2:3b</code></pre>
        <p style="color:var(--text-muted);font-size:12px;margin-top:10px">Recommended models:</p>
        <ul style="color:var(--text-muted);font-size:12px;line-height:1.7">
          <li><code>llama3.2:3b</code> &mdash; fast, 2GB, good for most tasks</li>
          <li><code>qwen2.5:3b</code> &mdash; fast, 2GB, strong at structured output</li>
          <li><code>llama3.2:8b</code> &mdash; slower, 5GB, higher quality</li>
          <li><code>gemma2:2b</code> &mdash; very fast, 1.6GB, minimal quality</li>
        </ul>
        <h3 style="font-size:13px;margin:16px 0 6px">Step 4: Click "Refresh Ollama Status"</h3>
        <p style="font-size:13px">Vex will detect Ollama automatically.</p>
        <div style="display:flex;justify-content:flex-end;margin-top:18px">
          <button class="btn-secondary" id="close-install-modal">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    // Scope the lookups to this overlay and close on backdrop/Esc: binding by
    // global id meant a second dialog's buttons wired the FIRST overlay, leaving
    // the newer one with no way to close it.
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    overlay.querySelector('#open-ollama-site').addEventListener('click', () => {
      if (typeof TabManager !== 'undefined') TabManager.createTab('https://ollama.com/download', true);
      close();
    });
    overlay.querySelector('#close-install-modal').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey);
  }

  return { renderAISettings, refreshStatus };
})();

window.AISettings = AISettings;
