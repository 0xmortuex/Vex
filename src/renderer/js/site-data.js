// === What this site is keeping on you, item by item ========================
//
// "Clear this site's data" throws everything away: the consent flag that is
// stuck, and the login you wanted to keep, in one go. Most of the time the
// thing that needs to change is one item — a cookie that says you saw the
// banner, a leftover session, a stored setting a site's own interface no
// longer lets you reach.
//
// Two kinds of storage, two ways of reaching them:
//   cookies              live in the session, per partition, so a container's
//                        cookies are read and changed as that container's
//   local/session store  live in the page, so they are read by running a
//                        small script in the page itself
//
// A value that comes back clipped is shown but not editable: writing back a
// shortened copy would quietly lose the rest of it.
const SiteData = {
  MAX_VALUE: 4096,          // how much of one value is brought back
  KINDS: ['cookies', 'local', 'session'],
  LABELS: { cookies: 'Cookies', local: 'Local storage', session: 'Session storage' },

  // The tab this is about. Local pages and the start page have no site data.
  target() {
    const tab = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
    const wv = typeof WebviewManager !== 'undefined' ? WebviewManager.webviews.get(TabManager.activeTabId) : null;
    let url = '';
    try { url = (wv && wv.getURL && wv.getURL()) || (tab && tab.url) || ''; } catch { url = (tab && tab.url) || ''; }
    if (!/^https?:/i.test(url)) throw new Error('Open a website first — a Vex page has no site data');
    return { url, partition: (tab && tab.partition) || 'persist:main', wv };
  },

  host(url) { try { return new URL(url).hostname; } catch { return ''; } },

  // --- reading -------------------------------------------------------------

  async cookies(t) {
    const res = await window.vex.cookiesList({ url: t.url, partition: t.partition });
    if (!res || !res.ok) throw new Error((res && res.error) || 'Could not read this site’s cookies');
    return res.cookies.map(c => ({
      ...c,
      id: c.name + '\u0000' + c.domain + '\u0000' + c.path,
      clipped: false,
    }));
  },

  // Runs in the page. A page that has storage switched off throws, and that
  // error is the answer — better than an empty list that looks like "nothing".
  listScript(kind) {
    return `(() => {
      const store = ${kind === 'session' ? 'sessionStorage' : 'localStorage'};
      const out = [];
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        const value = String(store.getItem(key) == null ? '' : store.getItem(key));
        out.push({ name: key, value: value.slice(0, ${this.MAX_VALUE}), clipped: value.length > ${this.MAX_VALUE}, size: value.length });
      }
      return out;
    })()`;
  },

  writeScript(kind, key, value) {
    const store = kind === 'session' ? 'sessionStorage' : 'localStorage';
    return value === null
      ? `(() => { ${store}.removeItem(${JSON.stringify(key)}); return true; })()`
      : `(() => { ${store}.setItem(${JSON.stringify(key)}, ${JSON.stringify(String(value))}); return true; })()`;
  },

  async storage(t, kind) {
    if (!t.wv) throw new Error('That tab has no page open');
    const items = await window.vexGuestEval(t.wv, this.listScript(kind), false, 6000);
    return (Array.isArray(items) ? items : []).map(i => ({ ...i, id: i.name }));
  },

  async read(t, kind) {
    const items = kind === 'cookies' ? await this.cookies(t) : await this.storage(t, kind);
    return items.sort((a, b) => a.name.localeCompare(b.name));
  },

  // --- changing ------------------------------------------------------------

  async remove(t, kind, item) {
    if (kind !== 'cookies') return window.vexGuestEval(t.wv, this.writeScript(kind, item.name, null), false, 6000);
    const res = await window.vex.cookiesRemove({
      url: t.url, partition: t.partition, name: item.name, domain: item.domain, path: item.path, secure: item.secure,
    });
    if (!res || !res.ok) throw new Error((res && res.error) || 'Could not remove that cookie');
    return true;
  },

  async write(t, kind, item, value) {
    if (item.clipped) throw new Error('This one is too big to edit here — remove it instead');
    if (kind !== 'cookies') return window.vexGuestEval(t.wv, this.writeScript(kind, item.name, value), false, 6000);
    const res = await window.vex.cookiesSet({
      url: t.url, partition: t.partition, name: item.name, value: String(value),
      domain: item.domain, path: item.path, secure: item.secure, httpOnly: item.httpOnly, expires: item.expires,
    });
    if (!res || !res.ok) throw new Error((res && res.error) || 'Could not change that cookie');
    return true;
  },

  // --- describing ----------------------------------------------------------

  clip(value, width = 64) {
    const one = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return one.length > width ? one.slice(0, width - 1) + '…' : one;
  },

  // The second line of a row: where a cookie applies and how long it lasts,
  // or how big a stored value is.
  describe(kind, item, now = Date.now()) {
    if (kind !== 'cookies') {
      const size = Number.isFinite(item.size) ? item.size : String(item.value || '').length;
      return size + (size === 1 ? ' character' : ' characters') + (item.clipped ? ' · too big to edit here' : '');
    }
    const bits = [item.domain + (item.path && item.path !== '/' ? item.path : '')];
    if (!item.expires) bits.push('until Vex closes');
    else {
      const days = Math.round((item.expires - now) / 86400000);
      bits.push(days <= 0 ? 'expired' : days < 1 ? 'expires today' : days === 1 ? 'expires tomorrow' : 'expires in ' + days + ' days');
    }
    if (item.httpOnly) bits.push('the page cannot read it');
    return bits.join(' · ');
  },

  // --- the dialog ----------------------------------------------------------

  async open(kind = 'cookies') {
    const t = this.target();
    document.querySelector('.vex-sitedata-overlay')?.remove();
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const overlay = document.createElement('div');
    overlay.className = 'vex-sitedata-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.38);display:grid;place-items:start center;padding-top:8vh';
    overlay.innerHTML = `
      <div class="vex-sitedata-box" role="dialog" aria-modal="true" aria-label="Site data"
           style="width:min(680px,92vw);max-height:74vh;display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--border);border-radius:12px;box-shadow:0 18px 50px var(--vex-shadow-color,rgba(0,0,0,0.45));overflow:hidden">
        <div style="display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border)">
          <div style="flex:1;min-width:0">
            <div style="font-size:13.5px;font-weight:650;color:var(--text)">What ${esc(this.host(t.url))} keeps on you</div>
            <div style="font-size:10.5px;color:var(--text-muted)">In this tab's container only</div>
          </div>
          <button data-clear type="button" style="font-size:11.5px;color:var(--text-muted);background:none;border:1px solid var(--border);border-radius:6px;padding:3px 8px;cursor:pointer">Remove all of these</button>
        </div>
        <div data-tabs style="display:flex;gap:6px;padding:8px 12px;border-bottom:1px solid var(--border)"></div>
        <div data-list style="overflow-y:auto;padding:6px;flex:1"></div>
        <div style="padding:8px 14px;border-top:1px solid var(--border);font-size:11px;color:var(--text-muted)">
          A site usually reads these when the page loads, so reload the tab after a change.
        </div>
      </div>`;

    const tabsEl = overlay.querySelector('[data-tabs]');
    const listEl = overlay.querySelector('[data-list]');
    let current = this.KINDS.includes(kind) ? kind : 'cookies';

    const drawTabs = () => {
      tabsEl.innerHTML = '';
      for (const k of this.KINDS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = this.LABELS[k];
        b.style.cssText = 'font-size:11.5px;border-radius:6px;padding:4px 10px;cursor:pointer;border:1px solid ' +
          (k === current ? 'var(--primary);color:var(--primary);background:var(--vex-hover-fill,var(--surface))' : 'var(--border);color:var(--text-muted);background:none');
        b.addEventListener('click', () => { current = k; drawTabs(); draw(); });
        tabsEl.appendChild(b);
      }
    };

    const draw = async () => {
      listEl.innerHTML = '<div style="padding:24px;text-align:center;font-size:12.5px;color:var(--text-muted)">Reading…</div>';
      let items;
      try { items = await this.read(t, current); }
      catch (err) {
        listEl.innerHTML = `<div style="padding:24px;text-align:center;font-size:12.5px;color:var(--text-muted)">${esc(err.message)}</div>`;
        return;
      }
      if (!items.length) {
        listEl.innerHTML = window.VexUI
          ? VexUI.emptyState('shield', 'Nothing here', this.LABELS[current] + ' is empty for this site')
          : '<div style="padding:24px;text-align:center;font-size:12.5px;color:var(--text-muted)">Nothing here.</div>';
        return;
      }
      listEl.innerHTML = '';
      for (const item of items) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 9px;border-radius:8px';
        row.addEventListener('mouseenter', () => { row.style.background = 'var(--vex-hover-fill,var(--surface))'; });
        row.addEventListener('mouseleave', () => { row.style.background = ''; });
        row.innerHTML = `
          <div style="flex:1;min-width:0">
            <div style="font-size:12.5px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
              <b style="font-weight:600">${esc(item.name)}</b> <span style="color:var(--text-muted)">${esc(this.clip(item.value))}</span>
            </div>
            <div style="font-size:10.5px;color:var(--text-muted)">${esc(this.describe(current, item))}</div>
          </div>
          ${item.clipped ? '' : `<button data-edit type="button" title="Change this value"
                  style="background:none;border:none;cursor:pointer;padding:4px;color:var(--text-muted)">${window.VexIcons ? VexIcons.svg('edit', { size: 14 }) : ''}</button>`}
          <button data-remove type="button" title="Remove this"
                  style="background:none;border:none;cursor:pointer;padding:4px;color:var(--text-muted)">${window.VexIcons ? VexIcons.svg('x', { size: 14 }) : ''}</button>`;
        row.querySelector('[data-edit]')?.addEventListener('click', async () => {
          const next = await window.vexPrompt({ title: 'Change ' + item.name, label: 'Value', value: item.value, okLabel: 'Save' });
          if (next == null || next === item.value) return;
          try { await this.write(t, current, item, next); window.showToast?.('Changed — reload the page to use it'); }
          catch (err) { window.showToast?.(err.message, 'error'); }
          draw();
        });
        row.querySelector('[data-remove]').addEventListener('click', async () => {
          try { await this.remove(t, current, item); window.showToast?.('Removed'); }
          catch (err) { window.showToast?.(err.message, 'error'); }
          draw();
        });
        listEl.appendChild(row);
      }
    };

    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('[data-clear]').addEventListener('click', async () => {
      if (!(await vexConfirm({
        title: 'Remove all ' + this.LABELS[current].toLowerCase() + '?',
        message: 'For ' + this.host(t.url) + ', in this tab’s container. You will probably be signed out of it.',
        okLabel: 'Remove them', danger: true,
      }))) return;
      let items = [];
      try { items = await this.read(t, current); } catch (err) { window.showToast?.(err.message, 'error'); return; }
      for (const item of items) {
        try { await this.remove(t, current, item); } catch (err) { window.showToast?.(err.message, 'error'); break; }
      }
      draw();
    });
    document.addEventListener('keydown', onKey, true);
    drawTabs();
    draw();
    document.body.appendChild(overlay);
    return overlay;
  },
};

if (typeof window !== 'undefined') window.SiteData = SiteData;
if (typeof module !== 'undefined' && module.exports) module.exports = { SiteData };
