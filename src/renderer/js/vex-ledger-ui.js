// === Ctrl+K "Why did that happen?" ===========================================
//
// The last 50 things Vex did by itself (js/vex-ledger.js), newest first, each
// with what it did, why, when, and two buttons:
//   Undo             puts it back (the token is kept in storage, so this works
//                    after the toast is gone and after a restart);
//   Stop doing this  switches the feature off through the registry.
const VexLedgerUI = {
  _icon(name, size = 14) { return (typeof VexIcons !== 'undefined' && VexIcons.has(name)) ? VexIcons.svg(name, { size }) : ''; },

  _ago(at) {
    const s = Math.max(0, Math.round((Date.now() - at) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' d ago';
  },

  close() {
    if (this._onKey) { document.removeEventListener('keydown', this._onKey, true); this._onKey = null; }
    document.getElementById('vex-ledger')?.remove();
  },

  open() {
    if (typeof VexLedger === 'undefined') throw new Error('The ledger is not loaded');
    this.close();
    const root = document.createElement('div');
    root.id = 'vex-ledger';
    root.className = 'vex-tt-overlay';
    const card = document.createElement('div');
    card.className = 'vex-tt-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', 'Why did that happen?');
    const head = document.createElement('div');
    head.className = 'vex-tt-head';
    const title = document.createElement('span');
    title.className = 'vex-tt-title';
    title.innerHTML = this._icon('clock', 16);
    title.append(' Why did that happen?');
    const forget = document.createElement('button');
    forget.className = 'vex-tt-btn danger';
    forget.type = 'button';
    forget.innerHTML = this._icon('trash');
    forget.append(' Forget the list');
    const closeBtn = document.createElement('button');
    closeBtn.className = 'vex-tt-btn';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML = this._icon('x');
    head.append(title, forget, closeBtn);
    const body = document.createElement('div');
    body.className = 'vex-tt-body';
    card.append(head, body);
    root.appendChild(card);
    document.body.appendChild(root);

    root.addEventListener('click', (e) => { if (e.target === root) this.close(); });
    closeBtn.addEventListener('click', () => this.close());
    forget.addEventListener('click', async () => {
      const ok = await vexConfirm({ title: 'Forget the list?', message: 'Vex forgets what it did by itself, and the Undo for each. Nothing is changed back.', okLabel: 'Forget', danger: true });
      if (ok) VexLedger.forget();
    });
    this._onKey = (e) => {
      if (e.key !== 'Escape' || document.querySelector('.vex-dialog-overlay')) return;
      e.preventDefault(); e.stopPropagation(); this.close();
    };
    document.addEventListener('keydown', this._onKey, true);
    this._paint(body);
    closeBtn.focus();
  },

  // Called when the ledger changes: repaint the list if it is on screen.
  _repaint() {
    const body = document.querySelector('#vex-ledger .vex-tt-body');
    if (body) this._paint(body);
  },

  _paint(body) {
    body.textContent = '';
    const rows = VexLedger.list();
    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'vex-tt-empty';
      empty.textContent = 'Nothing yet. When Vex does something on its own (sleeps a tab, files a download, changes the theme), it is listed here with the reason.';
      body.appendChild(empty);
      return;
    }
    const hint = document.createElement('div');
    hint.className = 'vex-tt-h';
    hint.textContent = 'The last ' + rows.length + ' thing' + (rows.length === 1 ? '' : 's') + ' Vex did by itself';
    body.appendChild(hint);
    for (const e of rows) {
      const row = document.createElement('div');
      row.className = 'vex-tn-rec sev-low';
      const main = document.createElement('div');
      main.className = 'vex-tn-rec-main';
      const t = document.createElement('div');
      t.className = 'vex-tn-rec-title';
      t.textContent = e.what;
      const d = document.createElement('div');
      d.className = 'vex-tn-rec-detail';
      d.textContent = e.why + ' · ' + this._ago(e.at) + (e.undone ? ' · undone' : '') + (e.stopped ? ' · switched off' : '');
      main.append(t, d);
      row.appendChild(main);
      if (VexLedger.canUndo(e)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'vex-tt-btn primary';
        b.textContent = 'Undo';
        b.addEventListener('click', async () => {
          b.disabled = true;
          try { await VexLedger.undo(e.id); window.showToast?.('Undone: ' + e.what); }
          catch (err) { console.error('[Ledger] undo failed:', err); window.showToast?.(err.message, 'error', 6000); b.disabled = false; }
        });
        row.appendChild(b);
      }
      const m = typeof VexRegistry !== 'undefined' ? VexRegistry.get(e.feature) : null;
      if (VexLedger.canStop(e)) {
        const s = document.createElement('button');
        s.type = 'button';
        s.className = 'vex-tt-btn';
        s.textContent = 'Stop doing this';
        s.title = m ? 'Switch off "' + m.title + '"' : 'Stop Vex doing this by itself';
        s.addEventListener('click', async () => {
          s.disabled = true;
          try { await VexLedger.stopDoing(e.id); window.showToast?.((m ? '"' + m.title + '" is off.' : 'Stopped.') + ' Turn it back on in Settings.'); }
          catch (err) { console.error('[Ledger] stop failed:', err); window.showToast?.(err.message, 'error', 6000); s.disabled = false; }
        });
        row.appendChild(s);
      }
      body.appendChild(row);
    }
  },
};

if (typeof VexLedger !== 'undefined') VexLedger.onChange(() => VexLedgerUI._repaint());
if (typeof window !== 'undefined') window.VexLedgerUI = VexLedgerUI;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexLedgerUI };
