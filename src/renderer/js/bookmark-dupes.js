// === Duplicate bookmarks ========================================================
//
// Ctrl+K "Find Duplicate Bookmarks": the bookmarks that point at the same page, listed together so you can merge or remove them.
// Two bookmarks are the same page when their addresses are equal after three harmless differences are ignored: a fragment
// (#section), a trailing slash on the path, and utm_* tracking parameters. Anything else (http against https, another query
// parameter, another path) is a different page and is never offered.
//
// Nothing is changed until you press a button, and both buttons go through the bookmark list's own removal (js/bookmarks.js
// remove), so one toast with Undo brings every removed bookmark back where it was. Merge keeps the bookmark saved first (one
// that sits in a folder wins a tie) and removes the other copies of that page; Remove selected removes exactly the ticked ones.
// Nothing is read from a page and nothing leaves this computer. A bookmark without an id (very old data) is left alone.
//
//   VexBookmarkDupes.normalize(url)     pure: the address two bookmarks are compared by
//   VexBookmarkDupes.groups(items)      pure: [{ key, keep, items }] for pages saved more than once
//   VexBookmarkDupes.mergeIds(groups)   pure: the ids Merge would remove
const VexBookmarkDupes = {
  _t(text) { return (typeof VexI18nUI !== 'undefined' && VexI18nUI.lookup(text)) || text; },

  normalize(url) {
    let u;
    try { u = new URL(String(url == null ? '' : url).trim()); } catch { return ''; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    const keep = [];
    for (const [k, v] of u.searchParams) if (!/^utm_/i.test(k)) keep.push([k, v]);
    const search = keep.length ? '?' + keep.map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&') : '';
    let path = u.pathname;
    if (path.length > 1) path = path.replace(/\/+$/, '');
    return u.protocol + '//' + u.host + path + search;
  },

  // The bookmark to keep out of a group: saved first; one in a folder beats one without when they were saved together.
  _pickKeeper(list) {
    const folder = (b) => (String(b.folder || '').trim() ? 1 : 0);
    return list.slice().sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0) || folder(b) - folder(a))[0];
  },

  groups(items) {
    const by = new Map();
    for (const b of Array.isArray(items) ? items : []) {
      if (!b || typeof b.id !== 'string' || !b.id) continue;
      const key = this.normalize(b.url);
      if (!key) continue;
      if (!by.has(key)) by.set(key, []);
      by.get(key).push(b);
    }
    const out = [];
    for (const [key, list] of by) if (list.length > 1) out.push({ key, keep: this._pickKeeper(list), items: list });
    return out.sort((a, b) => b.items.length - a.items.length || (a.key < b.key ? -1 : 1));
  },

  mergeIds(groups) {
    const ids = [];
    for (const g of groups) for (const b of g.items) if (b.id !== g.keep.id) ids.push(b.id);
    return ids;
  },

  // Removes bookmarks by id through the bookmark list (one toast with Undo). -> how many were removed
  removeIds(ids) {
    if (typeof Bookmarks === 'undefined' || typeof Bookmarks.remove !== 'function') throw new Error('Bookmarks are not available');
    const set = new Set(ids);
    if (!set.size) return 0;
    return Bookmarks.remove(b => b && set.has(b.id));
  },

  open() {
    if (typeof Bookmarks === 'undefined') throw new Error('Bookmarks are not available');
    if (typeof VexSettingsGroups === 'undefined') throw new Error('Settings dialogs are not available');
    if (typeof VexUsage !== 'undefined') VexUsage.touch('bookmark-dupes');
    const G = VexSettingsGroups;
    const { body } = G.dialog({ id: 'vex-bookmark-dupes', title: 'Duplicate bookmarks', sub: 'The same page saved more than once. Nothing is removed until you press a button.' });
    const fail = (e) => window.showToast?.(e.message, 'error');
    const chosen = new Set();
    const draw = () => {
      body.textContent = '';
      const groups = this.groups(Bookmarks.items);
      for (const id of [...chosen]) if (!groups.some(g => g.items.some(b => b.id === id && b.id !== g.keep.id))) chosen.delete(id);
      if (!groups.length) { body.appendChild(G.note('No duplicate bookmarks.')); return; }
      body.appendChild(G.note('Same page after ignoring #fragments, a trailing slash and utm_ tracking tags. The first one in each group is the one Merge keeps.'));
      for (const g of groups) {
        const box = document.createElement('div');
        box.className = 'vexsr-rule';
        box.style.cssText = 'display:block;margin:8px 0';
        const head = document.createElement('div');
        head.style.fontWeight = '600';
        head.textContent = g.keep.title || g.key;
        box.appendChild(head);
        for (const b of [g.keep, ...g.items.filter(x => x.id !== g.keep.id)]) {
          const row = document.createElement('label');
          row.style.cssText = 'display:flex;gap:8px;align-items:flex-start;margin:3px 0';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          const isKeeper = b.id === g.keep.id;
          cb.disabled = isKeeper;
          cb.checked = chosen.has(b.id);
          cb.setAttribute('aria-label', b.url);
          cb.addEventListener('change', () => { if (cb.checked) chosen.add(b.id); else chosen.delete(b.id); });
          const t = document.createElement('span');
          t.style.cssText = 'flex:1;word-break:break-all';
          t.textContent = b.url + (b.folder ? '  [' + b.folder + ']' : '') + (isKeeper ? '  (' + this._t('kept') + ')' : '');
          row.append(cb, t);
          box.appendChild(row);
        }
        body.appendChild(box);
      }
      const bar = document.createElement('div');
      bar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px';
      bar.append(
        G.button('Merge: keep one of each', () => { try { this.removeIds(this.mergeIds(groups)); chosen.clear(); draw(); } catch (e) { fail(e); } }, { primary: true }),
        G.button('Remove selected', () => { try { if (!chosen.size) { window.showToast?.(this._t('Tick the copies to remove first')); return; } this.removeIds([...chosen]); chosen.clear(); draw(); } catch (e) { fail(e); } }, { danger: true }),
      );
      body.appendChild(bar);
    };
    draw();
  },
};

if (typeof window !== 'undefined') window.VexBookmarkDupes = VexBookmarkDupes;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexBookmarkDupes };
