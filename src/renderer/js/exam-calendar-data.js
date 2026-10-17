// === Official dates read from ÖSYM, for the exam calendar (T2-085) ===========================
//
// Every row below was read on 2026-10-17 from ÖSYM's published exam calendar,
// https://www.osym.gov.tr/Sayfa/SinavTakvimi (the page itself warns that dates can change), and
// is typed here as written there: the ones still ahead on that day. Nothing is fetched by Vex.
// The person adds them with one button and a confirmation; each is marked "verify on the official
// site" and carries its source link and the day it was read (ExamCalendar shows both).
//
// NOT here, because the official pages did not give them when this was written (2026-10-17):
//   * YKS, KPSS, ALES and YDS for 2027: ÖSYM's calendar listed only 2026 exams (the one 2027 row is a
//     Sayıştay result date).
//   * LGS 2027 and the central exams of MEB: the meb.gov.tr home page announced none.
// They are listed in PENDING so the calendar says so instead of staying silent; type them in, or
// import an .ics, when the bodies publish them.
const ExamCalendarData = {
  READ_ON: '2026-10-17',
  SOURCE: 'https://www.osym.gov.tr/Sayfa/SinavTakvimi',
  BODY: 'osym',
  // { uid, kind, title, day, endDay?, note? }  (day-month-year in the source, year-month-day here)
  ROWS: [
    { uid: 'osym-2026-dgs-ek-tercih', kind: 'application', title: '2026-DGS Ek Yerleştirme: tercih dönemi', day: '2026-10-15', endDay: '2026-10-22', note: 'Tercih: 15.10.2026 14:30 – 22.10.2026 23:59' },
    { uid: 'osym-2026-ales3-late', kind: 'late', title: '2026-ALES/3: geç başvuru', day: '2026-10-21', note: '21.10.2026 10:00 – 23:59' },
    { uid: 'osym-2026-kpss-onlisans-result', kind: 'result', title: '2026-KPSS Ön Lisans: sonuç', day: '2026-10-30' },
    { uid: 'osym-2026-kpss-dhbt', kind: 'exam', title: '2026-KPSS Din Hizmetleri Alan Bilgisi Testi (DHBT)', day: '2026-11-01' },
    { uid: 'osym-2026-kpss-ortaogretim-result', kind: 'result', title: '2026-KPSS Ortaöğretim: sonuç', day: '2026-11-19' },
    { uid: 'osym-2026-yds2', kind: 'exam', title: '2026-YDS/2', day: '2026-11-22', note: 'Sınav saati: 10:15' },
    { uid: 'osym-2026-kpss-dhbt-result', kind: 'result', title: '2026-KPSS DHBT: sonuç', day: '2026-11-25' },
    { uid: 'osym-2026-ales3', kind: 'exam', title: '2026-ALES/3', day: '2026-11-29', note: 'Sınav saati: 10:15' },
    { uid: 'osym-2026-eyds12-apply', kind: 'application', title: 'e-YDS 2026/12 İngilizce: başvuru', day: '2026-12-02', endDay: '2026-12-10' },
    { uid: 'osym-2026-yds2-result', kind: 'result', title: '2026-YDS/2: sonuç', day: '2026-12-10' },
    { uid: 'osym-2026-kpss2-tercih', kind: 'application', title: 'KPSS-2026/2 Yerleştirme: tercih dönemi', day: '2026-12-17', endDay: '2026-12-24' },
    { uid: 'osym-2026-ales3-result', kind: 'result', title: '2026-ALES/3: sonuç', day: '2026-12-17' },
    { uid: 'osym-2026-eyds12', kind: 'exam', title: 'e-YDS 2026/12 İngilizce', day: '2026-12-19' },
  ],
  PENDING: [
    'YKS 2027, KPSS 2027, ALES 2027 and YDS 2027: not on ÖSYM\'s calendar yet (read ' + '2026-10-17' + ')',
    'LGS 2027 and MEB central exams: no date announced on meb.gov.tr (read 2026-10-17)',
  ],
};

if (typeof window !== 'undefined') window.ExamCalendarData = ExamCalendarData;
if (typeof module !== 'undefined' && module.exports) module.exports = { ExamCalendarData };
