// A place for intentional play, with local souvenirs and the existing profile
// XP. No page-reading, network, countdown pressure or loss for taking a break.
const VexPlayRoom = {
  KEY: 'vex.playRoom',
  ACTIVITIES: ['memory', 'pattern', 'postcard', 'imagination', 'bubbles', 'choices'],
  PROMPTS: [
    'Invent a terrible name for a heroic hamster.',
    'Describe your day as the title of a movie.',
    'Write a six-word story about a lost sock.',
    'Name a tiny planet and its one strange rule.',
    'Invent a spell that fixes a minor inconvenience.',
    'Pitch a restaurant run entirely by cats.',
    'Give a sleepy dragon a very ordinary job.',
    'Invent a superhero whose power is almost useless.',
  ],
  read() {
    try {
      const s = JSON.parse(localStorage.getItem(this.KEY) || '{}');
      return { rewards: s.rewards || {}, souvenirs: s.souvenirs || {}, notes: Array.isArray(s.notes) ? s.notes.slice(-10) : [], pixels: Array.isArray(s.pixels) ? s.pixels.slice(0, 144) : [] };
    } catch (err) { console.error('[Play room] Could not read saved play:', err); return { rewards: {}, souvenirs: {}, notes: [], pixels: [] }; }
  },
  save(s) { localStorage.setItem(this.KEY, JSON.stringify(s)); },
  day(now = new Date()) { return [now.getFullYear(), now.getMonth() + 1, now.getDate()].join('-'); },
  shuffled(values, rng = Math.random) {
    const out = values.slice();
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
  },
  complete(id) {
    if (!this.ACTIVITIES.includes(id)) return false;
    const s = this.read(), day = this.day(), fresh = s.rewards[id] !== day;
    if (fresh) {
      // Write the claim first, so re-entering an activity cannot double-award.
      s.rewards[id] = day; s.souvenirs[id] = true; this.save(s);
      if (window.VexMedals) window.VexMedals.addXp('play-room-' + id, 5);
    }
    return fresh;
  },
  reason() {
    if (typeof VexPlayfulness === 'undefined') return '';
    if (VexPlayfulness.chosen() === 'off') return 'Playfulness is off. Choose Calm or Full in Settings to play.';
    // These activities have a still, untimed version under reduced motion.
    return VexPlayfulness.autoOffReason(true);
  },
  open() {
    const reason = this.reason();
    if (reason) { window.showToast?.('Play room is paused: ' + reason, 'info'); return; }
    if (this._win) this._win.close();
    let cleanup = () => {}, detach = () => {};
    const win = VexFun.open({ title: 'Play room', wide: true, onClose: () => { cleanup(); detach(); this._win = null; } });
    this._win = win; win.body.classList.add('play-room');
    const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
    const button = (text, action, cls = '') => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', action); return b; };
    const home = () => {
      cleanup(); cleanup = () => {}; win.body.textContent = '';
      const s = this.read(), intro = el('div', 'pr-intro');
      intro.append(el('h2', '', 'Take a little detour.'), el('p', '', 'Make something odd. Solve something small. Play just because.'));
      win.body.append(intro);
      const grid = el('div', 'pr-grid');
      const cards = [
        ['memory', 'Memory garden', 'Find eight pairs. No timer, just a satisfying little puzzle.', memory],
        ['pattern', 'Echo tiles', 'Remember a pattern, then tap it back. Five gentle rounds.', pattern],
        ['postcard', 'Pixel postcard', 'Draw something tiny. Keep it, or save a PNG to share.', postcard],
        ['imagination', 'Silly little ideas', 'A ridiculous prompt. Your imagination gets the last word.', imagination],
        ['bubbles', 'Bubble wrap', 'Pop a whole sheet. No timer. Just pop, pop, pop.', bubbles],
        ['choices', 'Impossible choices', 'Pocket dragon or cloud shoes? Build an absurd little adventure.', choices],
      ];
      for (const [id, title, text, run] of cards) {
        const b = button('', run, 'pr-card');
        b.dataset.activity = id;
        b.append(el('span', 'pr-stamp', s.souvenirs[id] ? 'Collected' : 'A new detour'), el('strong', '', title), el('span', '', text));
        grid.append(b);
      }
      win.body.append(grid);
      const shelf = el('div', 'pr-souvenirs');
      shelf.append(el('h3', '', 'Your little collection'), el('p', '', `${Object.keys(s.souvenirs).filter(k => this.ACTIVITIES.includes(k) && s.souvenirs[k]).length} of ${this.ACTIVITIES.length} souvenirs. Each activity can add 5 points to your existing profile once a day. Replay whenever you like.`));
      win.body.append(shelf);
      const more = el('div', 'pr-more');
      more.append(button('My profile and medals', async () => {
        try {
          if (!window.VexProfile && window.VexLazy?.ensure) await window.VexLazy.ensure('js/vex-medals-profile.js');
          if (!window.VexProfile) throw new Error('The profile screen is not loaded');
          win.close(); window.VexProfile.open();
        } catch (err) { window.showToast?.(err.message, 'error'); }
      }), button('Pet care', () => {
        win.close(); SidebarManager.openPanel('settings'); SettingsUI.openSection('setting-fun-progress');
      }));
      more.append(button('More mini games', async () => {
        try {
          if (!window.VexMiniGames && window.VexLazy?.ensure) await window.VexLazy.ensure('js/vex-mini-games.js');
          if (!window.VexMiniGames) throw new Error('Mini games are not loaded');
          if (!VexFun.flag('games')) VexFun.setFlag('games', true);
          win.close(); window.VexMiniGames.open();
        } catch (err) { window.showToast?.(err.message, 'error'); }
      }));
      win.body.append(more);
    };
    const page = (title, hint) => {
      cleanup(); cleanup = () => {}; win.body.textContent = '';
      win.body.append(button('Back to play room', home, 'pr-back'), el('h2', '', title), el('p', 'pr-hint', hint));
      const status = el('p', 'pr-status'); status.setAttribute('role', 'status'); win.body.append(status);
      return status;
    };
    const won = (id, status, message) => {
      const fresh = this.complete(id);
      status.textContent = message + (fresh ? ' Souvenir collected, and +5 profile points.' : ' Nicely done. Your souvenir is already on the shelf.');
      status.classList.add('pr-won');
    };
    const memory = () => {
      const status = page('Memory garden', 'Turn two tiles over. Matching pairs stay face up.');
      const values = this.shuffled(['Sun', 'Moon', 'Leaf', 'Star', 'Rain', 'Snow', 'Wave', 'Cloud'].flatMap(x => [x, x]));
      const board = el('div', 'pr-memory'); let first = -1, busy = false, pairs = 0, turns = 0, timer;
      cleanup = () => clearTimeout(timer);
      values.forEach((value, i) => {
        const b = button('?', () => {
          if (busy || b.dataset.open) return;
          b.textContent = value; b.dataset.open = 'yes'; b.setAttribute('aria-label', value);
          if (first < 0) { first = i; return; }
          turns++; const previous = board.children[first]; first = -1;
          if (previous.textContent === value) {
            previous.disabled = b.disabled = true; pairs++;
            status.textContent = `${pairs} of 8 pairs · ${turns} turns`;
            if (pairs === 8) won('memory', status, `All eight pairs in ${turns} turns!`);
          } else {
            busy = true; timer = setTimeout(() => {
              for (const tile of [previous, b]) { tile.textContent = '?'; delete tile.dataset.open; tile.setAttribute('aria-label', 'Turn over tile'); }
              busy = false;
            }, 850);
          }
        });
        b.setAttribute('aria-label', 'Turn over tile'); board.append(b);
      });
      win.body.append(board, button('Shuffle a new garden', memory, 'pr-back'));
    };
    const pattern = () => {
      const status = page('Echo tiles', 'Study the sequence at your own pace. Hide it, then tap the same tiles.');
      const names = ['Sun', 'Moon', 'Leaf', 'Wave']; let round = 1, sequence, at = 0, playing = false;
      const strip = el('p', 'pr-sequence'), pads = el('div', 'pr-pattern');
      const study = () => { playing = false; at = 0; sequence = Array.from({ length: round + 1 }, () => Math.floor(Math.random() * 4)); strip.textContent = sequence.map(i => names[i]).join(' → '); status.textContent = 'Round ' + round + ' of 5'; };
      const start = button('Hide pattern and try', () => { playing = true; at = 0; strip.textContent = 'Your turn'; });
      names.forEach((name, i) => pads.append(button(name, () => {
        if (!playing) return;
        if (i !== sequence[at]) { playing = false; strip.textContent = sequence.map(n => names[n]).join(' → '); status.textContent = 'No rush. Have another look, then try this round again.'; return; }
        at++; strip.textContent = `${at} of ${sequence.length} tiles`;
        if (at === sequence.length) {
          if (round === 5) { playing = false; won('pattern', status, 'Five patterns remembered!'); start.disabled = true; }
          else { round++; study(); }
        }
      })));
      study(); win.body.append(strip, start, pads, button('Start over', pattern, 'pr-back'));
    };
    const postcard = () => {
      const status = page('Pixel postcard', 'Paint a tiny 12 × 12 picture. A sleeping dragon? A questionable sandwich?');
      const palette = ['#fffdf5', '#273344', '#e88f85', '#eabf69', '#a7c5a1', '#8eadd8', '#be9ac6'];
      const saved = this.read().pixels;
      let pixels = Array.from({ length: 144 }, (_, i) => palette.includes(saved[i]) ? saved[i] : palette[0]), ink = palette[1], painting = false, history = [];
      const canvas = el('canvas', 'pr-canvas'); canvas.width = canvas.height = 288; canvas.tabIndex = 0; canvas.setAttribute('aria-label', 'Pixel drawing canvas. Use the grid buttons below as a keyboard alternative.');
      const ctx = canvas.getContext('2d'), accessible = el('details', 'pr-accessible'), cells = el('div', 'pr-pixels'); accessible.append(el('summary', '', 'Keyboard drawing grid'), cells);
      const paint = () => { pixels.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect((i % 12) * 24, Math.floor(i / 12) * 24, 24, 24); cells.children[i].style.backgroundColor = c; }); };
      const remember = () => { history.push(pixels.slice()); if (history.length > 30) history.shift(); };
      for (let i = 0; i < 144; i++) { const b = button('', () => { remember(); pixels[i] = ink; paint(); }); b.setAttribute('aria-label', `Paint row ${Math.floor(i / 12) + 1}, column ${i % 12 + 1}`); cells.append(b); }
      const point = e => { const r = canvas.getBoundingClientRect(), x = Math.floor((e.clientX - r.x) / r.width * 12), y = Math.floor((e.clientY - r.y) / r.height * 12); if (x >= 0 && x < 12 && y >= 0 && y < 12) { pixels[y * 12 + x] = ink; paint(); } };
      canvas.addEventListener('pointerdown', e => { if (e.button !== 0) return; remember(); painting = true; canvas.setPointerCapture(e.pointerId); point(e); });
      canvas.addEventListener('pointermove', e => { if (painting) point(e); });
      for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(event, () => { painting = false; });
      const colors = el('div', 'pr-palette');
      const colorNames = ['Paper', 'Ink', 'Coral', 'Honey', 'Sage', 'Sky', 'Lilac'];
      palette.forEach((c, i) => { const b = button(colorNames[i], () => { ink = c; [...colors.children].forEach(n => n.setAttribute('aria-pressed', String(n === b))); }); b.style.backgroundColor = c; b.style.color = i === 1 ? '#ffffff' : '#273344'; b.setAttribute('aria-pressed', String(c === ink)); colors.append(b); });
      const keep = () => {
        if (pixels.every(c => c === palette[0])) { status.textContent = 'Add a little color first.'; return false; }
        const s = this.read(); s.pixels = pixels.slice(); this.save(s); won('postcard', status, 'Your tiny masterpiece is kept here.'); return true;
      };
      const actions = el('div', 'pr-more');
      actions.append(button('Undo stroke', () => { if (history.length) { pixels = history.pop(); paint(); } }), button('Clear canvas', () => { remember(); pixels.fill(palette[0]); paint(); }), button('Keep this postcard', keep), button('Save PNG', () => {
        if (!keep()) return;
        canvas.toBlob(blob => { if (!blob) return; const url = URL.createObjectURL(blob), a = el('a'); a.href = url; a.download = 'vex-pixel-postcard.png'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }, 'image/png');
      }));
      paint(); win.body.append(colors, canvas, actions, accessible);
    };
    const imagination = () => {
      const status = page('Silly little ideas', 'No AI judging. No right answers. Just make something that makes you smile.');
      const prompt = el('blockquote', 'pr-prompt'), input = el('textarea', 'pr-answer'); input.maxLength = 240; input.rows = 3; input.setAttribute('aria-label', 'Your idea');
      let selected = -1;
      const next = () => { selected = (selected + 1 + Math.floor(Math.random() * (this.PROMPTS.length - 1))) % this.PROMPTS.length; prompt.textContent = this.PROMPTS[selected]; input.value = ''; status.textContent = ''; };
      const shelf = el('div', 'pr-notes');
      const draw = () => { shelf.textContent = ''; this.read().notes.slice().reverse().forEach(n => { const card = el('article'); card.append(el('strong', '', n.prompt), el('p', '', n.text)); shelf.append(card); }); };
      next(); draw();
      win.body.append(prompt, input, button('Another ridiculous prompt', next), button('Keep my idea', () => {
        const text = input.value.trim(); if (!text) { status.textContent = 'Give your idea a few words first.'; input.focus(); return; }
        const s = this.read(); s.notes.push({ prompt: prompt.textContent, text: text.slice(0, 240) }); s.notes = s.notes.slice(-10); this.save(s);
        won('imagination', status, 'That one is a keeper.'); draw();
      }), shelf);
    };
    const bubbles = () => {
      const status = page('Bubble wrap', 'Thirty-six bubbles. Nothing to solve. Pop them however you like.');
      const sheet = el('div', 'pr-bubbles'); let popped = 0;
      for (let i = 0; i < 36; i++) {
        const b = button('', () => {
          b.disabled = true; b.classList.add('popped'); b.textContent = 'pop'; popped++;
          b.setAttribute('aria-label', 'Bubble ' + (i + 1) + ' popped');
          status.textContent = popped + ' of 36 popped';
          if (popped === 36) won('bubbles', status, 'A perfectly popped sheet. Satisfying.');
        });
        b.setAttribute('aria-label', 'Pop bubble ' + (i + 1)); sheet.append(b);
      }
      win.body.append(sheet, button('A fresh sheet', bubbles, 'pr-back'));
    };
    const choices = () => {
      const status = page('Impossible choices', 'Three very unserious decisions. There are no wrong answers.');
      const pairs = this.shuffled([
        ['A pocket-sized dragon', 'Shoes made of clouds'],
        ['A cat that narrates your life', 'A toaster that gives compliments'],
        ['A castle made of pancakes', 'A submarine full of houseplants'],
        ['Talk to sleepy mountains', 'Understand dramatic pigeons'],
        ['A cape with its own opinions', 'A hat that predicts snacks'],
        ['A tiny moon in your room', 'A friendly ghost as a roommate'],
      ]).slice(0, 3);
      const panel = el('div', 'pr-choices'), picks = []; let round = 0;
      const draw = () => {
        panel.textContent = ''; status.textContent = 'Choice ' + (round + 1) + ' of 3';
        for (const text of pairs[round]) panel.append(button(text, () => {
          picks.push(text); round++;
          if (round < 3) draw();
          else { panel.textContent = ''; panel.append(el('p', 'pr-adventure', 'Your absurd adventure: ' + picks.join(' + ') + '. Somehow, it all makes sense.')); won('choices', status, 'Excellent taste in nonsense.'); }
        }));
      };
      draw(); win.body.append(panel, button('Another adventure', choices, 'pr-back'));
    };
    const pause = () => { if (this.reason()) win.close(); };
    document.addEventListener('vex:game-mode', pause); document.addEventListener('vex:playfulness-changed', pause);
    detach = () => { document.removeEventListener('vex:game-mode', pause); document.removeEventListener('vex:playfulness-changed', pause); };
    home();
  },
};
if (typeof window !== 'undefined') {
  window.VexPlayRoom = VexPlayRoom;
  if (typeof CommandBar !== 'undefined') CommandBar.commands.push({ id: 'play-room', label: 'Play room', hint: 'Fun, games, memory matching, pixel art, silly prompts and souvenirs for your profile', icon: 'gamepad', action: () => VexPlayRoom.open() });
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPlayRoom };
