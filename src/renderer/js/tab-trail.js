// === How you ended up here =================================================
//
// Twenty tabs in, the question is not "what is this page" but "what was I
// doing when I opened it". Back does not answer it: this tab's back button
// goes back inside this tab, and the page that sent you here is in a different
// one — which by now may be buried, or closed.
//
// Every tab opened from another tab remembers the page it came from, so a tab
// can show its own trail: this page, from that page, from the one before it.
// A hop whose tab is still open switches to it; one whose tab has been closed
// opens the page again.
//
// It is held in memory for this run of Vex only. A trail is about what you
// were doing just now, and writing every "opened from" to disk would be a
// browsing history by another name.
const TabTrail = {
  MAX_HOPS: 12,
  MAX_KEPT: 400,           // tabs whose opener is still remembered
  from: new Map(),          // tab id → { id, url, title, at }

  // Called as a tab is created. The tab that was active at that moment is the
  // one that sent you here. A brand new empty tab came from nowhere, and a
  // page cannot be its own opener.
  record(tab, opener) {
    if (!tab || !opener || tab.id === opener.id) return null;
    if (!/^https?:/i.test(String(opener.url || ''))) return null;
    if (!/^https?:/i.test(String(tab.url || ''))) return null;
    const hop = { id: opener.id, url: opener.url, title: opener.title || '', at: Date.now() };
    this.from.set(tab.id, hop);
    // A closed tab's hop is kept, so a trail through it still works — but not
    // forever: the oldest go once there are more than a session's worth.
    while (this.from.size > this.MAX_KEPT) this.from.delete(this.from.keys().next().value);
    return hop;
  },

  forget(tabId) { this.from.delete(tabId); },

  // The chain back from a tab, nearest first. A loop (A opened B, B opened A
  // again) stops at the tab already seen rather than going round forever.
  chain(tabId) {
    const out = [];
    const seen = new Set([tabId]);
    let at = tabId;
    while (out.length < this.MAX_HOPS) {
      const hop = this.from.get(at);
      if (!hop || seen.has(hop.id)) break;
      seen.add(hop.id);
      out.push(hop);
      at = hop.id;
    }
    return out;
  },

  isOpen(tabId) {
    return typeof TabManager !== 'undefined' && TabManager.tabs.some(t => t.id === tabId);
  },

  // Going to a hop: the tab if it is still there, a fresh one if it is not.
  go(hop) {
    if (this.isOpen(hop.id)) { TabManager.switchTab(hop.id); return 'switched'; }
    TabManager.createTab(hop.url, true);
    return 'reopened';
  },

  label(hop) {
    const title = String(hop.title || '').trim();
    if (title && title !== 'Loading...') return title;
    try { return new URL(hop.url).hostname.replace(/^www\./, ''); } catch { return hop.url; }
  },

  show() {
    const tab = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
    if (!tab) throw new Error('Open a tab first');
    const hops = this.chain(tab.id);
    if (!hops.length) throw new Error('This tab was not opened from another page — it is where you started');

    document.querySelector('.vex-trail-overlay')?.remove();
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const overlay = document.createElement('div');
    overlay.className = 'vex-trail-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.38);display:grid;place-items:start center;padding-top:12vh';
    overlay.innerHTML = `
      <div role="dialog" aria-modal="true" aria-label="How you got here"
           style="width:min(560px,92vw);max-height:66vh;display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--border);border-radius:12px;box-shadow:0 18px 50px var(--vex-shadow-color,rgba(0,0,0,0.45));overflow:hidden">
        <div style="padding:12px 14px;border-bottom:1px solid var(--border)">
          <div style="font-size:13.5px;font-weight:650;color:var(--text)">How you got here</div>
          <div style="font-size:10.5px;color:var(--text-muted)">${esc(this.label({ title: tab.title, url: tab.url }))}</div>
        </div>
        <div data-list style="overflow-y:auto;padding:6px"></div>
        <div style="padding:8px 14px;border-top:1px solid var(--border);font-size:11px;color:var(--text-muted)">
          Kept for this run of Vex only. A page whose tab you closed opens again.
        </div>
      </div>`;

    const listEl = overlay.querySelector('[data-list]');
    hops.forEach((hop, i) => {
      const open = this.isOpen(hop.id);
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:9px;padding:8px 9px;border-radius:8px;cursor:pointer';
      row.addEventListener('mouseenter', () => { row.style.background = 'var(--vex-hover-fill,var(--surface))'; });
      row.addEventListener('mouseleave', () => { row.style.background = ''; });
      row.innerHTML = `
        <div style="width:18px;text-align:center;font-size:11px;color:var(--text-muted)">${i + 1}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12.5px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(this.label(hop))}</div>
          <div style="font-size:10.5px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(hop.url)}</div>
        </div>
        <div style="font-size:10.5px;color:var(--text-muted)">${open ? 'still open' : 'closed — opens again'}</div>`;
      row.addEventListener('click', () => { overlay.remove(); this.go(hop); });
      listEl.appendChild(row);
    });

    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    return overlay;
  },
};

if (typeof window !== 'undefined') window.TabTrail = TabTrail;
if (typeof module !== 'undefined' && module.exports) module.exports = { TabTrail };
