// === Remember which container a site belongs in ===============================
//
// A site you log into in your Banking container is not the one you meant when a
// link to it lands in the Main session: you are signed out, or worse, you sign
// in to the wrong account. Vex remembers, for each website (the registrable
// domain: bank.com.tr, roblox.com), the last container you used it in, and
// offers it first when you open a link from the clipboard.
//
//   Ctrl+K › Open clipboard link in a container
//        reads the clipboard only when you run it, shows the link, and lists
//        Main / Alt / Roblox / Banking (and any other container you have). The one
//        remembered for that site is highlighted and has the focus; nothing opens
//        until you press a button. A per-site rule (Ctrl+K › Site rules) always wins:
//        the remembered container is not offered for a site that has one.
//   Tab dots and the address-bar badge
//        a coloured dot on a tab in a container and its name beside the address
//        bar, so you see which account you are about to type a password into.
//
// What is kept: the registrable domain and the container, only for sites last
// used in a container; using the site in Main again forgets it. At most 200
// sites, on this computer only, never synced. Private and Tor tabs are never noted.
//
//   VexContainerMemory.registrable(host)        pure
//   VexContainerMemory.suggest(url)             the container remembered for that site, or null

const VexContainerMemory = {
  KEY: 'vex.containerMemory',
  PREF: 'vex.containerMemory.enabled',   // 'off': nothing is noted, offered or drawn
  MAX: 200,
  MAIN: 'persist:main',
  SECOND_LEVEL: new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'or', 'ne', 'go', 'gen', 'biz', 'info', 'k12', 'av', 'bel', 'pol', 'tsk', 'dr', 'web', 'name', 'mil']),
  COLORS: ['#5b8def', '#e8a33d', '#3fb68b', '#d9534f', '#9b6fe0', '#2aa5b8'],
  DEFAULT_PRESETS: [
    { id: 'main', name: 'Main', partition: 'persist:main', color: '#5b8def' },
    { id: 'alt', name: 'Alt', partition: 'persist:container-alt', color: '#e8a33d' },
    { id: 'roblox', name: 'Roblox', partition: 'persist:container-roblox', color: '#3fb68b' },
    { id: 'banking', name: 'Banking', partition: 'persist:container-banking', color: '#d9534f' },
  ],

  enabled() { try { return localStorage.getItem(this.PREF) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    try { localStorage.setItem(this.PREF, on ? 'on' : 'off'); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message); }
    if (on) this.decorate(); else this._clearDecor();
    return !!on;
  },

  // ---- pure ------------------------------------------------------------------------------
  registrable(host) {
    const h = String(host == null ? '' : host).toLowerCase().replace(/\.$/, '');
    if (!h || h === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':') || !h.includes('.')) return '';
    const labels = h.split('.');
    if (labels.length <= 2) return h;
    const tld = labels[labels.length - 1], sld = labels[labels.length - 2];
    return labels.slice(tld.length === 2 && this.SECOND_LEVEL.has(sld) ? -3 : -2).join('.');
  },
  domainOf(url) {
    try { const u = new URL(String(url)); return /^https?:$/.test(u.protocol) ? this.registrable(u.hostname) : ''; } catch { return ''; }
  },
  isContainer(partition) { return /^persist:container-[a-z0-9-]{1,40}$/.test(String(partition || '')); },
  isNotable(partition) { return !partition || partition === this.MAIN || this.isContainer(partition); },

  // ---- storage -----------------------------------------------------------------------------
  state() {
    const raw = localStorage.getItem(this.KEY);
    if (raw == null) return { v: 1, last: {}, presets: this.DEFAULT_PRESETS.map(p => ({ ...p })) };
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('Your container memory could not be read: ' + err.message); }
    if (!v || v.v !== 1 || typeof v.last !== 'object' || !Array.isArray(v.presets)) throw new Error('Your container memory is in a shape this version does not know');
    return v;
  },
  _save(st) {
    try { localStorage.setItem(this.KEY, JSON.stringify(st)); }
    catch (err) { throw new Error('Your container memory could not be saved: ' + err.message); }
  },
  presets() { return this.state().presets; },
  // All the containers the person can pick: the presets, then any other container with a tab open.
  choices() {
    const st = this.state();
    const out = st.presets.map(p => ({ ...p }));
    const seen = new Set(out.map(p => p.partition));
    if (typeof TabManager !== 'undefined') {
      for (const t of TabManager.tabs) {
        if (this.isContainer(t.partition) && !seen.has(t.partition)) { seen.add(t.partition); out.push({ id: t.partition, name: t.partition.slice('persist:container-'.length), partition: t.partition, color: '#8a8f98' }); }
      }
    }
    return out;
  },
  presetFor(partition, st = this.state()) {
    return st.presets.find(p => p.partition === (partition || this.MAIN)) || null;
  },
  addPreset({ name, color }) {
    const st = this.state();
    const n = String(name == null ? '' : name).trim();
    if (!n || n.length > 30) throw new Error('Name the container in 1 to 30 characters');
    const slug = n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    if (!slug) throw new Error('Use letters or digits in the name');
    const partition = 'persist:container-' + slug;
    if (st.presets.some(p => p.partition === partition)) throw new Error('A container called "' + slug + '" is already on the list');
    if (st.presets.length >= 12) throw new Error('That is 12 containers; remove one first');
    const c = this.COLORS.includes(color) ? color : this.COLORS[st.presets.length % this.COLORS.length];
    st.presets.push({ id: slug, name: n, partition, color: c });
    this._save(st);
    return st;
  },
  removePreset(partition) {
    const st = this.state();
    if (partition === this.MAIN) throw new Error('Main is the ordinary session and stays on the list');
    if (!st.presets.some(p => p.partition === partition)) throw new Error('That container is not on the list');
    st.presets = st.presets.filter(p => p.partition !== partition);
    this._save(st);
    return st;
  },

  // ---- noting and suggesting ----------------------------------------------------------------
  note(url, partition) {
    if (!this.enabled() || !this.isNotable(partition)) return false;
    const d = this.domainOf(url);
    if (!d) return false;
    const st = this.state();
    const p = partition || this.MAIN;
    if (p === this.MAIN) {
      if (!(d in st.last)) return false;
      delete st.last[d];
    } else {
      if (st.last[d] === p) return false;
      delete st.last[d];
      st.last[d] = p;           // newest last, so the oldest is dropped first
      const keys = Object.keys(st.last);
      for (const k of keys.slice(0, Math.max(0, keys.length - this.MAX))) delete st.last[k];
    }
    this._save(st);
    return true;
  },
  suggest(url) {
    if (!this.enabled()) return null;
    if (typeof SiteRoutes !== 'undefined' && typeof SiteRoutes.match === 'function' && SiteRoutes.match(url)) return null;
    const d = this.domainOf(url);
    return d ? (this.state().last[d] || null) : null;
  },
  forget() { const st = this.state(); st.last = {}; this._save(st); },
  known() { return Object.entries(this.state().last).map(([domain, partition]) => ({ domain, partition })); },

  // ---- opening a clipboard link ----------------------------------------------------------------
  async fromClipboard() {
    if (!this.enabled()) { window.showToast?.('Container memory is switched off in Settings', 'info'); return; }
    let text;
    try { text = String(await navigator.clipboard.readText()).trim(); }
    catch (err) { throw new Error('The clipboard could not be read: ' + err.message); }
    let u;
    try { u = new URL(text); } catch { throw new Error('The clipboard does not hold a web address'); }
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) throw new Error('The clipboard does not hold a plain web address');
    this.chooser(u.href);
  },
  chooser(href) {
    const u = new URL(href);
    const remembered = this.suggest(href);
    const ruled = typeof SiteRoutes !== 'undefined' && typeof SiteRoutes.match === 'function' ? SiteRoutes.match(href) : null;
    const { body, close } = VexSettingsGroups.dialog({ id: 'vex-container-choose', title: 'Open ' + u.host, sub: ruled ? 'A site rule decides where this site opens, so it goes by that rule.' : (remembered ? 'You last used this site in the highlighted container.' : 'Pick where to open it. Nothing opens until you press one.') });
    const link = document.createElement('div');
    link.className = 'vexsr-host'; link.style.cssText = 'word-break:break-all;margin-bottom:8px';
    link.textContent = href.length > 200 ? href.slice(0, 200) + '…' : href;
    body.appendChild(link);
    if (ruled) {
      body.appendChild(VexSettingsGroups.button('Open by the site rule', () => { close(); TabManager.createTab(href, true); }, { primary: true }));
      return;
    }
    let first = null;
    for (const c of this.choices()) {
      const isMemo = c.partition === remembered;
      const b = VexSettingsGroups.button(c.name + (isMemo ? '  (last used here)' : ''), () => {
        close();
        if (typeof TabManager === 'undefined') { window.showToast?.('Tabs are not loaded', 'error'); return; }
        TabManager.createTab(href, true, null, c.partition === this.MAIN ? undefined : { partition: c.partition });
      }, { primary: isMemo, label: 'Open in ' + c.name });
      b.style.borderLeft = '6px solid ' + c.color;
      body.appendChild(b);
      if (isMemo) first = b;
    }
    (first || body.querySelector('button.btn-secondary, button.btn-primary'))?.focus();
  },

  // ---- the dots and the badge ------------------------------------------------------------------------
  _clearDecor() {
    document.querySelectorAll('.vex-cm-dot').forEach(e => e.remove());
    document.getElementById('vex-cm-badge')?.remove();
  },
  decorate() {
    if (typeof document === 'undefined' || typeof TabManager === 'undefined') return;
    if (!this.enabled()) { this._clearDecor(); return; }
    let st;
    try { st = this.state(); } catch (err) { window.VexProblems?.note('Container memory', 'Could not read the container list for the tab dots', err); return; }
    const label = (partition) => {
      const p = this.presetFor(partition, st);
      return p ? { name: p.name, color: p.color } : { name: partition.slice('persist:container-'.length), color: '#8a8f98' };
    };
    for (const el of document.querySelectorAll('.tab-item[data-tab-id]')) {
      const tab = TabManager.tabs.find(t => t.id === el.dataset.tabId);
      const has = el.querySelector(':scope > .vex-cm-dot');
      if (!tab || !this.isContainer(tab.partition)) { has?.remove(); continue; }
      const l = label(tab.partition);
      let dot = has;
      if (!dot) {
        dot = document.createElement('span');
        dot.className = 'vex-cm-dot';
        dot.setAttribute('aria-hidden', 'true');
        dot.style.cssText = 'flex:none;width:8px;height:8px;border-radius:50%;margin:0 4px';
        el.insertBefore(dot, el.firstChild);
      }
      dot.style.background = l.color;
      dot.title = 'Container: ' + l.name;
    }
    const active = TabManager.getActiveTab?.();
    const bar = document.getElementById('url-bar');
    let badge = document.getElementById('vex-cm-badge');
    if (!active || !this.isContainer(active.partition) || !bar) { badge?.remove(); return; }
    const l = label(active.partition);
    if (!badge) {
      badge = document.createElement('span');
      badge.id = 'vex-cm-badge';
      badge.style.cssText = 'flex:none;font-size:11px;padding:1px 7px;margin:0 4px;border-radius:9px;border:1px solid;white-space:nowrap';
      const anchor = document.getElementById('url-site-btn');
      if (anchor && anchor.parentElement === bar) anchor.after(badge); else bar.insertBefore(badge, bar.firstChild);
    }
    badge.textContent = l.name;
    badge.style.color = l.color;
    badge.style.borderColor = l.color;
    badge.title = 'This tab is in the ' + l.name + ' container, with its own logins';
  },
  _schedule() {
    if (this._raf) return;
    const run = () => { this._raf = 0; try { this.decorate(); } catch (err) { window.VexProblems?.note('Container memory', 'The tab dots could not be drawn', err); } };
    this._raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : setTimeout(run, 16);
  },

  // ---- the settings ----------------------------------------------------------------------------------
  group(el) {
    el.appendChild(VexSettingsGroups.note('Vex remembers the last container you used each website in and offers it first when you open a link from the clipboard. Tabs in a container get a coloured dot, and the address bar names it. Nothing opens by itself.'));
    el.appendChild(VexSettingsGroups.button('Open the clipboard link in a container', () => { this.fromClipboard().catch(err => window.showToast?.(err.message, 'error')); }, { primary: true }));
    const draw = () => {
      el.querySelectorAll('.vex-cm-list').forEach(e => e.remove());
      const box = document.createElement('div'); box.className = 'vex-cm-list';
      let st; try { st = this.state(); } catch (err) { box.appendChild(VexSettingsGroups.note(err.message)); el.appendChild(box); return; }
      for (const p of st.presets) {
        const row = document.createElement('div'); row.className = 'vexsr-rule';
        const sw = document.createElement('span'); sw.style.cssText = 'width:10px;height:10px;border-radius:50%;flex:none;background:' + p.color; sw.setAttribute('aria-hidden', 'true');
        const t = document.createElement('span'); t.className = 'vexsr-host'; t.textContent = p.name;
        row.append(sw, t);
        if (p.partition !== this.MAIN) row.appendChild(VexSettingsGroups.button('Remove', () => { try { this.removePreset(p.partition); draw(); this.decorate(); } catch (err) { window.showToast?.(err.message, 'error'); } }, { danger: true, label: 'Remove ' + p.name }));
        box.appendChild(row);
      }
      const add = document.createElement('div'); add.className = 'vexsr-rule';
      const nm = Object.assign(document.createElement('input'), { type: 'text', placeholder: 'New container name', maxLength: 30 }); nm.setAttribute('aria-label', 'Container name');
      add.append(nm, VexSettingsGroups.button('Add', () => { try { this.addPreset({ name: nm.value }); draw(); } catch (err) { window.showToast?.(err.message, 'error'); } }));
      box.appendChild(add);
      let n = 0; try { n = this.known().length; } catch (err) { box.appendChild(VexSettingsGroups.note(err.message)); }
      box.appendChild(VexSettingsGroups.note(n + ' site' + (n === 1 ? '' : 's') + ' remembered.'));
      box.appendChild(VexSettingsGroups.button('Forget the remembered sites', async () => {
        const ok = await window.vexConfirm({ title: 'Forget remembered sites', message: 'Vex will stop offering a container first for the sites it remembered. Your containers and logins stay.', okLabel: 'Forget', danger: true });
        if (ok) { try { this.forget(); draw(); } catch (err) { window.showToast?.(err.message, 'error'); } }
      }, { danger: true }));
      el.appendChild(box);
    };
    draw();
  },

  init() {
    if (this._wired) return true;
    this._wired = true;
    document.addEventListener('vex:tab-navigated', (e) => {
      const d = e.detail || {};
      if (d.failed) return;
      const tab = typeof TabManager !== 'undefined' ? TabManager.tabs.find(t => t.id === d.tabId) : null;
      if (tab) {
        try { this.note(d.url, tab.partition); }
        catch (err) { window.VexProblems?.note('Container memory', 'Could not note a container', err); }
      }
      this._schedule();
    });
    for (const ev of ['vex:tab-activated', 'vex:tab-closed']) { document.addEventListener(ev, () => this._schedule()); window.addEventListener(ev, () => this._schedule()); }
    for (const id of ['tabs-list', 'tab-groups-container']) {
      const host = document.getElementById(id);
      if (host && typeof MutationObserver !== 'undefined') new MutationObserver(() => this._schedule()).observe(host, { childList: true, subtree: true });
    }
    this._schedule();
    return true;
  },
};

if (typeof window !== 'undefined') {
  window.VexContainerMemory = VexContainerMemory;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'container-memory', title: 'Containers per site', keywords: 'container preselect remember domain account banking roblox alt main tab dot badge clipboard link', before: 'about', build: (el) => VexContainerMemory.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'container-clipboard', label: 'Open clipboard link in a container', hint: 'Offers the container you last used for that site; opens nothing until you choose', icon: 'archive', action: () => VexContainerMemory.fromClipboard().catch(err => window.showToast?.(err.message, 'error')) });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexContainerMemory };
