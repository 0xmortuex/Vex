// === The channels you follow ===============================================
//
// Twitch and YouTube both have a notification system, and both spend it on
// telling you about things you did not ask for. This is the small version:
// the handful of channels you actually want to know about, checked quietly,
// and one desktop notification when one of them goes live.
//
// It says something once per stream — when a channel goes from off to on —
// and not again until it goes off and comes back. A channel that could not be
// checked is left alone rather than counted as off, so a bad connection never
// makes Vex announce the same stream twice.
const LiveChannels = {
  KEY: 'vex.liveChannels',
  STATE_KEY: 'vex.liveChannelsState',
  MAX: 30,
  EVERY_MS: 10 * 60 * 1000,

  list() { try { const a = JSON.parse(localStorage.getItem(this.KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } },
  save(list) { try { localStorage.setItem(this.KEY, JSON.stringify(list.slice(0, this.MAX))); } catch {} },

  // "twitch.tv/lofigirl", "youtube.com/@NASA", "@NASA", "lofigirl" — whatever
  // was pasted, turned into a channel to follow.
  parse(text) {
    const s = String(text || '').trim();
    if (!s) throw new Error('Paste the channel’s address or its name');
    const twitch = s.match(/twitch\.tv\/([A-Za-z0-9_]{3,40})/i);
    if (twitch) return { kind: 'twitch', name: twitch[1] };
    const yt = s.match(/youtube\.com\/@([A-Za-z0-9._-]{2,40})/i);
    if (yt) return { kind: 'youtube', name: yt[1] };
    if (/^@[A-Za-z0-9._-]{2,40}$/.test(s)) return { kind: 'youtube', name: s.slice(1) };
    if (/^[A-Za-z0-9_]{3,40}$/.test(s)) return { kind: 'twitch', name: s };
    throw new Error('That is not a Twitch or YouTube channel');
  },

  add(text) {
    const channel = this.parse(text);
    const list = this.list();
    if (list.some(c => c.kind === channel.kind && c.name.toLowerCase() === channel.name.toLowerCase())) {
      throw new Error('You already follow that one');
    }
    if (list.length >= this.MAX) throw new Error('That is as many as Vex will watch at once');
    list.push(channel);
    this.save(list);
    return channel;
  },

  remove(kind, name) {
    this.save(this.list().filter(c => !(c.kind === kind && c.name.toLowerCase() === String(name).toLowerCase())));
  },

  // Who was live last time, so only a change is worth saying out loud.
  _state() { try { const o = JSON.parse(localStorage.getItem(this.STATE_KEY) || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; } },
  _saveState(state) { try { localStorage.setItem(this.STATE_KEY, JSON.stringify(state)); } catch {} },

  key(status) { return status.kind + '::' + String(status.name).toLowerCase(); },

  // Which of these just went live: on now, off (or unknown) before. A status
  // that could not be read changes nothing.
  wentLive(statuses, before = this._state()) {
    return (statuses || []).filter(s => s.live === true && !before[this.key(s)]);
  },

  _remember(statuses) {
    const state = this._state();
    for (const s of statuses || []) {
      if (s.live === null || s.live === undefined) continue;     // could not ask
      if (s.live) state[this.key(s)] = true; else delete state[this.key(s)];
    }
    this._saveState(state);
    return state;
  },

  async check({ quiet = false } = {}) {
    const following = this.list();
    if (!following.length) return [];
    const res = await window.vex.liveCheck(following);
    if (!res || !res.ok) throw new Error((res && res.error) || 'Could not check the channels');
    const statuses = res.statuses || [];
    const fresh = this.wentLive(statuses);
    this._remember(statuses);
    if (!quiet && fresh.length) {
      const first = fresh[0];
      const rest = fresh.length > 1 ? ' (and ' + (fresh.length - 1) + ' more)' : '';
      window.vex.notify?.(first.name + ' is live', (first.title || 'on ' + (first.kind === 'twitch' ? 'Twitch' : 'YouTube')) + rest)
        .catch(err => window.VexProblems?.note('Live channels', 'Could not show the notification', err));
    }
    return statuses;
  },

  // --- the list ------------------------------------------------------------

  async open() {
    document.querySelector('.vex-live-overlay')?.remove();
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const overlay = document.createElement('div');
    overlay.className = 'vex-live-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.38);display:grid;place-items:start center;padding-top:10vh';
    overlay.innerHTML = `
      <div role="dialog" aria-modal="true" aria-label="Channels"
           style="width:min(560px,92vw);max-height:72vh;display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--border);border-radius:12px;box-shadow:0 18px 50px var(--vex-shadow-color,rgba(0,0,0,0.45));overflow:hidden">
        <div style="display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border)">
          <div style="flex:1;font-size:13.5px;font-weight:650;color:var(--text)">Channels</div>
          <button data-add type="button" style="font-size:11.5px;color:var(--text-muted);background:none;border:1px solid var(--border);border-radius:6px;padding:3px 8px;cursor:pointer">Follow one</button>
        </div>
        <div data-list style="overflow-y:auto;padding:6px;flex:1"></div>
        <div style="padding:8px 14px;border-top:1px solid var(--border);font-size:11px;color:var(--text-muted)">
          Read from each channel's own public page — no account, no API key. Vex says something once when one goes live.
        </div>
      </div>`;

    const listEl = overlay.querySelector('[data-list]');
    const draw = async () => {
      const following = this.list();
      if (!following.length) {
        listEl.innerHTML = '<div style="padding:22px;text-align:center;font-size:12.5px;color:var(--text-muted)">Follow a channel and Vex will tell you when it goes live.</div>';
        return;
      }
      listEl.innerHTML = '<div style="padding:22px;text-align:center;font-size:12.5px;color:var(--text-muted)">Asking…</div>';
      let statuses;
      try { statuses = await this.check({ quiet: true }); }
      catch (err) { listEl.innerHTML = `<div style="padding:22px;text-align:center;font-size:12.5px;color:var(--text-muted)">${esc(err.message)}</div>`; return; }
      statuses.sort((a, b) => (b.live === true ? 1 : 0) - (a.live === true ? 1 : 0) || a.name.localeCompare(b.name));
      listEl.innerHTML = '';
      for (const s of statuses) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:9px;padding:8px 9px;border-radius:8px';
        const state = s.live === null ? 'could not ask' : s.live ? (s.title || 'live now') : 'not live';
        row.innerHTML = `
          <span style="width:8px;height:8px;border-radius:50%;background:${s.live ? 'var(--danger,#ef4444)' : 'var(--border)'}"></span>
          <div style="flex:1;min-width:0">
            <div style="font-size:12.5px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.name)} <span style="font-size:10px;color:var(--text-muted)">${esc(s.kind === 'twitch' ? 'Twitch' : 'YouTube')}</span></div>
            <div style="font-size:10.5px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(state)}${s.viewers ? ' · ' + s.viewers.toLocaleString() + ' watching' : ''}</div>
          </div>
          ${s.live ? `<button data-corner type="button" title="Watch in a small window on top of everything"
                  style="font-size:11px;color:var(--text-muted);background:none;border:1px solid var(--border);border-radius:6px;padding:2px 7px;cursor:pointer">In the corner</button>
          <button data-open type="button" style="font-size:11px;color:var(--primary);background:none;border:1px solid var(--primary);border-radius:6px;padding:2px 7px;cursor:pointer">Watch</button>` : ''}
          <button data-drop type="button" title="Stop following" style="background:none;border:none;color:var(--text-muted);cursor:pointer;padding:3px">${window.VexIcons ? VexIcons.svg('x', { size: 13 }) : 'x'}</button>`;
        row.querySelector('[data-open]')?.addEventListener('click', () => { overlay.remove(); TabManager.createTab(s.url, true); });
        row.querySelector('[data-corner]')?.addEventListener('click', () => {
          overlay.remove();
          window.vex.overlayOpen?.(s.url, 0.95).catch(err => window.showToast?.(err.message, 'error'));
        });
        row.querySelector('[data-drop]').addEventListener('click', () => { this.remove(s.kind, s.name); draw(); });
        listEl.appendChild(row);
      }
    };

    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('[data-add]').addEventListener('click', async () => {
      const text = await window.vexPrompt({ title: 'Follow a channel', message: 'Paste the channel’s address, or just its name.', label: 'Twitch or YouTube channel', okLabel: 'Follow' });
      if (!text) return;
      try { this.add(text); await draw(); }
      catch (err) { window.showToast?.(err.message, 'error'); }
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    await draw();
    return overlay;
  },

  init() {
    if (typeof VexJobs === 'undefined') return this;
    VexJobs.every('live-channels', this.EVERY_MS, () => {
      if (!this.list().length) return;
      this.check().catch(err => window.VexProblems?.note('Live channels', 'Could not check who is live', err));
    }, { when: 'background' });
    return this;
  },
};

if (typeof window !== 'undefined') window.LiveChannels = LiveChannels;
if (typeof module !== 'undefined' && module.exports) module.exports = { LiveChannels };
