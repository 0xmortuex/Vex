// === Subscription and renewal radar ========================================
//
// Finds the subscriptions and free trials you are paying for or about to be
// charged for, so a renewal is a date you chose to see and not a surprise.
//
// It works from what this PC already holds, and from nothing else:
//   * the saved logins' SITE NAMES and the date each was last changed (the
//     vault's metadata list: host, username, updatedAt). A login's password
//     is never read, nor the vault's export, nor a single saved secret;
//   * mail HEADERS the mail panel already memoised (sender, subject, date) —
//     never a message body;
//   * text you clipped (the clips inbox, and notes you filed as receipts);
//   * what you type in yourself.
// It contacts no service and no company, and opens nothing in the vault.
//
// Every detection is a PROPOSAL. It sits under "To confirm" with the evidence
// it came from until you confirm it, edit it or dismiss it; only confirmed
// items count in the totals and get a reminder. A dismissed one is not
// proposed again.
//
// The date math, the detection and the CSV are pure functions of plain data,
// tested without a window. Reminders use the app's existing reminders.

const RenewalRadar = {
  KEY: 'vex.renewals',
  DISMISSED_KEY: 'vex.renewals.dismissed',
  SETTINGS_KEY: 'vex.renewals.settings',
  MAIL_KEY: 'vex.mailHeaders',
  DEFAULT_REMIND_DAYS: 3,
  CYCLES: ['weekly', 'monthly', 'quarterly', 'yearly'],
  CYCLE_MONTHS: { monthly: 1, quarterly: 3, yearly: 12 },
  EVERY_MS: 6 * 3600 * 1000,

  // --- dates (plain "YYYY-MM-DD" strings, calendar math in UTC so a daylight
  // saving change can never move a renewal) --------------------------------
  isoOk(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return false;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  },
  _parts(iso) {
    if (!this.isoOk(iso)) throw new Error('Not a date: ' + iso);
    const [y, m, d] = iso.split('-').map(Number);
    return { y, m, d };
  },
  _fmt(y, m, d) { return String(y).padStart(4, '0') + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'); },
  daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); },     // m is 1-12
  today(now = new Date()) { return this._fmt(now.getFullYear(), now.getMonth() + 1, now.getDate()); },
  addDays(iso, n) {
    const p = this._parts(iso);
    const d = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
    return this._fmt(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  },
  daysBetween(a, b) {
    const pa = this._parts(a), pb = this._parts(b);
    return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
  },
  // Calendar months, keeping the day where the month has it and the last day
  // where it does not: 31 Jan + 1 month is 28 (29) Feb.
  addMonths(iso, n) {
    const p = this._parts(iso);
    const idx = p.y * 12 + (p.m - 1) + n;
    const y = Math.floor(idx / 12), m = (idx % 12 + 12) % 12 + 1;
    return this._fmt(y, m, Math.min(p.d, this.daysInMonth(y, m)));
  },
  // The k-th renewal counted from the anchor. Always from the anchor, never
  // from the previous result: a plan billed on the 31st is the 31st again in
  // March, not the 28th it was clamped to in February; and 29 Feb is 29 Feb
  // again in the next leap year.
  occurrence(anchor, cycle, k) {
    if (cycle === 'weekly') return this.addDays(anchor, 7 * k);
    const step = this.CYCLE_MONTHS[cycle];
    if (!step) throw new Error('Unknown billing cycle: ' + cycle);
    return this.addMonths(anchor, step * k);
  },
  // The first renewal on or after today.
  nextOnOrAfter(anchor, cycle, today) {
    if (!this.isoOk(anchor)) throw new Error('Not a date: ' + anchor);
    if (anchor >= today) return anchor;
    if (!cycle) return anchor;                       // no cycle: the date is what it is
    let k;
    if (cycle === 'weekly') k = Math.ceil(this.daysBetween(anchor, today) / 7);
    else {
      const a = this._parts(anchor), t = this._parts(today);
      k = Math.max(0, Math.floor(((t.y * 12 + t.m) - (a.y * 12 + a.m)) / this.CYCLE_MONTHS[cycle]) - 1);
    }
    while (this.occurrence(anchor, cycle, k) < today) k++;
    return this.occurrence(anchor, cycle, k);
  },
  // A trial of N days started on a date ends N days later.
  trialEnd(startIso, days) {
    if (!(days >= 1 && days <= 366)) throw new Error('A trial is 1 to 366 days long');
    return this.addDays(startIso, Math.round(days));
  },

  // --- money -----------------------------------------------------------------
  monthlyOf(cost, cycle) {
    if (cost == null || !(cost >= 0) || !cycle) return null;
    const per = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 }[cycle];
    return per == null ? null : cost * per;
  },
  round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; },
  // Confirmed subscriptions only (a trial is not a cost until it converts).
  // → { USD: { monthly, annual, count, unknown }, … } and `unpriced` count.
  totals(items) {
    const by = {};
    let unpriced = 0;
    for (const it of items) {
      if (it.status !== 'confirmed' || it.kind !== 'subscription' || it.cancelled) continue;
      const mo = this.monthlyOf(it.cost, it.cycle);
      if (mo == null) { unpriced++; continue; }
      const cur = it.currency || 'USD';
      const t = by[cur] || (by[cur] = { monthly: 0, annual: 0, count: 0 });
      t.monthly += mo; t.annual += mo * 12; t.count++;
    }
    for (const t of Object.values(by)) { t.monthly = this.round2(t.monthly); t.annual = this.round2(t.annual); }
    return { byCurrency: by, unpriced };
  },

  // --- CSV ------------------------------------------------------------------
  // A cell that starts with = + - @ is read as a formula by a spreadsheet; a
  // site name or a subject is attacker-chosen text, so it is neutralised.
  csvCell(v) {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  },
  toCsv(items, today = this.today()) {
    const rows = [['Name', 'Kind', 'Status', 'Cost', 'Currency', 'Billing cycle', 'Next date', 'Per month', 'Per year', 'Source']];
    for (const it of items) {
      const mo = it.kind === 'subscription' ? this.monthlyOf(it.cost, it.cycle) : null;
      const next = this.nextDate(it, today);
      rows.push([it.name, it.kind, it.status, it.cost == null ? '' : it.cost.toFixed(2), it.currency || '', it.cycle || '', next, mo == null ? '' : this.round2(mo).toFixed(2), mo == null ? '' : this.round2(mo * 12).toFixed(2), it.source || '']);
    }
    return rows.map(r => r.map(c => this.csvCell(c)).join(',')).join('\r\n') + '\r\n';
  },

  // --- one item ---------------------------------------------------------------
  nextDate(item, today = this.today()) {
    if (!item.anchor || !this.isoOk(item.anchor)) return '';
    if (item.kind === 'trial') return item.anchor;
    return this.nextOnOrAfter(item.anchor, item.cycle, today);
  },
  // "in 3 days" / "today" / "ended 2 days ago"
  when(item, today = this.today()) {
    const next = this.nextDate(item, today);
    if (!next) return 'date not known';
    const n = this.daysBetween(today, next);
    if (n === 0) return 'today';
    if (n === 1) return 'tomorrow';
    if (n > 1) return 'in ' + n + ' days';
    return (item.kind === 'trial' ? 'ended ' : 'was ') + (-n) + ' day' + (n === -1 ? '' : 's') + ' ago';
  },
  clean(raw, now = Date.now()) {
    const name = String(raw.name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!name) throw new Error('Give it a name');
    const kind = raw.kind === 'trial' ? 'trial' : 'subscription';
    let cost = null;
    if (raw.cost !== '' && raw.cost != null) {
      cost = Number(String(raw.cost).replace(',', '.'));
      if (!Number.isFinite(cost) || cost < 0 || cost > 1e6) throw new Error('The cost is not a number');
    }
    const cycle = raw.cycle || null;
    if (cycle && !this.CYCLES.includes(cycle)) throw new Error('Unknown billing cycle: ' + cycle);
    const anchor = raw.anchor || '';
    if (anchor && !this.isoOk(anchor)) throw new Error('The date is not a real date');
    const remindDays = raw.remindDays == null || raw.remindDays === '' ? null : Math.round(Number(raw.remindDays));
    if (remindDays != null && !(remindDays >= 0 && remindDays <= 60)) throw new Error('Remind between 0 and 60 days before');
    return {
      id: raw.id || 'ren_' + now.toString(36) + Math.random().toString(36).slice(2, 6),
      name, kind, cost, currency: String(raw.currency || 'USD').toUpperCase().slice(0, 4), cycle: kind === 'trial' ? null : cycle,
      anchor, source: raw.source || 'manual', evidence: String(raw.evidence || '').slice(0, 300),
      status: ['detected', 'confirmed', 'dismissed'].includes(raw.status) ? raw.status : 'confirmed',
      remindDays, reminderId: raw.reminderId || '', remindedFor: raw.remindedFor || '', cancelled: !!raw.cancelled,
    };
  },

  // When to remind: 09:00 local, N days before; if that time has gone but the
  // date has not, in one minute. → { at: Date, message } or null.
  reminderPlan(item, { now = new Date(), defaultDays = this.DEFAULT_REMIND_DAYS } = {}) {
    if (item.status !== 'confirmed' || item.cancelled) return null;
    const today = this.today(now);
    const next = this.nextDate(item, today);
    if (!next || next < today) return null;
    const days = item.remindDays == null ? defaultDays : item.remindDays;
    const p = this._parts(this.addDays(next, -days));
    let at = new Date(p.y, p.m - 1, p.d, 9, 0, 0);
    if (at.getTime() <= now.getTime()) at = new Date(now.getTime() + 60000);
    const what = item.kind === 'trial' ? item.name + ' free trial ends' : item.name + ' renews';
    const cost = item.kind === 'subscription' && item.cost != null ? ' (' + item.cost.toFixed(2) + ' ' + (item.currency || '') + ')' : '';
    return { at, message: what + ' ' + (days === 0 ? 'today' : days === 1 ? 'tomorrow' : 'on ' + next) + cost, forDate: next, days };
  },

  // --- detection --------------------------------------------------------------
  MONTHS: { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 },

  // A date written in words or as ISO, found in text. A year left out means
  // the next time that day comes round after `refIso`. All-numeric 03/04/2026
  // dates are not guessed at: day-first or month-first cannot be known.
  parseTextDate(text, refIso) {
    const s = String(text || '');
    const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(s);
    if (iso && this.isoOk(iso[0])) return iso[0];
    const mon = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
    const mdy = new RegExp('\\b' + mon + '\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b', 'i').exec(s);
    const dmy = new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?' + mon + '(?:,?\\s+(\\d{4}))?\\b', 'i').exec(s);
    let m, d, y;
    if (mdy) { m = this.MONTHS[mdy[1].toLowerCase()]; d = +mdy[2]; y = mdy[3] ? +mdy[3] : null; }
    else if (dmy) { d = +dmy[1]; m = this.MONTHS[dmy[2].toLowerCase()]; y = dmy[3] ? +dmy[3] : null; }
    else return '';
    if (y == null) {
      const ref = this._parts(refIso);
      y = ref.y;
      if (!this.isoOk(this._fmt(y, m, d)) || this._fmt(y, m, d) < refIso) y = ref.y + 1;
    }
    const out = this._fmt(y, m, d);
    return this.isoOk(out) ? out : '';
  },

  parseCost(text) {
    const s = String(text || '');
    const sym = { '$': 'USD', '€': 'EUR', '£': 'GBP', '₺': 'TRY' };
    const num = (v) => { const n = Number(v.replace(/,(\d{2})$/, '.$1').replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
    let m = /(US\$|CA\$|A\$|[$€£₺])\s?(\d{1,5}(?:[.,]\d{2})?)\b/.exec(s);
    if (m) {
      const c = m[1] === 'US$' ? 'USD' : m[1] === 'CA$' ? 'CAD' : m[1] === 'A$' ? 'AUD' : sym[m[1]];
      const n = num(m[2]);
      if (n != null) return { cost: n, currency: c };
    }
    m = /\b(\d{1,5}(?:[.,]\d{2})?)\s?(USD|EUR|GBP|TRY|TL|CAD|AUD)\b/i.exec(s);
    if (m) {
      const n = num(m[1]);
      if (n != null) return { cost: n, currency: m[2].toUpperCase() === 'TL' ? 'TRY' : m[2].toUpperCase() };
    }
    return null;
  },

  parseCycle(text) {
    const s = String(text || '').toLowerCase();
    if (/(\bannual|\byearly|\bper year|\ba year|\/\s?yr\b|\/\s?year\b|\bevery year|\b12[- ]month)/.test(s)) return 'yearly';
    if (/(\bquarterly|\bper quarter|\bevery 3 months|\b3[- ]month)/.test(s)) return 'quarterly';
    if (/(\bmonthly|\bper month|\ba month|\/\s?mo\b|\/\s?month\b|\bevery month|\b1[- ]month)/.test(s)) return 'monthly';
    if (/(\bweekly|\bper week|\ba week|\/\s?week\b|\bevery week)/.test(s)) return 'weekly';
    return null;
  },

  // Months between payments → the cycle those payments are on.
  cycleFromGaps(isoDates) {
    const d = [...new Set(isoDates)].sort();
    if (d.length < 2) return null;
    const gaps = [];
    for (let i = 1; i < d.length; i++) gaps.push(this.daysBetween(d[i - 1], d[i]));
    gaps.sort((a, b) => a - b);
    const g = gaps[Math.floor(gaps.length / 2)];
    if (g >= 6 && g <= 8) return 'weekly';
    if (g >= 26 && g <= 35) return 'monthly';
    if (g >= 84 && g <= 98) return 'quarterly';
    if (g >= 350 && g <= 380) return 'yearly';
    return null;
  },

  KNOWN: ['netflix', 'spotify', 'disney', 'hulu', 'youtube', 'apple', 'icloud', 'google one', 'dropbox', 'adobe', 'microsoft', 'office 365', 'github', 'notion', 'openai', 'chatgpt', 'anthropic', 'claude', 'nordvpn', 'expressvpn', 'proton', '1password', 'bitwarden', 'lastpass', 'duolingo', 'audible', 'kindle', 'patreon', 'medium', 'nytimes', 'new york times', 'amazon prime', 'prime video', 'playstation', 'xbox', 'game pass', 'nintendo', 'crunchyroll', 'canva', 'figma', 'slack', 'zoom', 'linkedin', 'grammarly', 'evernote', 'todoist', 'cloudflare', 'vercel', 'jetbrains', 'surfshark', 'deezer', 'tidal', 'twitch', 'discord', 'paramount', 'peacock', 'max', 'hbo', 'masterclass', 'coursera', 'skillshare', 'headspace', 'calm', 'strava', 'chess.com', 'wsj', 'economist', 'substack'],
  PROCESSORS: ['paypal', 'stripe', 'paddle', 'fastspring', 'braintree', 'square', 'klarna', 'google play', 'app store', 'itunes', 'microsoft store', 'gumroad'],
  STOP_NAMES: new Set(['free', 'your', 'new', 'current', 'monthly', 'annual', 'yearly', 'trial', 'plan', 'subscription', 'membership', 'premium', 'the', 'our', 'this', 'a']),

  isKnown(name) {
    const n = ' ' + String(name || '').toLowerCase().replace(/[^\p{L}\p{N}.]+/gu, ' ').trim() + ' ';
    return this.KNOWN.some(k => n.includes(' ' + k + ' ') || n.includes(' ' + k.replace(/ /g, '') + ' '));
  },

  _titleCase(s) { return s.replace(/\b([a-z])([a-z]*)/g, (m, a, b) => (m === m.toLowerCase() && m.length > 3 ? a.toUpperCase() + b : m)); },

  // The service a header is about. The sender's display name when it names a
  // company; when the sender is a payment processor, the name in the subject.
  serviceName(from, subject) {
    let f = from && typeof from === 'object' ? (from.name || from.address || '') : String(from || '');
    f = f.replace(/<[^>]*>/g, ' ').replace(/["']/g, '').trim();
    if (/^[^\s@]+@[^\s@]+$/.test(f)) {
      const labels = f.split('@')[1].toLowerCase().split('.');
      const tld2 = labels.length > 2 && ['co', 'com', 'org', 'net', 'ac'].includes(labels[labels.length - 2]);
      f = labels[labels.length - (tld2 ? 3 : 2)] || '';
    }
    f = f.replace(/\s+via\s+.*$/i, '')
      .replace(/\b(no[- ]?reply|do[- ]?not[- ]?reply|billing|receipts?|payments?|invoices?|support|accounts?|customer (?:service|care)|team|notifications?|inc\.?|llc|ltd|gmbh|the)\b/gi, ' ')
      .replace(/[^\p{L}\p{N}&.+' -]+/gu, ' ').replace(/\s+/g, ' ').trim();
    const processor = this.PROCESSORS.includes(f.toLowerCase());
    if (f && !processor) return f.length <= 40 ? this._titleCase(f) : f.slice(0, 40);
    const s = String(subject || '');
    const pats = [
      /\b(?:payment|charge|receipt|invoice)s?\s+(?:from|to)\s+([\p{L}\p{N}&.'+ -]{2,40}?)(?=\s+(?:subscription|membership|plan|order)\b|[\s]*[#:,.!(\-–—]|$)/iu,
      /\b(?:receipt|invoice|payment|charge)s?\s+(?:from|to|for)\s+([\p{L}\p{N}&.'+ -]{2,40}?)(?=\s+(?:subscription|membership|plan|order)\b|[\s]*[#:,.!(\-–—]|$)/iu,
      /\byour\s+(?:free\s+)?([\p{L}\p{N}&.'+ -]{2,40}?)\s+(?:free\s+)?(?:trial|subscription|membership|plan)\b/iu,
      /\b([\p{L}\p{N}&.'+-]{2,30})\s+(?:subscription|membership)\b/iu,
    ];
    for (const re of pats) {
      const m = re.exec(s);
      if (m) {
        const name = m[1].trim().replace(/\s+(?:inc|llc|ltd|gmbh|corp|co)\.?$/i, '');
        if (name && !this.STOP_NAMES.has(name.toLowerCase()) && !/^(?:free|premium) /i.test(name)) return this._titleCase(name);
      }
    }
    return processor ? f : '';
  },

  PROMO: /(\bnewsletter|\bwebinar|% off\b|\bdiscount|\bflash sale|\bblack friday|\bdeals?\b|\blimited offer|\bspecial offer|\bcoupon|\bsurvey|\binvite|\bgift card|\breferral)/i,
  SUB_WORD: /(\brenew\w*|\bauto[- ]?renew\w*|\brecurring|\bsubscription|\bmembership|\bbilling|\byour plan|\bplan (?:renewal|receipt)|\bper (?:month|year)|\/\s?(?:mo|month|yr|year)\b|\bmonthly|\bannual(?:ly)?|\byearly)/i,
  PAY_WORD: /\b(receipt|invoice|payment|charged|thanks for your (?:payment|purchase))\b/i,
  ENDED: /\b(cancel(?:l)?ed|cancellation (?:confirm\w*|complete)|has (?:been )?ended|was (?:cancel|terminat)\w*|no longer active)\b/i,
  TRIAL_END: /\btrial\b[^.]*\b(end|ends|ending|expire|expires|expiring|over|convert\w*|last day|days? left|remaining)\b|\b(end|ends|ending|expire|expires|expiring|last day)\b[^.]*\btrial\b/i,

  // One header → what kind of billing mail it is, or null.
  classify(h, today) {
    const subject = String(h.subject || '').replace(/\s+/g, ' ').trim();
    if (!subject) return null;
    const from = h.from;
    const name = this.serviceName(from, subject);
    const known = this.isKnown(name) || this.isKnown(subject);
    const hasTrial = /\btrial\b/i.test(subject);
    const ended = this.ENDED.test(subject) && (hasTrial || this.SUB_WORD.test(subject));
    if (ended) return { cancelled: true, name, subject };
    const promo = this.PROMO.test(subject) && !/\brenew/i.test(subject);
    const date = Number.isFinite(h.date) ? this._fmt(new Date(h.date).getFullYear(), new Date(h.date).getMonth() + 1, new Date(h.date).getDate()) : '';
    const ref = date || today;
    const money = this.parseCost(subject);
    const cycle = this.parseCycle(subject);
    let type = null;
    let anchor = '';
    const startM = /\b(\d{1,3})[- ]day (?:free )?trial\b/i.exec(subject);
    if (hasTrial && this.TRIAL_END.test(subject)) {
      type = 'trial';
      anchor = this.parseTextDate(subject, ref);
      if (!anchor) {
        const inDays = /\bin (\d{1,3}) days?\b/i.exec(subject);
        if (inDays) anchor = this.addDays(ref, +inDays[1]);
        else if (/\btomorrow\b/i.test(subject)) anchor = this.addDays(ref, 1);
        else if (/\b(today|tonight|last day)\b/i.test(subject)) anchor = ref;
      }
    } else if (hasTrial && (startM || /\b(welcome|started|activated|confirmed|begins?)\b/i.test(subject))) {
      type = 'trial';
      if (startM && date) anchor = this.trialEnd(date, +startM[1]);
    } else if (!promo && (this.SUB_WORD.test(subject) || (this.PAY_WORD.test(subject) && (known || cycle)))) {
      type = 'payment';
      if (/\b(will )?renew\w*\b/i.test(subject)) anchor = this.parseTextDate(subject, ref);
    }
    if (!type || !name) return null;
    return { type, name, subject, date, cost: money ? money.cost : null, currency: money ? money.currency : '', cycle, anchor, known };
  },

  // Mail headers [{ subject, from, date }] → proposals, one per service.
  detectFromMail(headers, { today = this.today() } = {}) {
    const groups = new Map();
    const cancelled = new Set();
    for (const h of Array.isArray(headers) ? headers : []) {
      if (!h || typeof h !== 'object') continue;
      const c = this.classify(h, today);
      if (!c) continue;
      const key = this.keyOf(c.name);
      if (c.cancelled) { cancelled.add(key); continue; }
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }
    const out = [];
    for (const [key, list] of groups) {
      if (cancelled.has(key)) continue;
      list.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      const trials = list.filter(x => x.type === 'trial');
      const pays = list.filter(x => x.type === 'payment');
      const lastTrial = trials[trials.length - 1];
      const lastPay = pays[pays.length - 1];
      const paidAfterTrial = lastPay && (!lastTrial || (lastPay.date || '') >= (lastTrial.date || ''));
      const last = paidAfterTrial ? lastPay : lastTrial;
      let item;
      if (!paidAfterTrial) {
        item = { name: last.name, kind: 'trial', cost: last.cost, currency: last.currency || 'USD', cycle: null, anchor: lastTrial.anchor || '' };
      } else {
        const priced = [...pays].reverse().find(x => x.cost != null);
        const stated = [...pays].reverse().find(x => x.cycle);
        const cycle = (stated && stated.cycle) || this.cycleFromGaps(pays.map(p => p.date).filter(Boolean));
        let anchor = lastPay.anchor || '';
        if (!anchor && cycle && lastPay.date) anchor = this.occurrence(lastPay.date, cycle, 1);
        item = { name: lastPay.name, kind: 'subscription', cost: priced ? priced.cost : null, currency: (priced && priced.currency) || 'USD', cycle: cycle || null, anchor };
      }
      const n = list.length;
      out.push({
        ...item, source: 'mail', status: 'detected',
        evidence: n + ' mail header' + (n === 1 ? '' : 's') + ', latest: "' + last.subject.slice(0, 120) + '"' + (last.date ? ' (' + last.date + ')' : ''),
        confidence: (last.known || n > 1 || item.cost != null) ? 'high' : 'medium', key,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  },

  // Text you clipped: lines like "Renews on March 3, 2026", "Next billing
  // date: 2026-04-01", "Your free trial ends 12 Nov", "$9.99 / month".
  detectFromText(text, { name = '', today = this.today(), ref = today, source = 'clip' } = {}) {
    const s = String(text || '').slice(0, 20000);
    const lines = s.split(/\r?\n/);
    let trialEnd = '', renew = '', money = null, cycle = null;
    for (const line of lines) {
      if (!money) money = this.parseCost(line);
      cycle = cycle || this.parseCycle(line);
      if (/\btrial\b/i.test(line) && /\b(end|ends|expire|expires|until|through)\b/i.test(line)) trialEnd = trialEnd || this.parseTextDate(line, ref);
      if (/\b(renew\w*|next (?:billing|payment|charge)|billed (?:on|again)|next invoice)\b/i.test(line)) renew = renew || this.parseTextDate(line, ref);
    }
    if (!trialEnd && !renew && !(money && cycle)) return null;
    // No name given: the first line up to the first price, number or dash.
    const first = (lines.find(l => l.trim()) || '').split(/[-–—:|$€£₺\d]/)[0].replace(/\s+/g, ' ').trim().split(' ').slice(0, 4).join(' ');
    const svc = String(name || '').trim() || this.serviceName(first, '') || '';
    if (!svc) return null;
    const trial = !!trialEnd && !renew;
    return {
      name: svc, kind: trial ? 'trial' : 'subscription', cost: money ? money.cost : null, currency: money ? money.currency : 'USD',
      cycle: trial ? null : cycle, anchor: trial ? trialEnd : renew, source, status: 'detected', key: this.keyOf(svc),
      evidence: 'Clipped text: "' + (lines.find(l => l.trim()) || '').trim().slice(0, 120) + '"', confidence: (trialEnd || renew) ? 'high' : 'medium',
    };
  },

  // The vault's metadata list: [{ host, username, updatedAt }]. Only the
  // site's name is looked at; a saved login at a known subscription service
  // is a candidate with no price and no date, for you to fill in.
  detectFromVault(entries) {
    const seen = new Set();
    const out = [];
    for (const e of Array.isArray(entries) ? entries : []) {
      const host = String(e && e.host || '').toLowerCase().replace(/^www\./, '');
      if (!host) continue;
      const labels = host.split('.');
      const tld2 = labels.length > 2 && ['co', 'com', 'org', 'net', 'ac'].includes(labels[labels.length - 2]);
      const base = labels[labels.length - (tld2 ? 3 : 2)] || labels[0];
      if (!this.isKnown(base)) continue;
      const key = this.keyOf(base);
      if (seen.has(key)) continue;
      seen.add(key);
      const when = e.updatedAt ? String(e.updatedAt).slice(0, 10) : '';
      out.push({
        name: this._titleCase(base), kind: 'subscription', cost: null, currency: 'USD', cycle: null, anchor: '', source: 'vault', status: 'detected', key,
        evidence: 'A saved login for ' + host + (when ? ', last changed ' + when : '') + '. Whether you pay for it is yours to say.', confidence: 'low',
      });
    }
    return out;
  },

  keyOf(name) { return String(name || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''); },

  // New proposals only: not already tracked and not dismissed before.
  fresh(found, items, dismissedKeys) {
    const have = new Set(items.map(i => this.keyOf(i.name)));
    const gone = new Set(dismissedKeys);
    const out = [];
    for (const f of found) {
      const k = f.key || this.keyOf(f.name);
      if (!k || have.has(k) || gone.has(k)) continue;
      have.add(k);
      out.push(f);
    }
    return out;
  },

  // --- storage ------------------------------------------------------------------
  _read(key, fallback) {
    let raw;
    try { raw = localStorage.getItem(key); } catch (err) { throw new Error('Could not read ' + key + ': ' + err.message); }
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch (err) { throw new Error(key + ' is not valid JSON: ' + err.message); }
  },
  items() { const a = this._read(this.KEY, []); return Array.isArray(a) ? a : []; },
  _save(items) { localStorage.setItem(this.KEY, JSON.stringify(items)); },
  dismissedKeys() { const a = this._read(this.DISMISSED_KEY, []); return Array.isArray(a) ? a : []; },
  settings() { const o = this._read(this.SETTINGS_KEY, {}); return { remindDays: Number.isInteger(o.remindDays) && o.remindDays >= 0 && o.remindDays <= 60 ? o.remindDays : this.DEFAULT_REMIND_DAYS }; },
  setRemindDays(n) {
    const v = Math.round(Number(n));
    if (!(v >= 0 && v <= 60)) throw new Error('Choose between 0 and 60 days');
    localStorage.setItem(this.SETTINGS_KEY, JSON.stringify({ ...this.settings(), remindDays: v }));
  },

  upsert(raw) {
    const items = this.items();
    const clean = this.clean(raw);
    const i = items.findIndex(x => x.id === clean.id);
    if (i >= 0) items[i] = { ...items[i], ...clean }; else items.push(clean);
    this._save(items);
    return clean;
  },
  setStatus(id, status) {
    const items = this.items();
    const it = items.find(x => x.id === id);
    if (!it) throw new Error('No such item');
    it.status = status;
    if (status === 'dismissed') {
      const d = this.dismissedKeys();
      const k = this.keyOf(it.name);
      if (!d.includes(k)) { d.push(k); localStorage.setItem(this.DISMISSED_KEY, JSON.stringify(d)); }
    }
    this._save(items);
    return it;
  },
  remove(id) { this._save(this.items().filter(x => x.id !== id)); },

  // --- the live sources (headers and metadata only) ---------------------------
  _mailHeaders() {
    const a = this._read(this.MAIL_KEY, []);
    return (Array.isArray(a) ? a : []).map(h => ({ subject: h.subject, from: h.from, date: h.date }));
  },
  async _vaultMeta() {
    if (!window.vex || typeof window.vex.vaultList !== 'function') return [];
    const list = await window.vex.vaultList();            // host, username, updatedAt: no secrets cross this channel
    return (Array.isArray(list) ? list : []).map(e => ({ host: e.host, updatedAt: e.updatedAt }));
  },
  async _clipTexts() {
    if (!window.vex || typeof window.vex.clipsInboxList !== 'function') return [];
    const r = await window.vex.clipsInboxList();
    return r && r.ok && Array.isArray(r.items) ? r.items.map(c => ({ text: String(c.text || ''), at: c.at })) : [];
  },
  _receiptNotes() {
    const notes = this._read('vex.notes', []);
    const looks = /\b(receipt|invoice|subscription|renewal|billing|clippings?)\b/i;
    return (Array.isArray(notes) ? notes : []).filter(n => n && (looks.test(n.title || '') || (Array.isArray(n.tags) && n.tags.some(t => looks.test(String(t)))))).map(n => ({ title: n.title || '', content: String(n.content || '') }));
  },

  // Looks at everything local and returns NEW proposals. Adds nothing.
  async scan(now = new Date()) {
    const today = this.today(now);
    const found = [];
    found.push(...this.detectFromMail(this._mailHeaders(), { today }));
    for (const c of await this._clipTexts()) {
      const d = c.at ? this.today(new Date(c.at)) : today;
      const f = this.detectFromText(c.text, { today, ref: d, source: 'clip' });
      if (f) found.push(f);
    }
    for (const n of this._receiptNotes()) {
      for (const block of n.content.split(/\n{2,}|^#{1,3}\s/m)) {
        const f = this.detectFromText(block, { today, source: 'note' });
        if (f) { f.evidence = 'In your note "' + n.title.slice(0, 60) + '": ' + f.evidence; found.push(f); }
      }
    }
    found.push(...(this.detectFromVault(await this._vaultMeta())));
    // Several sources for the same service: keep the most informative.
    const best = new Map();
    const rank = (f) => (f.anchor ? 4 : 0) + (f.cost != null ? 2 : 0) + (f.cycle ? 1 : 0) + (f.source === 'vault' ? -5 : 0);
    for (const f of found) { const k = f.key || this.keyOf(f.name); if (!best.has(k) || rank(f) > rank(best.get(k))) best.set(k, f); }
    return this.fresh([...best.values()], this.items(), this.dismissedKeys());
  },

  addProposals(found) {
    const items = this.items();
    const have = new Set(items.map(i => this.keyOf(i.name)));
    let n = 0;
    for (const f of found) {
      if (have.has(this.keyOf(f.name))) continue;
      items.push(this.clean({ ...f, status: 'detected' }));
      have.add(this.keyOf(f.name));
      n++;
    }
    this._save(items);
    return n;
  },

  // --- reminders (the app's existing ones) ---------------------------------------
  // For each confirmed item: one reminder for the next date. A changed date
  // or lead time replaces the old one. → { set, failed: [{ name, error }] }
  async syncReminders(now = new Date()) {
    const items = this.items();
    const defaults = this.settings().remindDays;
    const out = { set: 0, failed: [] };
    let changed = false;
    for (const it of items) {
      const plan = this.reminderPlan(it, { now, defaultDays: defaults });
      const stamp = plan ? plan.forDate + ':' + plan.days : '';
      if (!plan || it.remindedFor === stamp) continue;
      try {
        if (it.reminderId && window.vex && window.vex.reminders && typeof window.vex.reminders.delete === 'function') await window.vex.reminders.delete(it.reminderId);
        let made;
        if (typeof VexQuickReminder !== 'undefined') made = await VexQuickReminder.create(plan.message, plan.at);
        else if (window.vex && window.vex.reminders) made = await window.vex.reminders.create(plan.message, plan.at.getTime());
        else throw new Error('Reminders are not available');
        it.reminderId = made && made.id ? String(made.id) : '';
        it.remindedFor = stamp;
        out.set++; changed = true;
      } catch (err) { out.failed.push({ name: it.name, error: err.message }); }
    }
    if (changed) this._save(items);
    return out;
  },

  // Data hook for the brief: what is coming, and what costs. Draws nothing.
  snapshot(now = new Date(), withinDays = 14) {
    let items;
    try { items = this.items(); } catch { return null; }
    const today = this.today(now);
    const confirmed = items.filter(i => i.status === 'confirmed' && !i.cancelled);
    const upcoming = confirmed.map(i => ({ id: i.id, name: i.name, kind: i.kind, next: this.nextDate(i, today), cost: i.cost, currency: i.currency }))
      .filter(u => u.next && u.next >= today && this.daysBetween(today, u.next) <= withinDays).sort((a, b) => a.next.localeCompare(b.next));
    return { upcoming, toConfirm: items.filter(i => i.status === 'detected').length, totals: this.totals(items) };
  },

  // --- the panel -------------------------------------------------------------------
  async open() {
    if (!window.PageExport || typeof window.PageExport._sheet !== 'function') throw new Error('The renewal panel is not available');
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const { head, body, close } = window.PageExport._sheet('Subscriptions and renewals', 'vex-renewals-overlay');
    const btn = 'font-size:11.5px;color:var(--text);background:none;border:1px solid var(--border);border-radius:6px;padding:3px 9px;cursor:pointer';
    const fail = (err) => window.showToast?.(err.message, 'error');
    const money = (c, cur) => (c == null ? '' : c.toFixed(2) + ' ' + (cur || ''));
    let editing = null;                       // an item id, or 'new'
    let showDismissed = false;

    head.insertAdjacentHTML('beforeend', `
      <button data-scan type="button" style="${btn}">Look in my local data</button>
      <button data-add type="button" style="${btn}">Add one</button>
      <button data-csv type="button" style="${btn}">Export CSV</button>
      <button data-close type="button" aria-label="Close" style="display:inline-flex;background:none;border:none;cursor:pointer;color:var(--text-muted)">${window.VexIcons.svg('x', { size: 15 })}</button>`);

    const form = (it) => `<div data-form style="padding:10px 14px;background:var(--surface);border-bottom:1px solid var(--border);display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px">
        <label style="font-size:11px">Name<input data-f="name" class="set-input" style="width:100%;box-sizing:border-box" value="${esc(it.name)}"></label>
        <label style="font-size:11px">Kind<select data-f="kind" class="set-input" style="width:100%"><option value="subscription"${it.kind === 'subscription' ? ' selected' : ''}>Subscription</option><option value="trial"${it.kind === 'trial' ? ' selected' : ''}>Free trial</option></select></label>
        <label style="font-size:11px">Cost<input data-f="cost" class="set-input" inputmode="decimal" style="width:100%;box-sizing:border-box" value="${it.cost == null ? '' : it.cost}"></label>
        <label style="font-size:11px">Currency<input data-f="currency" class="set-input" maxlength="4" style="width:100%;box-sizing:border-box" value="${esc(it.currency || 'USD')}"></label>
        <label style="font-size:11px">Billed<select data-f="cycle" class="set-input" style="width:100%"><option value="">Not known</option>${this.CYCLES.map(c => `<option value="${c}"${it.cycle === c ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
        <label style="font-size:11px">Next renewal or trial end<input data-f="anchor" type="date" class="set-input" style="width:100%;box-sizing:border-box" value="${esc(it.anchor || '')}"></label>
        <label style="font-size:11px">Remind days before<input data-f="remindDays" class="set-input" inputmode="numeric" placeholder="${this.settings().remindDays}" style="width:100%;box-sizing:border-box" value="${it.remindDays == null ? '' : it.remindDays}"></label>
        <div style="display:flex;gap:6px;align-items:end"><button data-save type="button" class="btn-primary">Save</button><button data-cancel type="button" class="btn-secondary">Cancel</button></div>
      </div>`;

    const draw = () => {
      let items;
      try { items = this.items(); } catch (err) { body.textContent = err.message; return; }
      const today = this.today();
      const t = this.totals(items);
      const cur = Object.keys(t.byCurrency);
      const totalLine = cur.length
        ? cur.map(c => `${t.byCurrency[c].monthly.toFixed(2)} ${esc(c)} a month · ${t.byCurrency[c].annual.toFixed(2)} ${esc(c)} a year`).join(' &nbsp;|&nbsp; ') + (t.unpriced ? ` · ${t.unpriced} without a price` : '')
        : 'Confirm a subscription with a price to see the total.';
      const by = (s) => items.filter(i => i.status === s);
      const row = (it) => {
        const next = this.nextDate(it, today);
        const mo = it.kind === 'subscription' ? this.monthlyOf(it.cost, it.cycle) : null;
        return `<div data-row="${esc(it.id)}">
          <div style="display:flex;gap:10px;align-items:flex-start;padding:9px 14px;border-bottom:1px solid var(--border)">
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:600">${esc(it.name)} <span style="font-weight:400;font-size:11px;color:var(--text-muted)">${it.kind === 'trial' ? 'free trial' : 'subscription'}</span></div>
              <div style="font-size:11.5px;color:var(--text-muted)">${[it.cost != null ? money(it.cost, it.currency) + (it.cycle ? ' ' + it.cycle : '') : '', next ? (it.kind === 'trial' ? 'ends ' : 'renews ') + next + ' (' + this.when(it, today) + ')' : 'date not known', mo != null ? this.round2(mo).toFixed(2) + ' a month' : ''].filter(Boolean).map(esc).join(' · ')}</div>
              ${it.status === 'detected' ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${esc(it.evidence)}</div>` : ''}
            </div>
            <div style="display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end">
              ${it.status === 'detected' ? `<button data-act="confirm" type="button" style="${btn}">Confirm</button>` : ''}
              ${it.status === 'dismissed' ? `<button data-act="restore" type="button" style="${btn}">Restore</button>` : `<button data-act="edit" type="button" style="${btn}">Edit</button>`}
              ${it.status === 'confirmed' ? `<button data-act="cancelled" type="button" style="${btn}">I cancelled it</button>` : ''}
              ${it.status === 'detected' ? `<button data-act="dismiss" type="button" style="${btn}">Not a subscription</button>` : ''}
              <button data-act="delete" type="button" aria-label="Delete" style="${btn};display:inline-flex">${window.VexIcons.svg('trash', { size: 12 })}</button>
            </div>
          </div>
          ${editing === it.id ? form(it) : ''}
        </div>`;
      };
      const section = (title, list) => list.length ? `<div style="padding:8px 14px 2px;font-size:11px;color:var(--text-muted)">${esc(title)}</div>${list.map(row).join('')}` : '';
      const live = items.filter(i => i.status === 'confirmed' && !i.cancelled);
      const dismissed = by('dismissed');
      body.innerHTML = `<div style="padding:10px 14px;border-bottom:1px solid var(--border);font-size:12px">${totalLine}</div>
        ${editing === 'new' ? form({ name: '', kind: 'subscription', cost: null, currency: 'USD', cycle: 'monthly', anchor: '', remindDays: null }) : ''}
        ${section('To confirm: found in your local data, not yet counted', by('detected'))}
        ${section('Subscriptions', live.filter(i => i.kind === 'subscription'))}
        ${section('Free trials', live.filter(i => i.kind === 'trial'))}
        ${section('Cancelled', items.filter(i => i.status === 'confirmed' && i.cancelled))}
        ${dismissed.length ? `<div style="padding:8px 14px"><button data-toggle-dismissed type="button" style="${btn}">${showDismissed ? 'Hide' : 'Show'} ${dismissed.length} dismissed</button></div>${showDismissed ? dismissed.map(row).join('') : ''}` : ''}
        ${items.length || editing === 'new' ? '' : window.VexUI.emptyState('card', 'Nothing tracked yet', 'Choose "Look in my local data" to find subscriptions in your saved logins, mail subjects and clips, or add one yourself.')}
        <div style="padding:10px 14px;font-size:11px;color:var(--text-muted)">Everything here comes from this PC. Vex never contacts a service, never reads a message body and never opens a saved password.</div>`;

      body.querySelectorAll('[data-row]').forEach(rowEl => {
        const id = rowEl.dataset.row;
        rowEl.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', async () => {
          try {
            const act = b.dataset.act;
            if (act === 'confirm') { this.setStatus(id, 'confirmed'); await this.syncReminders(); }
            else if (act === 'dismiss') this.setStatus(id, 'dismissed');
            else if (act === 'restore') this.setStatus(id, 'detected');
            else if (act === 'edit') editing = id;
            else if (act === 'cancelled') {
              const it = this.items().find(x => x.id === id);
              const ok = await window.vexConfirm({ title: 'Mark ' + it.name + ' as cancelled?', message: 'It leaves the totals and its reminder no longer repeats.', okLabel: 'Mark cancelled' });
              if (!ok) return;
              const items = this.items(); items.find(x => x.id === id).cancelled = true; this._save(items);
            } else if (act === 'delete') {
              const it = this.items().find(x => x.id === id);
              const ok = await window.vexConfirm({ title: 'Delete ' + it.name + '?', message: 'It is removed from this list. It may be found again by the next scan.', okLabel: 'Delete', danger: true });
              if (!ok) return;
              this.remove(id);
            }
            draw();
          } catch (err) { fail(err); }
        }));
      });
      body.querySelector('[data-toggle-dismissed]')?.addEventListener('click', () => { showDismissed = !showDismissed; draw(); });
      const f = body.querySelector('[data-form]');
      if (f) {
        const rowId = editing;
        f.querySelector('[data-cancel]').addEventListener('click', () => { editing = null; draw(); });
        f.querySelector('[data-save]').addEventListener('click', async () => {
          const v = {};
          f.querySelectorAll('[data-f]').forEach(el => { v[el.dataset.f] = el.value; });
          try {
            const prior = rowId === 'new' ? { status: 'confirmed', source: 'manual' } : this.items().find(x => x.id === rowId);
            this.upsert({ ...prior, ...v, status: prior.status === 'detected' ? 'confirmed' : prior.status, id: rowId === 'new' ? undefined : rowId });
            editing = null;
            await this.syncReminders();
            draw();
          } catch (err) { fail(err); }
        });
      }
    };

    head.querySelector('[data-close]').addEventListener('click', close);
    head.querySelector('[data-add]').addEventListener('click', () => { editing = 'new'; draw(); });
    head.querySelector('[data-scan]').addEventListener('click', async () => {
      try {
        const found = await this.scan();
        const n = this.addProposals(found);
        window.showToast?.(n ? n + ' possible subscription' + (n === 1 ? '' : 's') + ' found. Nothing counts until you confirm it.' : 'Nothing new found in your local data.');
        draw();
      } catch (err) { fail(err); }
    });
    head.querySelector('[data-csv]').addEventListener('click', async () => {
      try {
        const items = this.items().filter(i => i.status !== 'dismissed');
        if (!items.length) throw new Error('There is nothing to export yet');
        if (!window.vex || typeof window.vex.saveTextFile !== 'function') throw new Error('Saving a file is not available');
        const r = await window.vex.saveTextFile('vex-subscriptions-' + this.today() + '.csv', this.toCsv(items), 'csv');
        if (r && r.ok) window.showToast?.('Saved ' + r.path);
      } catch (err) { fail(err); }
    });
    draw();
    return close;
  },

  // --- command bar and Settings, added at runtime ---------------------------------
  registerCommands() {
    if (typeof CommandBar === 'undefined' || !Array.isArray(CommandBar.commands)) return false;
    CommandBar.commands = CommandBar.commands.filter(c => !String(c.id || '').startsWith('renewal-radar'));
    CommandBar.commands.push(
      { id: 'renewal-radar', label: 'Subscriptions and Renewals', hint: 'Trials and subscriptions found in your local data, the next renewal date, and what they cost a month', icon: 'card', action: () => this.open().catch(err => window.showToast?.(err.message, 'error')) },
      { id: 'renewal-radar-export', label: 'Export Subscriptions as CSV', hint: 'Your confirmed and proposed subscriptions as a spreadsheet file', icon: 'download', action: async () => {
        try {
          const items = this.items().filter(i => i.status !== 'dismissed');
          if (!items.length) { window.showToast?.('Nothing to export yet'); return; }
          const r = await window.vex.saveTextFile('vex-subscriptions-' + this.today() + '.csv', this.toCsv(items), 'csv');
          if (r && r.ok) window.showToast?.('Saved ' + r.path);
        } catch (err) { window.showToast?.(err.message, 'error'); }
      } },
    );
    return true;
  },

  injectSettings() {
    const content = typeof document !== 'undefined' ? document.querySelector('#panel-settings .settings-content') : null;
    if (!content || content.querySelector('#setting-renewal-radar')) return false;
    const group = document.createElement('div');
    group.className = 'setting-group';
    group.id = 'setting-renewal-radar';
    group.dataset.keywords = 'subscription renewal trial billing cost recurring reminder csv';
    let days = this.DEFAULT_REMIND_DAYS;
    try { days = this.settings().remindDays; } catch { /* keep the default */ }
    group.innerHTML = `<label class="setting-label">Subscriptions and renewals</label>
      <div class="setting-info muted">Finds trials and subscriptions from your saved logins' site names, the mail subjects Vex already keeps, and text you clipped. It contacts no service, reads no message body and never opens a saved password. You confirm each one.</div>
      <div class="setting-toggle-row" style="margin-top:8px"><span>Remind me this many days before a renewal or trial end</span>
        <input type="number" min="0" max="60" class="set-input" style="width:80px" data-days value="${days}" aria-label="Days before a renewal to remind"></div>
      <div style="margin-top:8px"><button type="button" class="btn-secondary" data-open>Open subscriptions and renewals</button></div>`;
    group.querySelector('[data-days]').addEventListener('change', (e) => {
      try { this.setRemindDays(e.target.value); window.showToast?.('Saved. It applies to reminders set from now on.'); }
      catch (err) { window.showToast?.(err.message, 'error'); e.target.value = String(this.settings().remindDays); }
    });
    group.querySelector('[data-open]').addEventListener('click', () => this.open().catch(err => window.showToast?.(err.message, 'error')));
    content.appendChild(group);
    return true;
  },

  async tick(now = new Date()) {
    const r = await this.syncReminders(now);
    if (r.failed.length) throw new Error('Could not set ' + r.failed.length + ' renewal reminder' + (r.failed.length === 1 ? '' : 's') + ': ' + r.failed[0].error);
    return r;
  },

  init() {
    if (this._inited) return;
    this._inited = true;
    this.registerCommands();
    this.injectSettings();
    if (typeof VexJobs !== 'undefined') {
      this._job = VexJobs.every('Renewal radar', this.EVERY_MS, () => this.tick().catch(err => window.VexProblems?.note('Renewals', 'Could not set the renewal reminders', err)), { when: 'background', deferOnBattery: true });
    }
  },
};

if (typeof window !== 'undefined') window.RenewalRadar = RenewalRadar;
if (typeof module !== 'undefined' && module.exports) module.exports = { RenewalRadar };
