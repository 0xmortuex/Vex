// "What's New" update log. After Vex auto-updates to a new version, this shows a
// modal with that release's notes (pulled from the GitHub release). Also openable
// on demand via window.VexWhatsNew.open(). First install shows nothing.
(function () {
  if (!window.vex || typeof window.vex.getReleaseNotes !== 'function') return;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // Tiny, safe Markdown → HTML for GitHub release bodies (headings, lists, bold,
  // italics, inline code, links). Everything is escaped first.
  function mdToHtml(md) {
    const lines = String(md || '').replace(/\r/g, '').split('\n');
    let html = '', inList = false;
    const inline = (t) => esc(t)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
    for (let raw of lines) {
      const line = raw.trimEnd();
      let m;
      if (!line.trim()) { closeList(); continue; }
      if ((m = line.match(/^#{1,6}\s+(.*)$/))) { closeList(); html += `<h4>${inline(m[1])}</h4>`; }
      else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(m[1])}</li>`; }
      else { closeList(); html += `<p>${inline(line)}</p>`; }
    }
    closeList();
    return html;
  }

  function injectStyles() {
    if (document.getElementById('whatsnew-styles')) return;
    const st = document.createElement('style');
    st.id = 'whatsnew-styles';
    st.textContent = `
      .whatsnew-ov{position:fixed;inset:0;z-index:2147482000;display:flex;align-items:center;justify-content:center;background:rgba(8,10,14,0.7);backdrop-filter:blur(4px);font-family:inherit;}
      .whatsnew-card{width:560px;max-width:92vw;max-height:82vh;display:flex;flex-direction:column;background:var(--surface,#1b1b24);border:1px solid var(--border,rgba(255,255,255,0.1));border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,0.6);overflow:hidden;}
      .whatsnew-head{padding:18px 22px 14px;border-bottom:1px solid var(--border,rgba(255,255,255,0.08));}
      .whatsnew-kicker{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--primary,#6366f1);font-weight:700;}
      .whatsnew-title{font-size:18px;font-weight:800;color:var(--text,#e9e9ee);margin-top:4px;}
      .whatsnew-body{padding:6px 22px 18px;overflow-y:auto;color:var(--text,#e9e9ee);font-size:13.5px;line-height:1.6;}
      .whatsnew-body h4{font-size:13px;margin:16px 0 6px;color:var(--text,#e9e9ee);}
      .whatsnew-body ul{margin:4px 0 4px 2px;padding-left:18px;}
      .whatsnew-body li{margin:3px 0;}
      .whatsnew-body p{margin:6px 0;color:var(--text-muted,#b9b9c4);}
      .whatsnew-body code{background:rgba(255,255,255,0.08);padding:1px 5px;border-radius:4px;font-size:12px;}
      .whatsnew-body a{color:var(--primary,#8b8bf5);}
      .whatsnew-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 22px;border-top:1px solid var(--border,rgba(255,255,255,0.08));}
      .whatsnew-link{font-size:12px;color:var(--text-muted,#9a9aa5);text-decoration:none;}
      .whatsnew-link:hover{color:var(--primary,#8b8bf5);}
      .whatsnew-btn{border:none;background:var(--primary,#6366f1);color:#fff;border-radius:9px;padding:9px 18px;font-size:13px;font-weight:600;font-family:inherit;cursor:pointer;}
      .whatsnew-empty{color:var(--text-muted,#9a9aa5);font-size:13px;padding:18px 0;}
    `;
    document.head.appendChild(st);
  }

  let _open = false;
  async function showWhatsNew(opts) {
    opts = opts || {};
    if (_open) return;
    _open = true;
    let notes = null;
    try { notes = await window.vex.getReleaseNotes(); } catch {}
    if (!notes && !opts.force) { _open = false; return; } // silent if we can't fetch on auto-show
    injectStyles();
    const ov = document.createElement('div');
    ov.className = 'whatsnew-ov';
    const bodyHtml = notes && notes.body ? mdToHtml(notes.body) : '<div class="whatsnew-empty">Couldn\'t load the release notes (offline?). Check the releases page.</div>';
    ov.innerHTML = `
      <div class="whatsnew-card">
        <div class="whatsnew-head">
          <div class="whatsnew-kicker">What's new</div>
          <div class="whatsnew-title">${esc(notes ? notes.name : 'Vex')}</div>
        </div>
        <div class="whatsnew-body">${bodyHtml}</div>
        <div class="whatsnew-foot">
          <a class="whatsnew-link" href="#" data-ext>View latest release on GitHub →</a>
          <button class="whatsnew-btn">Got it</button>
        </div>
      </div>`;
    const close = () => { ov.remove(); _open = false; };
    ov.querySelector('.whatsnew-btn').addEventListener('click', close);
    ov.querySelector('.whatsnew-link[data-ext]')?.addEventListener('click', (e) => {
      e.preventDefault();
      try { window.vex?.openExternal?.('https://github.com/0xmortuex/Vex/releases/latest'); } catch {}
      close(); // the release opens in the browser — no reason to keep the modal up
    });
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    document.addEventListener('keydown', function onEsc(e) { if (e.key === 'Escape') { document.removeEventListener('keydown', onEsc); close(); } });
    document.body.appendChild(ov);
  }

  // Auto-show once after an actual update (version changed since last seen).
  // First-ever launch records the version but shows nothing.
  async function checkOnStartup() {
    try {
      const ver = await window.vex.getAppVersion();
      if (!ver) return;
      let seen = null;
      try { seen = localStorage.getItem('vex.lastSeenVersion'); } catch {}
      try { localStorage.setItem('vex.lastSeenVersion', ver); } catch {}
      if (seen && seen !== ver) setTimeout(() => showWhatsNew(), 1200);
    } catch {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', checkOnStartup);
  else checkOnStartup();

  // Manual trigger (e.g. a Settings button or the version label).
  window.VexWhatsNew = { open: () => showWhatsNew({ force: true }) };
})();
