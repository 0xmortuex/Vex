// === Settings › Feature usage ===============================================
// The screen over VexUsage (js/vex-usage.js): after 30 days of keeping the
// record it lists what was used, what was not, and gives each unused feature a
// one-click Hide. Everything is local; nothing is reported anywhere.
const VexUsageUI = {
  _when(ms) {
    if (!ms) return 'never';
    const days = Math.floor((VexUsage._now() - ms) / VexUsage.DAY_MS);
    return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days + ' days ago';
  },

  _row(r, actions) {
    const row = document.createElement('div');
    row.className = 'vexsr-rule';
    row.dataset.feature = r.id;
    const name = document.createElement('span');
    name.className = 'vexsr-host';
    name.textContent = r.title;
    const meta = document.createElement('span');
    meta.className = 'vexsr-mode';
    const bits = [];
    if (r.uses) bits.push(r.uses + (r.uses === 1 ? ' use' : ' uses') + ', last ' + this._when(r.lastUsed));
    else if (r.catalogUsed) bits.push('used (from the command bar or sidebar record)');
    else bits.push('no use recorded');
    bits.push(r.daysSeen + ' days here');
    meta.textContent = bits.join(' · ');
    row.append(name, meta);
    if (actions) row.appendChild(actions);
    return row;
  },

  async _toggle(id, on, btn, redraw) {
    btn.disabled = true;
    try {
      if (on) await VexUsage.enable(id); else await VexUsage.disable(id);
    } catch (err) {
      window.showToast?.('Could not ' + (on ? 'turn on' : 'hide') + ' that feature: ' + (err && err.message || err), 'error');
    }
    redraw();
  },

  open() {
    const { body } = VexSettingsGroups.dialog({
      id: 'vex-usage-dialog',
      title: 'Feature usage',
      sub: 'What you use, kept on this computer only. Vex looks at the last ' + VexUsage.WINDOW_DAYS + ' days.',
    });
    const draw = () => {
      body.textContent = '';
      const rep = VexUsage.report();
      if (!VexUsage.features().length) {
        body.appendChild(VexSettingsGroups.note('No feature has registered with the usage record in this build.'));
        return;
      }
      if (!rep.ready) {
        body.appendChild(VexSettingsGroups.note('Vex has been keeping this record for ' + rep.days + ' of ' + VexUsage.WINDOW_DAYS + ' days. '
          + 'The list of unused features appears in ' + rep.daysLeft + ' more day' + (rep.daysLeft === 1 ? '' : 's') + '; before that it would only be a guess.'));
      }
      const section = (title, rows, withHide) => {
        if (!rows.length) return;
        const h = document.createElement('div');
        h.className = 'vexsr-sub';
        h.style.marginTop = '12px';
        h.textContent = title + ' (' + rows.length + ')';
        body.appendChild(h);
        const list = document.createElement('div');
        list.className = 'vexsr-list';
        for (const r of rows) {
          const box = document.createElement('span');
          box.style.display = 'contents';
          if (withHide === 'hide') {
            const b = VexSettingsGroups.button('Hide', () => this._toggle(r.id, false, b, draw), { label: 'Hide ' + r.title });
            box.appendChild(b);
          } else if (withHide === 'show') {
            const b = VexSettingsGroups.button('Turn back on', () => this._toggle(r.id, true, b, draw), { label: 'Turn ' + r.title + ' back on' });
            box.appendChild(b);
          }
          list.appendChild(this._row(r, box));
        }
        body.appendChild(list);
      };
      if (rep.ready) section('Not used in ' + VexUsage.WINDOW_DAYS + ' days', rep.unused, 'hide');
      section('Used', rep.used, null);
      section('Too new to say', rep.fresh, null);
      section('Switched off', rep.off, 'show');
      body.appendChild(VexSettingsGroups.note('Hiding turns the feature off and removes its Settings section; Turn back on puts both back. '
        + 'Nothing you made with it is deleted.'));
      const reset = VexSettingsGroups.button('Start counting again', async () => {
        const ok = await vexConfirm({
          title: 'Start counting again?',
          message: 'This clears the usage record on this computer and starts the ' + VexUsage.WINDOW_DAYS + ' days over. Features you switched off stay off.',
          okLabel: 'Start again', cancelLabel: 'Cancel', danger: true,
        });
        if (!ok) return;
        const off = Object.assign({}, VexUsage._load().off);
        VexUsage.reset();
        Object.assign(VexUsage._load().off, off);
        VexUsage._save();
        draw();
      });
      body.appendChild(reset);
    };
    draw();
  },

  group(el) {
    const rep = VexUsage.report();
    const rows = VexUsage.features().length;
    el.appendChild(VexSettingsGroups.note(!rows
      ? 'No feature has registered with the usage record in this build.'
      : rep.ready
        ? rows + ' features tracked: ' + rep.used.length + ' used, ' + rep.unused.length + ' not used in ' + VexUsage.WINDOW_DAYS + ' days, ' + rep.off.length + ' switched off.'
        : rows + ' features tracked. The list of unused ones appears after ' + VexUsage.WINDOW_DAYS + ' days (' + rep.daysLeft + ' to go). Kept on this computer only.'));
    el.appendChild(VexSettingsGroups.button('See feature usage', () => this.open(), { primary: true }));
  },
};

if (typeof window !== 'undefined') {
  window.VexUsageUI = VexUsageUI;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({
      id: 'feature-usage',
      title: 'Feature usage',
      keywords: 'unused features hide disable clean up declutter usage dashboard',
      before: 'about',
      build: (el) => VexUsageUI.group(el),
    });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexUsageUI };
