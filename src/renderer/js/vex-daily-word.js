// === Daily word: one five-letter puzzle a day, in the command bar ==========
//
// Off by default (Settings > Play: daily word). Open the command bar and run
// "Daily Word". One hidden word a day, six guesses, from a list that ships
// inside Vex: no network, no account, nothing shared, nothing sent. The word
// for a day is the same on every machine, worked out from the date alone.
//
// A streak is kept on this device and that is all it is: it counts days you
// solved and says so plainly. There is no "you lost your streak" and no
// reminder; a day you skipped is simply a day, and the next solve starts a
// count of one. A failed puzzle changes nothing.
const VexDailyWord = {
  STATE_KEY: 'vex.dailyWord.state',
  MAX_GUESSES: 6,
  LENGTH: 5,

  // Answers. Common, unambiguous words; the day picks one by its number.
  WORDS: ('about above actor adapt added admit adopt after again agent agree ahead alarm album alert alike alive allow alone along alter among angle angry apart apple apply arena argue arise armor array arrow aside asset avoid awake award aware badge baker basic basis beach beard begin being below bench berry birth black blade blame blank blast blaze bleed blend bless blind block blood bloom board boast bonus boost booth bound brain brand brave bread break breed brick bride brief bring broad brook brown brush build built bunch burst cabin cable cache camel canal candy canoe carry carve catch cause cedar chain chair chalk charm chart chase cheap check cheek cheer chess chest chief child chill chime choir chose civic claim class clean clear clerk click cliff climb clock close cloth cloud clown coach coast color comet coral couch count court cover crack craft crane crash crawl crazy cream creek crest crisp cross crowd crown crush curve cycle daily dance dairy daisy dealt delta dense depth diary dirty dodge doing donor doubt dozen draft drain drama drawn dream dress dried drift drill drink drive eager eagle early earth easel eight elbow elder elect elite empty enemy enjoy enter entry equal error essay event every exact exist extra fable faint fairy faith false fancy fault feast fence ferry fever fiber field fifth fifty fight final first flame flash fleet flint float flock flood floor flour fluid focus force forge forth forum found frame fresh front frost fruit funny gauge ghost giant given glass gleam globe glory glove grace grade grain grand grant grape graph grasp grass great green greet grill grove guard guess guest guide habit happy hardy haste hatch heart heavy hedge hello hence honey honor horse hotel house human humor ideal image index inner input irony ivory jelly jewel joint judge juice kayak kneel knife knock known label labor large laser later laugh layer learn lemon level light limit linen liter local logic loose lucky lunar lunch magic major maple march match mayor meant medal media melon mercy merit metal meter might minor minus mixed model money month moral motor mount mouse mouth movie music naive navel nerve never newly night noble noise north novel nurse ocean offer often olive onion opera orbit order other otter outer owner paint panel paper party pasta patch pause peace pearl pedal penny phase phone photo piano piece pilot pitch pizza place plain plane plant plate plaza point polar porch pound power press price pride prime print prize proof proud pulse punch pupil queen quest quick quiet quote radar radio raise rally ranch range rapid ratio reach ready realm rebel refer relax reply ridge right rival river roast robin robot rocky rough round route royal rural sable salad sauce scale scarf scene scent scope score scout screw sense serve seven shade shake shape share sharp sheep sheet shelf shell shift shine shirt shore short shout sight silly since skill skirt slate sleep slice slide slope small smart smile smoke snack snake solar solid solve sound south space spare spark speak speed spell spend spice spine spoon sport spray squad stack staff stage stair stamp stand stare start state steam steel steep steer stern stick still stone stood store storm story stove straw strip study stuff style sugar suite sunny super swamp sweet swift swing sword table taste teach tempo thank theme thick thing think third thumb tiger tight timer title toast today token tooth topic torch total touch tower trace track trade trail train treat trend trial tribe trick truck truly trunk trust truth tulip twice uncle under union unity until upper urban usual valid value vault venue verse video vigor vinyl visit vital vivid vocal voice waste watch water weave wheel where which while white whole whose widow width witty woman world worry worth wound wrist write wrong young youth zebra').split(' '),

  // ---- pure ---------------------------------------------------------------
  // Days since 1970-01-01 of a 'YYYY-MM-DD' key, by that calendar date alone.
  dayNumber(dayKey) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayKey));
    if (!m) throw new Error('Not a day: ' + dayKey);
    return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000);
  },
  // The word for a day. 7919 is prime and larger than the list, so stepping by
  // it visits every word once before any repeats: a list of N words gives N
  // different days in a row.
  wordFor(dayKey, words = this.WORDS) {
    const n = words.length;
    if (!n) throw new Error('The word list is empty');
    const i = ((this.dayNumber(dayKey) % n) * (7919 % n)) % n;
    return words[(i + n) % n];
  },
  normalize(text) { return String(text || '').trim().toLowerCase(); },
  validGuess(guess) { return /^[a-z]{5}$/.test(this.normalize(guess)); },
  // Per letter: 'hit' (right place), 'near' (in the word, elsewhere), 'miss'.
  // A repeated letter is marked only as many times as the answer holds it.
  score(guess, answer) {
    const g = this.normalize(guess);
    const a = this.normalize(answer);
    if (g.length !== a.length) throw new Error('A guess must be as long as the answer');
    const out = new Array(g.length).fill('miss');
    const left = {};
    for (let i = 0; i < a.length; i++) {
      if (g[i] === a[i]) out[i] = 'hit';
      else left[a[i]] = (left[a[i]] || 0) + 1;
    }
    for (let i = 0; i < g.length; i++) {
      if (out[i] === 'hit') continue;
      if (left[g[i]] > 0) { out[i] = 'near'; left[g[i]]--; }
    }
    return out;
  },
  // The best known state of each letter used so far: hit > near > miss.
  letterStates(guesses, answer) {
    const rank = { miss: 1, near: 2, hit: 3 };
    const states = {};
    for (const guess of guesses) {
      const s = this.score(guess, answer);
      [...this.normalize(guess)].forEach((ch, i) => {
        if (!states[ch] || rank[s[i]] > rank[states[ch]]) states[ch] = s[i];
      });
    }
    return states;
  },
  // The day before a 'YYYY-MM-DD' day.
  previousDay(dayKey) {
    const n = this.dayNumber(dayKey) - 1;
    const d = new Date(n * 86400000);
    const p = (v) => String(v).padStart(2, '0');
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
  },
  // The streak after a finished puzzle. A solve on the day after the last solve
  // adds one; a solve after any gap starts at one; a puzzle not solved leaves
  // everything as it was. Nothing ever goes down and nothing is announced.
  afterResult(state, dayKey, won) {
    const s = { streak: 0, best: 0, solved: 0, lastWon: '', ...(state || {}) };
    if (!won || s.lastWon === dayKey) return s;
    s.streak = s.lastWon && s.lastWon === this.previousDay(dayKey) ? s.streak + 1 : 1;
    s.best = Math.max(s.best, s.streak);
    s.solved += 1;
    s.lastWon = dayKey;
    return s;
  },

  // ---- saved state ---------------------------------------------------------
  // { streak, best, solved, lastWon, today: { day, guesses: [], done, won } }
  state() {
    let o = null;
    try { o = JSON.parse(localStorage.getItem(this.STATE_KEY) || 'null'); } catch { o = null; }
    return o && typeof o === 'object' ? o : {};
  },
  save(state) {
    try { localStorage.setItem(this.STATE_KEY, JSON.stringify(state)); } catch (err) {
      console.warn('[Daily word] could not save:', err && err.message);
      window.showToast?.('Could not save today\'s word: ' + ((err && err.message) || err), 'error');
    }
  },
  // Today's board, started fresh when the day changed.
  today(now = new Date()) {
    const day = VexFun.dayKey(now);
    const s = this.state();
    if (s.today && s.today.day === day && Array.isArray(s.today.guesses)) return { state: s, day, board: s.today };
    const board = { day, guesses: [], done: false, won: false };
    return { state: { ...s, today: board }, day, board };
  },

  // Applies one guess to today's board. Throws on an invalid one (the caller
  // shows the message); returns the board and the score.
  guess(text, now = new Date()) {
    const { state, day, board } = this.today(now);
    if (board.done) throw new Error('Today\'s word is already finished');
    if (!this.validGuess(text)) throw new Error('A guess is five letters, a to z');
    const g = this.normalize(text);
    if (board.guesses.includes(g)) throw new Error('You already tried that one');
    const answer = this.wordFor(day);
    const marks = this.score(g, answer);
    board.guesses.push(g);
    if (g === answer) { board.done = true; board.won = true; }
    else if (board.guesses.length >= this.MAX_GUESSES) { board.done = true; board.won = false; }
    let next = { ...state, today: board };
    if (board.done) next = { ...this.afterResult(next, day, board.won), today: board };
    this.save(next);
    return { board, marks, answer: board.done ? answer : null, state: next };
  },

  // ---- the screen ----------------------------------------------------------
  open() {
    const win = VexFun.open({ title: 'Daily Word', feature: 'word' });
    const reduced = VexFun.reducedMotion();
    const wrap = document.createElement('div');
    wrap.className = 'vexfun-word';
    const grid = document.createElement('div');
    grid.className = 'vexfun-word-grid';
    grid.setAttribute('role', 'table');
    grid.setAttribute('aria-label', 'Your guesses');
    const msg = document.createElement('div');
    msg.className = 'vexfun-msg';
    msg.setAttribute('role', 'status');
    msg.setAttribute('aria-live', 'polite');
    const form = document.createElement('form');
    form.className = 'vexfun-word-form';
    const input = document.createElement('input');
    input.type = 'text'; input.maxLength = 5; input.autocomplete = 'off'; input.spellcheck = false;
    input.className = 'set-input';
    input.setAttribute('aria-label', 'Your five-letter guess');
    input.placeholder = 'Five letters';
    const go = document.createElement('button');
    go.type = 'submit'; go.className = 'btn-primary'; go.textContent = 'Guess';
    form.append(input, go);
    const keys = document.createElement('div');
    keys.className = 'vexfun-word-keys';
    keys.setAttribute('aria-label', 'Letters used');
    wrap.append(grid, msg, form, keys);
    win.body.appendChild(wrap);

    const WORDS = { hit: 'right place', near: 'in the word, elsewhere', miss: 'not in the word' };
    const paint = (animateRow) => {
      const { day, board } = this.today();
      const answer = this.wordFor(day);
      grid.textContent = '';
      for (let r = 0; r < this.MAX_GUESSES; r++) {
        const row = document.createElement('div');
        row.className = 'vexfun-word-row';
        row.setAttribute('role', 'row');
        const g = board.guesses[r] || '';
        const marks = g ? this.score(g, answer) : [];
        for (let c = 0; c < this.LENGTH; c++) {
          const cell = document.createElement('span');
          cell.setAttribute('role', 'cell');
          cell.className = 'vexfun-tile' + (marks[c] ? ' is-' + marks[c] : '');
          cell.textContent = g[c] ? g[c].toUpperCase() : '';
          if (g[c]) cell.setAttribute('aria-label', g[c] + ', ' + WORDS[marks[c]]);
          if (animateRow === r && !reduced) cell.style.animationDelay = (c * 70) + 'ms';
          if (animateRow === r && !reduced) cell.classList.add('vexfun-flip');
          row.appendChild(cell);
        }
        grid.appendChild(row);
      }
      const st = this.letterStates(board.guesses, answer);
      keys.textContent = '';
      for (const ch of 'abcdefghijklmnopqrstuvwxyz') {
        const k = document.createElement('span');
        k.className = 'vexfun-key' + (st[ch] ? ' is-' + st[ch] : '');
        k.textContent = ch.toUpperCase();
        keys.appendChild(k);
      }
      const s = this.state();
      if (board.done) {
        form.hidden = true;
        msg.textContent = (board.won ? 'Solved in ' + board.guesses.length + '.' : 'The word was ' + answer.toUpperCase() + '.')
          + ' A new word tomorrow.' + (s.streak ? '  Days solved in a row: ' + s.streak + ' (best ' + s.best + ').' : '');
      }
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      try {
        const r = this.guess(input.value);
        input.value = '';
        msg.textContent = '';
        paint(r.board.guesses.length - 1);
        if (r.board.done && r.board.won) {
          VexFun.medal('play.daily-word.solved');
          if (r.state.streak >= 7) VexFun.medal('play.daily-word.week');
        }
      } catch (err) {
        msg.textContent = err.message;
      }
    });
    paint(-1);
    setTimeout(() => { try { if (!form.hidden) input.focus(); } catch { /* closed */ } }, 30);
    return win;
  },

  init() {
    VexFun.group('play-word-settings', 'Play: daily word', (g) => {
      VexFun.switchRow(g, 'word', 'Daily word', 'one five-letter puzzle a day in the command bar (Ctrl+K, "Daily Word"). The words ship with Vex; nothing is sent or shared');
      const s = this.state();
      const note = document.createElement('div');
      note.style.cssText = 'color:var(--text-muted);font-size:11px;margin-top:6px';
      note.textContent = 'Solved so far: ' + (s.solved || 0) + '. It counts days you solved and nothing else.';
      g.appendChild(note);
    });
    if (typeof CommandBar !== 'undefined' && Array.isArray(CommandBar.commands)) {
      CommandBar.commands.push({
        id: 'daily-word', label: 'Daily Word', icon: 'type',
        hint: 'Today\'s five-letter puzzle: six guesses, nothing shared',
        when: () => VexFun.may('word'),
        action: () => this.open(),
      });
    }
  },
};

if (typeof window !== 'undefined') {
  window.VexDailyWord = VexDailyWord;
  if (typeof document !== 'undefined' && typeof VexFun !== 'undefined' && document.querySelector) {
    try { VexDailyWord.init(); } catch (err) { console.error('[Daily word] could not start:', err); }
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexDailyWord };
