// === Vex Phase 17A: Memory Recorder settings fragment ===

const MemoryRecorderSettings = (() => {
  function _toast(m, k) { if (typeof window.showToast === 'function') window.showToast(m, k); }
  function _esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

  async function render() {
    const container = document.getElementById('memrec-settings-content');
    if (!container) return;

    let available = false;
    try { available = await window.vex.memoryIsAvailable(); } catch {}
    const index = await window.vex.memoryList().catch(() => []);
    const total = index.length;
    const totalMs = index.reduce((s, c) => s + (c.durationMs || 0), 0);
    const totalHours = Math.round(totalMs / 3600000 * 10) / 10;
    const processed = index.filter(c => c.processed).length;

    const aiEnabled = (() => { try { const raw = localStorage.getItem('vex.memoryAIEnabled'); return raw === null ? true : JSON.parse(raw) === true; } catch { return true; } })();
    const pauseOnIdle = (() => { try { const raw = localStorage.getItem('vex.memoryPauseOnIdle'); return raw === null ? false : JSON.parse(raw) === true; } catch { return false; } })();

    container.innerHTML = `
      <div class="memrec-stats-card">
        <div class="memrec-stat"><div class="memrec-stat-value">${total}</div><div class="memrec-stat-label">Conversations</div></div>
        <div class="memrec-stat"><div class="memrec-stat-value">${totalHours}h</div><div class="memrec-stat-label">Recorded</div></div>
        <div class="memrec-stat"><div class="memrec-stat-value">${processed}</div><div class="memrec-stat-label">AI-processed</div></div>
        <div class="memrec-stat"><div class="memrec-stat-value" style="color:${available ? '#22c55e' : '#ef4444'}">${available ? '\u2713' : '\u2717'}</div><div class="memrec-stat-label">Whisper ${available ? 'ready' : 'missing'}</div></div>
      </div>

      <div class="setting-toggle-row">
        <span>Send transcripts to AI for analysis (titles, memories, action items)</span>
        <label class="toggle"><input type="checkbox" id="memrec-ai-toggle" ${aiEnabled ? 'checked' : ''}><span class="toggle-slider"></span></label>
      </div>
      <div class="setting-toggle-row">
        <span>Pause recording automatically when window is hidden</span>
        <label class="toggle"><input type="checkbox" id="memrec-pause-idle" ${pauseOnIdle ? 'checked' : ''}><span class="toggle-slider"></span></label>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button id="memrec-open-panel" style="padding:8px 16px;background:var(--primary);color:white;border:none;border-radius:var(--radius);cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px">Open Memory Panel</button>
        <button id="memrec-setup-whisper" style="padding:8px 16px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:var(--radius);cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px">Whisper Setup Guide</button>
      </div>

      <div class="sync-subsection danger-zone" style="margin-top:20px">
        <h3>Danger Zone</h3>
        <div class="danger-row">
          <div>
            <strong>Forget last hour</strong>
            <div class="desc">Delete recordings from the past 60 minutes</div>
          </div>
          <button class="btn-danger" id="memrec-forget-60">Delete</button>
        </div>
        <div class="danger-row">
          <div>
            <strong>Forget today</strong>
            <div class="desc">Delete all of today's recordings</div>
          </div>
          <button class="btn-danger" id="memrec-forget-today">Delete</button>
        </div>
        <div class="danger-row">
          <div>
            <strong>Wipe all memories</strong>
            <div class="desc">Delete ALL recorded conversations. Cannot be undone.</div>
          </div>
          <button class="btn-danger" id="memrec-wipe">Wipe All</button>
        </div>
        <div class="danger-row">
          <div>
            <strong>Revoke recording consent</strong>
            <div class="desc">You'll see the consent screen again next time you open the panel</div>
          </div>
          <button class="btn-danger" id="memrec-revoke-consent">Revoke</button>
        </div>
      </div>
    `;

    document.getElementById('memrec-ai-toggle')?.addEventListener('change', (e) => {
      localStorage.setItem('vex.memoryAIEnabled', JSON.stringify(e.target.checked));
      _toast(e.target.checked ? 'AI analysis enabled' : 'AI analysis disabled — 100% local', 'success');
    });
    document.getElementById('memrec-pause-idle')?.addEventListener('change', (e) => {
      localStorage.setItem('vex.memoryPauseOnIdle', JSON.stringify(e.target.checked));
    });
    document.getElementById('memrec-open-panel')?.addEventListener('click', () => SidebarManager?.openPanel('memrec'));
    document.getElementById('memrec-setup-whisper')?.addEventListener('click', () => {
      SidebarManager?.openPanel('memrec');
      setTimeout(() => document.getElementById('btn-open-whisper-guide')?.click(), 200);
    });
    document.getElementById('memrec-forget-60')?.addEventListener('click', async () => {
      if (!confirm('Delete the last hour of recordings?')) return;
      const r = await window.vex.memoryForgetRecent(60);
      _toast(`Deleted ${r.deleted} conversation(s)`, 'success');
      render();
    });
    document.getElementById('memrec-forget-today')?.addEventListener('click', async () => {
      if (!confirm("Delete today's recordings?")) return;
      const r = await window.vex.memoryForgetRecent(24 * 60);
      _toast(`Deleted ${r.deleted} conversation(s)`, 'success');
      render();
    });
    document.getElementById('memrec-wipe')?.addEventListener('click', async () => {
      if (!confirm('Delete ALL recorded conversations? This cannot be undone.')) return;
      if (!confirm('Really wipe every memory forever?')) return;
      await window.vex.memoryWipeAll();
      _toast('All memories wiped', 'success');
      render();
    });
    document.getElementById('memrec-revoke-consent')?.addEventListener('click', () => {
      if (!confirm('Revoke recording consent?')) return;
      localStorage.removeItem('vex.memoryConsented');
      localStorage.removeItem('vex.memoryConsentedAt');
      _toast('Consent revoked. Will re-prompt in the panel.', 'success');
    });

    // Auto-pause on window blur / hidden, when enabled
    if (pauseOnIdle && !MemoryRecorderSettings._pauseWired) {
      MemoryRecorderSettings._pauseWired = true;
      document.addEventListener('visibilitychange', async () => {
        try {
          const s = await window.vex.memoryStatus();
          if (document.hidden && s.isRecording && !s.isPaused) {
            await window.vex.memoryPause();
          } else if (!document.hidden && s.isRecording && s.isPaused) {
            await window.vex.memoryResume();
          }
        } catch {}
      });
    }
  }

  return { render };
})();

window.MemoryRecorderSettings = MemoryRecorderSettings;
