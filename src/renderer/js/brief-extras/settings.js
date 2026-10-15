// === Brief extras: Settings ==================================================
//
// The on/off switches and numbers for the five brief extra sections
// (one-new-thing, news-actions, evening, audio-digest, streaks). Kept apart
// from the sections and from the Morning Brief's own settings so it can be
// mounted wherever the Settings panel wants it:
//
//   VexBriefExtrasSettings.render(containerElement)
//
// Everything lives in one localStorage object, vex.briefExtras:
//   oneNew, newsActions, evening, streaks   booleans, on unless false
//   audio                                   boolean, OFF unless true (opt-in)
//   eveningHour                             0-23, default 19
//   goalTabs, goalFocus                     1-999, defaults 15 and 25
const VexBriefExtrasSettings = {
  KEY: 'vex.briefExtras',

  TOGGLES: [
    { key: 'oneNew', label: 'One new thing each day', hint: 'Suggests one Vex feature you have not used yet.', def: true },
    { key: 'newsActions', label: 'AI news about what you use', hint: 'Open the changelog, watch the repository or be reminded, for stories naming your extensions, watched repositories or often-visited sites.', def: true },
    { key: 'evening', label: 'Evening wind-down', hint: 'After the hour below: what is undone, read-later and tomorrow\'s first event.', def: true },
    { key: 'audio', label: 'Spoken digest', hint: 'Lets you play the day as audio, with this computer\'s voice. Never starts by itself.', def: false },
    { key: 'streaks', label: 'Streaks and goals', hint: 'Inbox zero, open tabs and focus minutes, counted on this computer only.', def: true },
  ],

  NUMBERS: [
    { key: 'eveningHour', label: 'Evening starts at (hour, 0 to 23)', min: 0, max: 23, def: 19 },
    { key: 'goalTabs', label: 'Tab goal: at most', min: 1, max: 999, def: 15 },
    { key: 'goalFocus', label: 'Focus goal: minutes per day', min: 1, max: 999, def: 25 },
  ],

  get() {
    let s;
    try { s = JSON.parse(localStorage.getItem(this.KEY) || '{}'); }
    catch (err) { throw new Error('The brief extras settings could not be read', { cause: err }); }
    return (s && typeof s === 'object' && !Array.isArray(s)) ? s : {};
  },

  // Throws on a value that is not allowed, instead of storing something the
  // sections would silently ignore.
  set(patch) {
    const cur = this.get();
    for (const t of this.TOGGLES) {
      if (!(t.key in patch)) continue;
      if (typeof patch[t.key] !== 'boolean') throw new Error(t.label + ' is on or off');
      cur[t.key] = patch[t.key];
    }
    for (const n of this.NUMBERS) {
      if (!(n.key in patch)) continue;
      const v = Number(patch[n.key]);
      if (!Number.isInteger(v) || v < n.min || v > n.max) throw new Error(n.label + ' must be a whole number from ' + n.min + ' to ' + n.max);
      cur[n.key] = v;
    }
    localStorage.setItem(this.KEY, JSON.stringify(cur));
    try { document.dispatchEvent(new CustomEvent('vex:brief-extras-changed')); } catch { /* no document */ }
    return cur;
  },

  value(key) {
    const t = this.TOGGLES.find(x => x.key === key);
    const n = this.NUMBERS.find(x => x.key === key);
    const s = this.get();
    if (t) return t.def ? s[key] !== false : s[key] === true;
    if (n) { const v = Number(s[key]); return Number.isInteger(v) && v >= n.min && v <= n.max ? v : n.def; }
    throw new Error('Unknown brief extras setting: ' + key);
  },

  render(container) {
    if (!container) throw new Error('No place to draw the brief extras settings');
    const esc = (v) => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    container.innerHTML =
      this.TOGGLES.map(t => `<div class="setting-toggle-row"><span>${esc(t.label)}</span><label class="toggle"><input type="checkbox" data-be-toggle="${t.key}" aria-label="${esc(t.label)}" ${this.value(t.key) ? 'checked' : ''}><span class="toggle-slider"></span></label></div><p class="setting-info muted" style="margin:2px 0 10px">${esc(t.hint)}</p>`).join('') +
      this.NUMBERS.map(n => `<label class="setting-toggle-row"><span>${esc(n.label)}</span><input class="set-input" type="number" data-be-number="${n.key}" min="${n.min}" max="${n.max}" value="${this.value(n.key)}" style="width:80px"></label>`).join('') +
      `<div style="margin-top:10px"><button type="button" class="btn-secondary" data-be-reset>Show features I chose never to see again</button></div>`;
    container.querySelectorAll('[data-be-toggle]').forEach(el => el.addEventListener('change', () => {
      try { this.set({ [el.dataset.beToggle]: el.checked }); }
      catch (err) { el.checked = !el.checked; window.showToast?.(err.message, 'error'); }
    }));
    container.querySelectorAll('[data-be-number]').forEach(el => el.addEventListener('change', () => {
      try { this.set({ [el.dataset.beNumber]: el.value }); }
      catch (err) { el.value = this.value(el.dataset.beNumber); window.showToast?.(err.message, 'error'); }
    }));
    container.querySelector('[data-be-reset]').addEventListener('click', () => {
      if (typeof VexBriefOneNew === 'undefined') { window.showToast?.('The daily suggestion is not loaded', 'error'); return; }
      VexBriefOneNew.resetNever();
      window.showToast?.('Those features can be suggested again');
    });
  },
};

if (typeof window !== 'undefined') window.VexBriefExtrasSettings = VexBriefExtrasSettings;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexBriefExtrasSettings };
