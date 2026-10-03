// @vitest-environment jsdom
//
// Read aloud picks a voice for the page's language (2026-10-03): a page with
// no <html lang> was read by the system's default voice, so on a PC set up in
// Turkish ("Tolga, tr-TR") English pages were read in Turkish. The language is
// now guessed from the text when the page declares none, and a page in a
// language no installed voice speaks says so in the bar.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

require('../../src/renderer/js/vex-icons.js');
const { ReadAloud, VexTextLang } = require('../../src/renderer/js/page-extras.js');

// ---------------------------------------------------------------------------
const SAMPLES = {
  en: [
    'The council voted on Tuesday night to approve the plan for a new bridge across the river, ending years of argument about the cost.',
    'If you have ever wondered why the sky is blue, the answer has to do with the way that sunlight is scattered by the air.',
    'She said that the company would not be able to deliver the order before the end of the month because of the strike.',
    'This guide explains how to install the app, how to sign in with your account and what to do when something goes wrong.',
  ],
  tr: [
    'Belediye meclisi salı akşamı nehrin üzerine yeni bir köprü yapılması için uzun süredir tartışılan planı onayladı.',
    'Gökyüzünün neden mavi olduğunu hiç merak ettiyseniz, bunun cevabı güneş ışığının havada nasıl dağıldığı ile ilgili.',
    'Şirketin grev nedeniyle siparişi ay sonundan önce teslim edemeyeceğini söyledi ve bu durum çok sayıda müşteriyi etkiledi.',
    'Bu rehber uygulamanın nasıl kurulacağını, hesabınızla nasıl giriş yapacağınızı ve bir sorun olduğunda ne yapmanız gerektiğini anlatıyor.',
  ],
  de: [
    'Der Stadtrat hat am Dienstagabend den Plan für eine neue Brücke über den Fluss genehmigt und damit einen jahrelangen Streit beendet.',
    'Wenn Sie sich schon einmal gefragt haben, warum der Himmel blau ist, dann liegt die Antwort in der Streuung des Sonnenlichts.',
    'Sie sagte, dass die Firma die Bestellung wegen des Streiks nicht vor dem Ende des Monats liefern kann.',
    'Diese Anleitung erklärt, wie man die App installiert, wie man sich mit dem Konto anmeldet und was zu tun ist, wenn etwas nicht funktioniert.',
  ],
  fr: [
    'Le conseil municipal a approuvé mardi soir le projet d\'un nouveau pont sur la rivière, mettant fin à des années de débat sur son coût.',
    'Si vous vous êtes déjà demandé pourquoi le ciel est bleu, la réponse est liée à la façon dont la lumière du soleil se disperse dans l\'air.',
    'Elle a dit que la société ne pourrait pas livrer la commande avant la fin du mois à cause de la grève.',
    'Ce guide explique comment installer l\'application, comment se connecter avec son compte et que faire quand quelque chose ne marche pas.',
  ],
  es: [
    'El consejo municipal aprobó el martes por la noche el plan para un nuevo puente sobre el río, poniendo fin a años de discusión sobre su coste.',
    'Si alguna vez te has preguntado por qué el cielo es azul, la respuesta tiene que ver con la forma en que la luz del sol se dispersa en el aire.',
    'Ella dijo que la empresa no podrá entregar el pedido antes del final del mes por culpa de la huelga.',
    'Esta guía explica cómo instalar la aplicación, cómo iniciar sesión con tu cuenta y qué hacer cuando algo no funciona.',
  ],
  it: [
    'Il consiglio comunale ha approvato martedì sera il progetto per un nuovo ponte sul fiume, mettendo fine a anni di discussioni sul costo.',
    'Se ti sei mai chiesto perché il cielo è blu, la risposta ha a che fare con il modo in cui la luce del sole si diffonde nell\'aria.',
    'Lei ha detto che la società non potrà consegnare l\'ordine prima della fine del mese a causa dello sciopero.',
    'Questa guida spiega come installare l\'applicazione, come accedere con il proprio account e che cosa fare quando qualcosa non funziona.',
  ],
  pt: [
    'A câmara municipal aprovou na terça-feira à noite o plano para uma nova ponte sobre o rio, pondo fim a anos de discussão sobre o custo.',
    'Se você já se perguntou por que o céu é azul, a resposta tem a ver com a forma como a luz do sol se espalha no ar.',
    'Ela disse que a empresa não vai conseguir entregar o pedido antes do fim do mês por causa da greve.',
    'Este guia explica como instalar o aplicativo, como entrar com a sua conta e o que fazer quando algo não funciona.',
  ],
  nl: [
    'De gemeenteraad heeft dinsdagavond het plan voor een nieuwe brug over de rivier goedgekeurd, na jaren van discussie over de kosten.',
    'Als je je ooit hebt afgevraagd waarom de lucht blauw is, dan heeft het antwoord te maken met de manier waarop zonlicht in de lucht wordt verstrooid.',
    'Ze zei dat het bedrijf de bestelling door de staking niet voor het einde van de maand kan leveren.',
    'Deze handleiding legt uit hoe je de app installeert, hoe je met je account inlogt en wat je moet doen als er iets niet werkt.',
  ],
};

describe('guessing the language of a page that does not declare one', () => {
  for (const [lang, paras] of Object.entries(SAMPLES)) {
    it('tells ' + lang + ' from a single short paragraph, every time', () => {
      for (const p of paras) expect([p, VexTextLang.detect(p)]).toEqual([p, lang]);
    });
    it('tells ' + lang + ' from a few paragraphs together', () => {
      expect(VexTextLang.detect(paras.join(' '))).toBe(lang);
    });
  }

  it('Turkish and English are never taken for each other, capitals and all', () => {
    expect(VexTextLang.detect('İSTANBUL BÜYÜKŞEHİR BELEDİYESİ YENİ BİR KARAR ALDI. Bu karar ile şehirde toplu taşıma daha ucuz olacak ve her gün çok sayıda kişi bundan yararlanacak.')).toBe('tr');
    expect(VexTextLang.detect('Read aloud now picks the right voice. It was reading English pages with a Turkish voice, and that is not what anyone wants.')).toBe('en');
    // English that mentions Turkish places is still English.
    expect(VexTextLang.detect('We flew from London to İzmir and then took the bus to Muğla, which was a long trip but the views were worth it.')).toBe('en');
  });

  it('knows the other writing systems by their script', () => {
    expect(VexTextLang.detect('Городской совет во вторник одобрил план строительства нового моста через реку.')).toBe('ru');
    expect(VexTextLang.detect('Міська рада у вівторок затвердила план будівництва нового мосту через річку.')).toBe('uk');
    expect(VexTextLang.detect('وافق مجلس المدينة مساء الثلاثاء على خطة لبناء جسر جديد فوق النهر.')).toBe('ar');
    expect(VexTextLang.detect('شورای شهر روز سه‌شنبه طرح ساخت یک پل جدید روی رودخانه را تصویب کرد.')).toBe('fa');
    expect(VexTextLang.detect('市议会周二晚上批准了在河上建造一座新桥的计划，结束了多年的争论。')).toBe('zh');
    expect(VexTextLang.detect('市議会は火曜日の夜、川に新しい橋を架ける計画を承認しました。')).toBe('ja');
    expect(VexTextLang.detect('시의회는 화요일 밤 강 위에 새 다리를 건설하는 계획을 승인했습니다.')).toBe('ko');
    expect(VexTextLang.detect('Το δημοτικό συμβούλιο ενέκρινε την Τρίτη το σχέδιο για μια νέα γέφυρα.')).toBe('el');
    expect(VexTextLang.detect('नगर परिषद ने मंगलवार रात नदी पर एक नए पुल के निर्माण की योजना को मंजूरी दी।')).toBe('hi');
    expect(VexTextLang.detect('מועצת העיר אישרה ביום שלישי את התוכנית לבניית גשר חדש מעל הנהר.')).toBe('he');
  });

  it('makes no guess from too little, numbers, or a language it does not know', () => {
    expect(VexTextLang.detect('')).toBe('');
    expect(VexTextLang.detect('Home')).toBe('');
    expect(VexTextLang.detect('12:30 — 14:45, 3 × 7 = 21')).toBe('');
    expect(VexTextLang.detect('Lorem ipsum dolor sit amet consectetur adipiscing elit sed eiusmod tempor incididunt labore dolore magna aliqua')).toBe('');
  });
});

// ---------------------------------------------------------------------------
describe('Read aloud chooses a voice for the language', () => {
  let spoken, voices;
  const runInPage = (js) => (0, eval)(js);
  class FakeUtterance { constructor(text) { this.text = text; } }
  const V = (name, lang, extra) => ({ name, lang, localService: true, default: false, ...extra });
  // The owner's PC: Turkish is the system default voice.
  const OWNER = () => [
    V('Microsoft Tolga - Turkish (Turkey)', 'tr-TR', { default: true }),
    V('Microsoft David - English (United States)', 'en-US'),
    V('Microsoft Zira - English (United States)', 'en-US'),
    V('Microsoft Hazel - English (United Kingdom)', 'en-GB'),
    V('Google Deutsch', 'de-DE', { localService: false }),
  ];

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('lang');
    document.body.innerHTML = '';
    spoken = [];
    voices = OWNER();
    globalThis.speechSynthesis = { speak: vi.fn((u) => spoken.push(u)), cancel: vi.fn(), getVoices: () => voices, addEventListener() {}, removeEventListener() {} };
    globalThis.SpeechSynthesisUtterance = FakeUtterance;
    window.showToast = () => {};
    ReadAloud._s = null;
    ReadAloud.volume = 0;
  });
  afterEach(() => {
    ReadAloud.stop(true);
    document.documentElement.removeAttribute('lang');
    delete globalThis.speechSynthesis; delete globalThis.SpeechSynthesisUtterance;
    delete globalThis.TabManager; delete globalThis.WebviewManager;
  });

  async function read(html, lang) {
    if (lang) document.documentElement.setAttribute('lang', lang);
    document.body.innerHTML = '<article>' + html + '</article>';
    const wv = { dataset: { tabId: 't1' }, getURL: () => 'https://site.test/a', executeJavaScript: (js) => Promise.resolve(runInPage(js)), addEventListener() {}, removeEventListener() {} };
    globalThis.TabManager = { activeTabId: 't1', tabs: [{ id: 't1' }] };
    globalThis.WebviewManager = { getActiveWebview: () => wv };
    expect(await ReadAloud.start()).toBe(true);
    return spoken[0];
  }
  const note = () => document.querySelector('#vex-tts-bar .vex-tts-note');
  const EN = SAMPLES.en.map(p => '<p>' + p + '</p>').join('');

  it('reads an English page with no lang in an English voice, not the Turkish default', async () => {
    const u = await read(EN);
    expect(ReadAloud._s.detected).toBe('en');
    expect(u.voice.lang).toBe('en-US');
    expect(u.lang).toBe('en-US');
    expect(note().hidden).toBe(true);
  });

  it('reads a Turkish page with no lang in the Turkish voice', async () => {
    const u = await read(SAMPLES.tr.map(p => '<p>' + p + '</p>').join(''));
    expect(u.voice.name).toMatch(/Tolga/);
  });

  it('prefers the exact locale, then the same language', async () => {
    expect((await read(EN, 'en-GB')).voice.name).toMatch(/Hazel/);
    ReadAloud.stop(true); spoken = [];
    expect((await read(EN, 'en-AU')).voice.lang).toMatch(/^en-/);
    ReadAloud.stop(true); spoken = [];
    expect((await read(EN, 'en_us')).voice.lang).toBe('en-US');
  });

  it('the voice you chose for a language still wins', async () => {
    localStorage.setItem('vex.readAloud', JSON.stringify({ voices: { en: 'Microsoft Hazel - English (United Kingdom)' } }));
    expect((await read(EN)).voice.name).toMatch(/Hazel/);
  });

  it('a voice picked in the bar keeps reading even where the language differs', async () => {
    await read(EN, 'en-US');
    ReadAloud.setVoice('Microsoft Tolga - Turkish (Turkey)');
    spoken.at(-1).onend();
    expect(spoken.at(-1).voice.name).toMatch(/Tolga/);
  });

  it('says once in the bar when no installed voice speaks the declared language', async () => {
    const u = await read('<p>Le conseil municipal a approuvé le projet. Elle a dit que la société ne pourrait pas livrer.</p>', 'fr-FR');
    expect(u.voice).toBeUndefined();                     // the system default speaks
    expect(u.lang).toBe('fr-fr');
    expect(note().hidden).toBe(false);
    expect(note().textContent).toBe('This page is in French, but no French voice is installed. Reading with Tolga (tr-TR).');
    expect(note().getAttribute('role')).toBe('status');
    ReadAloud._s.note = '';                          // were it said again, it would come back
    spoken[0].onend();
    expect(ReadAloud._s.note).toBe('');
  });

  it('says so for a guessed language too, and nothing when it cannot guess', async () => {
    await read(SAMPLES.it.map(p => '<p>' + p + '</p>').join(''));
    expect(note().textContent).toMatch(/^This page looks like Italian, but no Italian voice is installed/);
    ReadAloud.stop(true); spoken = [];
    const u = await read('<p>12:30 — 14:45</p><p>3 × 7 = 21</p>');
    expect(ReadAloud._s.detected).toBe('');
    expect(u.voice).toBeUndefined();
    expect(note().hidden).toBe(true);
  });

  it('a declared language is believed over the text, and junk tags are not languages', async () => {
    expect((await read(EN, 'tr')).voice.name).toMatch(/Tolga/);
    ReadAloud.stop(true); spoken = [];
    await read(EN, 'x-default');
    expect(ReadAloud._s.lang).toBe('');
    expect(ReadAloud._s.detected).toBe('en');
    expect(ReadAloud._langTag('und')).toBe('');
    expect(ReadAloud._langTag('iw')).toBe('he');
    expect(ReadAloud._langTag('no-NO')).toBe('nb-no');
  });

  it('waits for the voice list without complaining while it is still empty', async () => {
    voices = [];
    const u = await read(EN);
    expect(u.voice).toBeUndefined();
    expect(u.lang).toBe('en');
    expect(note().hidden).toBe(true);
    voices = OWNER();
    spoken[0].onend();
    expect(spoken[1].voice.lang).toBe('en-US');
  });
});
