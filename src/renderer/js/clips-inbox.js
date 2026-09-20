// === Last night's clips ====================================================
//
// The renderer half of src/main/clips.js. A list of what is in your recordings
// folder, newest first: click one to watch it in a tab, or take its path to
// drop into a chat. Nothing is uploaded — "sharing" here means finding the
// file quickly, because that is the part that is actually annoying.
const ClipsInbox = {
  describe(clip, now = Date.now()) {
    const mins = Math.round((now - clip.at) / 60000);
    const hours = Math.round(mins / 60);
    const days = Math.round(hours / 24);
    const when = mins < 1 ? 'just now'
      : mins === 1 ? 'a minute ago'
        : mins < 60 ? mins + ' minutes ago'
          : hours < 24 ? (hours === 1 ? 'an hour ago' : hours + ' hours ago')
            : days === 1 ? 'yesterday' : days + ' days ago';
    const mb = clip.bytes / (1024 * 1024);
    const size = mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : Math.round(mb) + ' MB';
    return when + ' · ' + size;
  },

  // A recorder's filename is a timestamp held together with underscores.
  // Spaces read better, and the extension says nothing worth the room.
  title(clip) {
    const name = String(clip.name || '').replace(/\.[a-z0-9]+$/i, '');
    return name.replace(/[_-]+/g, ' ').trim() || clip.name;
  },

  async folder(pick) {
    const res = await window.vex.clipsFolder(!!pick);
    if (res && res.cancelled) return res.dir || '';
    if (!res || !res.ok) throw new Error('Could not read the folder');
    return res.dir || '';
  },

  async list(dir) {
    const res = await window.vex.clipsList(dir);
    if (!res || !res.ok) throw new Error((res && res.error) || 'Could not read that folder');
    return res;
  },

  async open() {
    document.querySelector('.vex-clips-overlay')?.remove();
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const overlay = document.createElement('div');
    overlay.className = 'vex-clips-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.4);display:grid;place-items:start center;padding-top:9vh';
    overlay.innerHTML = `
      <div role="dialog" aria-modal="true" aria-label="Clips"
           style="width:min(600px,92vw);max-height:74vh;display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--border);border-radius:12px;box-shadow:0 18px 50px var(--vex-shadow-color,rgba(0,0,0,0.45));overflow:hidden">
        <div style="display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border)">
          <div style="flex:1;min-width:0">
            <div style="font-size:13.5px;font-weight:650;color:var(--text)">Clips</div>
            <div data-dir style="font-size:10.5px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></div>
          </div>
          <button data-pick type="button" style="font-size:11.5px;color:var(--text-muted);background:none;border:1px solid var(--border);border-radius:6px;padding:3px 8px;cursor:pointer">Choose folder</button>
        </div>
        <div data-list style="overflow-y:auto;padding:6px;flex:1"></div>
        <div style="padding:8px 14px;border-top:1px solid var(--border);font-size:11px;color:var(--text-muted)">
          Read from your own folder. Vex does not move, rename or upload anything.
        </div>
      </div>`;

    const listEl = overlay.querySelector('[data-list]');
    const dirEl = overlay.querySelector('[data-dir]');

    const draw = async (pick) => {
      listEl.innerHTML = '<div style="padding:22px;text-align:center;font-size:12.5px;color:var(--text-muted)">Looking…</div>';
      let dir;
      try { dir = await this.folder(pick); } catch (err) { listEl.textContent = err.message; return; }
      if (!dir) {
        dirEl.textContent = '';
        listEl.innerHTML = '<div style="padding:22px;text-align:center;font-size:12.5px;color:var(--text-muted)">Choose the folder your recordings land in — OBS, ShadowPlay, Discord.</div>';
        return;
      }
      dirEl.textContent = dir;
      let res;
      try { res = await this.list(dir); }
      catch (err) { listEl.innerHTML = `<div style="padding:22px;text-align:center;font-size:12.5px;color:var(--text-muted)">${esc(err.message)}</div>`; return; }
      if (!res.clips.length) {
        listEl.innerHTML = '<div style="padding:22px;text-align:center;font-size:12.5px;color:var(--text-muted)">No recordings in that folder yet.</div>';
        return;
      }
      listEl.innerHTML = '';
      for (const clip of res.clips) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:9px;padding:8px 9px;border-radius:8px;cursor:pointer';
        row.addEventListener('mouseenter', () => { row.style.background = 'var(--vex-hover-fill,var(--surface))'; });
        row.addEventListener('mouseleave', () => { row.style.background = ''; });
        row.innerHTML = `
          <div style="flex:1;min-width:0">
            <div style="font-size:12.5px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(this.title(clip))}</div>
            <div style="font-size:10.5px;color:var(--text-muted)">${esc(this.describe(clip))}</div>
          </div>
          <button data-copy type="button" title="Copy the file's path, to paste into a chat"
                  style="font-size:11px;color:var(--text-muted);background:none;border:1px solid var(--border);border-radius:6px;padding:2px 7px;cursor:pointer">Copy path</button>
          <button data-show type="button" title="Show it in the folder, to drag it somewhere"
                  style="font-size:11px;color:var(--text-muted);background:none;border:1px solid var(--border);border-radius:6px;padding:2px 7px;cursor:pointer">Show</button>`;
        row.querySelector('[data-copy]').addEventListener('click', async (e) => {
          e.stopPropagation();
          try { await navigator.clipboard.writeText(clip.path); window.showToast?.('Path copied — paste it into the chat'); }
          catch (err) { window.showToast?.('Could not copy that: ' + err.message, 'error'); }
        });
        row.querySelector('[data-show]').addEventListener('click', (e) => {
          e.stopPropagation();
          window.vex.downloadsShowInFolder(clip.path);
        });
        // Watching it: a tab, so it can be scrubbed, paused and popped out
        // like any other video in Vex.
        row.addEventListener('click', () => {
          overlay.remove();
          TabManager.createTab('file:///' + String(clip.path).replace(/\\/g, '/'), true);
        });
        listEl.appendChild(row);
      }
    };

    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('[data-pick]').addEventListener('click', () => draw(true));
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    await draw(false);
    return overlay;
  },
};

if (typeof window !== 'undefined') window.ClipsInbox = ClipsInbox;
if (typeof module !== 'undefined' && module.exports) module.exports = { ClipsInbox };
