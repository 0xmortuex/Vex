// === Vex Mobile — the first run ===
//
// Four questions, once, and every one of them skippable: what it should look
// like, whether it should be the browser your links open in, whether blocking
// starts on, and whether this phone is joining a desktop you already sync.
//
// It exists because the alternative is a browser that arrives with everything
// switched to somebody else's preference and a settings tree to hunt through.
// It is deliberately short: four screens, no account, nothing that phones
// anywhere.

const VexWelcome = (() => {
  const { $, el, icon, clear } = VexDom;

  function done() {
    return VexStore.get('vex.onboarded', false) === true;
  }

  function card(title, subtitle) {
    const wrap = el('div', 'welcome-step');
    wrap.appendChild(el('h2', null, title));
    if (subtitle) wrap.appendChild(el('p', 'welcome-sub', subtitle));
    return wrap;
  }

  function primary(label, run) {
    const button = el('button', 'pill-btn', label);
    button.onclick = run;
    return button;
  }

  function secondary(label, run) {
    const button = el('button', 'pill-btn ghost', label);
    button.onclick = run;
    return button;
  }

  const STEPS = [
    // ── Look ───────────────────────────────────────────────────────────────
    body => {
      const step = card('How should it look?',
        'Vex’s own, or the browser you are used to — Samsung Internet, Chrome, Firefox or Safari, '
        + 'with its toolbar where you expect it. Then a theme: Auto follows your phone. All '
        + VexTheme.themes().length + ' of the desktop’s themes are in Settings → Appearance.');
      const looks = el('div', 'panel-chips welcome-looks');
      const lookNow = VexTheme.look();
      for (const [id, look] of Object.entries(VexTheme.LOOKS)) {
        looks.appendChild(el('button', {
          class: 'chip' + (id === lookNow ? ' on' : ''),
          onclick: async () => {
            await VexTheme.setLook(id);
            // The first run: nothing is a habit yet, so the layout comes with
            // the look rather than being asked about.
            if (look.layout) {
              await VexStore.set('vex.toolbarPosition', look.layout);
              await VexStore.set('vex.toolbarButtons', look.buttons);
            } else {
              await VexStore.set('vex.toolbarPosition', 'bottom');
              await VexStore.set('vex.toolbarButtons', null);
            }
            VexUI.applyToolbarPosition();
            VexUI.renderToolbar();
            VexWelcome.show(0);
          }
        }, look.label));
      }
      step.appendChild(looks);
      const grid = el('div', 'theme-grid');
      const chosen = VexStore.get('vex.theme', 'auto');
      // The first eight here; the rest are a scroll too far for a first run.
      const shown = VexTheme.themes().slice(0, 8);
      const picked = VexTheme.themes().find(theme => theme.id === chosen);
      if (picked && !shown.includes(picked)) shown.push(picked);
      for (const theme of [{ id: 'auto', bg: VexTheme.current().bg, accent: VexTheme.current().accent }]
        .concat(shown)) {
        const option = el('button', 'theme-card' + (chosen === theme.id ? ' on' : ''));
        const swatch = el('div', 'theme-swatch');
        swatch.style.background = theme.bg;
        const dot = el('i');
        dot.style.background = theme.accent;
        swatch.appendChild(dot);
        option.appendChild(swatch);
        option.appendChild(el('div', 'theme-name', theme.id === 'auto' ? 'Auto' : String(theme.label || theme.id).split(' — ')[0]));
        option.onclick = async () => { await VexTheme.set(theme.id); VexWelcome.show(0); };
        grid.appendChild(option);
      }
      step.appendChild(grid);
      body.appendChild(step);
    },

    // ── Where the address bar goes ─────────────────────────────────────────
    body => {
      const step = card('Where do you want the address bar?',
        'At the bottom it is under your thumb. At the top it is where a desktop '
        + 'browser puts it. Either way it gets out of the way as you scroll.');
      const row = el('div', 'welcome-buttons');
      const position = VexStore.get('vex.toolbarPosition', 'bottom');
      for (const [id, label] of [['bottom', 'Bottom'], ['top', 'Top']]) {
        const option = el('button', 'pill-btn' + (position === id ? '' : ' ghost'), label);
        option.onclick = async () => {
          await VexStore.set('vex.toolbarPosition', id);
          VexUI.applyToolbarPosition();
          VexWelcome.show(1);
        };
        row.appendChild(option);
      }
      step.appendChild(row);
      body.appendChild(step);
    },

    // ── Being the browser ──────────────────────────────────────────────────
    async body => {
      const isDefault = await VexBridge.isDefaultBrowser();
      const step = card(isDefault ? 'Vex is your default browser' : 'Open links in Vex?',
        isDefault
          ? 'Links from other apps already come here.'
          : 'Android will ask you; Vex cannot decide it for you. You can do this later '
            + 'from Settings.');
      if (!isDefault) {
        step.appendChild(primary('Choose Vex', () => VexBridge.openDefaultBrowserSettings()));
      }
      body.appendChild(step);
    },

    // ── Everything else ────────────────────────────────────────────────────
    body => {
      const step = card('Two more things, when you want them',
        'Both are yours to run — Vex ships pointing at nobody’s server but the '
        + 'one you give it.');
      const list = el('div', 'welcome-list');
      list.appendChild(VexSheets.row({
        icon: 'sync', label: 'Sync with your desktop',
        note: 'Bookmarks, reading list and sessions, encrypted with a key only your devices hold',
        // finish() writes a preference before it closes the panel, so the
        // panel it opens next has to wait for it: calling both in one breath
        // opened sync and then closed it half a tick later.
        run: async () => { await VexWelcome.finish(); VexPanels.sync(); return true; }
      }));
      list.appendChild(VexSheets.row({
        icon: 'sparkle', label: 'Set up the assistant',
        note: 'Your own Cloudflare Worker — ask about a page, or let it do things',
        run: async () => { await VexWelcome.finish(); VexPanels.assistantSettings(); return true; }
      }));
      list.appendChild(VexSheets.row({
        icon: 'grid', label: 'See everything Vex can do',
        note: VexLibrary.count() + ' features, on shelves, searchable',
        run: async () => { await VexWelcome.finish(); VexPanels.library(); return true; }
      }));
      step.appendChild(list);
      body.appendChild(step);
    }
  ];

  return {
    STEPS,
    done,

    async show(step = 0) {
      const body = VexPanels.shell('welcome', 'Welcome to Vex', {
        action: { label: step >= STEPS.length - 1 ? 'Done' : 'Skip', run: () => this.finish() }
      });

      await STEPS[Math.min(step, STEPS.length - 1)](body);

      const nav = el('div', 'welcome-nav');
      if (step > 0) nav.appendChild(secondary('Back', () => this.show(step - 1)));
      nav.appendChild(step < STEPS.length - 1
        ? primary('Next', () => this.show(step + 1))
        : primary('Start browsing', () => this.finish()));
      body.appendChild(nav);

      const dots = el('div', 'welcome-dots');
      for (let index = 0; index < STEPS.length; index++) {
        dots.appendChild(el('i', index === step ? 'on' : null));
      }
      body.appendChild(dots);
    },

    async finish() {
      await VexStore.set('vex.onboarded', true);
      VexPanels.close();
      VexUI.renderToolbar();
    },

    // Shown once, and only when there is nothing else going on.
    async maybeShow() {
      if (done()) return false;
      await this.show(0);
      return true;
    }
  };
})();

if (typeof window !== 'undefined') window.VexWelcome = VexWelcome;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexWelcome };
