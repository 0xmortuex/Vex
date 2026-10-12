// === The agreement: Vex's privacy policy and terms ===
//
// Vex does a number of things by itself (update checks, block-list downloads,
// page watches, reading sign-in codes from webmail tabs...). Before anyone
// uses it they see a short list of those, can read PRIVACY.md and TERMS.md
// inside Vex, and press "I agree" or "Quit Vex". Nothing else closes it.
//
// - A first start: the first step of the setup wizard (js/onboarding.js).
// - A profile that already accepted an older version, or none: this file's
//   own dialog over the window, once, with what changed (maybeAsk, js/app.js).
// - A private window never asks: it keeps its own storage, so it would ask
//   every time. Instead it does not open until this profile has agreed in
//   the main window: main reads the version saved for the profile and
//   refuses before (src/main/agreement-gate.js, agreedTo). On a profile that
//   had not agreed, a private window was Vex used without agreeing (release
//   check, 2026-10-12).
//
// VERSION is the only thing that shows it again. It must be the "Document
// version" written at the top of PRIVACY.md and TERMS.md (a test checks), and
// CHANGES says, in a few lines, what is new in that version.
// Automated runs (check-ui, the smoke tests) start from a profile seeded past
// first run, as they do for the wizard; nothing here accepts by itself.
const VexLegal = {
  VERSION: 2,
  DATE: '2026-10-11',
  KEY: 'vex.legalAcceptedVersion',
  AT_KEY: 'vex.legalAcceptedAt',

  // What changed in VERSION, shown to a profile that accepted less (or nothing).
  CHANGES: {
    en: [
      'You now agree to the privacy policy and terms before using Vex, and again only when they change.',
      'Both documents now cover what Vex does by itself: Page Watch (also devices on your home network), reading sign-in codes from webmail tabs, Recall, Clipboard History, AI memory, reconnecting MCP servers, reminders that wake Vex, and weekly block-list updates.',
      'Sync is described as it is: off until you set it up, end-to-end encrypted, and passwords and 2FA codes only if you turn that on.',
      'Each item says what is sent, where, when, and the switch that turns it off.',
    ],
    tr: [
      'Artık Vex’i kullanmadan önce gizlilik politikasını ve kullanım koşullarını kabul ediyorsunuz; bu yalnızca belgeler değiştiğinde yeniden sorulur.',
      'İki belge de artık Vex’in kendiliğinden yaptıklarını anlatıyor: Sayfa İzleme (ev ağınızdaki cihazlar dahil), web posta sekmelerinden giriş kodlarının okunması, Recall, Pano Geçmişi, yapay zekâ belleği, MCP sunucularına yeniden bağlanma, Vex’i uyandıran hatırlatıcılar ve haftalık engelleme listesi güncellemeleri.',
      'Eşitleme olduğu gibi anlatılıyor: siz kurana kadar kapalıdır, uçtan uca şifrelidir; parolalar ve 2FA kodları yalnızca siz açarsanız eşitlenir.',
      'Her madde neyin, nereye, ne zaman gönderildiğini ve onu kapatan ayarı söylüyor.',
    ],
  },

  // The short list of what Vex does by itself (the same on both screens).
  SUMMARY: {
    en: [
      'Vex sends no telemetry, analytics or crash reports, and nothing goes to the author.',
      'By itself it checks GitHub for Vex updates and Google or GitHub for extension updates (at start and every 6 hours), and downloads the ad and tracker block lists once a week.',
      'As you type, search suggestions go to the search engine you chose. Lists of sites fetch each site’s icon from that site.',
      'It keeps your history, settings and, when you use them, Recall, Clipboard History and AI memory on this PC. Passwords and 2FA secrets are encrypted with Windows.',
      'Features you turn on work in the background: Page Watch checks pages (also devices on your home network), email-code autofill reads sign-in codes from webmail tabs you have open, reminders can wake Vex through Windows Task Scheduler.',
      'The Discord panel’s network help is on by default and asks Cloudflare’s DNS (1.1.1.1) for Discord’s server addresses.',
      'AI runs on your PC unless you set up a cloud AI server; with routing on Auto, a failed local answer may be retried in the cloud. The AI agent reads pages without your cookies.',
      'Sync and cloud AI are off until you enter a server address; synced data is end-to-end encrypted.',
    ],
    tr: [
      'Vex telemetri, analiz veya çökme raporu göndermez; geliştiriciye hiçbir şey gitmez.',
      'Kendiliğinden Vex güncellemelerini GitHub’da, eklenti güncellemelerini Google’da veya GitHub’da arar (açılışta ve 6 saatte bir) ve reklam ve izleyici engelleme listelerini haftada bir indirir.',
      'Siz yazarken arama önerileri seçtiğiniz arama motoruna gider. Site listeleri her sitenin simgesini o siteden alır.',
      'Geçmişinizi, ayarlarınızı ve kullandığınızda Recall’u, Pano Geçmişi’ni ve yapay zekâ belleğini bu bilgisayarda tutar. Parolalar ve 2FA anahtarları Windows ile şifrelenir.',
      'Açtığınız özellikler arka planda çalışır: Sayfa İzleme sayfaları (ev ağınızdaki cihazlar dahil) denetler, e-posta kodu doldurma açık web posta sekmelerinizdeki giriş kodlarını okur, hatırlatıcılar Windows Görev Zamanlayıcı ile Vex’i uyandırabilir.',
      'Discord panelinin ağ yardımı varsayılan olarak açıktır ve Discord sunucularının adreslerini Cloudflare DNS’ine (1.1.1.1) sorar.',
      'Bir bulut yapay zekâ sunucusu kurmadığınız sürece yapay zekâ bilgisayarınızda çalışır; yönlendirme Otomatik ise başarısız bir yerel yanıt bulutta yeniden denenebilir. Yapay zekâ ajanı sayfaları çerezleriniz olmadan okur.',
      'Eşitleme ve bulut yapay zekâ, bir sunucu adresi girene kadar kapalıdır; eşitlenen veriler uçtan uca şifrelidir.',
    ],
  },

  // The licence and the notices are not part of the agreement; they are here so
  // Ctrl+K can show every shipped document in the same reader.
  DOCS: { privacy: 'PRIVACY.md', terms: 'TERMS.md', license: 'LICENSE', notices: 'THIRD_PARTY_NOTICES.md' },
  TITLES: {
    'PRIVACY.md': ['legalPrivacyTitle', 'Privacy policy'],
    'TERMS.md': ['legalTermsTitle', 'Terms of use'],
    'LICENSE': ['legalLicenseTitle', 'License (MIT)'],
    'THIRD_PARTY_NOTICES.md': ['legalNoticesTitle', 'Third-party notices'],
  },

  _lang() { return window.VexI18n?.locale?.() === 'tr' ? 'tr' : 'en'; },
  _t(key, fallback) { return window.VexI18n?.t(key, fallback) || fallback; },

  acceptedVersion() {
    const v = parseInt(localStorage.getItem(this.KEY), 10);
    return Number.isInteger(v) && v > 0 ? v : 0;
  },
  acceptedAt() { return localStorage.getItem(this.AT_KEY) || null; },
  needed() { return this.acceptedVersion() < this.VERSION; },
  accept() {
    localStorage.setItem(this.KEY, String(this.VERSION));
    localStorage.setItem(this.AT_KEY, new Date().toISOString());
    // Saved now, not in 300 ms: main reads it before it opens a private
    // window (above). A failed save is retried and reported by storage.js.
    if (window.PersistentStorage?._ready) {
      window.PersistentStorage._flush().catch(err => console.error('[legal] the agreement is saved on the next try:', err));
    }
    window.dispatchEvent(new CustomEvent('vex-legal-accepted', { detail: { version: this.VERSION } }));
  },
  quit() {
    if (typeof window.vex?.quitApp !== 'function') throw new Error('Vex cannot quit from here: window.vex.quitApp is missing');
    return window.vex.quitApp();
  },

  // While the agreement is up (this file's dialog, or the setup's "Before you
  // start" step) no Vex key or command does anything: Ctrl+T opened a tab
  // behind it (release check, 2026-10-12). The keys below (the listener at
  // the end of this file) work its buttons and the reader; every other key is
  // kept from Vex's own listeners, and main is told so the keys it acts on
  // itself, and a page's keys, stand aside too (src/main/agreement-gate.js).
  // The mouse cannot reach anything: both cover the whole window.
  AGREEMENT: '#vex-legal, #vex-legal-doc, #vex-onboarding, .vex-dialog-overlay',
  isUp() { return !!(document.getElementById('vex-legal') || document.querySelector('#vex-onboarding[data-vex-legal]')); },
  _gateUp: false,
  // Called whenever either screen comes or goes; tells main of a change.
  gateChanged() {
    const up = this.isUp();
    if (up === this._gateUp) return;
    this._gateUp = up;
    if (typeof window.vex?.legalGate !== 'function') throw new Error('window.vex.legalGate is missing: main cannot hold its keys back');
    window.vex.legalGate(up);
  },
  _AGREEMENT_KEYS: new Set(['Tab', 'Enter', ' ', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']),
  _keyAllowed(e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return false;
    if (e.key === 'Tab') return true;   // focus comes back into it (below)
    const t = e.target instanceof Element ? e.target : null;
    return this._AGREEMENT_KEYS.has(e.key) && !!(t && t.closest(this.AGREEMENT));
  },
  // Copying text out of the reader is the browser's, not Vex's.
  _copyKey(e) { return e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && ['c', 'C', 'a', 'A', 'Insert'].includes(e.key); },
  _focusAgreement() {
    const card = document.querySelector('#vex-legal .vex-legal-card') || document.querySelector('#vex-onboarding [role="dialog"]');
    if (!card) return;
    if (!card.hasAttribute('tabindex')) card.tabIndex = -1;
    card.focus();
  },

  // The body both screens share: the summary, what changed (an update), and
  // the two documents. `changes` adds the "What changed" list.
  renderInto(body, { changes = false } = {}) {
    const lang = this._lang();
    const esc = (s) => window.escapeHtml(s);
    const list = (items) => '<ul class="vex-legal-list">' + items.map(item => '<li>' + esc(item) + '</li>').join('') + '</ul>';
    body.innerHTML =
      (changes
        ? '<h3 class="vex-legal-sub" id="vex-legal-changes">' + esc(this._t('legalWhatChanged', 'What changed')) + '</h3>' + list(this.CHANGES[lang])
          + '<h3 class="vex-legal-sub">' + esc(this._t('legalSummaryHead', 'What Vex does by itself')) + '</h3>'
        : '')
      + '<p class="vex-legal-intro" id="vex-legal-intro">' + esc(this._t('legalIntro', 'Please read this before you start. Vex does some things by itself, without a click each time:')) + '</p>'
      + list(this.SUMMARY[lang])
      + '<p class="vex-legal-intro">' + esc(this._t('legalReadFull', 'The full privacy policy and terms say what is sent, where, when, and how to turn each thing off.')) + '</p>'
      + '<div class="vex-legal-docs">'
      + '<button type="button" class="vex-legal-doc-btn" data-legal-open="PRIVACY.md">' + esc(this._t('legalReadPrivacy', 'Read the privacy policy')) + '</button>'
      + '<button type="button" class="vex-legal-doc-btn" data-legal-open="TERMS.md">' + esc(this._t('legalReadTerms', 'Read the terms of use')) + '</button>'
      + '</div>'
      + '<p class="vex-legal-version">' + esc(this._t('legalVersion', 'Document version {v}, last updated {d}').replace('{v}', this.VERSION).replace('{d}', this.DATE)) + '</p>';
    body.querySelectorAll('[data-legal-open]').forEach(btn => btn.addEventListener('click', () => {
      this.openDoc(btn.dataset.legalOpen).catch(err => {
        console.error('[legal] could not open ' + btn.dataset.legalOpen + ':', err);
        window.showToast?.(this._t('legalOpenFailed', 'Could not open the document') + ': ' + (err && err.message), 'error');
      });
    }));
  },

  // At start, for a profile past the wizard that has not accepted this
  // version. The wizard asks a new profile itself, as its first step.
  maybeAsk() {
    if (window.VexTabPolicy?.isPrivateWindow) return false;
    if (typeof Onboarding !== 'undefined' && !Onboarding.done()) return false;
    if (!this.needed()) return false;
    this.show();
    return true;
  },

  show() {
    if (document.getElementById('vex-legal')) return;
    const returnFocus = document.activeElement;
    const overlay = document.createElement('div');
    overlay.id = 'vex-legal';
    overlay.className = 'vex-legal-overlay';
    overlay.innerHTML = `
      <div class="vex-legal-card" role="dialog" aria-modal="true" aria-labelledby="vex-legal-title" aria-describedby="vex-legal-changes" tabindex="-1">
        <h2 class="vex-legal-title" id="vex-legal-title"></h2>
        <div class="vex-legal-body"></div>
        <div class="vex-legal-actions">
          <button type="button" class="vex-legal-btn" data-legal-quit></button>
          <span style="flex:1"></span>
          <button type="button" class="vex-legal-btn primary" data-legal-agree></button>
        </div>
      </div>`;
    overlay.querySelector('#vex-legal-title').textContent = this._t('legalUpdatedTitle', 'Vex’s privacy policy and terms have changed');
    overlay.querySelector('[data-legal-quit]').textContent = this._t('legalQuit', 'Quit Vex');
    overlay.querySelector('[data-legal-agree]').textContent = this._t('legalAgree', 'I agree');
    this.renderInto(overlay.querySelector('.vex-legal-body'), { changes: true });
    // Escape and a click beside the card do nothing: only the two buttons
    // close this. The window behind keeps no keyboard either.
    const onKey = (e) => {
      if (e.key !== 'Escape' || document.getElementById('vex-legal-doc')) return;
      e.preventDefault(); e.stopPropagation();
    };
    document.addEventListener('keydown', onKey, true);
    // Focus that lands behind it comes back to it (the listener at the end
    // of this file).
    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      this.gateChanged();
      if (returnFocus?.isConnected) returnFocus.focus();
    };
    overlay.querySelector('[data-legal-agree]').addEventListener('click', () => { this.accept(); close(); });
    overlay.querySelector('[data-legal-quit]').addEventListener('click', () => {
      this.quit().catch(err => {
        console.error('[legal] could not quit:', err);
        window.showToast?.('Vex could not quit: ' + (err && err.message), 'error');
      });
    });
    document.body.appendChild(overlay);
    this.gateChanged();
    overlay.querySelector('.vex-legal-card').focus();
  },

  // A shipped document, read from the app folder and shown in a themed sheet
  // over everything (also over the agreement). Escape or Close goes back.
  async openDoc(name) {
    if (!Object.values(this.DOCS).includes(name)) throw new Error('Not one of Vex’s documents: ' + name);
    if (typeof window.vex?.legalRead !== 'function') throw new Error('window.vex.legalRead is missing');
    const text = await window.vex.legalRead(name);
    document.getElementById('vex-legal-doc')?.remove();
    const returnFocus = document.activeElement;
    const title = this._t(...this.TITLES[name]);
    const sheet = document.createElement('div');
    sheet.id = 'vex-legal-doc';
    sheet.className = 'vex-legal-overlay vex-legal-doc-overlay';
    sheet.innerHTML = `
      <div class="vex-legal-card vex-legal-doc" role="dialog" aria-modal="true" aria-labelledby="vex-legal-doc-title">
        <div class="vex-legal-doc-head">
          <h2 class="vex-legal-title" id="vex-legal-doc-title"></h2>
          <span style="flex:1"></span>
          <button type="button" class="vex-legal-btn" data-legal-doc-close></button>
        </div>
        <div class="vex-legal-doc-body" tabindex="0" aria-labelledby="vex-legal-doc-title"></div>
      </div>`;
    sheet.querySelector('#vex-legal-doc-title').textContent = title;
    sheet.querySelector('[data-legal-doc-close]').textContent = this._t('legalClose', 'Close');
    // VexMarkdown escapes everything first and only writes its own tags.
    sheet.querySelector('.vex-legal-doc-body').innerHTML = window.VexMarkdown.render(text);
    // A link to the other document opens it here; any other link opens in a
    // tab once the agreement is out of the way (a tab behind it is not seen).
    sheet.querySelector('.vex-legal-doc-body').addEventListener('click', (e) => {
      const link = e.target instanceof Element ? e.target.closest('a') : null;
      if (!link) return;
      e.preventDefault();
      const href = link.getAttribute('href') || '';
      const other = Object.values(this.DOCS).find(doc => href.endsWith('/' + doc));
      if (other) { this.openDoc(other).catch(err => console.error('[legal] could not open ' + other + ':', err)); return; }
      if (document.getElementById('vex-legal') || document.getElementById('vex-onboarding')) {
        window.showToast?.(this._t('legalLinkLater', 'Links open once you have agreed or closed setup.') , 'info');
        return;
      }
      if (typeof TabManager !== 'undefined') TabManager.createTab(href, true);
    });
    const close = () => {
      sheet.remove();
      document.removeEventListener('keydown', onKey, true);
      if (returnFocus?.isConnected) returnFocus.focus();
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    sheet.querySelector('[data-legal-doc-close]').addEventListener('click', close);
    document.body.appendChild(sheet);
    sheet.querySelector('[data-legal-doc-close]').focus();
    return sheet;
  },

  // Settings › About: "Accepted on <date>" under the document links.
  renderAbout() {
    const el = document.getElementById('setting-legal-accepted');
    if (!el) return;
    const at = this.acceptedAt();
    const when = at && !Number.isNaN(Date.parse(at)) ? new Date(at).toLocaleDateString() : null;
    el.textContent = when && !this.needed()
      ? this._t('legalAcceptedOn', 'Privacy policy and terms (version {v}) accepted on {d}').replace('{v}', this.acceptedVersion()).replace('{d}', when)
      : this._t('legalNotAccepted', 'Privacy policy and terms not accepted yet in this profile');
  },
};

if (typeof window !== 'undefined') {
  window.VexLegal = VexLegal;
  // Settings › Language switches at once; the About line went with it only
  // after a restart (found 2026-10-11).
  window.addEventListener('vex-lang-changed', () => VexLegal.renderAbout());
  // While the agreement is up (VexLegal.isUp): on the window, in the capture
  // phase, so it runs before every listener Vex has on the document or its
  // elements (the shortcut registry, the address bar, the tab strip...).
  window.addEventListener('keydown', (e) => {
    if (!VexLegal.isUp() || VexLegal._keyAllowed(e)) return;
    e.stopImmediatePropagation();
    if (!VexLegal._copyKey(e)) e.preventDefault();
  }, true);
  // It opens while Vex is still starting, and start-up later focuses the
  // address bar (seen live): focus that lands behind it comes back to it, so
  // a screen reader stays in it and no key goes to what is behind. A
  // document opened over it, or a Vex dialog, keeps its own focus.
  document.addEventListener('focusin', (e) => {
    if (!VexLegal.isUp()) return;
    if (e.target instanceof Element && e.target.closest(VexLegal.AGREEMENT)) return;
    VexLegal._focusAgreement();
  }, true);
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexLegal };
