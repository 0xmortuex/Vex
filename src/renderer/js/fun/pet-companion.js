// New Tab pet controls. Only the trusted start page can deliver these small
// commands; the browser validates every action and saves the profile state.
const VexPetCompanion = {
  render(host, data, cleanSvg) {
    if (!data) { host._companion?.destroy(); host._companion = null; host.textContent = ''; return; }
    if (!host._companion) host._companion = this.mount(host, cleanSvg);
    host._companion.update(data);
  },

  mount(host, cleanSvg) {
    let state, dragging = null, moved = false, lastCuddle = 0, bubbleTimer, reactionTimer, catches = 0;
    const abort = new AbortController(), options = { signal: abort.signal };
    host.classList.add('vpc');
    host.removeAttribute('role');
    const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
    const pet = el('button', 'vpc-avatar'); pet.type = 'button';
    pet.setAttribute('aria-expanded', 'false'); pet.setAttribute('aria-label', 'Pet care menu. Drag to move; arrow keys move when focused.');
    const speech = el('span', 'vpc-speech'); speech.setAttribute('role', 'status'); speech.hidden = true;
    const menu = el('section', 'vpc-menu'); menu.hidden = true; menu.setAttribute('aria-label', 'Pet care');
    const heading = el('strong', 'vpc-name'), close = el('button', 'vpc-close', 'Close'); close.type = 'button';
    const head = el('div', 'vpc-heading'); head.append(heading, close);
    const description = el('p', 'vpc-description', 'A little company. Treats and games are just for fun.');
    const stats = el('p', 'vpc-stats'), actions = el('div', 'vpc-actions');
    const say = text => { speech.textContent = text; speech.hidden = false; clearTimeout(bubbleTimer); bubbleTimer = setTimeout(() => { speech.hidden = true; }, 3500); };
    const send = (action, prefs) => console.log('VEX_CMD:' + JSON.stringify({ type: 'pet-action', action, ...(prefs ? { prefs } : {}) }));
    const ball = el('button', 'vpc-ball', 'Catch'); ball.type = 'button'; ball.hidden = true;
    ball.setAttribute('aria-label', 'Catch the ball');
    const toss = () => {
      ball.hidden = false;
      ball.style.left = Math.max(8, Math.min(innerWidth - 72, Number.parseFloat(host.style.left) - 100 + Math.random() * 180)) + 'px';
      ball.style.top = Math.max(8, Math.min(innerHeight - 52, Number.parseFloat(host.style.top) - 80 + Math.random() * 100)) + 'px';
    };
    ball.addEventListener('click', () => {
      catches++;
      if (catches >= 5) { ball.hidden = true; say('Five catches! Well played.'); pet.focus(); }
      else { say('Catch ' + catches + ' of 5!'); toss(); }
    }, options);
    const act = (action, text) => { send(action); say(text); };
    for (const [action, label, text] of [['feed', 'Feed a snack', 'Delicious! Thank you.'], ['play', 'Play ball', 'Your turn!'], ['cuddle', 'Cuddle', 'That is the spot.'], ['sleep', 'Take a nap', 'A little rest.'], ['wake', 'Wake up', 'Ready for some company.']]) {
      const b = el('button', '', label); b.type = 'button'; b.dataset.petAction = action;
      b.addEventListener('click', () => { act(action, text); if (action === 'play') { catches = 0; showMenu(false); toss(); } }, options); actions.append(b);
    }
    const details = el('details', 'vpc-customize'), summary = el('summary', '', 'Make it yours'); details.append(summary);
    const fields = {};
    const field = (label, key, choices) => {
      const row = el('label', 'vpc-field'), title = el('span', '', label);
      const input = el(choices ? 'select' : 'input');
      if (choices) for (const [value, text] of choices) { const o = el('option', '', text); o.value = value; input.append(o); }
      else { input.type = 'text'; input.maxLength = 24; }
      input.setAttribute('aria-label', label);
      input.addEventListener('change', () => send('customize', { [key]: key === 'size' ? Number(input.value) : input.value }), options);
      row.append(title, input); details.append(row); fields[key] = input;
    };
    field('Name', 'name');
    field('Companion', 'species', [['cat', 'Cat'], ['bunny', 'Bunny'], ['fox', 'Fox']]);
    field('Coat', 'color', [['theme', 'Match my theme'], ['#e7ad80', 'Apricot'], ['#a5bdde', 'Cloud blue'], ['#b2c9a5', 'Sage'], ['#d2b4d6', 'Lilac']]);
    field('Size', 'size', [[64, 'Small'], [88, 'Medium'], [112, 'Large']]);
    field('Accessory', 'accessory', [['none', 'None'], ['bandana', 'Bandana'], ['bow', 'Bow tie']]);
    for (const [key, text] of [['hover', 'Cuddle when I hover'], ['locked', 'Lock position']]) {
      const label = el('label', 'vpc-check'), input = el('input'); input.type = 'checkbox'; fields[key] = input;
      input.addEventListener('change', () => send('customize', { [key]: input.checked }), options);
      label.append(input, document.createTextNode(text)); details.append(label);
    }
    const reset = el('button', 'vpc-reset', 'Back to the corner'); reset.type = 'button';
    reset.addEventListener('click', () => send('customize', { position: null }), options); details.append(reset);
    const help = el('p', 'vpc-help', 'Drag your companion to move it. Or focus it and use arrow keys. Escape closes this menu.');
    menu.append(head, description, stats, actions, details, help); host.append(speech, pet, menu, ball);
    const reduced = () => document.documentElement.hasAttribute('data-reduce-motion') || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const bounds = () => ({ x: Math.max(1, innerWidth - pet.offsetWidth - 16), y: Math.max(1, innerHeight - pet.offsetHeight - 16) });
    const place = position => {
      const b = bounds();
      const x = position ? Math.max(8, Math.min(b.x, position.x * b.x)) : b.x - 8;
      const y = position ? Math.max(8, Math.min(b.y, position.y * b.y)) : b.y - 8;
      host.style.left = x + 'px'; host.style.top = y + 'px';
      if (!menu.hidden) {
        menu.style.left = Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, x + pet.offsetWidth - menu.offsetWidth)) + 'px';
        menu.style.top = Math.max(8, Math.min(innerHeight - menu.offsetHeight - 8, y - menu.offsetHeight - 12)) + 'px';
      }
    };
    const showMenu = open => { menu.hidden = !open; pet.setAttribute('aria-expanded', String(open)); if (open) place(state.prefs.position); };
    pet.addEventListener('click', () => { if (!moved) showMenu(menu.hidden); }, options);
    close.addEventListener('click', () => { showMenu(false); pet.focus(); }, options);
    document.addEventListener('pointerdown', e => { if (!host.contains(e.target)) showMenu(false); }, options);
    pet.addEventListener('pointerenter', e => {
      if (e.pointerType === 'touch' || !state.prefs.hover || Date.now() - lastCuddle < 3000) return;
      lastCuddle = Date.now(); act('cuddle', 'A little closer. Prrr.');
    }, options);
    pet.addEventListener('pointermove', e => {
      if (dragging) return;
      if (state.prefs.hover && !reduced()) {
        const r = pet.getBoundingClientRect(), lean = Math.max(-7, Math.min(7, (e.clientX - r.x - r.width / 2) / 6));
        pet.style.transform = `rotate(${lean}deg) scale(1.06)`;
      }
    }, options);
    pet.addEventListener('pointerleave', () => { pet.style.transform = ''; }, options);
    pet.addEventListener('pointerdown', e => {
      moved = false;
      if (state.prefs.locked || e.button !== 0) return;
      const r = pet.getBoundingClientRect(); dragging = { id: e.pointerId, startX: e.clientX, startY: e.clientY, dx: e.clientX - r.x, dy: e.clientY - r.y };
      pet.setPointerCapture(e.pointerId);
    }, options);
    pet.addEventListener('pointermove', e => {
      if (!dragging || dragging.id !== e.pointerId) return;
      if (Math.hypot(e.clientX - dragging.startX, e.clientY - dragging.startY) < 6 && !moved) return;
      moved = true; showMenu(false); pet.style.transform = '';
      const b = bounds(); place({ x: (e.clientX - dragging.dx) / b.x, y: (e.clientY - dragging.dy) / b.y });
    }, options);
    const finish = e => {
      if (!dragging || dragging.id !== e.pointerId) return;
      dragging = null;
      if (moved) {
        const b = bounds(), r = pet.getBoundingClientRect();
        send('customize', { position: { x: r.x / b.x, y: r.y / b.y } });
      }
    };
    pet.addEventListener('pointerup', finish, options);
    pet.addEventListener('pointercancel', () => { dragging = null; moved = true; place(state.prefs.position); }, options);
    host.addEventListener('keydown', e => {
      if (e.key === 'Escape') { showMenu(false); ball.hidden = true; pet.focus(); e.stopPropagation(); }
      if (e.target !== pet || state.prefs.locked || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      const b = bounds(), r = pet.getBoundingClientRect(), step = e.shiftKey ? 40 : 12;
      const position = { x: (r.x + (e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0)) / b.x, y: (r.y + (e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0)) / b.y };
      place(position); send('customize', { position });
    }, options);
    window.addEventListener('resize', () => { if (state) place(state.prefs.position); }, options);
    const update = data => {
      state = { ...data, prefs: { name: 'Mochi', species: 'cat', color: 'theme', size: 88, hover: true, locked: false, position: null, ...data.prefs } };
      const p = state.prefs, svg = cleanSvg(data.svg);
      if (!svg) return;
      pet.replaceChildren(svg); pet.style.width = p.size + 'px'; pet.style.height = p.size + 'px';
      host.style.setProperty('--vpc-coat', /^#[a-f\d]{6}$/i.test(p.color) ? p.color : 'var(--vex-accent, #7aa2ff)');
      pet.title = p.name + ': ' + data.label + '. Click for care; drag to move.';
      heading.textContent = p.name;
      stats.textContent = `${data.snacks || 0} snacks · ${data.plays || 0} games · ${data.cuddles || 0} cuddles`;
      for (const [key, input] of Object.entries(fields)) {
        if (document.activeElement === input) continue;
        if (input.type === 'checkbox') input.checked = !!p[key]; else input.value = String(p[key]);
      }
      if (!dragging) place(p.position);
      clearTimeout(reactionTimer);
      const delay = Number(data.reactionUntil) - Date.now();
      if (delay > 0 && delay <= 30 * 60000) reactionTimer = setTimeout(() => send('refresh'), delay + 50);
    };
    return { update, destroy() { abort.abort(); clearTimeout(bubbleTimer); clearTimeout(reactionTimer); host.textContent = ''; host.classList.remove('vpc'); } };
  },
};
if (typeof window !== 'undefined') window.VexPetCompanion = VexPetCompanion;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPetCompanion };
