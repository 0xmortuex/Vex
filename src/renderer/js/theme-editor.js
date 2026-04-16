// === Vex Theme Editor ===

const ThemeEditor = {
  STORAGE_KEY: 'vex.theme',
  presets: {
    default: { name: 'Default', bg: '#0a0c10', bg2: '#0f1218', surface: '#151921', border: '#1f2530', text: '#e5e9f0', textMuted: '#6b7482', primary: '#6366f1', accent: '#00b4d8' },
    midnight: { name: 'Midnight', bg: '#05050a', bg2: '#0a0a14', surface: '#10101e', border: '#1a1a2e', text: '#e0e0f0', textMuted: '#6060a0', primary: '#8b5cf6', accent: '#c084fc' },
    forest: { name: 'Forest', bg: '#0a100e', bg2: '#0e1512', surface: '#141e1a', border: '#1e2e28', text: '#d8ede4', textMuted: '#6b8a7e', primary: '#22c55e', accent: '#4ade80' },
    ocean: { name: 'Ocean', bg: '#080e14', bg2: '#0c1420', surface: '#121c2c', border: '#1c2c3e', text: '#d4e4f0', textMuted: '#6888a0', primary: '#0ea5e9', accent: '#38bdf8' },
    dracula: { name: 'Dracula', bg: '#1e1f29', bg2: '#21222c', surface: '#282a36', border: '#383a4c', text: '#f8f8f2', textMuted: '#6272a4', primary: '#bd93f9', accent: '#ff79c6' },
    nord: { name: 'Nord', bg: '#2e3440', bg2: '#3b4252', surface: '#434c5e', border: '#4c566a', text: '#eceff4', textMuted: '#7b88a1', primary: '#88c0d0', accent: '#81a1c1' },
    catppuccin: { name: 'Catppuccin', bg: '#1e1e2e', bg2: '#24243e', surface: '#302d41', border: '#45425a', text: '#d9e0ee', textMuted: '#988ba2', primary: '#c9cbff', accent: '#f5c2e7' }
  },

  currentTheme: null,

  init() {
    const panel = document.getElementById('panel-themes');
    if (!panel || panel.dataset.rendered) return;
    panel.dataset.rendered = 'true';

    this.currentTheme = this.load();
    this.render(panel);
    this.applyTheme(this.currentTheme);
  },

  load() {
    try { return JSON.parse(localStorage.getItem(this.STORAGE_KEY)) || { preset: 'default' }; }
    catch { return { preset: 'default' }; }
  },

  save() {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.currentTheme));
  },

  applyTheme(theme) {
    const preset = theme.preset ? this.presets[theme.preset] : null;
    const colors = preset || theme.custom || this.presets.default;
    const root = document.documentElement;
    root.style.setProperty('--bg', colors.bg);
    root.style.setProperty('--bg-2', colors.bg2);
    root.style.setProperty('--surface', colors.surface);
    root.style.setProperty('--border', colors.border);
    root.style.setProperty('--text', colors.text);
    root.style.setProperty('--text-muted', colors.textMuted);
    root.style.setProperty('--primary', colors.primary);
    root.style.setProperty('--accent', colors.accent);
  },

  render(panel) {
    let html = '<div class="theme-container"><h2>Themes</h2>';
    html += '<div class="theme-section"><div class="theme-section-title">Presets</div><div class="theme-presets">';
    for (const [id, preset] of Object.entries(this.presets)) {
      const active = this.currentTheme.preset === id ? ' active' : '';
      html += `<button class="theme-preset${active}" data-preset="${id}">${preset.name}</button>`;
    }
    html += '</div></div>';

    // Color editor
    const colors = this.currentTheme.preset ? this.presets[this.currentTheme.preset] : this.currentTheme.custom || this.presets.default;
    const colorFields = [
      ['bg', 'Background'], ['bg2', 'Surface 2'], ['surface', 'Surface'], ['border', 'Border'],
      ['text', 'Text'], ['textMuted', 'Text Muted'], ['primary', 'Primary'], ['accent', 'Accent']
    ];
    html += '<div class="theme-section"><div class="theme-section-title">Colors</div>';
    for (const [key, label] of colorFields) {
      html += `<div class="theme-color-row"><label>${label}</label><input type="color" data-key="${key}" value="${colors[key]}"><input type="text" data-key="${key}" value="${colors[key]}" maxlength="7"></div>`;
    }
    html += '</div>';

    // Force dark mode toggle
    const forceDark = localStorage.getItem('vex.forceDarkSites') === 'true';
    html += `<div class="theme-section"><div class="theme-section-title">Website Appearance</div>
      <div class="theme-toggle-row"><span>Force dark mode on all websites</span>
        <label class="toggle"><input type="checkbox" id="theme-force-dark" ${forceDark ? 'checked' : ''}><span class="toggle-slider"></span></label>
      </div></div>`;

    html += '</div>';
    panel.innerHTML = html;

    // Preset clicks
    panel.querySelectorAll('.theme-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        this.currentTheme = { preset: btn.dataset.preset };
        this.save();
        this.applyTheme(this.currentTheme);
        this.render(panel);
      });
    });

    // Color pickers
    panel.querySelectorAll('input[type="color"]').forEach(picker => {
      picker.addEventListener('input', () => {
        this._customColorChange(panel, picker.dataset.key, picker.value);
      });
    });
    panel.querySelectorAll('input[type="text"][data-key]').forEach(input => {
      input.addEventListener('change', () => {
        if (/^#[0-9a-f]{6}$/i.test(input.value)) {
          this._customColorChange(panel, input.dataset.key, input.value);
        }
      });
    });

    // Force dark toggle
    panel.querySelector('#theme-force-dark')?.addEventListener('change', (e) => {
      localStorage.setItem('vex.forceDarkSites', e.target.checked);
    });
  },

  _customColorChange(panel, key, value) {
    const base = this.currentTheme.preset ? { ...this.presets[this.currentTheme.preset] } : (this.currentTheme.custom || { ...this.presets.default });
    base[key] = value;
    this.currentTheme = { custom: base, preset: null };
    this.save();
    this.applyTheme(this.currentTheme);
    // Update sibling inputs
    panel.querySelectorAll(`input[data-key="${key}"]`).forEach(el => el.value = value);
    panel.querySelectorAll('.theme-preset').forEach(b => b.classList.remove('active'));
  }
};

// Apply saved theme on load
setTimeout(() => {
  try {
    const saved = JSON.parse(localStorage.getItem('vex.theme'));
    if (saved) ThemeEditor.applyTheme(saved);
  } catch {}
}, 0);
