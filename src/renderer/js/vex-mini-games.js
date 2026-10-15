// === Mini games for a page that will not load ==============================
//
// Off by default (Settings > Play: mini games). When it is on and a page fails
// for want of a connection, a small "Play while you wait" button appears over
// the tab. It opens a window with a runner, a word scramble and Lights Out.
// Everything is drawn here with a canvas and plain elements: no assets, no
// network, nothing saved except a best runner score on this device.
//
// Nothing counts against anybody: a game that ends says "Again" and nothing
// else. With "reduce motion" set, the runner is not offered (it is only
// motion) and the two puzzles are.
const VexMiniGames = {
  BEST_KEY: 'vex.fun.runner.best',

  // Chromium load errors that mean "could not reach it": offline, no such
  // name, unreachable, refused, reset, timed out, network changed, proxy down.
  // Not here: -3 (replaced by another load), -20/-27 (blocked on purpose) and
  // the certificate errors (-200..-299), which are answered elsewhere.
  OFFLINE_CODES: [-106, -105, -109, -102, -101, -118, -7, -21, -130],
  isOfflineCode(code) { return this.OFFLINE_CODES.includes(code); },

  // ---- runner (pure) -------------------------------------------------------
  RUN: { width: 600, height: 150, gravity: 1700, jump: 560, px: 40, pw: 22, ph: 28, baseSpeed: 260, maxSpeed: 520 },

  runnerStart() { return { y: 0, vy: 0, obstacles: [], score: 0, over: false, distance: 0 }; },
  // One step of dt seconds. `rng` is a function returning 0..1. Returns the
  // same state object, changed.
  runnerStep(s, dt, jump, rng) {
    const R = this.RUN;
    if (s.over) return s;
    if (jump && s.y === 0) s.vy = R.jump;
    s.vy -= R.gravity * dt;
    s.y = Math.max(0, s.y + s.vy * dt);
    if (s.y === 0) s.vy = 0;
    const speed = Math.min(R.maxSpeed, R.baseSpeed + s.score * 0.8);
    s.obstacles = s.obstacles.map(o => ({ ...o, x: o.x - speed * dt })).filter(o => o.x + o.w > -10);
    const last = s.obstacles[s.obstacles.length - 1];
    if (!last || last.x < R.width - (230 + rng() * 240)) {
      s.obstacles.push({ x: R.width, w: 16 + Math.floor(rng() * 14), h: 22 + Math.floor(rng() * 22) });
    }
    s.distance += speed * dt;
    s.score = Math.floor(s.distance / 12);
    for (const o of s.obstacles) {
      if (R.px < o.x + o.w && R.px + R.pw > o.x && s.y < o.h) { s.over = true; break; }
    }
    return s;
  },

  // ---- Lights Out (pure) ---------------------------------------------------
  // A board is an array of size*size booleans (true = lit). Pressing a cell
  // flips it and its four neighbours.
  lightsPress(board, i, size) {
    const out = board.slice();
    const x = i % size, y = Math.floor(i / size);
    const flip = (cx, cy) => { if (cx >= 0 && cx < size && cy >= 0 && cy < size) out[cy * size + cx] = !out[cy * size + cx]; };
    flip(x, y); flip(x - 1, y); flip(x + 1, y); flip(x, y - 1); flip(x, y + 1);
    return out;
  },
  lightsSolved(board) { return board.every(c => !c); },
  // A puzzle made by pressing random cells on an empty board, so it can always
  // be undone by pressing the same cells again.
  lightsMake(seed, size = 5) {
    const rng = VexFun.rng(seed);
    let board = new Array(size * size).fill(false);
    const presses = [];
    const target = 6 + Math.floor(rng() * 6);
    while (presses.length < target) {
      const i = Math.floor(rng() * size * size);
      if (presses.includes(i)) continue;
      presses.push(i);
      board = this.lightsPress(board, i, size);
    }
    // Pressing cells can cancel itself out to an empty board; press one more.
    if (this.lightsSolved(board)) board = this.lightsPress(board, 12 % (size * size), size);
    return { board, presses };
  },

  // ---- scramble (pure) -----------------------------------------------------
  scrambleWord(word, seed) {
    const letters = [...String(word)];
    if (letters.length < 2 || new Set(letters).size < 2) return letters.join('');
    const rng = VexFun.rng(seed);
    let out = letters;
    for (let tries = 0; tries < 20; tries++) {
      out = letters.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      if (out.join('') !== letters.join('')) break;
    }
    if (out.join('') === letters.join('')) out = letters.slice(1).concat(letters[0]);   // two or more different letters: a rotation differs
    return out.join('');
  },

  // ---- screens -------------------------------------------------------------
  _menu(win) {
    const body = win.body;
    body.textContent = '';
    const intro = document.createElement('p');
    intro.className = 'vexfun-msg';
    intro.textContent = 'Nothing is scored against you. Close this whenever you like.';
    body.appendChild(intro);
    const list = document.createElement('div');
    list.className = 'vexfun-menu';
    const add = (icon, name, hint, run) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'vexfun-menu-item';
      b.innerHTML = VexIcons.svg(icon, { size: 20 });
      const t = document.createElement('span');
      const n = document.createElement('strong'); n.textContent = name;
      const h = document.createElement('small'); h.textContent = hint;
      t.append(n, h);
      b.appendChild(t);
      b.addEventListener('click', run);
      list.appendChild(b);
      return b;
    };
    if (!VexFun.reducedMotion()) add('rocket', 'Runner', 'Space, Up or a click to jump', () => this._runner(win));
    add('type', 'Scramble', 'Put the letters back in order', () => this._scramble(win));
    add('grid', 'Lights Out', 'Switch every light off', () => this._lights(win));
    body.appendChild(list);
    const first = list.querySelector('button');
    if (first) setTimeout(() => { try { first.focus(); } catch { /* closed */ } }, 0);
  },

  _back(win) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn-secondary'; b.textContent = 'All games';
    b.addEventListener('click', () => { if (win._stop) { win._stop(); win._stop = null; } this._menu(win); });
    return b;
  },

  _runner(win) {
    const R = this.RUN;
    win.body.textContent = '';
    const canvas = document.createElement('canvas');
    canvas.width = R.width; canvas.height = R.height;
    canvas.className = 'vexfun-canvas';
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Runner game. Press space to jump over the blocks.');
    const info = document.createElement('div');
    info.className = 'vexfun-msg';
    info.setAttribute('role', 'status');
    const bar = document.createElement('div');
    bar.className = 'vexfun-bar';
    const again = document.createElement('button');
    again.type = 'button'; again.className = 'btn-primary'; again.textContent = 'Again'; again.hidden = true;
    bar.append(again, this._back(win));
    win.body.append(canvas, info, bar);
    const ctx = canvas.getContext('2d');
    if (!ctx) { info.textContent = 'This window cannot draw the game.'; return; }
    const css = getComputedStyle(win.root);
    const ink = css.getPropertyValue('--text').trim() || '#222';
    const accent = css.getPropertyValue('--vex-accent').trim() || '#6366f1';
    const rng = VexFun.rng(Date.now());
    let s = this.runnerStart();
    let jump = false, last = 0, raf = 0, alive = true;
    let best = Number(VexFun._read(this.BEST_KEY)) || 0;
    const ground = R.height - 24;
    const draw = () => {
      ctx.clearRect(0, 0, R.width, R.height);
      ctx.fillStyle = ink; ctx.globalAlpha = 0.35;
      ctx.fillRect(0, ground, R.width, 2);
      ctx.globalAlpha = 1;
      ctx.fillStyle = accent;
      ctx.fillRect(R.px, ground - R.ph - s.y, R.pw, R.ph);
      ctx.fillStyle = ink;
      for (const o of s.obstacles) ctx.fillRect(o.x, ground - o.h, o.w, o.h);
      ctx.font = '13px sans-serif';
      ctx.fillText(String(s.score), R.width - 54, 20);
    };
    const frame = (now) => {
      if (!alive) return;
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
      last = now;
      this.runnerStep(s, dt, jump, rng);
      jump = false;
      draw();
      if (s.over) {
        again.hidden = false;
        if (s.score > best) { best = s.score; VexFun._write(this.BEST_KEY, String(best)); }
        info.textContent = 'Score ' + s.score + '. Best on this device ' + best + '.';
        if (s.score >= 50) VexFun.medal('play.mini.runner');
        try { again.focus(); } catch { /* closed */ }
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    const onKey = (e) => {
      if (e.key === ' ' || e.key === 'ArrowUp') { e.preventDefault(); jump = true; }
    };
    const start = () => {
      s = this.runnerStart(); last = 0; again.hidden = true; info.textContent = '';
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
      canvas.focus();
    };
    win.root.addEventListener('keydown', onKey);
    canvas.addEventListener('pointerdown', () => { jump = true; });
    again.addEventListener('click', start);
    win._stop = () => { alive = false; cancelAnimationFrame(raf); win.root.removeEventListener('keydown', onKey); };
    start();
  },

  _scramble(win) {
    win.body.textContent = '';
    const words = (typeof VexDailyWord !== 'undefined') ? VexDailyWord.WORDS : ['planet', 'garden', 'window', 'bridge', 'silver'];
    const stats = { n: 0 };
    const board = document.createElement('div');
    board.className = 'vexfun-scramble';
    const letters = document.createElement('div');
    letters.className = 'vexfun-scramble-letters';
    letters.setAttribute('aria-live', 'polite');
    const form = document.createElement('form');
    form.className = 'vexfun-word-form';
    const input = document.createElement('input');
    input.type = 'text'; input.className = 'set-input'; input.autocomplete = 'off'; input.spellcheck = false;
    input.setAttribute('aria-label', 'The word');
    const check = document.createElement('button');
    check.type = 'submit'; check.className = 'btn-primary'; check.textContent = 'Check';
    form.append(input, check);
    const msg = document.createElement('div');
    msg.className = 'vexfun-msg'; msg.setAttribute('role', 'status');
    const bar = document.createElement('div');
    bar.className = 'vexfun-bar';
    const next = document.createElement('button');
    next.type = 'button'; next.className = 'btn-secondary'; next.textContent = 'Another word';
    bar.append(next, this._back(win));
    board.append(letters, form, msg, bar);
    win.body.appendChild(board);
    let answer = '';
    const fresh = () => {
      const seed = Date.now() + stats.n++;
      answer = words[Math.floor(VexFun.rng(seed)() * words.length)];
      const shown = this.scrambleWord(answer, seed + 1);
      letters.textContent = '';
      [...shown].forEach(ch => {
        const t = document.createElement('span');
        t.className = 'vexfun-tile'; t.textContent = ch.toUpperCase();
        letters.appendChild(t);
      });
      letters.setAttribute('aria-label', 'Letters: ' + [...shown].join(' '));
      input.value = ''; msg.textContent = ''; input.disabled = false;
      try { input.focus(); } catch { /* closed */ }
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const got = input.value.trim().toLowerCase();
      if (got === answer) {
        msg.textContent = 'Yes: ' + answer.toUpperCase() + '.';
        VexFun.medal('play.mini.scramble');
      } else {
        msg.textContent = 'Not that one. Try again, or take another word.';
      }
    });
    next.addEventListener('click', fresh);
    fresh();
  },

  _lights(win) {
    win.body.textContent = '';
    const size = 5;
    let state = this.lightsMake(Date.now(), size);
    let board = state.board;
    let moves = 0;
    const grid = document.createElement('div');
    grid.className = 'vexfun-lights';
    grid.style.gridTemplateColumns = 'repeat(' + size + ', 1fr)';
    const msg = document.createElement('div');
    msg.className = 'vexfun-msg'; msg.setAttribute('role', 'status');
    const bar = document.createElement('div');
    bar.className = 'vexfun-bar';
    const again = document.createElement('button');
    again.type = 'button'; again.className = 'btn-secondary'; again.textContent = 'New puzzle';
    bar.append(again, this._back(win));
    win.body.append(grid, msg, bar);
    const cells = [];
    const paint = () => {
      cells.forEach((c, i) => {
        c.classList.toggle('is-on', board[i]);
        c.setAttribute('aria-pressed', board[i] ? 'true' : 'false');
      });
      if (this.lightsSolved(board)) {
        msg.textContent = 'Every light is out' + (moves ? ' in ' + moves + ' presses.' : '.');
        if (moves) VexFun.medal('play.mini.lights');
      } else msg.textContent = moves ? moves + ' presses so far.' : 'Press a light: it and its neighbours flip.';
    };
    for (let i = 0; i < size * size; i++) {
      const c = document.createElement('button');
      c.type = 'button';
      c.className = 'vexfun-light';
      c.setAttribute('aria-label', 'Light ' + (Math.floor(i / size) + 1) + ', ' + ((i % size) + 1));
      c.addEventListener('click', () => {
        if (this.lightsSolved(board)) return;
        board = this.lightsPress(board, i, size); moves++; paint();
      });
      grid.appendChild(c);
      cells.push(c);
    }
    again.addEventListener('click', () => { state = this.lightsMake(Date.now(), size); board = state.board; moves = 0; paint(); });
    paint();
  },

  // ---- opening it ----------------------------------------------------------
  open() {
    const win = VexFun.open({
      title: 'Play while you wait', feature: 'games', wide: true,
      onClose: () => { if (win && win._stop) win._stop(); },
    });
    this._menu(win);
    return win;
  },

  // ---- the button over a page that did not load ----------------------------
  _chip: null,
  _chipTab: null,
  hideChip() {
    if (this._chip) this._chip.remove();
    this._chip = null; this._chipTab = null;
  },
  showChip(tabId) {
    this.hideChip();
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'vexfun-chip';
    b.innerHTML = VexIcons.svg('gamepad', { size: 15 }) + '<span>Play while you wait</span>';
    b.addEventListener('click', () => { this.hideChip(); try { this.open(); } catch (err) { window.showToast?.(err.message, 'error'); } });
    document.body.appendChild(b);
    this._chip = b; this._chipTab = tabId;
  },

  init() {
    VexFun.group('play-games-settings', 'Play: mini games', (g) => {
      VexFun.switchRow(g, 'games', 'Mini games', 'when a page cannot load for want of a connection, a small button offers a runner, a word scramble and Lights Out. Nothing is downloaded or scored against you');
    });
    document.addEventListener('vex:page-load-failed', (e) => {
      const d = e.detail || {};
      if (!this.isOfflineCode(d.code) || !VexFun.may('games')) return;
      if (typeof TabManager !== 'undefined' && TabManager.activeTabId !== d.tabId) return;
      this.showChip(d.tabId);
    });
    // The chip belongs to the tab and to the failed page.
    window.addEventListener('vex:tab-activated', (e) => { if (this._chip && (!e.detail || e.detail.tabId !== this._chipTab)) this.hideChip(); });
    document.addEventListener('vex:tab-closed', (e) => { if (this._chip && e.detail && e.detail.tabId === this._chipTab) this.hideChip(); });
    document.addEventListener('vex:tab-navigated', (e) => { if (this._chip && e.detail && e.detail.tabId === this._chipTab && e.detail.failed === false) this.hideChip(); });
    document.addEventListener('vex:play-changed', () => { if (this._chip && !VexFun.may('games')) this.hideChip(); });
    document.addEventListener('vex:game-mode', () => { if (this._chip && !VexFun.may('games')) this.hideChip(); });
    if (typeof CommandBar !== 'undefined' && Array.isArray(CommandBar.commands)) {
      CommandBar.commands.push({
        id: 'mini-games', label: 'Mini Games', icon: 'gamepad',
        hint: 'A runner, a word scramble and Lights Out: small, offline, nothing scored',
        when: () => VexFun.may('games'),
        action: () => this.open(),
      });
    }
  },
};

if (typeof window !== 'undefined') {
  window.VexMiniGames = VexMiniGames;
  if (typeof document !== 'undefined' && typeof VexFun !== 'undefined' && document.querySelector) {
    try { VexMiniGames.init(); } catch (err) { console.error('[Mini games] could not start:', err); }
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexMiniGames };
