// === Vex Page Translator ===

const Translator = {
  languages: [
    { code: 'en', name: 'English' },
    { code: 'tr', name: 'Turkish' },
    { code: 'es', name: 'Spanish' },
    { code: 'fr', name: 'French' },
    { code: 'de', name: 'German' },
    { code: 'ar', name: 'Arabic' },
    { code: 'zh-CN', name: 'Chinese' },
    { code: 'ja', name: 'Japanese' },
    { code: 'ko', name: 'Korean' },
    { code: 'pt', name: 'Portuguese' },
    { code: 'ru', name: 'Russian' }
  ],

  defaultTarget: 'en',

  translate(targetLang) {
    const wv = WebviewManager.getActiveWebview();
    if (!wv) return;

    const url = wv.getURL();
    if (!url || url.startsWith('about:') || url.startsWith('file:') || url.startsWith('vex:')) {
      window.showToast?.('Cannot translate this page');
      return;
    }

    const translateUrl = `https://translate.google.com/translate?sl=auto&tl=${targetLang || this.defaultTarget}&u=${encodeURIComponent(url)}`;
    wv.loadURL(translateUrl);
    this.defaultTarget = targetLang || this.defaultTarget;
    localStorage.setItem('vex.translateLang', this.defaultTarget);
    window.showToast?.('Translating...');
  },

  init() {
    this.defaultTarget = localStorage.getItem('vex.translateLang') || 'en';
  }
};
