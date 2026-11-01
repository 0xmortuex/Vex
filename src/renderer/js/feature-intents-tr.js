// === "What do you want to do?" in Turkish: the intent names, their one-line blurbs and the words around the tiles ===
//
// Keyed by the exact English text in js/feature-intents.js and js/feature-library.js, like the rest of the Turkish
// table (js/i18n-ui.js), and merged into it when this file loads. It is its own late file for the reason
// faq-tr.js is: i18n-ui.js is read at start-up, and these are only needed once the Library opens (it loads this
// together with js/feature-intents.js). tests/renderer/featureIntents.test.js checks every entry has its Turkish.
const VexFeatureIntentsTr = {
  'What do you want to do?': 'Ne yapmak istiyorsun?',
  'By area': 'Alana göre',
  'Choose what you want to do': 'Ne yapmak istediğini seç',
  'features': 'özellik',
  'Show all': 'Hepsini göster',
  'More areas': 'Daha fazla alan',
  'Fewer areas': 'Daha az alan',
  'Back to what you want to do': 'Ne yapmak istediğine dön',
  'Browse safely': 'Güvenle gez',
  'Blocking, Tor, passwords, and what each site may know about you.': 'Engelleme, Tor, parolalar ve her sitenin senin hakkında neleri bilebileceği.',
  'Tabs and speed': 'Sekmeler ve hız',
  'Tabs, windows, sessions, and finding what makes Vex slow.': 'Sekmeler, pencereler, oturumlar ve Vex’i neyin yavaşlattığını bulma.',
  'Look, feel and fun': 'Görünüm, his ve eğlence',
  'Themes, layout, the start page, and the playful bits.': 'Temalar, yerleşim, başlangıç sayfası ve eğlenceli kısımlar.',
  'Get things done': 'İşlerini hallet',
  'Notes, to-dos, reminders, the calendar, mail and automations.': 'Notlar, yapılacaklar, hatırlatıcılar, takvim, e-posta ve otomasyonlar.',
  'Read and research': 'Oku ve araştır',
  'Reading mode, translation, saving pages, sources and bookmarks.': 'Okuma modu, çeviri, sayfa kaydetme, kaynaklar ve yer imleri.',
  'Study': 'Ders çalış',
  'Study blocks, exams, course notes and cheat sheets.': 'Çalışma blokları, sınavlar, ders notları ve kopya kâğıtları.',
  'Watch, listen and capture': 'İzle, dinle ve kaydet',
  'Video, sound, screenshots, recording and screen sharing.': 'Video, ses, ekran görüntüleri, kayıt ve ekran paylaşımı.',
  'Game': 'Oyun',
  'Game mode, guides, patch news, and keeping Vex out of the way.': 'Oyun modu, rehberler, yama haberleri ve Vex’i yoldan çekme.',
  'Ask AI': 'Yapay zekâya sor',
  'The assistant, the agent, and which model answers.': 'Asistan, ajan ve hangi modelin cevap verdiği.',
  'Chat and apps': 'Sohbet ve uygulamalar',
  'Discord, WhatsApp, Spotify and other sidebar apps, and their notifications.': 'Discord, WhatsApp, Spotify ve diğer kenar çubuğu uygulamaları ile bildirimleri.',
  'Build and tools': 'Geliştir ve araçlar',
  'Developer tools, the Toolbox of small tools, and checks for a page you build.': 'Geliştirici araçları, küçük araçların Araç Kutusu ve yaptığın bir sayfa için denetimler.',
  'My data, sync and help': 'Verilerim, eşitleme ve yardım',
  'Sync, backup, export, updates, and help with Vex itself.': 'Eşitleme, yedekleme, dışa aktarma, güncellemeler ve Vex’in kendisiyle ilgili yardım.',
};

if (typeof VexI18nUI !== 'undefined' && VexI18nUI.TABLE && VexI18nUI.TABLE.tr) Object.assign(VexI18nUI.TABLE.tr, VexFeatureIntentsTr);
if (typeof window !== 'undefined') window.VexFeatureIntentsTr = VexFeatureIntentsTr;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexFeatureIntentsTr };
