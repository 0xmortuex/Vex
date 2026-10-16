// === Unfinished-form rescue (T2-077) ===========================================
//
// Crash-proof tabs (js/tab-snapshots.js) already keeps the text you typed into plain
// boxes every 30 seconds and puts it back after a crash. This adds the other half:
// a tab you CLOSED with unsent text in it. When that happens
//   * a notice says so at once ("kept for 7 days"),
//   * the text stays, encrypted (the OS-encrypted SecretStore in main), for 7 days and
//     for at most 10 pages,
//   * if you open the same page again, the text goes back into its empty boxes by
//     itself (the same restore as after a crash),
//   * "Unfinished forms" lists them: reopen and restore, copy the text, or discard, and
//     the morning after, one quiet line in the Attention Inbox says you left some.
//
// What is never taken is decided by the sampler, not here: password fields (or any field
// of a form that has one), card, one-time-code and username fields, email, phone and number
// boxes, and anything from a private, Tor, burner or routed tab. Without OS encryption the
// text is not stored at all. Switch it off here and nothing is kept after a close.
const FormRescue = {
  PREF_KEY: 'vex.formRescue.enabled',
  DAY_KEY: 'vex.formRescue.nudged',

  enabled() { try { return localStorage.getItem(this.PREF_KEY) !== 'false'; } catch { return true; } },
  setEnabled(on) { localStorage.setItem(this.PREF_KEY, on ? 'true' : 'false'); },

  hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return String(url || ''); } },
  preview(entry, n = 90) {
    const s = (entry.fields || []).map(f => f.v).join(' · ').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  },
  label(entry) { return (entry.title && entry.title.trim()) || this.hostOf(entry.url); },

  // Called by TabSnapshots the moment such a tab closes.
  told(info) {
    const say = () => window.showToast?.('Closed with text you had typed on "' + (info.title || this.hostOf(info.url)).slice(0, 50) + '". Kept for 7 days under Unfinished forms.', 'info');
    if (typeof VexAttention === 'undefined') { say(); return; }
    VexAttention.notify({ feature: 'form-rescue', urgency: 'asked', id: 'close:' + info.url }, say);
  },
  changed() { document.dispatchEvent(new CustomEvent('vex:form-rescue-changed')); },

  async list() {
    if (!window.vex || !window.vex.tabSnapshots) throw new Error('Saved pages are not available in this window');
    const r = await window.vex.tabSnapshots.load();
    return (r.entries || []).filter(e => e && e.closed === true && Array.isArray(e.fields) && e.fields.length)
      .sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0));
  },

  async reopen(entry) {
    if (typeof TabManager === 'undefined' || typeof TabSnapshots === 'undefined') throw new Error('Tabs are not available');
    const plain = { ...entry };   // restored as a normal snapshot
    delete plain.closed; delete plain.closedAt;
    TabSnapshots._restore = (TabSnapshots._restore || []).filter(e => e.url !== entry.url).concat([plain]);
    TabManager.createTab(entry.url, true);
    // The page needs a moment; the 30 second round tries again if these are too early.
    for (const ms of [2500, 6000, 12000]) setTimeout(() => { TabSnapshots._applyPending().catch(err => console.error('[FormRescue] restore failed:', err)); }, ms);
  },
  async discard(entry) { await window.vex.tabSnapshots.drop(entry.url); this.changed(); },

  async open() {
    const { body, close } = window.PageExport._sheet('Unfinished forms', 'vex-formrescue-overlay');
    const btn = 'font-size:11.5px;color:var(--text);background:none;border:1px solid var(--border);border-radius:6px;padding:3px 9px;cursor:pointer';
    const mk = (label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.style.cssText = btn; b.textContent = label; b.addEventListener('click', async () => { try { await fn(); } catch (err) { say(err.message || String(err)); } }); return b; };
    const status = document.createElement('div');
    status.setAttribute('role', 'status');
    status.style.cssText = 'padding:8px 14px;font-size:11.5px;color:var(--text-muted)';
    const say = (m) => { status.textContent = m; };
    const list = document.createElement('div');
    body.append(list, status);
    const draw = async () => {
      list.textContent = '';
      const entries = await this.list();
      if (!entries.length) { say('Nothing unfinished. Text you typed in a page you closed is kept here for 7 days.'); return; }
      say(entries.length + ' page' + (entries.length === 1 ? '' : 's') + ' closed with unsent text. Stored encrypted on this computer.');
      for (const e of entries) {
        const box = document.createElement('div');
        box.style.cssText = 'padding:10px 14px;border-bottom:1px solid var(--border)';
        const t = document.createElement('div'); t.style.cssText = 'font-size:12.5px;font-weight:600;color:var(--text)'; t.textContent = this.label(e);
        const p = document.createElement('div'); p.style.cssText = 'font-size:11.5px;color:var(--text-muted);margin:3px 0 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'; p.textContent = this.preview(e);
        const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
        row.append(
          mk('Reopen and restore', async () => { await this.reopen(e); say('Opening the page; the text goes back when it has loaded.'); }),
          mk('Copy the text', async () => { await navigator.clipboard.writeText(e.fields.map(f => f.v).join('\n\n')); say('Copied.'); }),
          mk('Discard', async () => { await this.discard(e); await draw(); }));
        box.append(t, p, row);
        list.append(box);
      }
    };
    try { await draw(); } catch (err) { say(err.message || String(err)); }
    if (typeof VexUsage !== 'undefined') VexUsage.touch('form-rescue');
    return close;
  },

  // The morning after: one quiet line, once a day.
  async nudge(now = Date.now()) {
    if (!this.enabled() || typeof VexAttention === 'undefined') return false;
    const day = new Date(now).toISOString().slice(0, 10);
    if (localStorage.getItem(this.DAY_KEY) === day) return false;
    const entries = await this.list();
    if (!entries.length) return false;
    const ok = VexAttention.suggest({ feature: 'form-rescue', id: 'day-' + day, title: 'You left ' + entries.length + ' page' + (entries.length === 1 ? '' : 's') + ' half-done', body: 'The text you typed is kept for 7 days.', action: { label: 'Open', key: 'open' } });
    if (ok) localStorage.setItem(this.DAY_KEY, day);
    return ok;
  },

  render(body) {
    const G = window.VexSettingsGroups;
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = this.enabled();
    cb.addEventListener('change', () => this.setEnabled(cb.checked));
    const label = document.createElement('label');
    label.append(cb, document.createTextNode(' Keep the text of a page I close with unsent text in it (7 days)'));
    body.append(label,
      G.note('Needs "Crash-proof tabs" below. Never takes password, card or one-time-code fields, or anything from private, Tor or routed tabs. Stored encrypted; not stored at all if Windows encryption is unavailable.'),
      G.button('Unfinished forms…', () => this.open().catch(err => window.showToast?.(err.message, 'error'))));
  },

  start() {
    if (this._started || typeof document === 'undefined') return;
    this._started = true;
    document.addEventListener('vex:tab-closed', (e) => {
      try { if (typeof TabSnapshots !== 'undefined') TabSnapshots.noteClosed(e.detail && e.detail.tabId); }
      catch (err) { window.VexProblems?.note('Form rescue', 'Could not keep a closed page’s text', err); }
    });
    if (typeof AttentionInbox !== 'undefined') AttentionInbox.handle('form-rescue', () => this.open());
    if (window.VexSettingsGroups) window.VexSettingsGroups.register({ id: 'form-rescue', title: 'Unfinished forms', keywords: 'form draft recover closed tab text typed rescue lost', render: (body) => this.render(body) });
    // After the saved tabs are back and the snapshots have loaded.
    setTimeout(() => { this.nudge().catch(err => window.VexProblems?.note('Form rescue', 'Could not check for unfinished forms', err)); }, 20000);
  },
};

if (typeof window !== 'undefined') window.FormRescue = FormRescue;
if (typeof module !== 'undefined' && module.exports) module.exports = { FormRescue };
