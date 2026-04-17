// === Vex Phase 17A: Memory Recorder panel ===
// NOTE: named MemoryRecorderPanel to avoid collision with the Phase 4
// MemoryPanel (which shows per-tab memory usage).

const MemoryRecorderPanel = (() => {

  function _toast(m, k) { if (typeof window.showToast === 'function') window.showToast(m, k); }
  function _esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function _consented() { try { return JSON.parse(localStorage.getItem('vex.memoryConsented') || 'false') === true; } catch { return false; } }
  function _setConsented(v) { try { localStorage.setItem('vex.memoryConsented', JSON.stringify(!!v)); localStorage.setItem('vex.memoryConsentedAt', new Date().toISOString()); } catch {} }

  async function init() {
    const panel = document.getElementById('panel-memrec');
    if (!panel) return;
    if (panel.dataset.rendered) return render();
    panel.dataset.rendered = 'true';
    panel.innerHTML = `<div id="memrec-content" class="memrec-panel-wrapper"></div>`;
    await render();
  }

  async function render() {
    const container = document.getElementById('memrec-content');
    if (!container) return;

    let available = false;
    try { available = await window.vex.memoryIsAvailable(); } catch {}
    if (!available) {
      _renderSetup(container);
      return;
    }
    if (!_consented()) {
      _renderConsent(container);
      return;
    }

    const status = await window.vex.memoryStatus();
    const index = await window.vex.memoryList();

    container.innerHTML = `
      <div class="memrec-header">
        <div class="memrec-header-left">
          <h2>&#127897;&#65039; Memory Recorder</h2>
          ${status.isRecording ? `
            <div class="recording-badge ${status.isPaused ? 'paused' : 'live'}">
              <span class="rec-dot"></span>${status.isPaused ? 'PAUSED' : 'REC'}
            </div>` : ''}
        </div>
        <div class="recording-controls">
          ${!status.isRecording ? `
            <button class="btn-primary" id="btn-rec-start"><span class="rec-dot"></span> Start Recording</button>
          ` : status.isPaused ? `
            <button class="btn-primary" id="btn-rec-resume">Resume</button>
            <button class="btn-secondary" id="btn-rec-stop">Stop</button>
          ` : `
            <button class="btn-secondary" id="btn-rec-pause">Pause</button>
            <button class="btn-danger" id="btn-rec-stop">Stop</button>
          `}
        </div>
      </div>

      <div class="memrec-search">
        <input type="text" id="memrec-search-input" placeholder="Search your memory... (&quot;what did I say about X last Tuesday&quot;)">
        <div class="search-mode-pills">
          <button class="pill active" data-mode="ai">&#10024; AI Search</button>
          <button class="pill" data-mode="keyword">Keyword</button>
        </div>
      </div>

      <div class="memrec-quick-actions">
        <button class="quick-btn" id="btn-forget-5">Forget last 5 min</button>
        <button class="quick-btn" id="btn-forget-30">Forget last 30 min</button>
        <button class="quick-btn" id="btn-memrec-settings">&#9881;&#65039; Open Settings</button>
      </div>

      ${status.isRecording ? `
        <div class="live-transcript-box">
          <div class="live-label">Live transcript (last few segments)</div>
          <div id="live-transcript-inner"></div>
        </div>` : ''}

      <div class="memrec-timeline" id="memrec-timeline">${_renderTimeline(index)}</div>
    `;

    _wireHandlers(container);
  }

  function _renderTimeline(conversations) {
    if (!conversations || conversations.length === 0) {
      return `
        <div class="empty-state">
          <div class="empty-icon">&#127897;&#65039;</div>
          <div class="empty-title">No conversations yet</div>
          <div class="empty-subtitle">Start recording to capture your first memory</div>
        </div>`;
    }
    const byDay = {};
    for (const c of conversations) {
      const day = new Date(c.startedAt).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
      (byDay[day] ||= []).push(c);
    }
    return Object.entries(byDay).map(([day, convs]) => `
      <div class="timeline-day">
        <div class="day-label">${_esc(day)}</div>
        ${convs.map(_renderConvCard).join('')}
      </div>`).join('');
  }

  function _renderConvCard(c) {
    const time = new Date(c.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dur = _formatDuration(c.durationMs || 0);
    const title = c.title || (c.processed ? '(Untitled)' : '(Processing...)');
    const summary = c.summary || '';
    const topicsHtml = (c.topics && c.topics.length) ?
      `<div class="conv-topics">${c.topics.slice(0, 5).map(t => `<span class="topic-chip">${_esc(t)}</span>`).join('')}</div>` : '';
    const actionsHtml = (c.actionItems && c.actionItems.length) ? `
      <div class="conv-actions-list">
        <strong>Action items</strong>
        <ul>${c.actionItems.slice(0, 3).map(a => `<li>${_esc(a)}</li>`).join('')}</ul>
      </div>` : '';
    const sentimentHtml = c.sentiment ? `<div class="conv-sentiment ${_esc(c.sentiment)}">${_esc(c.sentiment)}</div>` : '';
    return `
      <div class="conv-card" data-conv-id="${_esc(c.id)}">
        <div class="conv-header">
          <div class="conv-time">${_esc(time)} &middot; ${_esc(dur)}</div>
          ${sentimentHtml}
        </div>
        <div class="conv-title">${_esc(title)}</div>
        ${summary ? `<div class="conv-summary">${_esc(summary)}</div>` : ''}
        ${topicsHtml}
        ${actionsHtml}
        <div class="conv-footer">
          <button class="btn-link expand-btn" data-conv-id="${_esc(c.id)}">Show transcript</button>
          <button class="btn-link delete-btn" data-conv-id="${_esc(c.id)}">Delete</button>
        </div>
      </div>`;
  }

  function _formatDuration(ms) {
    const sec = Math.max(0, Math.floor(ms / 1000));
    const min = Math.floor(sec / 60);
    const h = Math.floor(min / 60);
    if (h > 0) return `${h}h ${min % 60}m`;
    if (min > 0) return `${min}m ${sec % 60}s`;
    return `${sec}s`;
  }

  function _renderSetup(container) {
    container.innerHTML = `
      <div class="memrec-setup">
        <h2>&#127897;&#65039; Memory Recorder</h2>
        <p>Records your conversations, transcribes them <strong>locally</strong> via Whisper, then extracts memories, action items, and people so you can search what you've said.</p>
        <div class="setup-warning">
          <strong>&#9888;&#65039; One-time setup needed</strong>
          <p>Whisper (the local speech-to-text engine) isn't installed yet. Two files are needed:</p>
          <ol>
            <li><code>whisper.exe</code></li>
            <li><code>ggml-base.bin</code> (~140 MB, multilingual — English + Turkish + many more)</li>
          </ol>
          <button class="btn-primary" id="btn-open-whisper-guide">Show install guide</button>
          <button class="btn-secondary" id="btn-recheck-whisper" style="margin-left:6px">Re-check</button>
        </div>
      </div>`;
    document.getElementById('btn-open-whisper-guide')?.addEventListener('click', _showWhisperGuide);
    document.getElementById('btn-recheck-whisper')?.addEventListener('click', async () => {
      if (await window.vex.memoryIsAvailable()) { _toast('Whisper detected \u2713', 'success'); render(); }
      else _toast('Still not detected — check file locations', 'warn');
    });
  }

  function _showWhisperGuide() {
    const { whisper, model, userData } = { whisper: '', model: '', userData: '' };
    window.vex.memoryPaths?.().then(p => {
      _renderWhisperModal(p);
    }).catch(() => _renderWhisperModal({ whisper, model, userData }));
  }

  function _renderWhisperModal(paths) {
    const overlay = document.createElement('div');
    overlay.className = 'sync-modal-overlay';
    overlay.innerHTML = `
      <div class="sync-modal-card" style="max-width:620px;max-height:85vh;overflow-y:auto">
        <h2 style="margin-top:0">Install Whisper for local transcription</h2>
        <p style="font-size:13px">Whisper is a free speech-to-text engine. It runs entirely on your PC &mdash; audio never leaves the machine.</p>
        <h3 style="font-size:13px;margin:14px 0 6px">Step 1 &mdash; Download <code>whisper.exe</code></h3>
        <p style="font-size:13px">Grab the latest Windows ZIP, unpack, find <code>main.exe</code>, rename it to <code>whisper.exe</code>.</p>
        <button class="btn-primary" id="open-whisper-releases">Open Whisper.cpp releases</button>
        <h3 style="font-size:13px;margin:16px 0 6px">Step 2 &mdash; Download the model</h3>
        <p style="font-size:13px">~140 MB, good multilingual support:</p>
        <button class="btn-primary" id="open-whisper-model">Download ggml-base.bin</button>
        <h3 style="font-size:13px;margin:16px 0 6px">Step 3 &mdash; Place both files in one of:</h3>
        <pre style="background:var(--bg);padding:10px;border-radius:6px;overflow-x:auto;font-size:11px"><code>${_esc(paths.userData || '')}\\assets\\whisper\\whisper.exe
${_esc(paths.userData || '')}\\assets\\whisper\\ggml-base.bin

&mdash; OR &mdash;

(install folder)\\resources\\assets\\whisper\\whisper.exe
(install folder)\\resources\\assets\\whisper\\ggml-base.bin</code></pre>
        <h3 style="font-size:13px;margin:16px 0 6px">Step 4 &mdash; Re-check</h3>
        <button class="btn-primary" id="btn-recheck-2">Check Again</button>
        <div style="display:flex;justify-content:flex-end;margin-top:18px">
          <button class="btn-secondary" id="close-whisper-guide">Close</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#open-whisper-releases').addEventListener('click', () => {
      if (typeof TabManager !== 'undefined') TabManager.createTab('https://github.com/ggerganov/whisper.cpp/releases', true);
    });
    overlay.querySelector('#open-whisper-model').addEventListener('click', () => {
      if (typeof TabManager !== 'undefined') TabManager.createTab('https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin', true);
    });
    overlay.querySelector('#btn-recheck-2').addEventListener('click', async () => {
      if (await window.vex.memoryIsAvailable()) { _toast('Whisper detected \u2713', 'success'); overlay.remove(); render(); }
      else _toast('Still not detected', 'warn');
    });
    overlay.querySelector('#close-whisper-guide').addEventListener('click', () => overlay.remove());
  }

  function _renderConsent(container) {
    container.innerHTML = `
      <div class="memrec-consent">
        <h2>&#127897;&#65039; Before you start recording...</h2>
        <div class="consent-warning">
          <h3>&#9888;&#65039; Important legal notice</h3>
          <p><strong>Recording laws vary by country.</strong> Many places &mdash; including Turkey, EU countries, and most of Europe &mdash; require consent from <strong>all parties</strong> to a conversation, not just one.</p>
          <p>Recording people without their knowledge may be illegal and is always unethical. You are solely responsible for complying with your local law.</p>
        </div>
        <div class="consent-features">
          <h3>How Vex Memory works</h3>
          <ul>
            <li>&#128274; Audio is transcribed <strong>locally</strong> via Whisper &mdash; never leaves your PC</li>
            <li>&#128275; Transcripts are stored <strong>encrypted</strong> (AES-256-GCM) on disk</li>
            <li>&#129504; AI analysis (title, memories, action items) sends transcripts to Claude &mdash; disable any time in settings</li>
            <li>&#128308; A visible "REC" badge shows anytime recording is active</li>
            <li>&#128465;&#65039; "Forget last X minutes" instantly deletes recent data</li>
            <li>&#9208;&#65039; Pause or stop anytime &mdash; works offline</li>
          </ul>
        </div>
        <div class="consent-checkboxes">
          <label><input type="checkbox" id="consent-understood"> I understand recording laws vary and I am responsible for complying</label>
          <label><input type="checkbox" id="consent-disclose"> I will tell people around me when I'm recording</label>
          <label><input type="checkbox" id="consent-own-risk"> I accept that I use this feature at my own risk</label>
        </div>
        <div class="consent-actions">
          <button class="btn-primary" id="btn-consent-accept" disabled>Enable Memory Recorder</button>
          <button class="btn-link" id="btn-consent-decline">Not for me</button>
        </div>
      </div>`;
    const ids = ['consent-understood', 'consent-disclose', 'consent-own-risk'];
    const update = () => {
      document.getElementById('btn-consent-accept').disabled = !ids.every(id => document.getElementById(id)?.checked);
    };
    ids.forEach(id => document.getElementById(id).addEventListener('change', update));
    document.getElementById('btn-consent-accept').addEventListener('click', () => { _setConsented(true); render(); });
    document.getElementById('btn-consent-decline').addEventListener('click', () => {
      _toast('Memory recorder disabled. Enable anytime from Settings.', 'info');
    });
  }

  // Bulletproof Start button binding — clone-and-replace so old listeners don't
  // accumulate across re-renders, disable the button during the await, show
  // any error inline and via toast, re-render the panel on success.
  function _wireStartButton() {
    const orig = document.getElementById('btn-rec-start');
    console.log('[MemoryRecorderPanel] _wireStartButton() called, button exists:', !!orig);
    if (!orig) return;
    const btn = orig.cloneNode(true);
    orig.parentNode.replaceChild(btn, orig);

    btn.addEventListener('click', async (e) => {
      console.log('[MemoryRecorderPanel] Start button clicked!!!');
      e.preventDefault(); e.stopPropagation();
      btn.disabled = true;
      const originalHTML = btn.innerHTML;
      btn.textContent = 'Starting...';

      try {
        console.log('[MemoryRecorderPanel] calling window.vex.memoryStart()...');
        const mainResult = await window.vex.memoryStart();
        console.log('[MemoryRecorderPanel] memoryStart returned:', JSON.stringify(mainResult));
        if (!mainResult || !mainResult.ok) {
          throw new Error((mainResult && mainResult.error) || 'memoryStart failed with unknown error');
        }

        console.log('[MemoryRecorderPanel] calling MemoryCapture.start()...');
        const captureResult = await MemoryCapture.start();
        console.log('[MemoryRecorderPanel] MemoryCapture.start returned:', JSON.stringify(captureResult));

        _toast('Recording started', 'success');
        _showGlobalBadge();
        render();
      } catch (err) {
        console.error('[MemoryRecorderPanel] Start FAILED:', err.message, err.stack);
        btn.disabled = false;
        btn.innerHTML = originalHTML;
        _toast('Failed to start: ' + err.message, 'error');
        const errEl = document.createElement('div');
        errEl.style.cssText = 'background:#ef4444;color:white;padding:10px 12px;border-radius:6px;margin-top:8px;font-size:12px;font-family:\'JetBrains Mono\',monospace';
        errEl.textContent = 'ERROR: ' + err.message;
        btn.parentNode.appendChild(errEl);
        setTimeout(() => errEl.remove(), 15000);
      }
    });
    console.log('[MemoryRecorderPanel] Start button handler attached');
  }

  function _wireHandlers(container) {
    _wireStartButton();
    document.getElementById('btn-rec-pause')?.addEventListener('click', async () => {
      await window.vex.memoryPause();
      render();
    });
    document.getElementById('btn-rec-resume')?.addEventListener('click', async () => {
      await window.vex.memoryResume();
      render();
    });
    document.getElementById('btn-rec-stop')?.addEventListener('click', async () => {
      MemoryCapture.stop();
      await window.vex.memoryStop();
      _hideGlobalBadge();
      setTimeout(render, 800);
    });
    document.getElementById('btn-forget-5')?.addEventListener('click', async () => {
      if (!confirm('Forget the last 5 minutes of recordings? This cannot be undone.')) return;
      const r = await window.vex.memoryForgetRecent(5);
      _toast(`Deleted ${r.deleted} conversation(s)`, 'success');
      render();
    });
    document.getElementById('btn-forget-30')?.addEventListener('click', async () => {
      if (!confirm('Forget the last 30 minutes of recordings? This cannot be undone.')) return;
      const r = await window.vex.memoryForgetRecent(30);
      _toast(`Deleted ${r.deleted} conversation(s)`, 'success');
      render();
    });
    document.getElementById('btn-memrec-settings')?.addEventListener('click', () => {
      if (typeof SidebarManager !== 'undefined') SidebarManager.openPanel('settings');
      setTimeout(() => document.getElementById('memrec-settings-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
    });

    // Search
    const searchInput = document.getElementById('memrec-search-input');
    let searchMode = 'ai';
    container.querySelectorAll('.search-mode-pills .pill').forEach(p => {
      p.addEventListener('click', () => {
        container.querySelectorAll('.search-mode-pills .pill').forEach(x => x.classList.remove('active'));
        p.classList.add('active');
        searchMode = p.dataset.mode;
      });
    });
    searchInput?.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      const q = e.target.value.trim();
      if (!q) { render(); return; }
      if (searchMode === 'ai') await _aiSearch(q);
      else await _keywordSearch(q);
    });

    container.querySelectorAll('.expand-btn').forEach(b => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      await _showTranscript(b.dataset.convId);
    }));
    container.querySelectorAll('.delete-btn').forEach(b => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this conversation? Cannot be undone.')) return;
      await window.vex.memoryDelete(b.dataset.convId);
      render();
    }));
  }

  async function _aiSearch(query) {
    const tl = document.getElementById('memrec-timeline');
    if (!tl) return;
    tl.innerHTML = '<div class="ai-search-loading"><div class="spinner-lg"></div><div class="ai-search-loading-text">Searching your memory...</div></div>';
    try {
      const conversations = await window.vex.memoryList();
      const compact = (conversations || []).filter(c => c.processed).slice(0, 100).map(c => ({
        id: c.id, title: c.title || '', summary: c.summary || '',
        tags: c.topics || [], url: '', visitedAt: c.startedAt
      }));
      const res = await AIRouter.callAI('historySearch', {
        query, historyEntries: compact, timeContext: new Date().toISOString()
      });
      let parsed;
      try {
        const str = String(res.result || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
        parsed = JSON.parse(str);
      } catch { throw new Error('Invalid AI response'); }
      if (!parsed.matches || parsed.matches.length === 0) {
        tl.innerHTML = `<div class="empty-state"><div class="empty-title">No matches</div><div class="empty-subtitle">${_esc(parsed.interpretation || '')}</div></div>`;
        return;
      }
      const matched = parsed.matches.map(m => conversations.find(c => c.id === m.id)).filter(Boolean);
      tl.innerHTML = `
        <div class="search-interpretation">&#10024; ${_esc(parsed.interpretation || '')}</div>
        ${matched.map(_renderConvCard).join('')}`;
      _rewireCardActions(tl);
    } catch (err) {
      tl.innerHTML = `<div class="empty-state"><div class="empty-title">Search failed</div><div class="empty-subtitle">${_esc(err.message)}</div></div>`;
    }
  }

  async function _keywordSearch(query) {
    const tl = document.getElementById('memrec-timeline');
    if (!tl) return;
    const conversations = await window.vex.memoryList();
    const q = query.toLowerCase();
    const matched = (conversations || []).filter(c =>
      (c.title || '').toLowerCase().includes(q) ||
      (c.summary || '').toLowerCase().includes(q) ||
      (c.topics || []).some(t => String(t).toLowerCase().includes(q)) ||
      (c.people || []).some(p => String(p).toLowerCase().includes(q))
    );
    if (!matched.length) { tl.innerHTML = '<div class="empty-state"><div class="empty-title">No matches</div></div>'; return; }
    tl.innerHTML = matched.map(_renderConvCard).join('');
    _rewireCardActions(tl);
  }

  function _rewireCardActions(container) {
    container.querySelectorAll('.expand-btn').forEach(b => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      await _showTranscript(b.dataset.convId);
    }));
    container.querySelectorAll('.delete-btn').forEach(b => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this conversation?')) return;
      await window.vex.memoryDelete(b.dataset.convId);
      render();
    }));
  }

  async function _showTranscript(convId) {
    const conv = await window.vex.memoryLoad(convId);
    if (!conv) { _toast('Could not load conversation', 'error'); return; }
    const overlay = document.createElement('div');
    overlay.className = 'sync-modal-overlay';
    const memoriesHtml = (conv.memories && conv.memories.length) ? `
      <div class="transcript-section">
        <h3>&#128204; Memories</h3>
        <ul>${conv.memories.map(m => `<li>${_esc(m)}</li>`).join('')}</ul>
      </div>` : '';
    const actionsHtml = (conv.actionItems && conv.actionItems.length) ? `
      <div class="transcript-section">
        <h3>&#9989; Action items</h3>
        <ul>${conv.actionItems.map(a => `<li>${_esc(a)}</li>`).join('')}</ul>
      </div>` : '';
    overlay.innerHTML = `
      <div class="sync-modal-card transcript-modal">
        <h2 style="margin-top:0">${_esc(conv.title || 'Conversation')}</h2>
        <div class="transcript-meta">${_esc(new Date(conv.startedAt).toLocaleString())} &middot; ${_esc(_formatDuration(conv.durationMs))} &middot; ${conv.segments?.length || 0} segments</div>
        ${conv.summary ? `<div class="transcript-summary">${_esc(conv.summary)}</div>` : ''}
        ${memoriesHtml}
        ${actionsHtml}
        <div class="transcript-section">
          <h3>&#128221; Full transcript</h3>
          <div class="transcript-text">${_esc(conv.transcript || '')}</div>
        </div>
        <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end;align-items:center">
          <button class="btn-secondary" id="tx-copy">&#128203; Copy</button>
          <button class="btn-danger" id="tx-delete">Delete</button>
          <div style="flex:1"></div>
          <button class="btn-primary" id="tx-close">Close</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#tx-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#tx-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(conv.transcript || ''); _toast('Transcript copied', 'success'); }
      catch { _toast('Copy failed', 'error'); }
    });
    overlay.querySelector('#tx-delete').addEventListener('click', async () => {
      if (!confirm('Delete permanently?')) return;
      await window.vex.memoryDelete(convId);
      overlay.remove();
      render();
    });
  }

  function _showGlobalBadge() {
    if (document.getElementById('global-rec-badge')) return;
    const b = document.createElement('div');
    b.id = 'global-rec-badge';
    b.className = 'global-rec-badge';
    b.innerHTML = '<span class="rec-dot"></span> RECORDING';
    document.body.appendChild(b);
  }
  function _hideGlobalBadge() { document.getElementById('global-rec-badge')?.remove(); }

  // Live transcript accumulator
  const LIVE_MAX = 400;
  let liveBuffer = '';
  if (window.vex && window.vex.onMemoryLiveSegment) {
    window.vex.onMemoryLiveSegment((data) => {
      const el = document.getElementById('live-transcript-inner');
      if (!el) return;
      liveBuffer = (liveBuffer + ' ' + (data.text || '')).trim();
      if (liveBuffer.length > LIVE_MAX) liveBuffer = '…' + liveBuffer.slice(-LIVE_MAX);
      el.textContent = liveBuffer;
    });
  }
  // Refresh when a conversation finalizes or gets extracted
  if (window.vex && window.vex.onMemoryConversationFinalized) {
    window.vex.onMemoryConversationFinalized(() => {
      liveBuffer = '';
      setTimeout(() => render(), 2500);
    });
  }
  window.addEventListener('vex-memory-extracted', () => { render(); });

  return { init, render };
})();

window.MemoryRecorderPanel = MemoryRecorderPanel;
