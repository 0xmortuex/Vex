// === A small Turkish word list (for js/turkish-helpers.js) =======================
//
// About 900 of the commonest Turkish words, written with their Turkish letters, in lower
// case, as stems or whole forms: pronouns, little words, numbers, days and months, family,
// school, home, places, the commonest nouns, adjectives and verb forms. It is NOT a
// dictionary: it is only big enough to tell "guzel" (güzel) from "guzel" the non-word, so
// the typing helper can put back ç ğ ı ö ş ü where exactly one reading is a known word.
// Words it does not hold are left alone, never "corrected". The list was written by hand for
// Vex (no dictionary was copied), so it has no licence of its own to carry.
const VexTurkishWords = {
  TEXT: [
    // little words, pronouns, question words
    've veya ama fakat ancak çünkü eğer ise de da ki mi mı mu mü ile için gibi kadar daha çok az en hiç her bütün bazı birçok başka diğer aynı kendi hem ya yani belki zaten artık hâlâ hala henüz şimdi sonra önce hemen yine tekrar bile sadece yalnız ayrıca ne neden niçin nasıl nerede nereye nereden kim kime kimin kimi hangi kaç kaçıncı ben sen o biz siz onlar bu şu bunlar şunlar bana sana ona bize size onlara beni seni onu bizi sizi onları benim senin onun bizim sizin onların',
    'evet hayır tamam lütfen teşekkür teşekkürler sağol merhaba selam günaydın iyi akşamlar geceler hoş geldiniz güle güle görüşürüz affedersiniz pardon',
    // numbers, time, days, months
    'bir iki üç dört beş altı yedi sekiz dokuz on yirmi otuz kırk elli altmış yetmiş seksen doksan yüz bin milyon milyar sıfır birinci ikinci üçüncü yarım çeyrek',
    'saniye dakika saat gün hafta ay yıl sene bugün dün yarın sabah öğle öğleden akşam gece şimdi bazen her zaman genellikle hafta sonu pazartesi salı çarşamba perşembe cuma cumartesi pazar',
    'ocak şubat mart nisan mayıs haziran temmuz ağustos eylül ekim kasım aralık ilkbahar yaz sonbahar kış mevsim',
    // people and family
    'insan adam kadın erkek çocuk bebek kız oğul anne baba kardeş abi abla ağabey teyze dayı amca hala nine dede büyükanne büyükbaba aile arkadaş dost komşu öğrenci öğretmen hoca doktor hemşire mühendis avukat işçi müdür başkan delege temsilci yazar okuyucu müşteri misafir',
    // school and work
    'okul ders sınıf sınav ödev kitap defter kalem silgi çanta tahta bilgi bilim fen matematik tarih coğrafya edebiyat felsefe fizik kimya biyoloji dil yabancı türkçe ingilizce almanca fransızca üniversite fakülte bölüm lise ortaokul ilkokul anaokulu not puan diploma mezun kayıt dönem yarıyıl konu soru cevap örnek problem çözüm formül denklem sayı toplam fark çarpım bölüm oran yüzde grafik tablo harita rapor makale tez araştırma kaynak kaynakça özet giriş sonuç bölüm sayfa paragraf cümle kelime harf',
    'iş çalışma çalışmak ofis şirket firma maaş ücret toplantı proje görev sorumluluk başvuru dilekçe belge evrak imza tarih adres telefon numara kimlik',
    // home, things, food
    'ev oda salon mutfak banyo yatak masa sandalye kapı pencere duvar çatı bahçe sokak cadde mahalle şehir kasaba köy ülke dünya',
    'su ekmek süt peynir yumurta çay kahve şeker tuz yağ et tavuk balık sebze meyve elma armut portakal üzüm domates salatalık patates soğan pirinç makarna çorba yemek kahvaltı öğle akşam tatlı',
    'para fiyat pahalı ucuz alışveriş market dükkan mağaza pazar banka hesap kart bilet ücretsiz indirim kargo sipariş ödeme fatura',
    // places, travel, nature
    'türkiye istanbul ankara izmir bursa antalya adana konya trabzon eskişehir kayseri gaziantep mersin denizli samsun avrupa asya amerika almanya fransa ingiltere japonya çin rusya',
    'yol köprü otobüs araba tren uçak gemi vapur metro durak istasyon havaalanı otogar bisiklet yolculuk seyahat tatil otel plaj deniz göl nehir dağ orman ova ada kıyı',
    'hava yağmur kar rüzgar güneş bulut sıcak soğuk ılık nem fırtına gök yıldız ay toprak taş ağaç çiçek yaprak hayvan kuş köpek kedi at inek koyun',
    // body, health
    'baş göz kulak burun ağız diş el kol ayak bacak kalp karın sırt boyun saç yüz ağrı hasta sağlık ilaç hastane doktor ateş nezle grip',
    // adjectives
    'güzel çirkin büyük küçük uzun kısa geniş dar yüksek alçak yeni eski genç yaşlı iyi kötü doğru yanlış kolay zor hızlı yavaş sıcak soğuk temiz kirli açık kapalı dolu boş ağır hafif sert yumuşak tatlı acı ekşi tuzlu mutlu üzgün yorgun aç tok zengin fakir önemli gerekli mümkün özel genel ortak farklı benzer tek çift tüm bütün gerçek sahte güçlü zayıf ucuz pahalı',
    // verbs (stems and common forms)
    'olmak olur oldu olacak olan var yok değil gelmek gel geldi gelir gidiyor gitmek git gitti gider yapmak yap yaptı yapar yapıyor etmek etti eder vermek ver verdi verir almak al aldı alır görmek gör gördü görür bakmak bak baktı bilmek bil bildi bilir istemek ister istedi söylemek söyle söyledi demek dedi diyor konuşmak konuş konuştu yazmak yaz yazdı okumak oku okudu öğrenmek öğren öğrendi öğretmek öğret anlamak anla anladı düşünmek düşün düşündü çalışmak çalış çalıştı oynamak oyna oynadı yemek yedi içmek iç içti uyumak uyu uyudu kalkmak kalk kalktı oturmak otur oturdu durmak dur durdu koşmak koş koştu yürümek yürü yürüdü beklemek bekle bekledi aramak ara aradı bulmak bul buldu kaybetmek kazanmak kazan kazandı başlamak başla başladı bitmek bitti bitir değiştirmek göstermek göster gösterdi kullanmak kullan kullandı açmak aç açtı kapatmak kapat kapattı sevmek sev sevdi sevgi beğenmek gülmek gül güldü ağlamak ağla ağladı sormak sor sordu cevaplamak yardım etmek yardımcı destek paylaşmak gönder göndermek gönderdi indirmek yüklemek kaydet kaydetmek sil silmek seçmek seç seçti hatırlamak unutmak unut unuttu geçmek geç geçti kalmak kal kaldı yaşamak yaşa yaşadı ölmek doğmak doğdu',
    // abstract and common nouns
    'şey şeyler zaman yer yön taraf kısım parça grup takım sistem düzen kural kanun yasa hak özgürlük adalet barış savaş devlet hükümet millet halk toplum kültür sanat müzik film oyun spor futbol maç takım haber gazete dergi radyo televizyon internet bilgisayar telefon ekran tuş dosya klasör program uygulama tarayıcı sekme pencere sayfa bağlantı adres şifre parola kullanıcı hesap ayar seçenek güvenlik gizlilik izin onay hata sorun uyarı mesaj posta iletişim görüntü ses resim fotoğraf video müzik not hatırlatıcı takvim görev liste plan hedef amaç neden sebep sonuç durum olay örnek fikir düşünce görüş yorum öneri karar seçim fırsat risk fayda zarar değer ölçü miktar sayı oran birim süre hız güç enerji madde hücre ışık renk şekil biçim çizgi nokta alan hacim ağırlık sıcaklık basınç hareket kuvvet',
    'kırmızı mavi yeşil sarı siyah beyaz turuncu mor pembe gri kahverengi',
    'güzel güzelim güzellik gerçekten kesinlikle muhtemelen belki herhalde mutlaka hemen çabuk yavaşça birlikte beraber karşı arasında üzerinde altında yanında önünde arkasında içinde dışında yakın uzak',
    'şöyle böyle öyle şimdilik sonunda başında ortasında içine dışına üstüne altına',
    'ırmak kıyı çiçek çocuk çalışkan çözüm çıkış çıkmak çıkar çıktı çıkarmak çağrı çağırmak çaba çay çerçeve çevre çevirmek çeviri çekmek çekti çıkış öğün öğrenci öğlen ödül ödev öncelik önemli öneri önlem öyle özgür özet özür üretim üretmek ürün üye üzerine üzgün ünlü ülke üst üç yaş yıldız yıldırım şarkı şiir şehir şimdi şirket şüphe ağaç ağır ağız ağrı ağabey doğa doğru doğum değer değişiklik değişim değil değişmek göğüs gönül görev görüntü gözlük güç güven güvenli güneş güney kuzey doğu batı gün gündem günlük'
  ].join(' '),

  _set: null,
  set() {
    if (!this._set) this._set = new Set(this.TEXT.split(/\s+/).filter(Boolean));
    return this._set;
  },
  count() { return this.set().size; },
};

if (typeof window !== 'undefined') window.VexTurkishWords = VexTurkishWords;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexTurkishWords };
