// === Vex Recall ("memex"): full-text search of everything you've read ===
//
// As you browse, the readable text of each page is indexed locally (capped,
// stored by the main process in userData/recall.json via the recall:* IPC).
// The Recall panel then lets you find any page you've ever read by its CONTENT,
// not just its title or URL — "that paragraph about DPI throttling".
// Off-the-record tabs, file:// pages and the start page are never indexed.

const Recall = {
  ENABLED_KEY: 'vex.recall.enabled',
  _recent: 0,

  enabled() { try { return localStorage.getItem(this.ENABLED_KEY) !== 'false'; } catch { return true; } },
  setEnabled(v) { try { localStorage.setItem(this.ENABLED_KEY, v ? 'true' : 'false'); } catch {} },

  // Pull the page's readable text and hand it to the main-process index.
  async indexPage(webview, url, title) {
    if (!this.enabled() || !url || !window.vex?.recallIndex) return;
    if (!/^https?:/i.test(url)) return;
    if (typeof isStartPage === 'function' && isStartPage(url)) return;
    // Skip ephemeral / container-isolated tabs: don't index what the user chose
    // to keep traceless.
    const t = typeof TabManager !== 'undefined' ? TabManager.tabs.find(x => x.url === url) : null;
    if (t && t.partition && !String(t.partition).startsWith('persist:main')) return;
    let text = '';
    try {
      text = await webview.executeJavaScript(`(function(){try{
        var el=document.querySelector('article,main,[role=main]')||document.body;
        return (el.innerText||'').replace(/\\s+/g,' ').trim().substring(0,16000);
      }catch(e){return ''}})();`);
    } catch {}
    if (!text || text.length < 200) return; // too thin to be worth recalling
    try { await window.vex.recallIndex({ url, title: title || url, text }); this._recent++; } catch {}
  },

  async search(q) {
    if (!window.vex?.recallSearch) return [];
    try { return (await window.vex.recallSearch(q)) || []; } catch { return []; }
  },

  renderPanel(container) {
    if (!container) return;
    const esc = (s) => { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; };
    container.innerHTML = `<div class="panel-header"><h2>Recall</h2></div>
      <div style="padding:0 12px 8px">
        <input id="recall-q" type="text" placeholder="Search everything you've read…" spellcheck="false" autocomplete="off"
          style="width:100%;box-sizing:border-box;padding:9px 12px;background:var(--bg);border:1px solid var(--border);border-radius:9px;color:var(--text);font-size:13px;outline:none;font-family:'Outfit',sans-serif">
        <p class="setting-info muted" style="margin:7px 2px 0">Searches the full text of pages you've visited — find a page by what it <em>said</em>.</p>
      </div>
      <div id="recall-results" style="padding:2px 10px 24px;overflow-y:auto;max-height:calc(100vh - 160px)"></div>`;
    const input = container.querySelector('#recall-q');
    const out = container.querySelector('#recall-results');
    let timer = null;
    const run = async () => {
      const q = input.value.trim();
      if (!q) { out.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:8px">Type to search your reading history.</div>'; return; }
      out.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:8px">Searching…</div>';
      const hits = await this.search(q);
      if (!hits.length) { out.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:8px">No pages matched “' + esc(q) + '”.</div>'; return; }
      out.innerHTML = '';
      hits.forEach(h => {
        let host = h.url; try { host = new URL(h.url).hostname.replace(/^www\./, ''); } catch {}
        const when = h.at ? new Date(h.at).toLocaleDateString() : '';
        const r = document.createElement('div');
        r.style.cssText = 'padding:8px;border-radius:9px;cursor:pointer';
        r.addEventListener('mouseenter', () => r.style.background = 'var(--surface)');
        r.addEventListener('mouseleave', () => r.style.background = '');
        r.innerHTML = `<div style="display:flex;align-items:center;gap:8px">
            <img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32" style="width:15px;height:15px;border-radius:3px" onerror="this.style.visibility='hidden'">
            <div style="flex:1;min-width:0;font-size:12.5px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(h.title)}</div>
            <span style="font-size:10.5px;color:var(--text-muted);flex:none">${when}</span></div>
          <div style="font-size:11.5px;color:var(--text-muted);margin:3px 0 0 23px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(h.snippet || '')}</div>
          <div style="font-size:10.5px;color:var(--primary);margin:2px 0 0 23px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(host)}</div>`;
        r.addEventListener('click', () => { SidebarManager.hideActivePanel?.(); TabManager.createTab(h.url, true); });
        out.appendChild(r);
      });
    };
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 180); });
    setTimeout(() => input.focus(), 40);
  },

  renderSettings(container) {
    if (!container) return;
    container.innerHTML = `
      <p class="setting-info muted" style="margin-bottom:8px">Index the full text of pages you read so you can find them later by content. Stored locally only (userData/recall.json) — never uploaded.</p>
      <div class="setting-toggle-row"><span>Index pages for full-text recall</span><label class="toggle"><input type="checkbox" id="recall-enabled" ${this.enabled() ? 'checked' : ''}><span class="toggle-slider"></span></label></div>
      <button id="recall-clear" style="margin-top:10px;padding:8px 16px;background:var(--danger);color:#fff;border:none;border-radius:var(--radius);cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px">Clear recall index</button>`;
    container.querySelector('#recall-enabled').addEventListener('change', (e) => { this.setEnabled(e.target.checked); window.showToast?.(e.target.checked ? 'Recall on' : 'Recall off'); });
    container.querySelector('#recall-clear').addEventListener('click', async () => {
      try { await window.vex?.recallClear?.(); window.showToast?.('Recall index cleared'); } catch {}
    });
  },
};

if (typeof window !== 'undefined') window.Recall = Recall;
if (typeof module !== 'undefined' && module.exports) module.exports = { Recall };
