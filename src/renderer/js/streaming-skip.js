// === Skip intro / recap / next episode on streaming sites: the switches ==========
//
// Ctrl+K "Skip intro and next episode on streaming sites". One switch per site (Netflix, Prime Video, Disney+), every one OFF until
// pressed. When a site is on, its page presses the on-page Skip Intro, Skip Recap, Next Episode and "Continue watching" buttons
// about a second after they appear, exactly as a click of yours would. Nothing is sent anywhere and nothing about the video, the
// player or its protection is touched. The scanner and the table of selectors are in src/site-tweaks.js; the switches and the
// "last matched" note are kept by src/main/streaming-skip.js.
//
// The selectors are NOT verified against the live sites (they need a subscription and change often). "Last matched" is how a
// broken one is noticed: a site that has been on while you watched and still says "Not matched yet" has changed its page, and
// "Copy a report" puts what is needed to fix the table on the clipboard. Turning a site off is the way to stop it for that site.
const VexStreamingSkip = {
  KIND_LABEL: { intro: 'Skip intro', recap: 'Skip recap', next: 'Next episode', continue: 'Continue watching' },

  _t(text) { return (typeof VexI18nUI !== 'undefined' && VexI18nUI.lookup(text)) || text; },

  _api() {
    const v = typeof window !== 'undefined' ? window.vex : null;
    if (!v || typeof v.streamingSkipGet !== 'function' || typeof v.streamingSkipSet !== 'function') throw new Error('This build cannot switch streaming skip');
    return v;
  },

  // "5 minutes ago" from a gap in milliseconds.
  ago(ms) {
    const mins = Math.floor(Math.max(0, ms) / 60000);
    if (mins < 1) return this._t('just now');
    if (mins < 60) return this._t('{1} minutes ago').replace('{1}', String(mins));
    const hours = Math.floor(mins / 60);
    if (hours < 48) return this._t('{1} hours ago').replace('{1}', String(hours));
    return this._t('{1} days ago').replace('{1}', String(Math.floor(hours / 24)));
  },

  // The line under a site: what it did last, or why it did nothing.
  describeSite(site, now = Date.now()) {
    if (!site.enabled) return this._t('Off');
    if (!site.last) return this._t('Not matched yet. If you have watched here since turning it on, this site may have changed its page.');
    return this._t('Last matched: {1}, {2}').replace('{1}', this._t(this.KIND_LABEL[site.last.kind] || site.last.kind)).replace('{2}', this.ago(now - site.last.at));
  },

  // Plain text for a bug report: nothing but the switches, the table version and the last matches.
  reportText(state, now = Date.now()) {
    const lines = ['Vex streaming skip report', 'Selector table version ' + state.version + ' (' + state.updated + '), ' + (state.verified ? 'verified' : 'NOT verified against the live sites')];
    for (const s of state.sites) {
      lines.push(s.label + ': ' + (s.enabled ? 'on' : 'off') + ', ' + (s.last ? 'last matched ' + s.last.kind + ' ' + this.ago(now - s.last.at) : 'never matched'));
    }
    return lines.join('\n');
  },

  async open() {
    const api = this._api();
    const { body } = VexSettingsGroups.dialog({ id: 'vex-streaming-skip', title: 'Skip intro and next episode', sub: 'Presses the Skip Intro, Skip Recap, Next Episode and "Continue watching" buttons for you on the sites you turn on. Off for every site until you turn it on.' });
    const draw = async () => {
      body.textContent = '';
      let state;
      try { state = await api.streamingSkipGet(); }
      catch (err) { body.appendChild(VexSettingsGroups.note('Could not read the switches: ' + err.message)); return; }
      body.appendChild(VexSettingsGroups.note('Each site is read when its page loads, so reload a page after changing its switch. Nothing is sent anywhere: this only clicks buttons that are already on the page.'));
      for (const site of state.sites) {
        const line = document.createElement('div');
        line.className = 'vexsr-rule';
        line.style.flexWrap = 'wrap';
        const text = document.createElement('span');
        text.className = 'vexsr-host';
        text.style.wordBreak = 'normal';
        text.dataset.streamSite = site.id;
        text.textContent = site.label + ' - ' + this.describeSite(site);
        line.appendChild(text);
        line.appendChild(VexSettingsGroups.button(site.enabled ? 'Turn off' : 'Turn on', async () => {
          try { await api.streamingSkipSet(site.id, !site.enabled); }
          catch (err) { window.showToast?.(err.message, 'error'); }
          if (body.isConnected) draw();
        }, { primary: !site.enabled, label: (site.enabled ? 'Turn off skipping on ' : 'Turn on skipping on ') + site.label }));
        body.appendChild(line);
      }
      body.appendChild(VexSettingsGroups.note('The buttons are found by a table of selectors (version ' + state.version + ', ' + state.updated + ') that has not been checked against the live sites, so a site can change and stop matching. A site that stays on "Not matched yet" while you watch needs the table updated.'));
      body.appendChild(VexSettingsGroups.button('Copy a report', async () => {
        try { await navigator.clipboard.writeText(this.reportText(state)); window.showToast?.('Report copied. Nothing was sent.'); }
        catch (err) { window.showToast?.('Could not copy the report: ' + err.message, 'error'); }
      }));
    };
    await draw();
    return body;
  },
};

if (typeof window !== 'undefined') window.VexStreamingSkip = VexStreamingSkip;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexStreamingSkip };
