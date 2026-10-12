(function () {
  const strings = {
    en: { retry: 'Retry', saveFailed: 'Changes could not be saved. Retry before closing.', cancel: 'Cancel', ok: 'OK', back: 'Back', next: 'Next', skip: 'Skip',
      welcome: 'Welcome to Vex', setupstyle: 'Choose your starting point', theme: 'Choose a theme', job: 'A Vex built for your work', language: 'Language · Dil', wisdom: 'Daily wisdom', name: 'What should we call you?', weather: 'Weather location', github: 'GitHub username', search: 'Default search engine', defaultbrowser: 'Make Vex your default', aicloud: 'Cloud AI (Claude)', ollama: 'Local AI (Ollama)', ondevice: 'On-device AI (WebGPU)', sync: 'Vex Sync', passwords: 'Password manager', done: 'All set', nearlyDone: 'nearly done', minuteLeft: 'about 1 minute left', minutesLeft: 'about {n} minutes left' },
    tr: { retry: 'Yeniden dene', saveFailed: 'Değişiklikler kaydedilemedi. Kapatmadan önce yeniden deneyin.', cancel: 'İptal', ok: 'Tamam', back: 'Geri', next: 'İleri', skip: 'Atla',
      welcome: 'Vex’e hoş geldiniz', setupstyle: 'Başlangıç düzeninizi seçin', theme: 'Bir tema seçin', job: 'Çalışma alışkanlıklarınıza uygun bir Vex', language: 'Dil · Language', wisdom: 'Günün sözü', name: 'Size nasıl hitap edelim?', weather: 'Hava durumu konumu', github: 'GitHub kullanıcı adı', search: 'Varsayılan arama motoru', defaultbrowser: 'Vex’i varsayılan tarayıcınız yapın', aicloud: 'Bulut yapay zekâsı (Claude)', ollama: 'Yerel yapay zekâ (Ollama)', ondevice: 'Cihaz üzerinde yapay zekâ (WebGPU)', sync: 'Vex eşitleme', passwords: 'Parola yöneticisi', done: 'Her şey hazır', nearlyDone: 'neredeyse bitti', minuteLeft: 'yaklaşık 1 dakika kaldı', minutesLeft: 'yaklaşık {n} dakika kaldı', notifications: 'Bildirimler', look: 'Bir görünüm seçin', performance: 'Hız, bellek ve gizlilik', browsing: 'Tarayıcının davranışı', aidata: 'Vex neleri okuyabilir' }
  };
  Object.assign(strings.en, { skipSetupAsk: 'Skip the rest of setup? What you have chosen so far is kept, everything else keeps its default, and Settings has all of it.' });
  Object.assign(strings.tr, { skipSetupAsk: 'Kurulumun geri kalanı atlansın mı? Şimdiye kadar seçtikleriniz korunur, geri kalan her şey varsayılan ayarında kalır ve hepsi Ayarlar’da bulunur.' });
  Object.assign(strings.en, { skipSetup: 'Skip setup', getStarted: 'Get started', finish: 'Finish', saveContinue: 'Save & continue', configured: 'Already set', confirm: 'Confirm', step: 'Step', of: 'of' });
  Object.assign(strings.tr, { skipSetup: 'Kurulumu atla', getStarted: 'Başlayalım', finish: 'Bitir', saveContinue: 'Kaydet ve devam et', configured: 'Zaten ayarlandı', confirm: 'Onayla', step: 'Adım', of: '/',
    'welcome.sub': 'Vex’i size göre ayarlayalım. İstemediğiniz adımları atlayabilir ve kurulumu daha sonra yeniden açabilirsiniz.',
    'setupstyle.sub': 'Görmek istediğiniz panelleri seçin. Seçimlerinizi daha sonra Ayarlar bölümünden değiştirebilirsiniz.',
    'theme.sub': 'Temanızı başlangıç sayfasından veya Ayarlar bölümünden istediğiniz zaman değiştirebilirsiniz.',
    'job.sub': 'İsteğe bağlı: çalışma alanınıza uygun tema ve günlük araçları seçin. Seçimlerinizi daha sonra değiştirebilirsiniz.',
    'language.sub': 'Başlangıç sayfası ve desteklenen kurulum metinlerinin dilini seçin. Bazı özelliklerde İngilizce metinler bulunabilir.',
    'wisdom.sub': 'Başlangıç sayfanızda her gün kısa bir söz görün. Kaynağını seçebilir veya tamamen kapatabilirsiniz.',
    'name.sub': 'Bu ad yalnızca başlangıç sayfasındaki karşılamada kullanılır. Boş bırakabilirsiniz.',
    'weather.sub': 'Bir şehir veya ilçe yazın ve hava durumunu görmek istediğiniz konumu seçin.',
    'github.sub': 'İsteğe bağlı: başlangıç sayfasında depo, takipçi ve etkinlik bilgilerinizi gösterir.',
    'search.sub': 'Adres çubuğunun ve başlangıç sayfasının kullanacağı arama motorunu seçin.',
    'defaultbrowser.sub': 'E-posta ve diğer uygulamalardaki bağlantıların Vex’te açılmasını sağlayın.',
    'aicloud.sub': 'Kendi Vex AI hizmetinizin adresini girin. Erişim anahtarını Bulut Hizmetleri ayarlarından kaydedin. Yerel yapay zekâ kullanacaksanız bu adımı atlayabilirsiniz.',
    'ollama.sub': 'Ollama ile modelleri cihazınızda çalıştırın. Açık bir Ollama hizmetini otomatik olarak arayacağız.',
    'ondevice.sub': 'Küçük bir modeli Vex içinde çalıştırın. İlk indirmeden sonra çevrimdışı kullanılabilir.',
    'sync.sub': 'Sekme, yer imi, geçmiş ve ayarlarınızı cihazlar arasında şifreleyerek eşitleyin. Mevcut bir hesap için kurtarma kodunuz gerekir.',
    'passwords.sub': 'Parolalar işletim sistemi anahtarıyla şifrelenir. İlk hesabınızı ekleyebilir veya bu adımı atlayabilirsiniz.',
    'done.sub': 'Hazırsınız. Bu seçenekleri daha sonra Ayarlar bölümünden değiştirebilirsiniz.',
    // The steps that were English in a Turkish setup (found 2026-10-10).
    'look.sub': 'Tarayıcının kendi biçimi: Vex’in kendi görünümü, buzlu Cam, Chrome, Firefox, Safari, Internet Explorer veya Netscape’ten alınmış bir görünüm ya da Fluent, Glossy, Neobrutal veya Terminal stili. Tema renkleriniz hepsinin üzerinde korunabilir.',
    'performance.sub': 'Vex’in gerçekte nasıl davranacağını belirleyen ayarlar. Çalışma biçiminize uyanı seçin ya da listeyi açıp dokuzunu da kendiniz ayarlayın.',
    'browsing.sub': 'Günlük davranışlar: sekmelerin yeri, fare hareketleri, çerez bildirimleri, kopyalamayı engelleyen siteler, oturumunuzun kaydedilmesi. Her biri daha sonra Ayarlar’da bir anahtardır.',
    'aidata.sub': 'İki özellik çalışmak için kendi verilerinizi okur: yapay zekâ geçmiş dizini (Vex AI ziyaret ettiğiniz sayfaları hatırlayabilsin diye) ve e-posta kodu doldurma (giriş kodu gelen kutunuzdan doldurulsun diye). İkisi de bu bilgisayarda kalır. Şimdi seçin; daha sonra Ayarlar’dan değiştirin.',
    privacy: 'Gizlilik seçimleri',
    'privacy.sub': 'İnternetteki bir hizmete soran üç özellik. Her biri sizin seçiminizdir ve her biri daha sonra Ayarlar’da bir anahtardır.',
    'notifications.sub': 'Hatırlatıcılar, alarmlar, sayfa değişikliği uyarıları ve izin verdiğiniz siteler Windows bildirimi olarak gelir. Size ulaştığından emin olmak için şimdi bir tane gönderin; görünmezse düzeltme Windows’tadır ve bu sayfa nerede olduğunu söyler.' });
  // Switching workspace with private or Tor tabs open (js/workspaces.js).
  Object.assign(strings.tr, { 'wsPrivate.title': 'Gizli ve Tor sekmeleri açık',
    'wsPrivate.one': 'Bir gizli veya Tor sekmesi açık. Hiçbir çalışma alanına ait değil; bir sonrakinde açık kalabilir ya da şimdi kapatılabilir. Kapatılan bir gizli veya Tor sekmesi geri getirilemez.',
    'wsPrivate.many': '{n} gizli veya Tor sekmesi açık. Hiçbir çalışma alanına ait değiller; bir sonrakinde açık kalabilir ya da şimdi kapatılabilirler. Kapatılan bir gizli veya Tor sekmesi geri getirilemez.',
    'wsPrivate.close': 'Bu sefer kapat', 'wsPrivate.keep': 'Açık kalsın', 'wsPrivate.always': 'Her zaman kapat',
    'wsPrivate.saved': 'Çalışma alanı değiştirdiğinizde gizli ve Tor sekmeleri kapanacak. Ayarlar › Genel › Çalışma alanları bunu geri değiştirir.' });
  // "Fill code from authenticator" (js/totp-autofill.js): the right-click row,
  // Ctrl+K and what it says when it cannot.
  Object.assign(strings.en, { menuFillTotp: 'Fill code from authenticator',
    totpOpenPage: 'Open a web page first',
    totpPrivate: 'Authenticator codes are never filled in a private or Tor tab',
    totpHttps: 'Authenticator codes are only filled on secure (https) pages',
    totpLocked: 'Vex is locked: unlock it, then try again',
    totpListFailed: 'Could not read your authenticator accounts: ',
    totpNoAccounts: 'No authenticator accounts yet: add one in the Authenticator panel first',
    totpNoneHere: 'No authenticator account for this site',
    totpPickAny: 'Pick the account to use on {host}. It is remembered for this site.',
    totpCodesFailed: 'Could not read the code: ',
    totpNoCode: 'That account has no code right now',
    totpNoField: 'No code field found on this page: click into the field and try again',
    totpFilled: 'Authenticator code filled', totpRemembered: 'Remembered for this site',
    totpWhich: "Which account's code?", totpNotNow: 'Not now', totpCodesFor: 'Authenticator codes for' });
  Object.assign(strings.tr, { menuFillTotp: 'Kimlik doğrulayıcıdan kod doldur',
    totpOpenPage: 'Önce bir web sayfası açın',
    totpPrivate: 'Kimlik doğrulayıcı kodları gizli veya Tor sekmelerinde asla doldurulmaz',
    totpHttps: 'Kimlik doğrulayıcı kodları yalnızca güvenli (https) sayfalarda doldurulur',
    totpLocked: 'Vex kilitli: kilidi açın, sonra yeniden deneyin',
    totpListFailed: 'Kimlik doğrulayıcı hesaplarınız okunamadı: ',
    totpNoAccounts: 'Henüz kimlik doğrulayıcı hesabı yok: önce Kimlik doğrulayıcı panelinden bir tane ekleyin',
    totpNoneHere: 'Bu site için kimlik doğrulayıcı hesabı yok',
    totpPickAny: '{host} sitesinde kullanılacak hesabı seçin. Bu site için hatırlanır.',
    totpCodesFailed: 'Kod okunamadı: ',
    totpNoCode: 'Bu hesabın şu anda kodu yok',
    totpNoField: 'Bu sayfada kod alanı bulunamadı: alana tıklayıp yeniden deneyin',
    totpFilled: 'Kimlik doğrulayıcı kodu dolduruldu', totpRemembered: 'Bu site için hatırlandı',
    totpWhich: 'Hangi hesabın kodu?', totpNotNow: 'Şimdi değil', totpCodesFor: 'Kimlik doğrulayıcı kodları:' });
  // The agreement at start (js/legal.js) and the wizard step that shows it.
  Object.assign(strings.en, { legal: 'Before you start', 'legal.sub': 'Vex does some things by itself. Read what they are, then agree to the privacy policy and terms to use Vex.',
    legalAgree: 'I agree', legalQuit: 'Quit Vex', legalWhatChanged: 'What changed', legalSummaryHead: 'What Vex does by itself',
    legalIntro: 'Please read this before you start. Vex does some things by itself, without a click each time:',
    legalReadFull: 'The full privacy policy and terms say what is sent, where, when, and how to turn each thing off.',
    legalReadPrivacy: 'Read the privacy policy', legalReadTerms: 'Read the terms of use', legalVersion: 'Document version {v}, last updated {d}',
    legalOpenFailed: 'Could not open the document', legalUpdatedTitle: 'Vex’s privacy policy and terms have changed',
    legalPrivacyTitle: 'Privacy policy', legalTermsTitle: 'Terms of use', legalClose: 'Close',
    legalLicenseTitle: 'License (MIT)', legalNoticesTitle: 'Third-party notices',
    legalLinkLater: 'Links open once you have agreed or closed setup.',
    legalAcceptedOn: 'Privacy policy and terms (version {v}) accepted on {d}', legalNotAccepted: 'Privacy policy and terms not accepted yet in this profile' });
  Object.assign(strings.tr, { legal: 'Başlamadan önce', 'legal.sub': 'Vex bazı şeyleri kendiliğinden yapar. Bunların neler olduğunu okuyun, ardından Vex’i kullanmak için gizlilik politikasını ve kullanım koşullarını kabul edin.',
    legalAgree: 'Kabul ediyorum', legalQuit: 'Vex’ten çık', legalWhatChanged: 'Neler değişti', legalSummaryHead: 'Vex’in kendiliğinden yaptıkları',
    legalIntro: 'Lütfen başlamadan önce okuyun. Vex bazı şeyleri her seferinde bir tıklama beklemeden, kendiliğinden yapar:',
    legalReadFull: 'Gizlilik politikasının ve kullanım koşullarının tamamı neyin, nereye, ne zaman gönderildiğini ve her birinin nasıl kapatılacağını anlatır.',
    legalReadPrivacy: 'Gizlilik politikasını oku', legalReadTerms: 'Kullanım koşullarını oku', legalVersion: 'Belge sürümü {v}, son güncelleme {d}',
    legalOpenFailed: 'Belge açılamadı', legalUpdatedTitle: 'Vex’in gizlilik politikası ve kullanım koşulları değişti',
    legalPrivacyTitle: 'Gizlilik politikası', legalTermsTitle: 'Kullanım koşulları', legalClose: 'Kapat',
    legalLicenseTitle: 'Lisans (MIT)', legalNoticesTitle: 'Üçüncü taraf bildirimleri',
    legalLinkLater: 'Bağlantılar, kabul ettikten veya kurulumu kapattıktan sonra açılır.',
    legalAcceptedOn: 'Gizlilik politikası ve kullanım koşulları (sürüm {v}) {d} tarihinde kabul edildi', legalNotAccepted: 'Gizlilik politikası ve kullanım koşulları bu profilde henüz kabul edilmedi' });
  function locale() { let value; try { value = localStorage.getItem('vex.lang') || 'en'; try { value = JSON.parse(value); } catch {} } catch {} return value === 'tr' ? 'tr' : 'en'; }
  function t(key, fallback) { return strings[locale()][key] || strings.en[key] || fallback || key; }
  window.VexI18n = { t, locale, strings };
})();
