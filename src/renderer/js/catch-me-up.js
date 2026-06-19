// === Vex Catch Me Up — an AI digest of your reading queue ===
//
// Pulls the newest items from your RSS feeds (VexFeeds) plus anything unread in
// Read Later (ReadLater), then asks the AI for a short, skimmable briefing —
// grouped bullets, no fluff. The underlying items are listed below the summary
// so you can jump straight into any of them. Opened from the command bar.

const CatchMeUp = {
  MAX_FEED: 30,
  MAX_LATER: 25,

  async _gather() {
    const items = [];
    try {
      if (typeof VexFeeds !== 'undefined' && VexFeeds.feeds && VexFeeds.feeds.length) {
        const feed = await VexFeeds.fetchAll();
        feed.slice(0, this.MAX_FEED).forEach(it => items.push({ title: it.title, url: it.link, src: it.src || 'Feed', kind: 'feed' }));
      }
    } catch {}
    try {
      if (typeof ReadLater !== 'undefined' && Array.isArray(ReadLater.items)) {
        ReadLater.items.filter(i => !i.read).slice(0, this.MAX_LATER)
          .forEach(i => items.push({ title: i.title, url: i.url, src: 'Read Later', kind: 'later' }));
      }
    } catch {}
    return items;
  },

  async open() {
    this._close();
    const m = document.createElement('div');
    m.id = 'vex-catchup';
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center';
    m.innerHTML = `<div style="width:560px;max-width:94vw;max-height:82vh;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.5);overflow:hidden">
      <div style="display:flex;align-items:center;gap:8px;padding:16px 18px;border-bottom:1px solid var(--border)">
        <span style="font-size:15px;font-weight:700;color:var(--text);flex:1">☕ Catch Me Up</span>
        <button id="cmu-close" style="padding:6px 12px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px">✕</button>
      </div>
      <div id="cmu-body" style="overflow-y:auto;padding:16px 18px;font-size:13px;color:var(--text);line-height:1.55">Gathering your feeds…</div></div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m) this._close(); });
    m.querySelector('#cmu-close').addEventListener('click', () => this._close());

    const body = m.querySelector('#cmu-body');
    const esc = (s) => { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; };

    const items = await this._gather();
    if (!items.length) {
      body.innerHTML = `<div style="color:var(--text-muted);text-align:center;padding:20px">Nothing to catch up on yet — add RSS feeds (Feeds panel) or save articles to Read Later.</div>`;
      return;
    }

    // Render the source list immediately; stream the AI summary in above it.
    const listHtml = items.map((it, i) =>
      `<a href="#" data-open="${i}" style="display:block;padding:7px 9px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;text-decoration:none;color:var(--text)">
        <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.title)}</div>
        <div style="font-size:10.5px;color:var(--text-muted)">${esc(it.src)}</div>
      </a>`).join('');

    if (typeof AIRouter === 'undefined' || typeof AIRouter.callAI !== 'function') {
      body.innerHTML = `<div style="color:var(--text-muted);margin-bottom:10px">AI is unavailable — here's your queue:</div>${listHtml}`;
      this._wireLinks(body, items);
      return;
    }

    body.innerHTML = `<div id="cmu-summary" style="margin-bottom:14px;color:var(--text-muted)">Summarizing ${items.length} items…</div>
      <div style="font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted);margin:0 0 8px">Sources</div>${listHtml}`;
    this._wireLinks(body, items);

    const lines = items.map((it, i) => `${i + 1}. [${it.src}] ${it.title}`).join('\n');
    const prompt = `Give me a short "catch me up" briefing on my reading queue below. Group related items into 3-6 skimmable bullet points highlighting the key themes and anything notable. Be concise and skip filler. Do not invent details beyond the titles.\n\nItems:\n${lines}`;
    try {
      const res = await AIRouter.callAI('chat', { message: prompt });
      const out = String((res && (res.result || res.text || res.message)) || '').trim();
      const sumEl = m.querySelector('#cmu-summary');
      if (sumEl) {
        sumEl.style.color = 'var(--text)';
        sumEl.innerHTML = out ? this._mini(out, esc) : '<span style="color:var(--text-muted)">No summary returned.</span>';
      }
    } catch (err) {
      const sumEl = m.querySelector('#cmu-summary');
      if (sumEl) { sumEl.style.color = 'var(--text-muted)'; sumEl.textContent = 'Could not generate a summary — your queue is listed below.'; }
    }
  },

  // Tiny markdown-ish renderer: bullets + **bold**, escaped. Avoids a full MD dep.
  _mini(text, esc) {
    return text.split('\n').map(line => {
      const t = line.trim();
      if (!t) return '';
      const bolded = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      if (/^[-*•]\s+/.test(t)) return `<div style="margin:3px 0 3px 4px">• ${bolded(t.replace(/^[-*•]\s+/, ''))}</div>`;
      if (/^\d+\.\s+/.test(t)) return `<div style="margin:3px 0 3px 4px">${bolded(t)}</div>`;
      return `<div style="margin:6px 0">${bolded(t)}</div>`;
    }).join('');
  },

  _wireLinks(body, items) {
    body.querySelectorAll('[data-open]').forEach(a => a.addEventListener('click', (e) => {
      e.preventDefault();
      const it = items[parseInt(a.dataset.open, 10)];
      if (it && it.url && typeof TabManager !== 'undefined') {
        try { TabManager.createTab(it.url, true); } catch {}
        this._close();
      }
    }));
  },

  _close() { document.getElementById('vex-catchup')?.remove(); },
};

if (typeof window !== 'undefined') window.CatchMeUp = CatchMeUp;
if (typeof module !== 'undefined' && module.exports) module.exports = { CatchMeUp };
