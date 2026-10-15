// === Autopilot: what needs you, in order =====================================
//
// The ranking half of the Autopilot inbox (js/autopilot.js). Pure: items go in,
// a score, a tier and the reasons come out, so every number is testable and
// nothing here touches the page, the network or a mailbox.
//
// One stream, five kinds of thing: mail, GitHub events, reminders, watched
// pages and releases. They are put on one scale by asking the same questions
// of each:
//
//   how much does this kind of thing want me?        (base, by kind and flag)
//   is there a time on it?                           (deadline / overdue)
//   do I usually care about this sender or repo?     (importance, learned here)
//   has it been waiting, or is it stale news?        (age)
//
// The score maps to three groups: "needs you now" (70 and up), "today" (40
// and up) and "FYI". Every row carries its reasons, because a ranking nobody
// can read is a ranking nobody trusts.
//
// What it learns is only this computer's: how often you opened, acted on or
// dismissed things from a sender or a repo. It is a few counters in
// localStorage, never sent anywhere, and "Forget what Autopilot learned"
// empties it.

const AutopilotRank = {
  NOW: 70,
  TODAY: 40,
  KINDS: ['mail', 'github', 'reminder', 'watch', 'release'],

  // Words that put a time on a message without a date being parsed.
  URGENT: /\b(urgent|asap|immediately|right away|time[- ]sensitive|final notice|last chance|action required|overdue|past due|expires? (?:today|tonight|tomorrow))\b/i,
  TODAY_WORDS: /\b(today|tonight|by (?:end of day|eod|cob|close of business|5 ?pm|noon)|this (?:morning|afternoon|evening))\b/i,
  TOMORROW_WORDS: /\b(tomorrow|by tomorrow)\b/i,
  WEEKDAY: /\bby (monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  DAYS: { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 },

  clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); },
  endOfDay(now) { const d = new Date(now); d.setHours(23, 59, 59, 999); return d.getTime(); },

  // A time the wording implies, or null. { at, urgent, why }.
  deadlineFromText(text, now = Date.now()) {
    const s = String(text == null ? '' : text);
    if (!s) return null;
    if (this.URGENT.test(s)) return { at: now, urgent: true, why: 'the wording says it is urgent' };
    if (this.TODAY_WORDS.test(s)) return { at: this.endOfDay(now), urgent: false, why: 'it asks for something today' };
    if (this.TOMORROW_WORDS.test(s)) return { at: this.endOfDay(now) + 24 * 3600000, urgent: false, why: 'it asks for something by tomorrow' };
    const m = this.WEEKDAY.exec(s);
    if (m) {
      const want = this.DAYS[m[1].toLowerCase()];
      const d = new Date(now);
      d.setHours(23, 59, 59, 999);
      let hops = 0;
      while (d.getDay() !== want && hops < 8) { d.setDate(d.getDate() + 1); hops++; }
      return { at: d.getTime(), urgent: false, why: 'it asks for something by ' + m[1].toLowerCase() };
    }
    return null;
  },

  // --- what Vex has learned about senders and repos --------------------------
  newModel() { return { v: 1, keys: {} }; },
  _raw(entry) {
    if (!entry) return 0;
    return 7 * Math.log2(1 + (entry.o || 0)) + 10 * Math.log2(1 + (entry.a || 0)) - 6 * Math.log2(1 + (entry.d || 0));
  },
  // Importance of an item from its keys, [-12, +24]. The first key is the
  // specific one (a sender, a repo); later ones (its domain) count half.
  importance(model, keys) {
    const table = (model && model.keys) || {};
    let value = 0;
    const why = [];
    (keys || []).forEach((key, i) => {
      const entry = table[key];
      const w = i === 0 ? 1 : 0.5;
      const part = this._raw(entry) * w;
      if (!part) return;
      value += part;
      const name = String(key).replace(/^[a-z]+:/, '');
      if (part > 0) why.push('you often act on ' + name);
      else why.push('you usually dismiss ' + name);
    });
    return { value: this.clamp(Math.round(value), -12, 24), why: value > 0 ? why.filter(w => w.startsWith('you often')) : why.filter(w => w.startsWith('you usually')) };
  },
  // event: 'open' | 'act' | 'dismiss'. Returns a NEW model.
  learn(model, keys, event, now = Date.now()) {
    const field = { open: 'o', act: 'a', dismiss: 'd' }[event];
    if (!field) throw new Error('Autopilot learns from open, act and dismiss, not "' + event + '"');
    const next = { v: 1, keys: { ...((model && model.keys) || {}) } };
    for (const key of keys || []) {
      if (!key) continue;
      const cur = { o: 0, a: 0, d: 0, ...(next.keys[key] || {}) };
      cur[field] += 1;
      // Old habits fade: a long history halves instead of growing without end.
      if (cur.o + cur.a + cur.d > 40) { cur.o = Math.floor(cur.o / 2); cur.a = Math.floor(cur.a / 2); cur.d = Math.floor(cur.d / 2); }
      cur.at = now;
      next.keys[key] = cur;
    }
    const names = Object.keys(next.keys);
    if (names.length > 400) {
      names.sort((a, b) => (next.keys[a].at || 0) - (next.keys[b].at || 0));
      for (const gone of names.slice(0, names.length - 400)) delete next.keys[gone];
    }
    return next;
  },

  // --- the score ---------------------------------------------------------------
  // item: { kind, ts, dueAt?, keys?, title?, sub?, flags? }
  // flags: needs | look | bulk (mail), failed | passed (run), changed, hit (a
  //   watched number reached its target), fired (a reminder that went off).
  base(item) {
    const f = item.flags || {};
    switch (item.kind) {
      case 'mail':
        if (f.bulk) return { n: 6, why: 'bulk mail' };
        if (f.needs) return { n: 62, why: f.flagged ? 'you flagged it' : 'a person is waiting on an answer' };
        return { n: 28, why: 'a person, but it asks nothing' };
      case 'reminder':
        if (f.fired) return { n: 85, why: 'a reminder that has gone off' };
        return { n: 38, why: 'a reminder coming up' };
      case 'github':
        if (f.failed) return { n: 58, why: 'a build or run failed' };
        if (f.release) return { n: 30, why: 'a new release' };
        return { n: 22, why: 'something finished' };
      case 'watch':
        if (f.hit) return { n: 55, why: 'a watched figure reached the number you set' };
        return { n: 36, why: 'a watched page changed' };
      case 'release':
        return { n: 26, why: 'new patch notes or a release' };
      default:
        return { n: 20, why: '' };
    }
  },
  score(item, ctx = {}) {
    const now = ctx.now == null ? Date.now() : ctx.now;
    const why = [];
    const b = this.base(item);
    let n = b.n;
    if (b.why) why.push(b.why);

    // A time on it: given by the source, or read out of the wording (weaker).
    let due = item.dueAt != null ? { at: item.dueAt, weight: 1, why: null } : null;
    if (!due && item.kind !== 'release') {
      const d = this.deadlineFromText((item.title || '') + ' ' + (item.sub || ''), now);
      if (d) due = { at: d.at, weight: 0.7, why: d.why, urgent: d.urgent };
    }
    if (due) {
      const dt = due.at - now;
      let add = 0;
      if (dt <= 0) { add = 35; why.push(due.why || (item.kind === 'reminder' ? 'it is due' : 'its time has passed')); }
      else if (dt <= 2 * 3600000) { add = 28; why.push(due.why || 'due within two hours'); }
      else if (due.at <= this.endOfDay(now)) { add = 18; why.push(due.why || 'due today'); }
      else if (dt <= 48 * 3600000) { add = 8; why.push(due.why || 'due within two days'); }
      n += Math.round(add * due.weight);
    }

    const imp = this.importance(ctx.model, item.keys);
    if (imp.value) { n += imp.value; why.push(...imp.why); }

    // Waiting: something that needs you gets heavier the longer it sits; news
    // gets lighter.
    const ageDays = item.ts ? Math.max(0, (now - item.ts) / 86400000) : 0;
    if (n >= this.TODAY && !(item.flags && item.flags.bulk)) {
      const wait = Math.min(8, Math.floor(ageDays));
      if (wait >= 2) { n += wait; why.push('waiting ' + Math.floor(ageDays) + ' days'); }
    } else {
      n -= Math.min(14, Math.floor(ageDays * 2));
    }
    n = this.clamp(Math.round(n), 0, 100);
    return { score: n, tier: n >= this.NOW ? 'now' : n >= this.TODAY ? 'today' : 'fyi', why };
  },

  // items -> { now, today, fyi } each sorted by score then newest, every item
  // given score, tier and why. ctx.hidden(item) lets the caller drop what
  // was dealt with. Pure.
  rank(items, ctx = {}) {
    const out = { now: [], today: [], fyi: [], hidden: 0 };
    for (const item of items || []) {
      if (typeof ctx.hidden === 'function' && ctx.hidden(item)) { out.hidden++; continue; }
      const r = this.score(item, ctx);
      out[r.tier].push({ ...item, score: r.score, tier: r.tier, why: r.why });
    }
    for (const k of ['now', 'today', 'fyi']) out[k].sort((a, b) => b.score - a.score || (b.ts || 0) - (a.ts || 0) || String(a.id).localeCompare(String(b.id)));
    return out;
  },

  summary(groups) {
    const n = groups.now.length, t = groups.today.length, f = groups.fyi.length;
    if (!n && !t && !f) return 'Nothing is waiting on you.';
    const parts = [];
    parts.push(n ? n + ' need' + (n === 1 ? 's' : '') + ' you now' : 'nothing needs you right now');
    if (t) parts.push(t + ' for today');
    if (f) parts.push(f + ' to know');
    return parts.join(', ') + '.';
  },
};

if (typeof window !== 'undefined') window.AutopilotRank = AutopilotRank;
if (typeof module !== 'undefined' && module.exports) module.exports = { AutopilotRank };
