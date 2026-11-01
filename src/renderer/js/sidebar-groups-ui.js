// === Sidebar groups: making, naming and moving them ==========================
// The folders themselves (model, rail, open and closed) are js/sidebar-groups.js. This file is only needed once somebody touches them,
// so it loads after start-up (js/lazy-boot.js):
//   - the menus: right-click a folder (open, rename, description, icon and colour, move, delete), right-click the rail (new group), and
//     a button's menu gets "Move to group" and "Move up / Move down" (the keyboard way of dragging)
//   - the dialog that makes or edits a group (name, description, one of thirteen icons, one of six colours of the theme)
//   - renaming the name under a folder in place
//   - dragging: a folder up or down the rail, a button into a folder or to a place inside one (pointer events, so a mouse and a finger
//     both work; Escape puts it back)
//   - Settings > Sidebar: the list of groups
// Nothing here paints a colour: the folders take theirs from the rail's tokens, a group only names a colour of the theme's palette.
const VexSidebarGroupsUI = (() => {
  const G = () => window.VexSidebarGroups;
  const tr = (s) => (typeof VexI18nUI !== 'undefined' && VexI18nUI.lookup ? (VexI18nUI.lookup(s) || s) : s);
  const toast = (msg, kind) => window.showToast?.(msg, kind);
  const bar = () => document.getElementById('icon-sidebar');
  const COLOR_NAMES = { accent: 'Accent', accent2: 'Accent 2', success: 'Green', warning: 'Amber', danger: 'Red', neutral: 'Neutral' };
  const SWATCH = {
    accent: 'var(--vex-accent)', accent2: 'color-mix(in srgb, var(--vex-accent) 55%, var(--text))',
    success: 'var(--vex-success, var(--success))', warning: 'var(--vex-warning, var(--warning))', danger: 'var(--vex-danger, var(--danger))', neutral: 'var(--text)',
  };

  // Every failure of a change is shown, never swallowed.
  function attempt(fn) {
    try { return fn(); }
    catch (err) { toast(err.message, 'error'); window.VexProblems?.note('Sidebar groups', err.message, err); return undefined; }
  }

  // ---- A menu ----------------------------------------------------------------------------------------------------------
  // The same menu the tab and the sidebar buttons use (.tab-context-menu and TabManager's placing and dismissal).
  function showMenu(e, items, anchor) {
    document.querySelectorAll('.tab-context-menu, .tab-group-context-menu, .context-menu-overlay').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'tab-context-menu';
    menu.setAttribute('role', 'menu');
    let x = e.clientX, y = e.clientY;
    if (anchor && !x && !y) { const r = anchor.getBoundingClientRect(); x = r.right; y = r.top; }   // opened from the keyboard
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    const rows = [];
    for (const item of items) {
      if (item.separator) {
        const sep = document.createElement('div');
        sep.className = 'tab-context-separator';
        sep.setAttribute('role', 'separator');
        sep.style.cssText = 'height:1px;margin:4px 8px;background:var(--border)';
        menu.appendChild(sep);
        continue;
      }
      const el = document.createElement('div');
      el.className = 'tab-context-item' + (item.danger ? ' danger' : '');
      el.setAttribute('role', 'menuitem');
      el.tabIndex = -1;
      el.textContent = item.label;
      if (item.detail) el.title = item.detail;
      el.addEventListener('click', () => {
        if (typeof TabManager !== 'undefined' && TabManager._dismissMenu) TabManager._dismissMenu(menu); else menu.remove();
        item.action();
      });
      menu.appendChild(el);
      rows.push(el);
    }
    // Up, Down, Home, End and Enter, so the menu works without a mouse.
    menu.addEventListener('keydown', (ev) => {
      const i = rows.indexOf(document.activeElement);
      let to = null;
      if (ev.key === 'ArrowDown') to = rows[(i + 1) % rows.length];
      else if (ev.key === 'ArrowUp') to = rows[(i - 1 + rows.length) % rows.length];
      else if (ev.key === 'Home') to = rows[0];
      else if (ev.key === 'End') to = rows[rows.length - 1];
      else if ((ev.key === 'Enter' || ev.key === ' ') && i >= 0) { ev.preventDefault(); rows[i].click(); return; }
      if (to) { ev.preventDefault(); to.focus(); }
    });
    document.body.appendChild(menu);
    if (typeof TabManager !== 'undefined' && TabManager._clampMenuToViewport) TabManager._clampMenuToViewport(menu, x, y);
    if (typeof TabManager !== 'undefined' && TabManager._attachMenuDismissal) TabManager._attachMenuDismissal(menu);
    if (rows[0]) rows[0].focus();
    return menu;
  }

  // ---- The dialog that makes or edits a group --------------------------------------------------------------------------
  // mode: 'create' (name, description, icon, colour), 'edit' (the same, filled in), 'look' (icon and colour only).
  function editor({ mode, group }) {
    const g = G();
    return new Promise((resolve) => {
      const state = {
        name: group ? (group.name || g.fullNameOf(group)) : '',
        desc: group ? (group.desc || (group.base ? g.descOf(group) : '')) : '',
        icon: group ? group.icon : 'folder',
        color: group ? (group.color || 'neutral') : 'neutral',
      };
      const overlay = document.createElement('div');
      overlay.className = 'sbg-overlay';
      overlay.style.cssText = 'inset:0;display:flex;align-items:center;justify-content:center;background:var(--vex-scrim, rgba(0,0,0,0.45))';
      const title = mode === 'create' ? 'New group' : mode === 'look' ? 'Icon and colour' : 'Edit group';
      const showText = mode !== 'look';
      const el = document.createElement('div');
      el.className = 'sbg-dialog';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.setAttribute('aria-labelledby', 'sbg-title');
      el.innerHTML = '<h3 id="sbg-title"></h3>'
        + (showText ? '<label for="sbg-name">Name <span class="sbg-count" id="sbg-name-count"></span></label><input type="text" id="sbg-name" autocomplete="off" translate="no">'
          + '<label for="sbg-desc">Description <span class="sbg-count" id="sbg-desc-count"></span></label><input type="text" id="sbg-desc" autocomplete="off" translate="no">' : '')
        + '<label id="sbg-icon-label">Icon</label><div class="sbg-icons" role="group" aria-labelledby="sbg-icon-label"></div>'
        + '<label id="sbg-color-label">Colour (from your theme)</label><div class="sbg-colors" role="group" aria-labelledby="sbg-color-label"></div>'
        + '<div class="sbg-error" role="alert" hidden></div>'
        + '<div class="sbg-actions"><button type="button" data-cancel>Cancel</button><button type="button" class="primary" data-ok></button></div>';
      el.querySelector('#sbg-title').textContent = tr(title);
      el.querySelector('[data-ok]').textContent = tr(mode === 'create' ? 'Create' : 'Save');
      const nameIn = el.querySelector('#sbg-name'), descIn = el.querySelector('#sbg-desc');
      if (nameIn) { nameIn.value = state.name; nameIn.maxLength = g.NAME_MAX; }
      if (descIn) { descIn.value = state.desc; descIn.maxLength = g.DESC_MAX; }
      const count = () => {
        if (nameIn) el.querySelector('#sbg-name-count').textContent = nameIn.value.length + '/' + g.NAME_MAX;
        if (descIn) el.querySelector('#sbg-desc-count').textContent = descIn.value.length + '/' + g.DESC_MAX;
      };
      nameIn?.addEventListener('input', count);
      descIn?.addEventListener('input', count);
      count();
      const picks = (host, values, key, make) => {
        values.forEach((v) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'sbg-pick';
          make(b, v);
          b.setAttribute('aria-pressed', String(state[key] === v));
          b.addEventListener('click', () => {
            state[key] = v;
            host.querySelectorAll('.sbg-pick').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
          });
          host.appendChild(b);
        });
      };
      const icons = g.ICONS.slice();
      if (group && !icons.includes(group.icon)) icons.unshift(group.icon);
      picks(el.querySelector('.sbg-icons'), icons, 'icon', (b, v) => { b.innerHTML = VexIcons.svg(v, { size: 18 }); b.title = v; b.setAttribute('aria-label', v); });
      picks(el.querySelector('.sbg-colors'), g.COLORS, 'color', (b, v) => {
        b.innerHTML = '<span class="sbg-swatch" style="--sbg-swatch:' + SWATCH[v] + '"></span>';
        b.title = tr(COLOR_NAMES[v]);
        b.setAttribute('aria-label', tr(COLOR_NAMES[v]));
      });
      overlay.appendChild(el);
      const err = el.querySelector('.sbg-error');
      let done = false;
      const finish = (result) => {
        if (done) return;
        done = true;
        VexLayer.close(overlay);
        resolve(result);
      };
      VexLayer.open(overlay, { tier: 'dialog', id: 'sidebar-group-editor', onClose: () => finish(null) });
      el.querySelector('[data-cancel]').addEventListener('click', () => finish(null));
      const ok = () => {
        const out = { icon: state.icon, color: state.color };
        if (showText) { out.name = nameIn.value; out.desc = descIn.value; }
        if (showText && !out.name.trim() && !(group && group.builtin)) { err.hidden = false; err.textContent = tr('Give the group a name'); nameIn.focus(); return; }
        finish(out);
      };
      el.querySelector('[data-ok]').addEventListener('click', ok);
      overlay.addEventListener('mousedown', (ev) => { if (ev.target === overlay) finish(null); });
      overlay.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(null); }
        else if (ev.key === 'Enter' && ev.target.tagName === 'INPUT') { ev.preventDefault(); ok(); }
        else if (ev.key === 'Tab' && window.VexFocusTrap?.onTab) window.VexFocusTrap.onTab(ev, el);
      });
      (nameIn || el.querySelector('.sbg-pick')).focus();
    });
  }

  async function newGroup() {
    const out = await editor({ mode: 'create' });
    if (!out) return null;
    const id = attempt(() => G().createGroup(out));
    if (id) {
      G().setOpen(id, true);
      toast('Group created. Drag buttons into it, or use a button\'s menu: Move to group.');
    }
    return id;
  }
  async function editGroup(id) {
    const group = G().groupInfo(id);
    const out = await editor({ mode: 'edit', group });
    if (!out) return;
    attempt(() => {
      // A built-in group whose words were left as they were keeps using the built-in (translated) words.
      const patch = { icon: out.icon, color: out.color };
      patch.name = out.name.trim() === G().fullNameOf(group) && !group.name ? '' : out.name;
      patch.desc = out.desc.trim() === G().descOf(group) && !group.desc ? '' : out.desc;
      G().updateGroup(id, patch);
    });
  }
  async function changeLook(id) {
    const group = G().groupInfo(id);
    const out = await editor({ mode: 'look', group });
    if (out) attempt(() => G().updateGroup(id, { icon: out.icon, color: out.color }));
  }

  async function editDescription(id) {
    const group = G().groupInfo(id);
    let value = group.desc || G().descOf(group);
    for (;;) {
      const v = await window.vexPrompt({ title: 'Edit description', message: 'Shown when you point at the button. Up to 80 characters.', value, okLabel: 'Save' });
      if (v == null) return;
      if (v.trim().length > G().DESC_MAX) { toast('A description can be at most 80 characters', 'error'); value = v; continue; }
      const same = !group.desc && v.trim() === G().descOf(group);
      attempt(() => G().updateGroup(id, { desc: same ? '' : v }));
      return;
    }
  }

  // The name under the button, edited where it stands. Enter saves, Escape puts the old name back.
  function renameInline(id) {
    const rail = bar();
    const f = rail && rail.querySelector('.sb-folder[data-group="' + id + '"]');
    if (!f) return renameDialog(id);
    const group = G().groupInfo(id);
    const label = f.querySelector('.sb-folder-label');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'sb-folder-label-edit';
    input.value = group.name || G().labelOf(group);
    input.maxLength = G().NAME_MAX;
    input.setAttribute('aria-label', tr('Group name'));
    input.setAttribute('translate', 'no');
    label.hidden = true;
    label.after(input);
    input.focus();
    input.select();
    let over = false;
    const close = () => { if (over) return; over = true; input.remove(); label.hidden = false; };
    const save = () => {
      if (over) return;
      const v = input.value;
      close();
      const same = !group.name && v.trim() === G().labelOf(group);
      if (v.trim() === (group.name || '') || same) return;
      attempt(() => G().updateGroup(id, { name: v }));
    };
    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') { ev.preventDefault(); save(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); close(); }
    });
    input.addEventListener('blur', save);
    input.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    return undefined;
  }
  async function renameDialog(id) {
    const group = G().groupInfo(id);
    const v = await window.vexPrompt({ title: 'Rename group', value: group.name || G().labelOf(group), okLabel: 'Save' });
    if (v != null) attempt(() => G().updateGroup(id, { name: v }));
  }

  async function removeGroup(id) {
    const group = G().groupInfo(id);
    const name = G().fullNameOf(group);
    const ok = await window.vexConfirm({
      title: 'Delete this group?',
      message: name + ': ' + tr('its buttons go back to their own groups. Nothing else is lost.'),
      okLabel: 'Delete', danger: true,
    });
    if (ok) attempt(() => G().deleteGroup(id));
  }
  async function resetAll() {
    const ok = await window.vexConfirm({
      title: 'Reset the groups?',
      message: 'This puts the built-in five groups back, with their own names, icons and buttons, and deletes the groups you made. Your sidebar order and hidden buttons are not touched.',
      okLabel: 'Reset', danger: true,
    });
    if (ok) attempt(() => G().resetGroups());
  }

  // ---- The menus -----------------------------------------------------------------------------------------------------
  function groupMenu(e, id) {
    const g = G();
    const info = g.groupInfo(id);
    if (!info) throw new Error('Unknown sidebar group: ' + id);
    const order = g.model().map(x => x.id);
    const i = order.indexOf(id);
    const items = [
      { label: g.isOpen(id) ? 'Close folder' : 'Open folder', action: () => g.toggleOpen(id) },
      { separator: true },
      { label: 'Rename…', action: () => renameInline(id) },
      { label: 'Edit description…', action: () => editDescription(id) },
      { label: 'Change icon and colour…', action: () => changeLook(id) },
      { separator: true },
    ];
    if (i > 0) items.push({ label: 'Move group up', action: () => attempt(() => g.nudgeGroup(id, -1)) });
    if (i < order.length - 1) items.push({ label: 'Move group down', action: () => attempt(() => g.nudgeGroup(id, +1)) });
    items.push({ label: 'New group…', action: () => newGroup() }, { separator: true });
    if (info.builtin) {
      items.push({ label: 'Hide group', danger: true, action: () => { attempt(() => g.updateGroup(id, { hidden: true })); toast('Group hidden. Show it again in Settings > Sidebar.'); } });
    } else {
      items.push({ label: 'Delete group…', danger: true, action: () => removeGroup(id) });
    }
    return showMenu(e, items, e.target && e.target.closest && e.target.closest('.sb-folder-btn'));
  }
  function railMenu(e) {
    return showMenu(e, [{ label: 'New group…', action: () => newGroup() }]);
  }

  // What a button's own menu gets: where it can go, without dragging.
  function panelMenuItems(panel, e) {
    const g = G();
    if (!g || !g.enabled() || g.ESSENTIALS.includes(panel)) return [];
    const here = g.groupOf(panel);
    return [
      { label: 'Move to group…', action: () => groupPicker(e, panel, here) },
      { label: 'Move up in group', action: () => attempt(() => g.nudgePanel(panel, -1)) },
      { label: 'Move down in group', action: () => attempt(() => g.nudgePanel(panel, +1)) },
    ];
  }
  function groupPicker(e, panel, here) {
    const g = G();
    const items = g.model().filter(x => x.id !== here).map(x => ({
      label: g.fullNameOf(x),
      detail: g.descOf(x),
      action: () => { attempt(() => g.movePanel(panel, x.id, null)); g.setOpen(x.id, true); },
    }));
    items.push({ separator: true }, { label: 'New group…', action: async () => { const id = await newGroup(); if (id) attempt(() => g.movePanel(panel, id, null)); } });
    return showMenu(e, items);
  }

  // ---- Dragging ---------------------------------------------------------------------------------------------------------
  // A folder is dragged by its tile, a button by itself (inside an open folder). Start, Settings and the spacer never move.
  function wireDrag() {
    const rail = bar();
    if (!rail || rail.dataset.sbGroupsDragWired) return;
    rail.dataset.sbGroupsDragWired = '1';
    const THRESHOLD = 6;
    let drag = null;
    const marks = ['sb-drop-before', 'sb-drop-after', 'sb-drop-into'];
    const unmark = () => rail.querySelectorAll('.sb-drop-before, .sb-drop-after, .sb-drop-into').forEach(x => x.classList.remove(...marks));
    const folders = () => [...rail.querySelectorAll('.sb-folder')].filter(f => !f.hidden);

    // Folder drag: before the first other folder whose middle is below the pointer, else after the last.
    const groupTarget = (y) => {
      const others = folders().filter(f => f !== drag.el);
      if (!others.length) return null;
      for (const f of others) {
        const r = f.getBoundingClientRect();
        if (y < r.top + r.height / 2) return { el: f, after: false, group: f.dataset.group };
      }
      return { el: others[others.length - 1], after: true, group: others[others.length - 1].dataset.group };
    };
    // Button drag: on a folder's tile or name = into that folder (last); on an open folder's button = before or after it.
    const panelTarget = (x, y) => {
      for (const f of folders()) {
        const r = f.getBoundingClientRect();
        if (y < r.top || y > r.bottom || x < r.left || x > r.right) continue;
        const kids = [...f.querySelectorAll('.sb-folder-inner > .sidebar-icon')].filter(b => b !== drag.el && !b.hidden && b.style.display !== 'none');
        const open = f.classList.contains('open');
        if (open) {
          for (let i = 0; i < kids.length; i++) {
            const kr = kids[i].getBoundingClientRect();
            if (y >= kr.top - 4 && y <= kr.bottom + 4) {
              const before = y < kr.top + kr.height / 2;
              return { el: kids[i], group: f.dataset.group, before: before ? kids[i].dataset.panel : (kids[i + 1] ? kids[i + 1].dataset.panel : null), after: !before };
            }
          }
        }
        return { el: f, group: f.dataset.group, into: true, before: null };
      }
      return null;
    };
    const show = (t) => {
      unmark();
      if (!t) return;
      if (drag.kind === 'group') t.el.classList.add(t.after ? 'sb-drop-after' : 'sb-drop-before');
      else if (t.into) t.el.classList.add('sb-drop-into');
      else t.el.classList.add(t.after ? 'sb-drop-after' : 'sb-drop-before');
    };

    rail.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || rail.dataset.sbGrouped !== '1' || !G().enabled()) return;
      if (e.target.closest('.sb-folder-label-edit')) return;
      const tile = e.target.closest('.sb-folder-btn');
      const btn = e.target.closest('.sb-folder-inner > .sidebar-icon[data-panel]');
      if (tile) drag = { kind: 'group', el: tile.parentElement, x: e.clientX, y: e.clientY, id: e.pointerId, active: false, target: null };
      else if (btn) drag = { kind: 'panel', el: btn, x: e.clientX, y: e.clientY, id: e.pointerId, active: false, target: null };
    });
    rail.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.active) {
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < THRESHOLD) return;
        drag.active = true;
        drag.el.classList.add('sb-dragging');
        rail.classList.add('sb-reordering');
        if (rail.setPointerCapture) rail.setPointerCapture(e.pointerId);
      }
      e.preventDefault();
      drag.target = drag.kind === 'group' ? groupTarget(e.clientY) : panelTarget(e.clientX, e.clientY);
      show(drag.target);
    });
    const finish = (e, cancel) => {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      const d = drag;
      drag = null;
      if (!d.active) return;
      unmark();
      d.el.classList.remove('sb-dragging');
      rail.classList.remove('sb-reordering');
      // The click that ends a drag must not open or close anything.
      const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      rail.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => rail.removeEventListener('click', swallow, { capture: true }), 0);
      if (cancel || !d.target) return;
      const g = G();
      if (d.kind === 'group') {
        const order = g.model().map(x => x.id).filter(x => x !== d.el.dataset.group);
        const at = order.indexOf(d.target.group);
        const beforeId = d.target.after ? (order[at + 1] == null ? null : order[at + 1]) : d.target.group;
        attempt(() => g.reorderGroup(d.el.dataset.group, beforeId));
      } else {
        const panel = d.el.dataset.panel;
        const ok = attempt(() => { g.movePanel(panel, d.target.group, d.target.before); return true; });
        if (ok && d.target.into) g.setOpen(d.target.group, true);
      }
    };
    rail.addEventListener('pointerup', (e) => finish(e, false));
    rail.addEventListener('pointercancel', (e) => finish(e, true));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drag && drag.active) finish(null, true); });
  }

  // ---- Settings > Sidebar ------------------------------------------------------------------------------------------------
  function renderManager() {
    const host = document.getElementById('sidebar-groups-manager');
    const g = G();
    if (!host || !g) return;
    const focused = host.contains(document.activeElement) ? { row: document.activeElement.closest('[data-group-row]')?.dataset.groupRow, act: document.activeElement.dataset.act } : null;
    host.innerHTML = '';
    host.hidden = !g.enabled();
    if (host.hidden) return;
    let list;
    try { list = g.model(); }
    catch (err) {
      const p = document.createElement('p');
      p.className = 'setting-info';
      p.setAttribute('role', 'alert');
      p.textContent = err.message;
      host.appendChild(p);
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'btn-secondary';
      reset.textContent = tr('Reset groups to the built-in five');
      reset.addEventListener('click', () => resetAll());
      host.appendChild(reset);
      return;
    }
    const head = document.createElement('div');
    head.className = 'sbg-manager-head';
    head.innerHTML = '<strong></strong><button type="button" data-act="new"></button><button type="button" data-act="reset"></button>';
    head.querySelector('strong').textContent = tr('Groups');
    head.querySelector('[data-act="new"]').innerHTML = VexIcons.svg('plus', { size: 12 }) + '<span style="margin-left:4px"></span>';
    head.querySelector('[data-act="new"] span').textContent = tr('New group');
    head.querySelector('[data-act="reset"]').textContent = tr('Reset groups to the built-in five');
    head.querySelector('[data-act="new"]').addEventListener('click', () => newGroup());
    head.querySelector('[data-act="reset"]').addEventListener('click', () => resetAll());
    host.appendChild(head);
    const all = g.membership((typeof SidebarManager !== 'undefined' ? SidebarManager._topButtons() : []).map(b => b.dataset.panel));
    list.forEach((info, i) => {
      const full = g.fullNameOf(info);
      const row = document.createElement('div');
      row.className = 'sbg-row' + (info.hidden ? ' is-hidden' : '');
      row.dataset.groupRow = info.id;
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', full);
      const n = (all.get(info.id) || []).length;
      row.innerHTML = '<span class="sbg-ico" aria-hidden="true"></span><span class="sbg-text"><div class="sbg-name" translate="no"></div><div class="sbg-desc" translate="no"></div></span><span class="sbg-count"></span>';
      row.querySelector('.sbg-ico').innerHTML = VexIcons.svg(info.icon, { size: 16 });
      row.querySelector('.sbg-name').textContent = full;
      row.querySelector('.sbg-desc').textContent = g.descOf(info);
      row.querySelector('.sbg-count').textContent = n + ' ' + tr(n === 1 ? 'button' : 'buttons');
      const mk = (act, icon, label, disabled) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.act = act;
        b.title = tr(label);
        b.setAttribute('aria-label', tr(label) + ': ' + full);
        b.innerHTML = VexIcons.svg(icon, { size: 13 });
        if (disabled) b.disabled = true;
        row.appendChild(b);
        return b;
      };
      mk('up', 'chevron-up', 'Move up', i === 0).addEventListener('click', () => attempt(() => g.nudgeGroup(info.id, -1)));
      mk('down', 'chevron-down', 'Move down', i === list.length - 1).addEventListener('click', () => attempt(() => g.nudgeGroup(info.id, +1)));
      mk('edit', 'edit', 'Edit group').addEventListener('click', () => editGroup(info.id));
      if (info.builtin) mk('hide', info.hidden ? 'eye' : 'eye-off', info.hidden ? 'Show group' : 'Hide group').addEventListener('click', () => attempt(() => g.updateGroup(info.id, { hidden: !info.hidden })));
      else mk('delete', 'trash', 'Delete group').addEventListener('click', () => removeGroup(info.id));
      host.appendChild(row);
    });
    if (focused) {
      const to = host.querySelector('[data-group-row="' + focused.row + '"] [data-act="' + focused.act + '"]:not(:disabled)') || host.querySelector('[data-act]');
      if (to) to.focus();
    }
  }

  function init() {
    wireDrag();
    renderManager();
    window.addEventListener(G().EVENT, () => renderManager());
    window.addEventListener('vex-lang-changed', () => renderManager());
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  return { editor, newGroup, editGroup, changeLook, editDescription, renameInline, removeGroup, resetAll, groupMenu, railMenu, panelMenuItems, groupPicker, showMenu, renderManager, wireDrag };
})();
window.VexSidebarGroupsUI = VexSidebarGroupsUI;
