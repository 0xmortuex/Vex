// === Settings › Attention ======================================================
//
// What the Attention Budget (js/vex-attention.js) did, in the open: the
// notifications it held back and why, the features you told to stay quiet or to
// show less, and the switch for the Attention Inbox (the bell).
const AttentionSettings = {
  ID: 'attention',

  _when(ms) {
    const d = Date.now() - ms;
    if (d < 90 * 1000) return 'just now';
    if (d < 3600 * 1000) return Math.round(d / 60000) + ' min ago';
    if (d < 24 * 3600 * 1000) return Math.round(d / 3600000) + ' h ago';
    return Math.round(d / 86400000) + ' d ago';
  },

  async _denied() {
    const own = VexAttention.denied().map(d => ({ ...d, where: 'in Vex' }));
    let os = [];
    if (window.vex && window.vex.attention && typeof window.vex.attention.denied === 'function') {
      os = (await window.vex.attention.denied()).map(d => ({ ...d, where: 'Windows' }));
    }
    return own.concat(os).sort((a, b) => b.t - a.t).slice(0, 50);
  },

  render(body) {
    body.textContent = '';
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const redraw = () => this.render(body);
    const fail = (err) => window.showToast?.((err && err.message) || String(err), 'error');

    body.appendChild(el('p', 'setting-info', 'Features that speak up on their own share one budget: at most ' + VexAttention.HOUR_CAP + ' an hour and ' + VexAttention.DAY_CAP + ' a day, never during a game, a meeting, Focus, quiet hours or the wind-down, and never the same thing twice. What is not urgent waits in the Inbox (the bell in the toolbar) instead. Reminders and things you asked for always get through.'));

    const row = el('div', 'setting-toggle-row');
    const lab = el('label', 'toggle');
    const input = document.createElement('input');
    input.type = 'checkbox'; input.checked = AttentionInbox.enabled(); input.setAttribute('aria-label', 'Attention Inbox');
    input.addEventListener('change', () => { try { AttentionInbox.setEnabled(input.checked); } catch (err) { input.checked = !input.checked; fail(err); } });
    lab.append(input, el('span', 'toggle-slider'));
    row.append(el('span', 'setting-label-text', 'Attention Inbox (the bell)'), lab);
    body.appendChild(row);

    const rowsOf = (title, items, empty) => {
      const box = el('div', 'attention-list');
      box.appendChild(el('div', 'setting-label', title));
      if (!items.length) box.appendChild(el('p', 'setting-info', empty));
      for (const it of items) box.appendChild(it);
      body.appendChild(box);
      return box;
    };
    const line = (text, btnLabel, onClick) => {
      const r = el('div', 'setting-row');
      r.appendChild(el('span', '', text));
      if (btnLabel) {
        const b = el('button', 'btn-secondary', btnLabel); b.type = 'button';
        b.addEventListener('click', () => { try { onClick(); redraw(); } catch (err) { fail(err); } });
        r.appendChild(b);
      }
      return r;
    };

    rowsOf('Muted features', VexAttention.mutedDetails().map(m => line(m.label, 'Allow again', () => VexAttention.unmute(m.feature))), 'None. "Never for this feature" in the Inbox adds one here.');
    const lessList = Object.keys(VexAttention._map(VexAttention.KEYS.less));
    rowsOf('Shown less', lessList.map(f => line(f, 'Show normally', () => VexAttention.more(f))), 'None. "Show less" in the Inbox adds one here.');

    const heldBox = rowsOf('Held back recently', [], 'Loading…');
    this._denied().then((list) => {
      heldBox.textContent = '';
      heldBox.appendChild(el('div', 'setting-label', 'Held back recently'));
      if (!list.length) { heldBox.appendChild(el('p', 'setting-info', 'Nothing has been held back.')); return; }
      for (const d of list) {
        heldBox.appendChild(line((d.title || d.feature) + ' (' + d.feature + ', ' + d.where + '): ' + d.reason + (d.n > 1 ? ' x' + d.n : '') + ', ' + this._when(d.t)));
      }
      const clear = el('button', 'btn-secondary', 'Clear this list'); clear.type = 'button';
      clear.addEventListener('click', async () => {
        try {
          VexAttention.clearDenied();
          if (window.vex && window.vex.attention) await window.vex.attention.clearDenied();
          redraw();
        } catch (err) { fail(err); }
      });
      heldBox.appendChild(clear);
    }).catch((err) => { heldBox.textContent = ''; heldBox.appendChild(el('p', 'setting-info', 'The list could not be read: ' + ((err && err.message) || err))); });
  },
};

if (typeof window !== 'undefined') {
  window.AttentionSettings = AttentionSettings;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: AttentionSettings.ID, title: 'Attention', keywords: 'inbox bell notifications toasts quiet limits held back muted nag', render: (body) => AttentionSettings.render(body) });
  }
  if (typeof CommandBar !== 'undefined' && CommandBar.commands && !CommandBar.commands.some(c => c.id === 'attention-inbox')) {
    CommandBar.commands.push({ id: 'attention-inbox', label: 'Open the Inbox', hint: 'Suggestions that were not worth a pop-up: Dismiss, Show less or Never for this feature', icon: 'bell',
      action: () => { if (AttentionInbox.count() === 0) { window.showToast?.('The Inbox is empty'); return; } AttentionInbox.open(); } });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { AttentionSettings };
