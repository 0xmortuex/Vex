// === The download desk, in the window (T3-032, T3-073, T3-119) =================
//
// The three helpers that live in src/main/download-desk.js, drawn:
//
//   Release assistant   When a file finishes that came from a GitHub release (github.com/<owner>/<repo>/
//                       releases/download/...), a card shows the repository, the version, the size and the
//                       SHA-256, with "Check on VirusTotal" (opens the page for that hash; nothing is
//                       uploaded), "Copy SHA-256", and, when older installers of the same repository are
//                       still in the folder, "Remove N older" (to the Recycle Bin, after a confirm).
//   Mod desk            Ctrl+K › Sort Minecraft mods: previews where each .jar in the downloads folder would
//                       go ("Minecraft mods/Fabric 1.20.1"), flags older copies of the same mod, and moves
//                       them only after you confirm. Undo puts every file back.
//   Real file names     A switch (off until chosen): images and videos saved from a site get the site, the
//                       page title and the date as their name instead of a counter.
//
// The card is a notice about something you just did, so it goes through the Attention Budget as
// "useful": when the budget is full it waits in the Attention Inbox instead of appearing.

const VexDownloadDesk = {
  PREF: 'vex.downloadDesk',            // 'off' hides the release card and the Ctrl+K command
  FEATURE: 'download-desk',

  enabled() { try { return localStorage.getItem(this.PREF) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    try { localStorage.setItem(this.PREF, on ? 'on' : 'off'); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message); }
    return !!on;
  },

  _bytes(n) {
    if (!n || n <= 0) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
    return parseFloat((n / Math.pow(1024, i)).toFixed(1)) + ' ' + u[i];
  },

  // ---- release assistant -------------------------------------------------------------------
  async onComplete(data) {
    if (!this.enabled() || !data || data.state !== 'completed' || !data.release || !data.path || data.ephemeral) return null;
    const bridge = window.vex;
    if (!bridge || typeof bridge.downloadsReleaseAssist !== 'function') throw new Error('The release assistant is not available in this window');
    const info = await bridge.downloadsReleaseAssist(data.path);
    if (!info || !info.ok) throw new Error((info && info.error) || 'Could not check the release download');
    const title = info.release.owner + '/' + info.release.repo + ' ' + info.release.tag;
    const body = info.name + ', ' + this._bytes(info.sizeBytes) + '. SHA-256 ' + info.sha256.slice(0, 16) + '…';
    const show = () => this.card(data.path, info);
    if (typeof VexAttention !== 'undefined') {
      const d = VexAttention.request({ feature: this.FEATURE, urgency: 'useful', id: data.path, title: 'Release download: ' + title, body });
      if (d.route === 'toast') show();
    } else show();
    if (typeof VexUsage !== 'undefined') VexUsage.touch('download-desk');
    return info;
  },

  card(filePath, info) {
    const container = typeof DownloadToast !== 'undefined' ? DownloadToast._container() : document.body;
    const el = document.createElement('div');
    el.className = 'download-toast';
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', 'Release download ' + info.release.owner + '/' + info.release.repo);
    const infoBox = document.createElement('div');
    infoBox.className = 'download-toast-info';
    const t1 = document.createElement('div');
    t1.className = 'download-toast-filename';
    t1.textContent = info.release.owner + '/' + info.release.repo + ' ' + info.release.tag;
    const t2 = document.createElement('div');
    t2.className = 'download-toast-size';
    t2.textContent = info.name + ' · ' + this._bytes(info.sizeBytes) + ' · SHA-256 ' + info.sha256.slice(0, 12) + '…';
    infoBox.append(t1, t2);
    const actions = document.createElement('div');
    actions.className = 'download-toast-actions';
    const btn = (text, fn, label) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      if (label) b.setAttribute('aria-label', label);
      b.addEventListener('click', () => { Promise.resolve().then(fn).catch(err => window.showToast?.(err.message, 'error')); });
      actions.appendChild(b);
      return b;
    };
    btn('VirusTotal', () => {
      TabManager.createTab(info.virusTotal, true);
      window.showToast?.('Only the file\'s hash was used. If VirusTotal says "Item not found", nobody has scanned this exact file yet.', 'info', 9000);
    }, 'Check the hash on VirusTotal. The file is not uploaded.');
    btn('Copy hash', async () => { await navigator.clipboard.writeText(info.sha256); window.showToast?.('SHA-256 copied'); }, 'Copy the SHA-256');
    if (info.older.length) {
      btn('Remove ' + info.older.length + ' older', async () => {
        const list = info.older.map(o => o.name + ' (' + o.tag + ', ' + this._bytes(o.sizeBytes) + ')').join('\n');
        const ok = await window.vexConfirm({ title: 'Remove older installers of ' + info.release.repo + '?', message: 'These go to the Recycle Bin; the newest (' + info.name + ') stays.\n\n' + list, okLabel: 'Move to Recycle Bin' });
        if (!ok) return;
        const failed = [];
        for (const o of info.older) {
          const r = await window.vex.downloadsDeleteFile(o.path);
          if (!r || !r.ok) failed.push(o.name + ': ' + ((r && r.error) || 'failed'));
        }
        if (failed.length) throw new Error('Some could not be removed: ' + failed.join('; '));
        window.showToast?.('Moved ' + info.older.length + ' older installer' + VexPlural.s(info.older.length) + ' to the Recycle Bin');
        el.remove();
      }, 'Move the older installers of this repository to the Recycle Bin');
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'download-toast-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.innerHTML = typeof VexIcons !== 'undefined' ? VexIcons.svg('x', { size: 12 }) : '';
    close.addEventListener('click', () => el.remove());
    actions.appendChild(close);
    el.append(infoBox, actions);
    container.appendChild(el);
    return el;
  },

  // ---- mod desk -----------------------------------------------------------------------------------
  async sortMods() {
    if (!this.enabled()) { window.showToast?.('The download desk is switched off in Settings', 'info'); return null; }
    const bridge = window.vex;
    if (!bridge || typeof bridge.downloadsModsPlan !== 'function') throw new Error('The mod desk is not available in this window');
    const p = await bridge.downloadsModsPlan();
    if (!p || !p.ok) throw new Error((p && p.error) || 'Could not preview the mod folders');
    if (!p.moves.length) {
      window.showToast?.('No Minecraft mods (.jar) loose in the downloads folder' + (p.skipped.length ? ' (' + p.skipped.length + ' file' + VexPlural.s(p.skipped.length) + ' were not mods or could not be read)' : ''));
      return p;
    }
    const lines = p.moves.slice(0, 14).map(m => m.name + '  ->  ' + m.folder + (m.older ? '   (older than ' + m.newer + ')' : '') + (m.unknownVersion ? '   (game version not found)' : ''));
    const more = p.moves.length > 14 ? '\n... and ' + (p.moves.length - 14) + ' more' : '';
    const older = p.moves.filter(m => m.older).length;
    const skipped = p.skipped.length ? '\n\nLeft alone: ' + p.skipped.slice(0, 4).map(s => s.name + ' (' + s.why + ')').join('; ') + (p.skipped.length > 4 ? '; ...' : '') : '';
    const ok = await window.vexConfirm({
      title: 'File ' + p.moves.length + ' mod' + VexPlural.s(p.moves.length) + ' by loader and version?',
      message: (older ? older + ' older cop' + (older === 1 ? 'y' : 'ies') + ' of a mod you also have a newer file of go to "Older versions". ' : '') + 'Files move inside ' + p.dir + '. Nothing is deleted or run, and Undo puts every file back.\n\n' + lines.join('\n') + more + skipped,
      okLabel: 'Move them',
    });
    if (!ok) return p;
    const r = await bridge.downloadsModsApply(p.id);
    if (!r || !r.ok) throw new Error((r && r.error) || 'Could not move the mods');
    window.showToast?.('Moved ' + r.moved + ' mod' + VexPlural.s(r.moved) + (r.failed.length ? ', ' + r.failed.length + ' could not be moved' : '') + '. Undo: Ctrl+K › Undo mod sort', r.failed.length ? 'error' : undefined, 8000);
    if (r.moved && typeof VexLedger !== 'undefined') {
      VexLedger.note({ feature: this.FEATURE, what: 'Filed ' + r.moved + ' Minecraft mod' + VexPlural.s(r.moved) + ' by loader and version', why: 'You confirmed the preview', undo: { kind: 'downloads-mods-undo' } });
    }
    if (typeof VexUsage !== 'undefined') VexUsage.touch('download-desk');
    if (typeof DownloadsPanel !== 'undefined' && typeof DownloadsPanel.refreshExistence === 'function') DownloadsPanel.refreshExistence();
    return r;
  },

  async undoMods() {
    const ok = await window.vexConfirm({ title: 'Undo the last mod sort?', message: 'Every mod it moved goes back to where it was.', okLabel: 'Put them back' });
    if (!ok) return null;
    const r = await window.vex.downloadsModsUndo();
    if (!r || !r.ok) throw new Error((r && r.error) || 'Could not undo');
    window.showToast?.('Put ' + r.restored + ' file' + VexPlural.s(r.restored) + ' back' + (r.left.length ? '; ' + r.left.length + ' could not be (' + r.left[0].error + ')' : ''), r.left.length ? 'error' : undefined);
    return r;
  },

  // ---- wiring ----------------------------------------------------------------------------------------
  init() {
    if (this._wired) return true;
    this._wired = true;
    if (typeof VexLedger !== 'undefined') {
      // Main undoes the LAST batch, so only the newest one still on the list can be undone from here.
      VexLedger.registerUndo('downloads-mods-undo', async (_token, entry) => {
        const newer = VexLedger.list(200).find(e => e.undo && e.undo.kind === 'downloads-mods-undo' && !e.undone && e.id > entry.id);
        if (newer) throw new Error('A later mod sort came after this one; undo that one first');
        const r = await window.vex.downloadsModsUndo();
        if (!r || !r.ok) throw new Error((r && r.error) || 'Could not put the mods back');
        if (r.left && r.left.length) window.showToast?.(r.left.length + ' file(s) could not be put back (' + r.left[0].error + ')', 'error');
      });
    }
    if (window.vex && typeof window.vex.onDownloadComplete === 'function') {
      window.vex.onDownloadComplete((data) => {
        this.onComplete(data).catch(err => { if (typeof VexProblems !== 'undefined') VexProblems.note('Download desk', 'Could not check a release download', err); else throw err; });
      });
    }
    return true;
  },

  async group(host) {
    const el = document.createElement('div');
    host.appendChild(el);
    el.appendChild(VexSettingsGroups.note('GitHub release downloads get a card with the repository, the SHA-256, a VirusTotal link that sends only the hash (never the file), and a way to remove older installers of the same repository. Ctrl+K › Sort Minecraft mods files .jar mods by loader and game version, with a preview and Undo.'));
    el.appendChild(VexSettingsGroups.button('Sort Minecraft mods', () => { this.sortMods().catch(err => window.showToast?.(err.message, 'error')); }, { primary: true }));
    el.appendChild(VexSettingsGroups.button('Undo the last mod sort', () => { this.undoMods().catch(err => window.showToast?.(err.message, 'error')); }));
    const row = document.createElement('div');
    row.className = 'setting-toggle-row';
    const lab = document.createElement('label');
    lab.textContent = 'Give saved images and videos a real name (site, page title, date)';
    const box = document.createElement('input');
    box.type = 'checkbox'; box.id = 'download-media-names';
    lab.htmlFor = box.id;
    box.disabled = true;
    row.append(lab, box);
    el.appendChild(row);
    try {
      const prefs = await window.vex.downloadsPrefs();
      box.checked = !!(prefs && prefs.mediaNames);
      box.disabled = false;
    } catch (err) { el.appendChild(VexSettingsGroups.note('Could not read the downloads settings: ' + err.message)); }
    box.addEventListener('change', async () => {
      const want = box.checked;
      const r = await window.vex.downloadsSetMediaNames(want);
      if (!r || !r.ok) { box.checked = !want; window.showToast?.((r && r.error) || 'Could not save that', 'error'); }
    });
  },
};

if (typeof window !== 'undefined') {
  window.VexDownloadDesk = VexDownloadDesk;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'download-desk', title: 'Download desk', keywords: 'download release github sha256 virustotal minecraft mods jar fabric forge modrinth file name image video older installer', before: 'about', build: (el) => { VexDownloadDesk.group(el); } });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'mods-sort', label: 'Sort Minecraft mods', hint: 'File .jar mods in Downloads by loader and game version, with a preview and Undo', icon: 'folder', action: () => { VexDownloadDesk.sortMods().catch(err => window.showToast?.(err.message, 'error')); } });
    VexExtras.registerCommand({ id: 'mods-sort-undo', label: 'Undo mod sort', hint: 'Put the last sorted mods back where they were', icon: 'folder-open', action: () => { VexDownloadDesk.undoMods().catch(err => window.showToast?.(err.message, 'error')); } });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexDownloadDesk };
