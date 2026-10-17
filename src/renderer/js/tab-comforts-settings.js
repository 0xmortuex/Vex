// === Settings › Tab comforts ====================================================
//
// The switches for scroll memory (js/scroll-memory.js), essential tabs
// (js/essentials.js), English/Turkish spelling (js/spell-lang.js), middle-click
// autoscroll (js/autoscroll.js), pinned tab home pages (js/pinned-home.js), the
// page that did not load (js/load-failure.js), paste as plain text
// (js/paste-plain.js) and find text in all tabs (js/tab-text-find.js). Each is
// also a Minimal Vex feature, so these are the same switches that screen uses.
// Floating a video when you switch tabs is the existing switch under
// Picture-in-Picture; it now also waits while a game is in front.
const VexTabComfortsSettings = {
  ID: 'tab-comforts',

  render(body) {
    body.textContent = '';
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const fail = (err) => window.showToast?.((err && err.message) || String(err), 'error');
    body.appendChild(el('p', 'setting-info', 'Small helpers for tabs and pages. Each can be switched off on its own.'));
    const toggle = (label, hint, on, set) => {
      const row = el('div', 'setting-toggle-row');
      const lab = el('label', 'toggle');
      const input = document.createElement('input');
      input.type = 'checkbox'; input.checked = !!on; input.setAttribute('aria-label', label);
      input.addEventListener('change', () => { try { set(input.checked); } catch (err) { input.checked = !input.checked; fail(err); } });
      lab.append(input, el('span', 'toggle-slider'));
      row.append(el('span', 'setting-label-text', label), lab);
      body.appendChild(row);
      if (hint) body.appendChild(el('p', 'setting-info', hint));
    };

    toggle('Remember where I was on a page', 'A tab you reopen with Ctrl+Shift+T, or open again after closing Vex, comes back to where you were reading it. Kept with the tab; never from a private or Tor tab.',
      VexScrollMemory.enabled(), (on) => { VexScrollMemory.setEnabled(on); this.render(body); });
    if (VexScrollMemory.enabled()) {
      toggle('Remember where I stopped in a long article, even after the tab is closed', 'A page of three screens or more is also kept by its address (200 addresses, 60 days), so opening it again from History or a link brings you back to your place. Forgotten when you reach the end.',
        VexScrollMemory.articlesEnabled(), (on) => VexScrollMemory.setArticlesEnabled(on));
      toggle('Thin reading progress bar', 'A line along the top of a long page showing how far down you are. Read every two seconds for the tab in front only.',
        VexScrollMemory.barEnabled(), (on) => VexScrollMemory.setBarEnabled(on));
      const forget = el('div', 'setting-row');
      const fb = el('button', 'btn-secondary', 'Forget the places kept for articles'); fb.type = 'button';
      fb.addEventListener('click', () => { try { localStorage.removeItem(VexScrollMemory.ARTICLES_KEY); window.showToast?.('Forgotten'); } catch (err) { fail(err); } });
      forget.appendChild(fb); body.appendChild(forget);
    }

    toggle('Essential tabs', 'Right-click a tab, "Make essential": it is pinned and stays open in every workspace (Ctrl+K, "Essential tabs", lists them).',
      VexEssentials.enabled(), (on) => VexEssentials.setEnabled(on));

    toggle('English and Turkish spelling', 'Right-click a text box: "Spelling language" and "Add to the dictionary". Turkish\'s dictionary is fetched by Chromium the first time you use it.',
      VexSpellLang.enabled(), (on) => { VexSpellLang.setEnabled(on); this.render(body); });
    if (VexSpellLang.enabled()) {
      const row = el('div', 'setting-row');
      row.appendChild(el('span', 'setting-label-text', 'Spell-check in'));
      const select = document.createElement('select');
      select.setAttribute('aria-label', 'Spelling language');
      for (const [id, label] of VexSpellLang.CHOICES) {
        const o = document.createElement('option'); o.value = id; o.textContent = label; select.appendChild(o);
      }
      select.value = VexSpellLang.choice();
      select.addEventListener('change', () => {
        VexSpellLang.setChoice(select.value).catch((err) => { select.value = VexSpellLang.choice(); fail(err); });
      });
      row.appendChild(select);
      body.appendChild(row);
    }

    toggle('Middle-click autoscroll', 'Press the middle mouse button on empty page: the page follows the pointer. Not on links, text boxes or videos.',
      VexAutoscroll.enabled(), (on) => VexAutoscroll.setEnabled(on));

    toggle('Pinned tab home page', 'A pinned tab remembers the address it was pinned on and shows "Back to ..." when it is somewhere else.',
      VexPinnedHome.enabled(), (on) => { VexPinnedHome.setEnabled(on); this.render(body); });
    if (VexPinnedHome.enabled()) {
      toggle('Links that leave the pinned site open in a new tab', 'Only a plain click on a link. Typing an address, redirects and links inside the site are not changed.',
        VexPinnedHome.linksEnabled(), (on) => VexPinnedHome.setLinksEnabled(on));
    }

    toggle('A page of Vex\'s own when a site does not load', 'Try again, a hard reload, http:// after you confirm, your saved copy and the Wayback Machine. Nothing is tried by itself.',
      VexLoadFailure.enabled(), (on) => VexLoadFailure.setEnabled(on));

    toggle('Paste as plain text in the right-click menu', 'Also Ctrl+K, "Paste as plain text". Ctrl+Shift+V pastes plain text inside a page by itself.',
      VexPastePlain.enabled(), (on) => VexPastePlain.setEnabled(on));

    toggle('Find text in all tabs', 'Ctrl+K, "Find text in all tabs": which open tab has these exact words? Reads the text of loaded tabs, in memory only.',
      VexTabTextFind.enabled(), (on) => VexTabTextFind.setEnabled(on));
  },

  init() {
    if (typeof VexSettingsGroups === 'undefined') throw new Error('VexSettingsGroups is not loaded');
    VexSettingsGroups.register({
      id: this.ID, title: 'Tab comforts',
      keywords: 'scroll position restore essential workspace spelling turkish english dictionary autoscroll middle click pinned home failure retry paste plain text find all tabs picture in picture',
      render: (body) => this.render(body),
    });
  },
};

if (typeof window !== 'undefined') window.VexTabComfortsSettings = VexTabComfortsSettings;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexTabComfortsSettings };
