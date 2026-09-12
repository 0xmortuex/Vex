(function () {
  const strings = {
    en: { retry: 'Retry', saveFailed: 'Changes could not be saved. Retry before closing.', cancel: 'Cancel', ok: 'OK', back: 'Back', next: 'Next', skip: 'Skip',
      welcome: 'Welcome to Vex', setupstyle: 'Choose your starting point', theme: 'Choose a theme', job: 'A Vex built for your work', language: 'Language · Dil', wisdom: 'Daily wisdom', name: 'What should we call you?', weather: 'Weather location', github: 'GitHub username', search: 'Default search engine', defaultbrowser: 'Make Vex your default', aicloud: 'Cloud AI (Claude)', ollama: 'Local AI (Ollama)', ondevice: 'On-device AI (WebGPU)', sync: 'Vex Sync', passwords: 'Password manager', done: 'All set' },
    tr: { retry: 'Yeniden dene', saveFailed: 'Değişiklikler kaydedilemedi. Kapatmadan önce yeniden deneyin.', cancel: 'İptal', ok: 'Tamam', back: 'Geri', next: 'İleri', skip: 'Atla',
      welcome: 'Vex’e hoş geldiniz', setupstyle: 'Başlangıç düzeninizi seçin', theme: 'Bir tema seçin', job: 'Çalışma alışkanlıklarınıza uygun bir Vex', language: 'Dil · Language', wisdom: 'Günün sözü', name: 'Size nasıl hitap edelim?', weather: 'Hava durumu konumu', github: 'GitHub kullanıcı adı', search: 'Varsayılan arama motoru', defaultbrowser: 'Vex’i varsayılan tarayıcınız yapın', aicloud: 'Bulut yapay zekâsı (Claude)', ollama: 'Yerel yapay zekâ (Ollama)', ondevice: 'Cihaz üzerinde yapay zekâ (WebGPU)', sync: 'Vex eşitleme', passwords: 'Parola yöneticisi', done: 'Her şey hazır' }
  };
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
    'done.sub': 'Hazırsınız. Bu seçenekleri daha sonra Ayarlar bölümünden değiştirebilirsiniz.' });
  function locale() { let value; try { value = localStorage.getItem('vex.lang') || 'en'; try { value = JSON.parse(value); } catch {} } catch {} return value === 'tr' ? 'tr' : 'en'; }
  function t(key, fallback) { return strings[locale()][key] || strings.en[key] || fallback || key; }
  window.VexI18n = { t, locale, strings };
})();
