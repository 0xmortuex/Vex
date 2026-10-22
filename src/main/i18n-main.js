// === The language the main process speaks ====================================
//
// Vex's window is translated in the page (js/i18n-ui.js), but the native Windows dialogs (a file picker, "Vex stopped responding", the
// microphone question) are drawn by this process, which does not see the page's language. The window tells it (i18n:set-language) when
// the language is set or changed, and it is kept in a small file in the profile so the first dialog of the next start, which can come
// before any window exists ("Vex cannot open this profile"), is already in the right language.
//
// Only Turkish exists besides English. install(dialog) wraps the dialog functions so the text they are given is translated on its way
// to the screen; the call sites keep their English, and a text with no Turkish here is shown as written.
'use strict';

const FILE = 'language.txt';

// English -> Turkish. {1}, {2} stand for a value the code puts in; it is carried across as it is.
const TR = {
  'Choose the passwords file you exported': 'Dışa aktardığınız parola dosyasını seçin',
  'Password export (CSV)': 'Parola dışa aktarımı (CSV)',
  'Choose a picture to prepare': 'Hazırlanacak bir resim seçin',
  'Pictures': 'Resimler',
  'Save the prepared picture as a new file': 'Hazırlanan resmi yeni bir dosya olarak kaydedin',
  'Vex cannot open this profile': 'Vex bu profili açamıyor',
  '{1} Nothing was changed. To get your data back without Vex, close Vex and run: node scripts/profile-decrypt.js --profile "<profile folder>" (see docs/profile-lock.md).':
    '{1} Hiçbir şey değiştirilmedi. Verilerinizi Vex olmadan geri almak için Vex’i kapatın ve şunu çalıştırın: node scripts/profile-decrypt.js --profile "<profile folder>" (bkz. docs/profile-lock.md).',
  'Vex cannot ask for the passphrase': 'Vex parolayı soramıyor',
  'Save the recording': 'Kaydı kaydedin',
  'Listen to your microphone?': 'Mikrofonunuz dinlensin mi?',
  'Start listening': 'Dinlemeye başla',
  'Cancel': 'İptal',
  'Vex will listen to YOUR microphone for {1} and turn your voice into text.': 'Vex, {1} için SİZİN mikrofonunuzu dinleyecek ve sesinizi metne çevirecek.',
  'Only your microphone is used: the other people on a call are not captured, and the screen is not recorded. The sound is turned into text on this computer by the program you chose; nothing is sent anywhere. {1}Tell the people in the meeting that you are transcribing what you say. Vex will run, for each piece of audio: {2}':
    'Yalnızca mikrofonunuz kullanılır: aramadaki diğer kişiler yakalanmaz ve ekran kaydedilmez. Ses, seçtiğiniz program tarafından bu bilgisayarda metne çevrilir; hiçbir yere hiçbir şey gönderilmez. {1}Toplantıdaki kişilere söylediklerinizi yazıya döktüğünüzü söyleyin. Vex her ses parçası için şunu çalıştıracak: {2}',
  'Vex stopped responding': 'Vex yanıt vermeyi bıraktı',
  'The window is not answering. Reload it to get going again — your tabs and settings come back with it. Or wait, if something is still finishing.':
    'Pencere yanıt vermiyor. Yeniden devam etmek için yeniden yükleyin — sekmeleriniz ve ayarlarınız onunla birlikte geri gelir. Ya da bir şey hâlâ bitiyorsa bekleyin.',
  'Reload window': 'Pencereyi yeniden yükle',
  'Wait': 'Bekle',
  'Vex could not open this profile': 'Vex bu profili açamadı',
  'Where your clips are': 'Kliplerinizin bulunduğu yer',
  'Export a copy of this page': 'Bu sayfanın bir kopyasını dışa aktarın',
  'Web page, single file': 'Web sayfası, tek dosya',
  'Select extension folder (must contain manifest.json)': 'Uzantı klasörünü seçin (manifest.json içermeli)',
  'Select extension .zip or .crx': 'Uzantı .zip ya da .crx dosyasını seçin',
  'Extensions': 'Uzantılar',
  'Open a Vex pack': 'Bir Vex paketi açın',
  'Vex pack': 'Vex paketi',
  'Save your Vex pack': 'Vex paketinizi kaydedin',
  'Save': 'Kaydet',
  'Save as an e-book': 'E-kitap olarak kaydedin',
  'E-book': 'E-kitap',
  // The unlock window of an encrypted profile (main/profile-unlock.js)
  'Unlock Vex': 'Vex’in kilidini aç',
  'Too many tries - wait {1}': 'Çok fazla deneme - {1} bekleyin',
  'Wrong passphrase': 'Yanlış parola',
  'That recovery code does not open this profile': 'Bu kurtarma kodu bu profili açmıyor',
  'A recovery code is 32 letters and digits, in groups of four': 'Kurtarma kodu, dörderli gruplar halinde 32 harf ve rakamdır',
  'A passphrase is {1} to {2} characters': 'Bir parola {1} ile {2} karakter arasındadır',
  'Unknown way to unlock': 'Bilinmeyen kilit açma yolu',
  // Said to the page by passkeys.js
  '{1}. Use the site’s other sign-in methods.': '{1}. Sitenin diğer oturum açma yöntemlerini kullanın.',
  'Vex is locked. Unlock it to use a passkey.': 'Vex kilitli. Bir geçiş anahtarı kullanmak için kilidini açın.',
  '{1} asked for a passkey too many times, so Vex stopped asking for a minute.': '{1} çok fazla kez geçiş anahtarı istedi; bu yüzden Vex bir dakika sormayı bıraktı.',
};

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Keys with a hole become patterns that carry the value across.
const TEMPLATES = Object.keys(TR).filter(k => /\{\d\}/.test(k)).map(k => {
  const parts = k.split(/\{\d\}/);
  const order = [...k.matchAll(/\{(\d)\}/g)].map(m => m[1]);
  return { re: new RegExp('^' + parts.map(escapeRe).join('([\\s\\S]*?)') + '$'), order, value: TR[k] };
});

function translate(text, lang) {
  if (lang !== 'tr' || typeof text !== 'string' || !text) return text;
  if (Object.prototype.hasOwnProperty.call(TR, text)) return TR[text];
  for (const t of TEMPLATES) {
    const m = t.re.exec(text);
    if (m) return t.value.replace(/\{(\d)\}/g, (all, n) => { const i = t.order.indexOf(n); return i === -1 ? all : m[i + 1]; });
  }
  return text;
}

// The options of a dialog call with their text translated: title, message, detail, button labels, checkbox label, filter names.
function localizeOptions(opts, lang) {
  if (lang !== 'tr' || !opts || typeof opts !== 'object' || Array.isArray(opts)) return opts;
  const out = { ...opts };
  for (const k of ['title', 'message', 'detail', 'checkboxLabel', 'buttonLabel']) if (typeof out[k] === 'string') out[k] = translate(out[k], lang);
  if (Array.isArray(out.buttons)) out.buttons = out.buttons.map(b => translate(b, lang));
  if (Array.isArray(out.filters)) out.filters = out.filters.map(f => (f && typeof f.name === 'string' ? { ...f, name: translate(f.name, lang) } : f));
  return out;
}

function create({ fs, dir }) {
  let lang = 'en';
  const file = require('path').join(dir, FILE);
  try { const saved = fs.readFileSync(file, 'utf8').trim(); if (saved === 'tr') lang = 'tr'; }
  catch (err) { if (err && err.code !== 'ENOENT') console.warn('[i18n-main] the saved language could not be read:', err.message); }

  return {
    language: () => lang,
    // The window says which language Vex is in. Anything but 'tr' is English. Written only when it changes.
    setLanguage(next) {
      const value = next === 'tr' ? 'tr' : 'en';
      if (value === lang) return lang;
      lang = value;
      try { fs.writeFileSync(file, value + '\n', 'utf8'); }
      catch (err) { console.warn('[i18n-main] the language could not be saved for the next start:', err.message); }
      return lang;
    },
    t: (text) => translate(text, lang),
    // Wrap the dialog functions of Electron's dialog module (once) so the text they show is translated.
    install(dialog) {
      if (!dialog || dialog.__vexI18n) return;
      const self = this;
      for (const name of ['showMessageBox', 'showMessageBoxSync', 'showOpenDialog', 'showOpenDialogSync', 'showSaveDialog', 'showSaveDialogSync']) {
        const original = dialog[name];
        if (typeof original !== 'function') continue;
        dialog[name] = function (...args) { return original.apply(dialog, args.map(a => localizeOptions(a, self.language()))); };
      }
      if (typeof dialog.showErrorBox === 'function') {
        const original = dialog.showErrorBox;
        dialog.showErrorBox = function (title, content) { return original.call(dialog, translate(title, self.language()), translate(content, self.language())); };
      }
      Object.defineProperty(dialog, '__vexI18n', { value: true });
    },
  };
}

module.exports = { create, translate, localizeOptions, TR };
