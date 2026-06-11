// === Vex Phase 14: AI Backend settings UI ===

const AISettings = (() => {

  function toast(m, k) { if (typeof window.showToast === 'function') window.showToast(m, k); }
  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

  async function renderAISettings() {
    await refreshStatus();
    await populateModels();
    renderRoutingGrid();
    wireHandlers();
  }

  async function refreshStatus() {
    const status = AIRouter.getOllamaStatus();

    const cloudEl = document.getElementById('cloud-status');
    if (cloudEl) {
      if (status.online) {
        cloudEl.textContent = 'Online \u2713';
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
      { id: 'multiTab', label: 'Multi-tab AI', desc: 'Cross-tab reasoning' }
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

  function wireHandlers() {
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
    document.getElementById('btn-refresh-ollama')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-refresh-ollama');
      btn.disabled = true; btn.textContent = 'Checking...';
      const available = await AIRouter.refreshOllamaStatus();
      console.log('[AISettings] Refresh → Ollama available:', available);
      await refreshStatus();
      await populateModels();
      btn.disabled = false; btn.textContent = 'Refresh Ollama Status';
    });
    document.getElementById('btn-install-ollama')?.addEventListener('click', showOllamaInstallDialog);
    document.querySelectorAll('#routing-grid select').forEach(sel => {
      sel.addEventListener('change', () => {
        const prefs = AIRouter.getRoutingPrefs();
        prefs[sel.dataset.feature] = sel.value;
        AIRouter.setRoutingPrefs(prefs);
      });
    });
  }

  function showOllamaInstallDialog() {
    const overlay = document.createElement('div');
    overlay.className = 'sync-modal-overlay';
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
    document.getElementById('open-ollama-site').addEventListener('click', () => {
      if (typeof TabManager !== 'undefined') TabManager.createTab('https://ollama.com/download', true);
      overlay.remove();
    });
    document.getElementById('close-install-modal').addEventListener('click', () => overlay.remove());
  }

  return { renderAISettings, refreshStatus };
})();

window.AISettings = AISettings;
