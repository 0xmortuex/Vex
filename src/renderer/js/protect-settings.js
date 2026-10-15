// === A settings group a module owns =========================================
//
// The privacy report card, extension audit, crash-proof tabs and quiet hours
// each have a Settings section. Each module builds its own markup and adds it
// here, at run time, so index.html only needs a <script> tag per module and
// not a block of settings markup. SettingsUI.enhance() (settings-ui.js) runs
// when the panel opens and files every .setting-group by its heading, so a
// group added before then is categorized and searchable like the static ones.
//
//   const body = ProtectSettings.group({ id: 'settings-quiet', title: 'Quiet hours' });
//   body.innerHTML = ...
//
// The group's heading must contain a word settings-ui.js's CATS knows
// ('privacy', 'extension', 'session', 'quiet hours'), or it lands in "Other".
const ProtectSettings = {
  // Creates the group once (by id) and returns its body element, or null when
  // there is no settings panel to put it in.
  group({ id, title, intro }) {
    if (!id || !title) throw new Error('ProtectSettings.group needs an id and a title');
    const root = document.querySelector('#panel-settings .settings-content');
    if (!root) return null;
    let g = document.getElementById(id);
    if (!g) {
      g = document.createElement('div');
      g.className = 'setting-group';
      g.id = id;
      const label = document.createElement('label');
      label.className = 'setting-label';
      label.textContent = title;
      g.appendChild(label);
      if (intro) {
        const p = document.createElement('div');
        p.className = 'protect-intro';
        p.style.cssText = 'font-size:12px;color:var(--text-muted);margin:2px 0 8px';
        p.textContent = intro;
        g.appendChild(p);
      }
      const body = document.createElement('div');
      body.className = 'protect-body';
      g.appendChild(body);
      // Above "About", which is meant to be the last section.
      const about = document.getElementById('settings-version');
      const last = about && about.closest('.setting-group');
      if (last && last.parentElement === root) root.insertBefore(g, last);
      else root.appendChild(g);
    }
    return g.querySelector('.protect-body');
  },

  // A labelled switch, wired by the caller. Returns the <label>.
  toggle({ text, hint, checked, onChange }) {
    const l = document.createElement('label');
    l.style.cssText = 'display:flex;gap:8px;align-items:flex-start;font-size:12.5px;margin:6px 0;cursor:pointer';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!checked;
    cb.style.cssText = 'cursor:pointer;margin-top:2px';
    const span = document.createElement('span');
    span.textContent = text;
    if (hint) {
      const h = document.createElement('span');
      h.style.color = 'var(--text-muted)';
      h.textContent = ' · ' + hint;
      span.appendChild(h);
    }
    l.append(cb, span);
    cb.addEventListener('change', () => onChange(cb.checked, cb));
    return l;
  },

  // A plain button in the settings look.
  button(text, onClick, { danger = false, icon = null } = {}) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = danger ? 'btn-danger' : 'btn-secondary';
    if (icon && window.VexIcons) b.innerHTML = window.VexIcons.svg(icon, { size: 13 }) + ' ';
    b.appendChild(document.createTextNode(text));
    b.style.cssText = 'padding:6px 12px;font-size:12px;cursor:pointer;margin:2px 6px 2px 0';
    b.addEventListener('click', onClick);
    return b;
  },
};

if (typeof window !== 'undefined') window.ProtectSettings = ProtectSettings;
if (typeof module !== 'undefined' && module.exports) module.exports = { ProtectSettings };
