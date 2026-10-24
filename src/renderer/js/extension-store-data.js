// === The Vex Extension Store: the list ======================================
// One reviewable file. Every entry here is an extension from its REAL source;
// Vex hosts no copies of anyone's code:
//
//   * `webstoreId` entries install from the Chrome Web Store. Vex downloads the
//     package from Google's own update server and installs it only when its
//     CRX3 signatures check out, including that the id is the developer's own
//     key (src/main/webstore.js). The id was taken from the project's own README
//     or site, and proven by fetching and verifying its package.
//   * the catalogue's GitHub entries (js/extension-catalog.js: first-party
//     extensions and uBlock Origin) install from the publisher's own release
//     (src/main/extension-sources.js). They are added by combined() below.
//
// Each entry was installed into a throwaway profile and opened on the site it is
// for, then marked honestly:
//
//   level  'full'     it loads and does its job under Electron's extension support;
//          'partial'  it loads and the main part works, but something it offers
//                     does not (said in `caveat`), or Vex already does it itself;
//          'none'     does not work. Such an entry is dropped, not listed: the
//                     validity test refuses one.
//   works  what happens in Vex, in a sentence (the reason behind the badge);
//   caveat what will not work or what to know, or null;
//   sizeKB the package as the store served it when it was checked (a guide: updates change it);
//   tr     the Turkish of what / works / caveat, shown when Vex is in Turkish.
//
// Electron's limits (see extension-catalog.js): no blocking webRequest, no
// userScripts or DevTools panels, nothing in Private or Tor tabs.
const VexExtensionStoreData = (() => {
  const CATEGORIES = [
    { id: 'youtube', name: 'YouTube', tr: 'YouTube' },
    { id: 'privacy', name: 'Privacy and blocking', tr: 'Gizlilik ve engelleme' },
    { id: 'appearance', name: 'Appearance and dark mode', tr: 'Görünüm ve koyu mod' },
    { id: 'productivity', name: 'Productivity', tr: 'Üretkenlik' },
    { id: 'developer', name: 'Developer', tr: 'Geliştirici' },
    { id: 'media', name: 'Media and social', tr: 'Medya ve sosyal' },
    { id: 'shopping', name: 'Shopping and games', tr: 'Alışveriş ve oyun' },
    { id: 'vex', name: 'Made for Vex', tr: 'Vex için yapıldı' },
  ];

  const store = (id) => 'https://chromewebstore.google.com/detail/' + id;
  const web = (e) => ({ ...e, sourceUrl: store(e.webstoreId) });

  const WEB = [
    // ---- YouTube ------------------------------------------------------------
    web({
      key: 'ambient-light', webstoreId: 'paponcgjfojgemddooebbgniglhkajkj', name: 'Ambient Light for YouTube', publisher: 'Wessel Kroos', category: 'youtube', level: 'full', sizeKB: 973,
      what: 'Adds a soft glow around a YouTube video in the colours of the picture, like a TV with a light strip behind it, and can dim the rest of the page.',
      works: 'A content script on youtube.com that draws on a canvas, with its settings in extension storage. Both are supported.',
      caveat: 'The glow uses your graphics card. On a weak one, lower its quality in the extension\'s options.',
      tr: { what: 'YouTube videosunun çevresine görüntünün renklerinde yumuşak bir ışık ekler, arkasında ışık şeridi olan bir televizyon gibi. Sayfanın geri kalanını da kısabilir.',
        works: 'youtube.com üzerinde tuvale çizen bir içerik betiği; ayarları eklenti depolamasında durur. İkisi de desteklenir.',
        caveat: 'Işık ekran kartını kullanır. Zayıf bir kartta eklentinin seçeneklerinden kalitesini düşür.' },
    }),
  ];

  // The catalogue's own entries, in the store's terms. An entry whose name is
  // already on the shelf above is not listed twice; one that does not work is left out.
  const CATALOG_META = {
    rosuite: { publisher: '0xmortuex', category: 'vex', level: 'full',
      tr: { what: 'Daha iyi Roblox: sunucu tarayıcısı (en kalabalık ya da en boş olan önce, süzgeçler, sunucuya katıl), canlı oyun istatistikleri, profil değeri ve etkinliği, takas hesaplayıcısı.',
        works: 'Tam çalışır. İçerik betikleri ve Roblox’un herkese açık API’leri, mevcut Roblox oturumunla. Sekmelerde ve Roblox panelinde çalışır.',
        caveat: 'Takaslar ve sunucudaki arkadaşlar için Roblox’ta oturum açmış olman gerekir. Vex için yapıldı, açık kaynak.' } },
    'github-pulse': { publisher: '0xmortuex', category: 'vex', level: 'full',
      tr: { what: 'Her GitHub deposunun üstünde bir çubuk: son iş akışı çalıştırmaları, dağıtım ve sürüm, ayrıca Cloudflare Worker’ının en son ne zaman dağıtıldığı.',
        works: 'Tam çalışır. Bir içerik betiği ve GitHub’ın herkese açık API’si.',
        caveat: 'Cloudflare kısmı isteğe bağlıdır; seçeneklerinde salt okunur bir API belirteci ister. Vex için yapıldı, açık kaynak.' } },
    'devforum-plus': { publisher: '0xmortuex', category: 'vex', level: 'full',
      tr: { what: 'Geliştiriciler için Roblox Geliştirici Forumu: koddaki API adları belgelerine bağlanır, Alt+D ile belge araması, kodun yanında Kopyala düğmesi.',
        works: 'Tam çalışır. Bir içerik betiği ve haftalık bir API adı listesi.',
        caveat: 'Vex için yapıldı, açık kaynak.' } },
    chatkeep: { publisher: '0xmortuex', category: 'vex', level: 'full',
      tr: { what: 'ChatGPT, Claude veya Gemini sohbetini Markdown olarak dışa aktar ve üçü için tek bir istem kitaplığı tut.',
        works: 'Sekmelerde tam çalışır. Bir içerik betiği; hiçbir yere bir şey göndermez.',
        caveat: 'Sohbet siteleri sayfalarını sık değiştirir; ChatKeep güncellenene kadar bir dışa aktarma boş çıkabilir. Vex için yapıldı, açık kaynak.' } },
    'cineverse-plus': { publisher: '0xmortuex', category: 'vex', level: 'full',
      tr: { what: 'Her filmde IMDb puanı olan Paribu Cineverse ve sana en yakın sinemalardaki en yakın seanslar.',
        works: 'Tam çalışır. Konumun Ayarlar › Konum’dan gelir.',
        caveat: 'IMDb puanları için seçeneklerine bir kez yapıştırılan ücretsiz bir OMDb anahtarı gerekir. Vex için yapıldı, açık kaynak.' } },
    'dark-reader': { publisher: 'Dark Reader Ltd', category: 'appearance', level: 'full',
      tr: { what: 'Her site için koyu mod, site başına ayarlarla.',
        works: 'Tam çalışır. Yerel depolamalı bir içerik betiğidir; Electron’un en iyi desteklediği türdür.',
        caveat: 'Ayarları bu makinede kalır; eklenti eşitlemesi burada yok.' } },
    stylus: { publisher: 'Stylus contributors', category: 'appearance', level: 'full',
      tr: { what: 'Herhangi bir sitede kendi CSS’in ya da userstyles.world’deki stiller.',
        works: 'Tam çalışır; stiller içerik betiği olarak eklenir.',
        caveat: 'Stillerin bulut eşitlemesi çalışmaz; yerine yedek dışa aktar.' } },
    violentmonkey: { publisher: 'Violentmonkey contributors', category: 'developer', level: 'none', tr: null },
    'return-youtube-dislike': { publisher: 'Anarios and contributors', category: 'youtube', level: 'full',
      tr: { what: 'YouTube’a beğenmeme sayısını geri koyar.',
        works: 'Tam çalışır: bir içerik betiği ve bir ağ isteği; ikisi de desteklenir.',
        caveat: null } },
    'ublock-origin': { publisher: 'Raymond Hill', category: 'privacy', level: 'partial', redundant: true,
      tr: { what: 'En bilinen içerik engelleyici.',
        works: 'Kurulur ve arka plan sayfası çalışır ama burada istekleri ENGELLEYEMEZ: Electron eklentilere engelleyici API vermez. En fazla bazı sayfa öğelerini gizler.',
        caveat: 'Gerçek engelleme için Vex’in kendi engelleyicisini kullan: ağ katmanında çalışır ve varsayılan olarak açıktır.' } },
  };

  function combined(catalog) {
    const names = new Set(WEB.map(e => e.name.toLowerCase()));
    const gh = [];
    for (const c of (catalog && catalog.ENTRIES) || []) {
      const meta = CATALOG_META[c.id];
      if (!meta) throw new Error('extension-store-data: the catalogue entry "' + c.id + '" has no store entry in CATALOG_META');
      if (meta.level === 'none' || names.has(c.name.toLowerCase())) continue;
      gh.push({
        key: 'gh-' + c.id, catalogId: c.id, name: c.name, publisher: meta.publisher, category: meta.category,
        level: meta.level, what: c.what, works: c.works, caveat: c.caveat, redundant: !!meta.redundant,
        sourceUrl: c.source, tr: meta.tr,
      });
    }
    return WEB.concat(gh);
  }

  return { CATEGORIES, WEB, CATALOG_META, combined, web };
})();

if (typeof window !== 'undefined') window.VexExtensionStoreData = VexExtensionStoreData;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexExtensionStoreData };
