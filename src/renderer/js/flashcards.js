// === Cards out of the things you highlighted ===============================
//
// Highlighting is where studying usually stops: the page is yellow, the point
// is "read again some time", and it never happens. Turning a highlight into a
// question you answer a few days later is what actually makes it stick.
//
// A card is made from a highlight — its text is the answer, the note you wrote
// on it (or the sentence around it) is the prompt — and then comes back on a
// spacing that grows each time you get it right: a day, three, a week, and on.
// Got it wrong? It comes back tomorrow, and the spacing drops back a couple of
// steps — not to the very start, or one bad evening would undo a month.
//
// Everything is local: the cards live in localStorage beside the highlights
// they came from, and no one is told how you did.
const Flashcards = {
  KEY: 'vex.flashcards',
  // How long until a card comes back, per step. The last one repeats.
  STEPS: [1, 3, 7, 16, 35, 90],
  MAX: 2000,

  all() { try { const a = JSON.parse(localStorage.getItem(this.KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } },
  save(cards) { try { localStorage.setItem(this.KEY, JSON.stringify(cards.slice(0, this.MAX))); } catch {} },

  day() { return 24 * 60 * 60 * 1000; },

  // A card the highlight already made is not made again: re-reading a page you
  // highlighted should not double your deck.
  has(cards, from) { return cards.some(c => c.from === from); },

  make({ id, text, note, url, title }, now = Date.now()) {
    const answer = String(text || '').replace(/\s+/g, ' ').trim();
    if (!answer) throw new Error('There is nothing highlighted to make a card from');
    const prompt = String(note || '').replace(/\s+/g, ' ').trim();
    return {
      id: 'card_' + now + '_' + Math.random().toString(36).slice(2, 7),
      from: id || '',
      // With no note of your own, the question is the one everybody asks of a
      // highlight: what did this say?
      question: prompt || 'What did you highlight here?',
      answer,
      url: url || '',
      title: String(title || '').trim(),
      step: 0,
      due: now,                       // a new card is due at once
      seen: 0,
      right: 0,
      at: now,
    };
  },

  add(highlight, now = Date.now()) {
    const cards = this.all();
    if (this.has(cards, highlight.id)) throw new Error('That highlight already has a card');
    const card = this.make(highlight, now);
    cards.unshift(card);
    this.save(cards);
    return card;
  },

  remove(id) {
    this.save(this.all().filter(c => c.id !== id));
  },

  due(now = Date.now()) { return this.all().filter(c => (c.due || 0) <= now).sort((a, b) => (a.due || 0) - (b.due || 0)); },

  // Right: this step's wait, then on to the next step — so a card answered
  // right for the first time comes back tomorrow, then in three days, and so
  // on. Wrong: back tomorrow, and the step drops — but not all the way to zero
  // for a card you have known before, or one bad day would undo a month.
  answer(id, right, now = Date.now()) {
    const cards = this.all();
    const card = cards.find(c => c.id === id);
    if (!card) throw new Error('That card is gone');
    const last = this.STEPS.length - 1;
    card.seen = (card.seen || 0) + 1;
    if (right) {
      card.right = (card.right || 0) + 1;
      card.due = now + this.STEPS[Math.min(card.step || 0, last)] * this.day();
      card.step = Math.min((card.step || 0) + 1, last);
    } else {
      card.step = Math.max(0, (card.step || 0) - 2);
      card.due = now + this.STEPS[0] * this.day();
    }
    card.lastAt = now;
    this.save(cards);
    return card;
  },

  // When the next one is due, said the way a person would.
  nextIn(now = Date.now()) {
    const soonest = this.all().map(c => c.due || 0).filter(Boolean).sort((a, b) => a - b)[0];
    if (soonest == null) return 'no cards yet';
    const mins = Math.round((soonest - now) / 60000);
    if (mins <= 0) return 'now';
    if (mins < 60) return 'in ' + mins + ' minutes';
    const hours = Math.round(mins / 60);
    if (hours < 24) return 'in ' + hours + ' hour' + (hours === 1 ? '' : 's');
    const days = Math.round(hours / 24);
    return 'in ' + days + ' day' + (days === 1 ? '' : 's');
  },

  // --- making cards from what is highlighted -------------------------------

  // Every highlight on this page that has no card yet.
  fromPage(url) {
    if (typeof Annotations === 'undefined') throw new Error('Highlights are not ready yet');
    const list = Annotations.forUrl(url) || [];
    const cards = this.all();
    return list.filter(h => h && h.text && !this.has(cards, h.id));
  },

  addPage(url, title) {
    const fresh = this.fromPage(url);
    if (!fresh.length) throw new Error('Nothing new to make cards from — highlight something on this page first');
    let made = 0;
    for (const h of fresh) {
      try { this.add({ ...h, url, title }); made++; } catch { /* already had one */ }
    }
    window.showToast?.(made + ' card' + (made === 1 ? '' : 's') + ' made — the first are due now');
    return made;
  },

  // --- going through them --------------------------------------------------

  open() {
    const cards = this.due();
    document.querySelector('.vex-cards-overlay')?.remove();
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const overlay = document.createElement('div');
    overlay.className = 'vex-cards-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.42);display:grid;place-items:center';
    overlay.innerHTML = `
      <div role="dialog" aria-modal="true" aria-label="Cards"
           style="width:min(560px,92vw);background:var(--bg);border:1px solid var(--border);border-radius:12px;box-shadow:0 18px 50px var(--vex-shadow-color,rgba(0,0,0,0.45));overflow:hidden">
        <div style="display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border)">
          <div style="flex:1;font-size:13.5px;font-weight:650;color:var(--text)">Cards</div>
          <div data-left style="font-size:11px;color:var(--text-muted)"></div>
        </div>
        <div data-body style="padding:18px 16px;min-height:150px"></div>
        <div data-foot style="display:flex;gap:8px;justify-content:flex-end;padding:10px 14px;border-top:1px solid var(--border)"></div>
      </div>`;

    const bodyEl = overlay.querySelector('[data-body]');
    const footEl = overlay.querySelector('[data-foot]');
    const leftEl = overlay.querySelector('[data-left]');
    let at = 0, showing = false;

    const button = (label, primary) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.style.cssText = 'font-size:12px;border-radius:7px;padding:6px 12px;cursor:pointer;border:1px solid var(--border);'
        + (primary ? 'background:var(--primary);color:#fff;border-color:var(--primary)' : 'background:none;color:var(--text)');
      return b;
    };

    const draw = () => {
      footEl.innerHTML = '';
      const card = cards[at];
      if (!card) {
        leftEl.textContent = '';
        bodyEl.innerHTML = `<div style="text-align:center;color:var(--text-muted);font-size:12.5px;padding:20px">
          ${cards.length ? 'Done — next card ' + esc(this.nextIn()) : 'Nothing due. Highlight something and make cards from it.'}</div>`;
        const close = button('Close', true);
        close.addEventListener('click', () => overlay.remove());
        footEl.appendChild(close);
        return;
      }
      leftEl.textContent = (at + 1) + ' of ' + cards.length;
      bodyEl.innerHTML = `
        <div style="font-size:14px;color:var(--text);line-height:1.5">${esc(card.question)}</div>
        ${showing ? `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);font-size:13px;color:var(--text);line-height:1.55">${esc(card.answer)}</div>
          ${card.title ? `<div style="margin-top:8px;font-size:10.5px;color:var(--text-muted)">${esc(card.title)}</div>` : ''}` : ''}`;
      if (!showing) {
        const show = button('Show the answer', true);
        show.addEventListener('click', () => { showing = true; draw(); });
        footEl.appendChild(show);
        return;
      }
      const wrong = button('Not yet');
      const right = button('Got it', true);
      wrong.addEventListener('click', () => { this.answer(card.id, false); at++; showing = false; draw(); });
      right.addEventListener('click', () => { this.answer(card.id, true); at++; showing = false; draw(); });
      footEl.append(wrong, right);
    };

    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); overlay.remove(); document.removeEventListener('keydown', onKey, true); }
    };
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) { overlay.remove(); document.removeEventListener('keydown', onKey, true); } });
    document.addEventListener('keydown', onKey, true);
    draw();
    document.body.appendChild(overlay);
    return overlay;
  },
};

if (typeof window !== 'undefined') window.Flashcards = Flashcards;
if (typeof module !== 'undefined' && module.exports) module.exports = { Flashcards };
