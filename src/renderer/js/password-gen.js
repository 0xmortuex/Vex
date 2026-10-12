// === Password generator — the one implementation every part of Vex uses ===
//
// Settings › Passwords (the generator card), "Suggest a strong password" on a
// site's sign-up form (passwords.js + preload-webview.js) and the Toolbox
// Password tool all draw from here. Two copies used to exist in toolbox.js and
// both picked characters with `random % length`, which favours the start of the
// alphabet whenever the pool size does not divide 2^32, and one of them fell
// back to Math.random when crypto was missing.
//
// Every pick here is crypto.getRandomValues with rejection sampling: a draw that
// lands in the uneven tail of the 32-bit range is thrown away and drawn again,
// so each character or word is exactly equally likely. There is no fallback —
// without a secure random source this throws.
(function () {
  'use strict';

  const SETS = {
    lower: 'abcdefghijklmnopqrstuvwxyz',
    upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    digits: '0123456789',
    symbols: '!@#$%^&*()-_=+[]{};:,.?',
  };
  // Symbols almost every site's password rules accept. A suggestion for a
  // site's sign-up form uses these: one it refuses is no help.
  const SITE_SYMBOLS = '-_.!@#$%*?';
  // Characters people misread when they have to type a password off a screen.
  const AMBIGUOUS = /[0O1lI|]/g;

  // Short, common, easy-to-type words. Each one adds log2(WORDS.length) bits.
  const WORDS = Array.from(new Set(('able acid aged also area army away baby back ball band bank base bath bear beat been beer bell belt bend best bike bill bird blow blue boat body bomb bond bone book boom boot born boss both bowl bulk burn bush busy cafe cage cake call calm came camp card care case cash cast cave cell chat chef chip city clay clip club coal coat code coin cold come cook cool cope copy core corn cost crew crop crow cube cure curl cyan dark dash data date dawn days dead deal dean dear debt deck deep deer demo dent deny desk dial diet dime dirt dish disk dive dock does dole dome done door dose dove down drag draw drew drop drum dual duck dull duly dusk dust duty each earn ease east easy echo edge edit eggs else emit ends envy epic even ever evil exam exit eyes face fact fade fail fair fall fame farm fast fate fear feed feel feet fell felt file fill film find fine fire firm fish fist five flag flat flew flex flip flow flux foam fold folk font food foot fore fork form fort four free frog from fuel full fund gain game gate gave gear gene gift girl give glad glow goal goat goes gold golf gone good gown grab gray grew grid grim grip grow gulf hair half hall halt hand hang hard harm hash hate haul have hawk haze head heal heap hear heat heel held hell helm help herb herd here hero hide high hike hill hint hire hold hole holy home hood hoof hook hope horn hose host hour huge hunt hurt icon idea idle inch iron isle item jade jail jazz jean join joke jump june junk jury just keen keep kept kick kind king kiss kite knee knew knit knot know lace lack lady laid lake lamb lamp land lane last late lava lawn lazy lead leaf leak lean leap left lend lens less levy liar life lift like limb lime line link lion list live load loan lock loft logo lone long look loop lord lose loss lost loud love luck lump lung made mail main make male mall malt many maps mark mask mass mast mate math maze mead meal mean meat meet melt memo mend menu mere mesh mess mice mild mile milk mill mind mine mint miss mist mode mold mole monk mood moon more moss most moth move much mule mush must mute myth nail name nape navy near neat neck need neon nest news next nice nick nine node none noon norm nose note noun nova numb oath odds odor okay omit once only onto onus open oral orbit oval oven over pace pack page paid pain pair pale palm park part pass past path peak pear peel peer pens pest pick pier pile pill pine pink pipe pity plan play plea plot plug plum plus poem poet pole poll pond pony pool poor pope pork port pose post pour pray prep prey prim prop pull pulp pump pure push quit quiz race rack raft rage raid rail rain rake ramp rank rare rash rate rave read real reap rear reed reef reel rely rent rest rice rich ride ring riot rise risk rite road roam robe rock rode role roll roof room root rope rose ross rout ruby rude ruin rule rush rust sage said sail sake sale salt same sand sang sank save scan scar seal seam seat seed seek seem seen self sell semi send sent sett shed shim ship shoe shop shot show shut sick side sift sigh sign silk sill silo sing sink site size skin skip slab slam slap sled slid slim slip slot slow slug snap snow soap sock soda sofa soft soil sold sole solo some song soon sore sort soul soup sour span spin spit spot spur stab star stay stem step stew stir stop stow stub stun such suit sung sunk sure surf swam swan swap sway swim tack tail take tale talk tall tank tape task taxi team tear tech tell tend tent term test text than that thaw thee them then they thin this thus tide tidy tier tile till tilt time tiny tire toad toes toil told toll tomb tone took tool torn toss tour town trace tram trap tray tree trek trim trio trip trot true tube tuck tuna tune turf turn twin twig type ugly unit upon urge used user vain vale vane vary vase vast veil vein vent verb very vest veto vial vibe vice view vine visa void volt vote wade wage wait wake walk wall wand want ward ware warm warn wash wasp wave wavy weak wear weed week weep well went were west what when whim whip whom wide wife wild will wind wine wing wink wipe wire wise wish wolf wood wool word wore work worm worn wrap wren yard yarn yawn year yell yoga yolk your zero zest zinc zone zoom').split(' ')));

  function cryptoSource() {
    const c = (typeof globalThis !== 'undefined' && globalThis.crypto) || null;
    if (!c || typeof c.getRandomValues !== 'function') throw new Error('No secure random source is available here');
    return c;
  }

  // A uniformly random integer in [0, n). Draws above the largest multiple of
  // n that fits in 32 bits are rejected, so no value is more likely than another.
  function randomBelow(n) {
    if (!Number.isInteger(n) || n < 1 || n > 2 ** 32) throw new Error('randomBelow needs a whole number from 1 to 2^32');
    const c = cryptoSource();
    const limit = Math.floor(2 ** 32 / n) * n;
    const buf = new Uint32Array(1);
    for (;;) {
      c.getRandomValues(buf);
      if (buf[0] < limit) return buf[0] % n;
    }
  }

  function clampInt(value, min, max, fallback) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  }

  // The character classes an options object asks for, each already stripped of
  // lookalikes when that is on. Empty classes are dropped.
  function classesFor(opts) {
    const o = opts || {};
    const out = [];
    const add = (on, chars) => {
      if (!on) return;
      const cleaned = o.avoidAmbiguous ? chars.replace(AMBIGUOUS, '') : chars;
      if (cleaned) out.push(cleaned);
    };
    add(o.lower !== false, SETS.lower);
    add(o.upper !== false, SETS.upper);
    add(o.digits !== false, SETS.digits);
    add(o.symbols !== false, typeof o.symbolSet === 'string' && o.symbolSet ? o.symbolSet : SETS.symbols);
    return out;
  }

  // Bits of entropy of a uniformly random string of `length` characters drawn
  // from the union of `classes`, given that every class must appear at least
  // once (inclusion–exclusion over the classes left out, in ratio form so it
  // never overflows).
  function charEntropy(classes, length) {
    const pool = classes.reduce((n, c) => n + c.length, 0);
    if (!pool || !length) return 0;
    let fraction = 0;
    const k = classes.length;
    for (let mask = 0; mask < (1 << k); mask++) {
      let missing = 0, bits = 0;
      for (let i = 0; i < k; i++) if (mask & (1 << i)) { missing += classes[i].length; bits++; }
      fraction += (bits % 2 ? -1 : 1) * Math.pow((pool - missing) / pool, length);
    }
    return length * Math.log2(pool) + Math.log2(Math.max(fraction, Number.MIN_VALUE));
  }

  // A random password. Every chosen class appears at least once (sites ask for
  // "a digit and a symbol"): a draw missing one is thrown away whole and drawn
  // again, which keeps every allowed password equally likely.
  function generate(opts) {
    const o = opts || {};
    const classes = classesFor(o);
    if (!classes.length) throw new Error('Pick at least one kind of character');
    const length = clampInt(o.length, 4, 128, 20);
    if (length < classes.length) throw new Error(`A password of ${length} characters cannot hold ${classes.length} kinds of character`);
    const pool = classes.join('');
    for (let attempt = 0; attempt < 10000; attempt++) {
      let pw = '';
      for (let i = 0; i < length; i++) pw += pool[randomBelow(pool.length)];
      if (classes.every(c => { for (const ch of c) if (pw.includes(ch)) return true; return false; })) {
        return { password: pw, bits: charEntropy(classes, length), kind: 'characters' };
      }
    }
    throw new Error('Could not make a password with every kind of character');
  }

  const SEPARATORS = ['-', ' ', '.', '_'];
  function passphrase(opts) {
    const o = opts || {};
    const count = clampInt(o.words, 3, 20, 7);
    const sep = SEPARATORS.includes(o.separator) ? o.separator : '-';
    const words = [];
    for (let i = 0; i < count; i++) {
      let w = WORDS[randomBelow(WORDS.length)];
      if (o.capitalize) w = w.charAt(0).toUpperCase() + w.slice(1);
      words.push(w);
    }
    let bits = count * Math.log2(WORDS.length);
    if (o.number) { words.push(String(randomBelow(10))); bits += Math.log2(10); }
    return { password: words.join(sep), bits, kind: 'words' };
  }

  // How long it would take to guess, in words a person reads at a glance.
  function humanTime(secs) {
    if (!(secs >= 1)) return 'instantly';
    if (secs < 60) return Math.round(secs) + ' seconds';
    if (secs < 3600) return Math.round(secs / 60) + ' minutes';
    if (secs < 86400) return Math.round(secs / 3600) + ' hours';
    if (secs < 3.15e7) return Math.round(secs / 86400) + ' days';
    const yrs = secs / 3.15e7;
    if (yrs < 1e6) return Math.round(yrs).toLocaleString('en-US') + ' years';
    if (yrs > 1.4e10) return 'longer than the universe has existed';
    return yrs.toExponential(1) + ' years';
  }

  // Strength of a GENERATED password, from its real entropy. Thresholds: under
  // 50 bits falls to a stolen badly-hashed database in days, 70+ is out of reach.
  function strength(bits) {
    const b = Math.max(0, Number(bits) || 0);
    const level = b < 50 ? 0 : b < 70 ? 1 : b < 100 ? 2 : 3;
    const label = ['Weak', 'Fair', 'Strong', 'Very strong'][level];
    const guesses = Math.pow(2, Math.max(0, b - 1));
    return {
      bits: b, level, label,
      offline: humanTime(guesses / 1e11), // a stolen database, hashed badly
      online: humanTime(guesses / 1e3),   // guessing through the site itself
    };
  }

  // The suggestion for a site's new-password field. 20 characters of all four
  // kinds with the symbols most sites accept, cut to the field's maxlength
  // (and stretched to its minlength). A field that holds fewer than 8
  // characters gets no suggestion: nothing that short is strong.
  function forField(field) {
    const f = field || {};
    const max = Number.isInteger(f.maxLength) && f.maxLength > 0 ? f.maxLength : 0;
    const min = Number.isInteger(f.minLength) && f.minLength > 0 ? f.minLength : 0;
    if (max && max < 8) return null;
    let length = 20;
    if (min > length) length = Math.min(min, 128);
    if (max && max < length) length = max;
    return generate({ length, lower: true, upper: true, digits: true, symbols: true, symbolSet: SITE_SYMBOLS });
  }

  const api = Object.freeze({ SETS, SITE_SYMBOLS, WORDS, SEPARATORS, randomBelow, charEntropy, generate, passphrase, strength, humanTime, forField });
  if (typeof window !== 'undefined') window.VexPasswordGen = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
