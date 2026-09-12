// === Toolbox pack — encoding, networking and CSS ==========================
//
// Tools that were missing: the ones you reach a search engine for because the
// browser could not do them. Each answers a question exactly rather than
// approximately — a subnet calculator that gives the real broadcast address, a
// float inspector that shows why 0.1 + 0.2 is not 0.3, a punycode decoder that
// tells you when a domain is pretending to be another one.
//
// Every run() here is synchronous and pure, which is what the shared runner
// expects, and every tool carries worked examples that the catalogue test
// executes.
(function registerEncodingNetCssPack() {
  const packs = (typeof window !== 'undefined' && window.ToolboxPacks)
    || (typeof ToolboxPacks !== 'undefined' ? ToolboxPacks : null);
  if (!packs) return;

  // ---- shared helpers -----------------------------------------------------
  const need = (v, what) => {
    const s = String(v == null ? '' : v).trim();
    if (!s) throw new Error(`Enter ${what}.`);
    return s;
  };
  const int = (v, what) => {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`${what} must be a number.`);
    return n;
  };

  // CRC-32, table-driven. Same polynomial as zip, PNG and gzip.
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (bytes) => {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };
  const utf8 = (s) => new TextEncoder().encode(s);

  // Punycode, per RFC 3492. Written out rather than pulled in, because the
  // whole point of the tool is to show exactly what the transformation does.
  const PUNY = {
    base: 36, tmin: 1, tmax: 26, skew: 38, damp: 700, initialBias: 72, initialN: 128,
    adapt(delta, numPoints, firstTime) {
      delta = firstTime ? Math.floor(delta / this.damp) : delta >> 1;
      delta += Math.floor(delta / numPoints);
      let k = 0;
      while (delta > ((this.base - this.tmin) * this.tmax) >> 1) {
        delta = Math.floor(delta / (this.base - this.tmin));
        k += this.base;
      }
      return k + Math.floor(((this.base - this.tmin + 1) * delta) / (delta + this.skew));
    },
    encodeDigit(d) { return String.fromCharCode(d + 22 + (d < 26 ? 75 : 0)); },
    decodeDigit(c) {
      const n = c.charCodeAt(0);
      if (n - 48 < 10) return n - 22;
      if (n - 65 < 26) return n - 65;
      if (n - 97 < 26) return n - 97;
      return this.base;
    },
    encode(input) {
      const cps = [...input].map(c => c.codePointAt(0));
      const basic = cps.filter(c => c < 128);
      let out = basic.map(c => String.fromCodePoint(c)).join('');
      let h = basic.length;
      const b = h;
      if (out) out += '-';
      let n = this.initialN, delta = 0, bias = this.initialBias;
      while (h < cps.length) {
        let m = Infinity;
        for (const c of cps) if (c >= n && c < m) m = c;
        delta += (m - n) * (h + 1);
        n = m;
        for (const c of cps) {
          if (c < n) delta++;
          if (c === n) {
            let q = delta;
            for (let k = this.base; ; k += this.base) {
              const t = k <= bias ? this.tmin : (k >= bias + this.tmax ? this.tmax : k - bias);
              if (q < t) break;
              out += this.encodeDigit(t + ((q - t) % (this.base - t)));
              q = Math.floor((q - t) / (this.base - t));
            }
            out += this.encodeDigit(q);
            bias = this.adapt(delta, h + 1, h === b);
            delta = 0;
            h++;
          }
        }
        delta++; n++;
      }
      return out;
    },
    decode(input) {
      let n = this.initialN, i = 0, bias = this.initialBias;
      const last = input.lastIndexOf('-');
      const output = last > 0 ? [...input.slice(0, last)].map(c => c.codePointAt(0)) : [];
      let idx = last > 0 ? last + 1 : 0;
      while (idx < input.length) {
        const oldi = i;
        let w = 1;
        for (let k = this.base; ; k += this.base) {
          if (idx >= input.length) throw new Error('That punycode string ends in the middle of a character.');
          const digit = this.decodeDigit(input[idx++]);
          if (digit >= this.base) throw new Error(`"${input[idx - 1]}" is not a valid punycode character.`);
          i += digit * w;
          const t = k <= bias ? this.tmin : (k >= bias + this.tmax ? this.tmax : k - bias);
          if (digit < t) break;
          w *= this.base - t;
        }
        bias = this.adapt(i - oldi, output.length + 1, oldi === 0);
        n += Math.floor(i / (output.length + 1));
        i %= output.length + 1;
        output.splice(i, 0, n);
        i++;
      }
      return output.map(c => String.fromCodePoint(c)).join('');
    },
  };

  const ipToInt = (ip) => {
    const parts = ip.split('.');
    if (parts.length !== 4) throw new Error(`"${ip}" is not an IPv4 address — it needs four parts.`);
    return parts.reduce((acc, p) => {
      const n = Number(p);
      if (!/^\d+$/.test(p) || n < 0 || n > 255) throw new Error(`"${p}" is not between 0 and 255.`);
      return (acc << 8 >>> 0) + n;
    }, 0) >>> 0;
  };
  const intToIp = (n) => [24, 16, 8, 0].map(s => (n >>> s) & 255).join('.');

  packs.add([
    // ---------------------------------------------------------------- encoding
    {
      id: 'enc-punycode',
      name: 'Punycode / IDN',
      icon: 'globe',
      family: 'web',
      desc: 'Convert an international domain to its xn-- form and back, and spot one imitating another.',
      keywords: ['idn', 'xn--', 'homograph', 'unicode domain', 'phishing'],
      fields: [
        { id: 'text', label: 'Domain', type: 'text', placeholder: 'münchen.de or xn--mnchen-3ya.de' },
        { id: 'dir', label: 'Direction', type: 'select', value: 'auto', options: [['auto', 'Detect'], ['encode', 'To punycode'], ['decode', 'From punycode']] },
      ],
      run(v) {
        const input = need(v.text, 'a domain name');
        const labels = input.toLowerCase().split('.');
        const decoding = v.dir === 'decode' || (v.dir === 'auto' && labels.some(l => l.startsWith('xn--')));
        const out = labels.map(l => {
          if (decoding) return l.startsWith('xn--') ? PUNY.decode(l.slice(4)) : l;
          return /^[\x00-\x7F]*$/.test(l) ? l : 'xn--' + PUNY.encode(l);
        }).join('.');
        const rows = [[decoding ? 'Unicode' : 'Punycode', out], ['Input', input]];
        // A label mixing scripts is the shape a homograph attack takes.
        const unicode = decoding ? out : input;
        const scripts = {
          Latin: /[a-z]/i, Cyrillic: /[Ѐ-ӿ]/, Greek: /[Ͱ-Ͽ]/,
          Han: /[一-鿿]/, Arabic: /[؀-ۿ]/,
        };
        for (const label of unicode.split('.')) {
          const found = Object.keys(scripts).filter(k => scripts[k].test(label));
          if (found.length > 1) rows.push(['Mixed scripts', `"${label}" mixes ${found.join(' and ')} — this is how a lookalike domain is built`]);
        }
        return rows;
      },
      examples: [
        { in: { text: 'münchen.de', dir: 'encode' }, out: [['Punycode', 'xn--mnchen-3ya.de'], ['Input', 'münchen.de']] },
        { in: { text: 'xn--mnchen-3ya.de', dir: 'decode' }, out: [['Unicode', 'münchen.de'], ['Input', 'xn--mnchen-3ya.de']] },
      ],
    },

    {
      id: 'enc-crc32',
      name: 'CRC-32',
      icon: 'fingerprint',
      family: 'dev',
      desc: 'The checksum used by zip, gzip and PNG — for spotting accidental corruption, never for security.',
      keywords: ['checksum', 'crc', 'zip', 'png', 'gzip'],
      fields: [
        { id: 'text', label: 'Text', type: 'textarea', placeholder: 'anything' },
      ],
      run(v) {
        const s = need(v.text, 'some text');
        const n = crc32(utf8(s));
        return [
          ['Hex', n.toString(16).padStart(8, '0')],
          ['Unsigned', String(n)],
          ['Signed', String(n | 0)],
          ['Bytes', String(utf8(s).length)],
        ];
      },
      examples: [
        { in: { text: 'hello' }, out: [['Hex', '3610a686'], ['Unsigned', '907060870'], ['Signed', '907060870'], ['Bytes', '5']] },
      ],
    },

    {
      id: 'enc-ieee754',
      name: 'Float inspector',
      icon: 'braces',
      family: 'dev',
      desc: 'Why 0.1 + 0.2 is not 0.3: sign, exponent and mantissa bits, and the exact value actually stored.',
      keywords: ['ieee754', 'double', 'float', 'precision', 'rounding', 'binary'],
      fields: [
        { id: 'num', label: 'Number', type: 'text', value: '0.1', placeholder: '0.1' },
        { id: 'bits', label: 'Size', type: 'select', value: '64', options: [['64', '64-bit (double)'], ['32', '32-bit (float)']] },
      ],
      run(v) {
        const raw = need(v.num, 'a number');
        const n = Number(raw);
        if (!Number.isFinite(n) && !Number.isNaN(n)) {
          return [['Value', raw], ['Note', 'Infinity has every exponent bit set and a zero mantissa.']];
        }
        if (Number.isNaN(n)) throw new Error(`"${raw}" is not a number.`);
        const is32 = String(v.bits) === '32';
        const buf = new ArrayBuffer(8);
        const dv = new DataView(buf);
        if (is32) dv.setFloat32(0, n); else dv.setFloat64(0, n);
        const bytes = [];
        for (let i = 0; i < (is32 ? 4 : 8); i++) bytes.push(dv.getUint8(i).toString(2).padStart(8, '0'));
        const bits = bytes.join('');
        const expLen = is32 ? 8 : 11;
        const sign = bits[0];
        const exp = bits.slice(1, 1 + expLen);
        const mant = bits.slice(1 + expLen);
        const stored = is32 ? dv.getFloat32(0) : dv.getFloat64(0);
        return [
          ['You typed', raw],
          ['Actually stored', stored === n ? String(n) : String(stored)],
          ['Exact value', stored.toFixed(is32 ? 30 : 20).replace(/0+$/, '')],
          ['Sign', `${sign} (${sign === '0' ? 'positive' : 'negative'})`],
          ['Exponent', `${exp} (${parseInt(exp, 2)} − ${is32 ? 127 : 1023} = ${parseInt(exp, 2) - (is32 ? 127 : 1023)})`],
          ['Mantissa', mant],
          ['Hex', bytes.map(b => parseInt(b, 2).toString(16).padStart(2, '0')).join(' ')],
        ];
      },
      examples: [
        { in: { num: '0.5', bits: '64' }, match: /Sign.*0 \(positive\)/s },
        { in: { num: '0.1', bits: '64' }, match: /Exact value/ },
      ],
    },

    {
      id: 'enc-entropy',
      name: 'Shannon entropy',
      icon: 'activity',
      family: 'security',
      desc: 'Bits of information per character — how compressible, and how random, a string really is.',
      keywords: ['entropy', 'randomness', 'compression', 'information'],
      fields: [{ id: 'text', label: 'Text', type: 'textarea', placeholder: 'paste a key, a password or any text' }],
      run(v) {
        const s = need(v.text, 'some text');
        const freq = new Map();
        for (const c of s) freq.set(c, (freq.get(c) || 0) + 1);
        let H = 0;
        for (const n of freq.values()) { const p = n / s.length; H -= p * Math.log2(p); }
        const total = H * s.length;
        return [
          ['Entropy per character', H.toFixed(4) + ' bits'],
          ['Total', total.toFixed(1) + ' bits'],
          ['Distinct characters', String(freq.size)],
          ['Length', String(s.length)],
          ['Theoretical minimum size', (total / 8).toFixed(1) + ' bytes'],
        ];
      },
      examples: [
        { in: { text: 'aaaa' }, out: [['Entropy per character', '0.0000 bits'], ['Total', '0.0 bits'], ['Distinct characters', '1'], ['Length', '4'], ['Theoretical minimum size', '0.0 bytes']] },
        { in: { text: 'abcd' }, out: [['Entropy per character', '2.0000 bits'], ['Total', '8.0 bits'], ['Distinct characters', '4'], ['Length', '4'], ['Theoretical minimum size', '1.0 bytes']] },
      ],
    },

    {
      id: 'enc-xor',
      name: 'XOR cipher',
      icon: 'zap',
      family: 'security',
      desc: 'XOR text against a repeating key. Symmetrical, trivially breakable, and everywhere in CTFs and malware.',
      keywords: ['xor', 'cipher', 'ctf', 'obfuscation'],
      fields: [
        { id: 'text', label: 'Input', type: 'textarea', placeholder: 'text, or hex when decoding' },
        { id: 'key', label: 'Key', type: 'text', value: 'key' },
        { id: 'mode', label: 'Direction', type: 'select', value: 'encode', options: [['encode', 'Text → hex'], ['decode', 'Hex → text']] },
      ],
      run(v) {
        const key = need(v.key, 'a key');
        const kb = utf8(key);
        if (v.mode === 'decode') {
          const clean = need(v.text, 'hex to decode').replace(/[^0-9a-f]/gi, '');
          if (clean.length % 2) throw new Error('Hex input has an odd number of digits.');
          const bytes = new Uint8Array(clean.length / 2);
          for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.substr(i * 2, 2), 16) ^ kb[i % kb.length];
          return new TextDecoder().decode(bytes);
        }
        const b = utf8(need(v.text, 'some text'));
        return [...b].map((x, i) => (x ^ kb[i % kb.length]).toString(16).padStart(2, '0')).join('');
      },
      examples: [
        { in: { text: 'hello', key: 'key', mode: 'encode' }, out: '030015070a' },
        { in: { text: '030015070a', key: 'key', mode: 'decode' }, out: 'hello' },
      ],
    },

    {
      id: 'enc-vigenere',
      name: 'Vigenère cipher',
      icon: 'key',
      family: 'security',
      desc: 'The classic keyword cipher — unbreakable for three centuries, now a puzzle. Letters shift, everything else passes through.',
      keywords: ['vigenere', 'cipher', 'classical', 'puzzle', 'crypto'],
      fields: [
        { id: 'text', label: 'Text', type: 'textarea', placeholder: 'attack at dawn' },
        { id: 'key', label: 'Keyword', type: 'text', value: 'lemon' },
        { id: 'mode', label: 'Direction', type: 'select', value: 'encode', options: [['encode', 'Encrypt'], ['decode', 'Decrypt']] },
      ],
      run(v) {
        const text = need(v.text, 'some text');
        const key = need(v.key, 'a keyword').toLowerCase().replace(/[^a-z]/g, '');
        if (!key) throw new Error('The keyword must contain at least one letter.');
        let k = 0;
        return [...text].map(ch => {
          const isUpper = ch >= 'A' && ch <= 'Z';
          const isLower = ch >= 'a' && ch <= 'z';
          if (!isUpper && !isLower) return ch;
          const base = isUpper ? 65 : 97;
          const shift = key.charCodeAt(k % key.length) - 97;
          k++;
          const n = ch.charCodeAt(0) - base;
          const out = v.mode === 'decode' ? (n - shift + 26) % 26 : (n + shift) % 26;
          return String.fromCharCode(base + out);
        }).join('');
      },
      examples: [
        { in: { text: 'attack at dawn', key: 'lemon', mode: 'encode' }, out: 'lxfopv ef rnhr' },
        { in: { text: 'lxfopv ef rnhr', key: 'lemon', mode: 'decode' }, out: 'attack at dawn' },
      ],
    },

    // ---------------------------------------------------------------- network
    {
      id: 'net-cidr',
      name: 'Subnet calculator',
      icon: 'globe',
      family: 'web',
      desc: 'Network, broadcast, usable range and host count for an IPv4 CIDR block — with the mask in every notation.',
      keywords: ['cidr', 'subnet', 'netmask', 'ipv4', 'network', 'broadcast', 'vlsm'],
      fields: [
        { id: 'cidr', label: 'Address / prefix', type: 'text', value: '192.168.1.10/24', placeholder: '10.0.0.0/8' },
      ],
      run(v) {
        const raw = need(v.cidr, 'an address like 192.168.1.0/24');
        const [ip, prefixRaw] = raw.split('/');
        const prefix = prefixRaw === undefined ? 32 : int(prefixRaw, 'The prefix');
        if (prefix < 0 || prefix > 32) throw new Error('An IPv4 prefix is between 0 and 32.');
        const addr = ipToInt(ip.trim());
        const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
        const network = (addr & mask) >>> 0;
        const broadcast = (network | (~mask >>> 0)) >>> 0;
        const total = Math.pow(2, 32 - prefix);
        const usable = prefix >= 31 ? (prefix === 32 ? 1 : 2) : total - 2;
        const priv = (network >>> 24) === 10
          || ((network >>> 16) & 0xFFFF) >= 0xAC10 && ((network >>> 16) & 0xFFFF) <= 0xAC1F
          || (network >>> 16) === 0xC0A8;
        return [
          ['Network', intToIp(network) + '/' + prefix],
          ['Netmask', intToIp(mask)],
          ['Wildcard', intToIp(~mask >>> 0)],
          ['Broadcast', intToIp(broadcast)],
          ['First host', prefix >= 31 ? intToIp(network) : intToIp(network + 1)],
          ['Last host', prefix >= 31 ? intToIp(broadcast) : intToIp(broadcast - 1)],
          ['Total addresses', total.toLocaleString()],
          ['Usable hosts', usable.toLocaleString()],
          ['Range', priv ? 'Private (RFC 1918)' : 'Public'],
        ];
      },
      examples: [
        {
          in: { cidr: '192.168.1.10/24' },
          out: [
            ['Network', '192.168.1.0/24'], ['Netmask', '255.255.255.0'], ['Wildcard', '0.0.0.255'],
            ['Broadcast', '192.168.1.255'], ['First host', '192.168.1.1'], ['Last host', '192.168.1.254'],
            ['Total addresses', '256'], ['Usable hosts', '254'], ['Range', 'Private (RFC 1918)'],
          ],
        },
      ],
    },

    {
      id: 'net-user-agent',
      name: 'User agent',
      icon: 'monitor',
      family: 'web',
      desc: 'Read a User-Agent string: browser, engine, platform — and why it claims to be four other browsers.',
      keywords: ['user agent', 'ua', 'browser detect', 'mozilla'],
      fields: [{ id: 'ua', label: 'User-Agent', type: 'textarea', placeholder: 'paste a User-Agent header' }],
      run(v) {
        const ua = need(v.ua, 'a User-Agent string');
        const pick = (re) => { const m = ua.match(re); return m ? m[1] : null; };
        const browser =
          pick(/Edg\/([\d.]+)/) ? 'Edge ' + pick(/Edg\/([\d.]+)/)
            : pick(/OPR\/([\d.]+)/) ? 'Opera ' + pick(/OPR\/([\d.]+)/)
              : pick(/Firefox\/([\d.]+)/) ? 'Firefox ' + pick(/Firefox\/([\d.]+)/)
                : pick(/Chrome\/([\d.]+)/) ? 'Chrome ' + pick(/Chrome\/([\d.]+)/)
                  : pick(/Version\/([\d.]+).*Safari/) ? 'Safari ' + pick(/Version\/([\d.]+).*Safari/)
                    : 'unknown';
        const engine = /Gecko\/|rv:/.test(ua) && !/like Gecko/.test(ua) ? 'Gecko'
          : /AppleWebKit/.test(ua) ? (/Chrome|Edg|OPR/.test(ua) ? 'Blink' : 'WebKit') : 'unknown';
        const os = /Windows NT 10/.test(ua) ? 'Windows 10 or 11'
          : /Windows NT/.test(ua) ? 'Windows'
            : /Android ([\d.]+)/.test(ua) ? 'Android ' + pick(/Android ([\d.]+)/)
              : /iPhone|iPad/.test(ua) ? 'iOS'
                : /Mac OS X ([\d_.]+)/.test(ua) ? 'macOS ' + String(pick(/Mac OS X ([\d_.]+)/)).replace(/_/g, '.')
                  : /Linux/.test(ua) ? 'Linux' : 'unknown';
        const rows = [
          ['Browser', browser], ['Engine', engine], ['Platform', os],
          ['Mobile', /Mobi|Android|iPhone/.test(ua) ? 'yes' : 'no'],
        ];
        if (/Mozilla\/5\.0/.test(ua)) {
          rows.push(['Why "Mozilla/5.0"', 'Every browser claims it. Sites once sniffed for Netscape, so everyone copied the prefix and never stopped.']);
        }
        return rows;
      },
      examples: [
        {
          in: { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
          match: /Chrome 120[\s\S]*Blink[\s\S]*Windows 10 or 11/,
        },
      ],
    },

    // -------------------------------------------------------------------- CSS
    {
      id: 'css-units',
      name: 'px / rem / em',
      icon: 'ruler',
      family: 'design',
      desc: 'Convert between px, rem, em, pt and percent against a chosen root size.',
      keywords: ['rem', 'px', 'em', 'pt', 'css units', 'root font size'],
      fields: [
        { id: 'value', label: 'Value', type: 'number', value: 24 },
        { id: 'from', label: 'From', type: 'select', value: 'px', options: [['px', 'px'], ['rem', 'rem'], ['em', 'em'], ['pt', 'pt'], ['percent', '%']] },
        { id: 'root', label: 'Root font size (px)', type: 'number', value: 16 },
      ],
      run(v) {
        const root = int(v.root, 'The root font size') || 16;
        const n = int(v.value, 'The value');
        const px = v.from === 'px' ? n
          : v.from === 'pt' ? n * 96 / 72
            : v.from === 'percent' ? root * n / 100
              : n * root;
        const tidy = (x) => String(Math.round(x * 10000) / 10000);
        return [
          ['px', tidy(px)],
          ['rem', tidy(px / root)],
          ['em', tidy(px / root) + ' (at this element’s own size)'],
          ['pt', tidy(px * 72 / 96)],
          ['%', tidy(px / root * 100) + '%'],
        ];
      },
      examples: [
        { in: { value: 24, from: 'px', root: 16 }, out: [['px', '24'], ['rem', '1.5'], ['em', '1.5 (at this element’s own size)'], ['pt', '18'], ['%', '150%']] },
      ],
    },

    {
      id: 'css-bezier',
      name: 'Easing curve',
      icon: 'activity',
      family: 'design',
      desc: 'Evaluate a cubic-bezier easing at any point, and see the named curve it matches.',
      keywords: ['cubic-bezier', 'easing', 'animation', 'transition', 'timing function'],
      fields: [
        { id: 'curve', label: 'Curve', type: 'text', value: '0.25, 0.1, 0.25, 1', placeholder: 'x1, y1, x2, y2' },
        { id: 'at', label: 'Progress (0–1)', type: 'number', value: 0.5, min: 0, max: 1, step: 0.05 },
      ],
      run(v) {
        const nums = need(v.curve, 'four numbers').split(/[\s,]+/).filter(Boolean).map(Number);
        if (nums.length !== 4 || nums.some(n => !Number.isFinite(n))) throw new Error('A cubic-bezier needs exactly four numbers: x1, y1, x2, y2.');
        const [x1, y1, x2, y2] = nums;
        if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) throw new Error('x1 and x2 must be between 0 and 1 — CSS does not allow the curve to double back in time.');
        const bez = (t, a, b) => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
        // x(t) is not t, so solve for the t that gives this x.
        const target = Math.min(1, Math.max(0, int(v.at, 'Progress')));
        let lo = 0, hi = 1, t = target;
        for (let i = 0; i < 40; i++) {
          const x = bez(t, x1, x2);
          if (Math.abs(x - target) < 1e-6) break;
          if (x < target) lo = t; else hi = t;
          t = (lo + hi) / 2;
        }
        const y = bez(t, y1, y2);
        const NAMED = {
          'ease': [0.25, 0.1, 0.25, 1], 'linear': [0, 0, 1, 1],
          'ease-in': [0.42, 0, 1, 1], 'ease-out': [0, 0, 0.58, 1], 'ease-in-out': [0.42, 0, 0.58, 1],
        };
        const match = Object.entries(NAMED).find(([, c]) => c.every((n, i) => Math.abs(n - nums[i]) < 1e-9));
        return [
          ['CSS', `cubic-bezier(${nums.join(', ')})`],
          ['Same as', match ? match[0] : 'no named equivalent'],
          [`Output at ${target}`, y.toFixed(4)],
          ['Overshoots', (y1 > 1 || y2 > 1) ? 'yes — goes past the end and comes back' : (y1 < 0 || y2 < 0) ? 'yes — pulls back before starting' : 'no'],
        ];
      },
      examples: [
        { in: { curve: '0, 0, 1, 1', at: 0.5 }, out: [['CSS', 'cubic-bezier(0, 0, 1, 1)'], ['Same as', 'linear'], ['Output at 0.5', '0.5000'], ['Overshoots', 'no']] },
      ],
    },

    {
      id: 'css-shadow',
      name: 'Box shadow',
      icon: 'box',
      family: 'design',
      desc: 'Build a layered box-shadow, with the elevation presets that read as real depth rather than a grey smear.',
      keywords: ['box-shadow', 'elevation', 'drop shadow', 'css', 'material'],
      fields: [
        { id: 'level', label: 'Elevation', type: 'select', value: '2', options: [['1', '1 — resting'], ['2', '2 — raised'], ['3', '3 — overlay'], ['4', '4 — modal'], ['5', '5 — popover']] },
        { id: 'hue', label: 'Shadow colour', type: 'text', value: '0 0% 0%', placeholder: 'h s% l%' },
        { id: 'strength', label: 'Opacity ×', type: 'number', value: 1, min: 0, max: 3, step: 0.1 },
      ],
      run(v) {
        const lvl = Math.max(1, Math.min(5, parseInt(v.level, 10) || 2));
        const hsl = need(v.hue, 'a colour like "220 40% 10%"');
        const k = Number.isFinite(Number(v.strength)) ? Number(v.strength) : 1;
        // Two layers per level: a tight contact shadow and a wider ambient one.
        const LAYERS = {
          1: [[0, 1, 2, 0.06], [0, 1, 3, 0.10]],
          2: [[0, 2, 4, 0.06], [0, 4, 8, 0.10]],
          3: [[0, 4, 8, 0.07], [0, 8, 16, 0.12]],
          4: [[0, 8, 16, 0.08], [0, 16, 32, 0.14]],
          5: [[0, 12, 24, 0.09], [0, 24, 48, 0.18]],
        };
        const css = LAYERS[lvl].map(([x, y, b, a]) =>
          `${x}px ${y}px ${b}px hsl(${hsl} / ${Math.min(1, a * k).toFixed(3)})`).join(',\n            ');
        return [
          ['CSS', `box-shadow: ${css};`],
          ['Layers', '2 — a tight contact shadow plus a wider ambient one'],
          ['Why two', 'A single large blur reads as fog. Real shadows are sharp where the object meets the surface and diffuse further out.'],
        ];
      },
      examples: [
        { in: { level: '1', hue: '0 0% 0%', strength: 1 }, match: /box-shadow: 0px 1px 2px hsl\(0 0% 0% \/ 0\.060\)/ },
      ],
    },

    {
      id: 'css-media',
      name: 'Media queries',
      icon: 'monitor',
      family: 'design',
      desc: 'Breakpoint ranges that do not overlap, for a chosen scale — plus the queries people usually get wrong.',
      keywords: ['media query', 'breakpoint', 'responsive', 'mobile first', 'tailwind', 'bootstrap'],
      fields: [
        { id: 'scale', label: 'Scale', type: 'select', value: 'tailwind', options: [['tailwind', 'Tailwind'], ['bootstrap', 'Bootstrap 5'], ['custom', 'Custom']] },
        { id: 'custom', label: 'Custom breakpoints (px)', type: 'text', value: '480, 768, 1024, 1280' },
      ],
      run(v) {
        const SCALES = {
          tailwind: [['sm', 640], ['md', 768], ['lg', 1024], ['xl', 1280], ['2xl', 1536]],
          bootstrap: [['sm', 576], ['md', 768], ['lg', 992], ['xl', 1200], ['xxl', 1400]],
        };
        let points = SCALES[v.scale];
        if (!points) {
          const nums = need(v.custom, 'some breakpoints').split(/[\s,]+/).filter(Boolean).map(Number);
          if (nums.some(n => !Number.isFinite(n))) throw new Error('Breakpoints must be numbers, separated by commas.');
          points = nums.sort((a, b) => a - b).map((n, i) => ['bp' + (i + 1), n]);
        }
        const rows = [['Mobile first', 'Write the small layout, then add min-width queries — no max-width needed.']];
        for (const [name, px] of points) rows.push([name, `@media (min-width: ${px}px)`]);
        rows.push(['Range only', `@media (min-width: ${points[0][1]}px) and (max-width: ${points[1][1] - 0.02}px)`]);
        rows.push(['The 0.02 gap', 'max-width uses the value BELOW the next breakpoint, or a screen exactly on the boundary matches both rules.']);
        return rows;
      },
      examples: [
        { in: { scale: 'tailwind', custom: '' }, match: /sm[\s\S]*min-width: 640px/ },
      ],
    },

    // ------------------------------------------------------------------- unix
    {
      id: 'unix-umask',
      name: 'umask',
      icon: 'lock',
      family: 'dev',
      desc: 'What a umask actually leaves behind for new files and directories — the subtraction people get backwards.',
      keywords: ['umask', 'chmod', 'permissions', 'unix', 'linux'],
      fields: [{ id: 'mask', label: 'umask', type: 'text', value: '022', placeholder: '022' }],
      run(v) {
        const raw = need(v.mask, 'a umask like 022');
        if (!/^[0-7]{3,4}$/.test(raw)) throw new Error('A umask is three or four octal digits, like 022 or 0027.');
        const mask = parseInt(raw, 8);
        const show = (base) => {
          const result = base & ~mask & 0o777;
          const oct = result.toString(8).padStart(3, '0');
          const rwx = [...oct].map(d => {
            const n = parseInt(d, 10);
            return (n & 4 ? 'r' : '-') + (n & 2 ? 'w' : '-') + (n & 1 ? 'x' : '-');
          }).join('');
          return `${oct}  ${rwx}`;
        };
        return [
          ['New files', show(0o666)],
          ['New directories', show(0o777)],
          ['Why 666 not 777', 'A new file is never given execute permission — only directories get it, because there x means "may enter".'],
          ['It is not subtraction', 'The bits in the mask are REMOVED. 022 removes write from group and other, which happens to look like subtraction but is not.'],
        ];
      },
      examples: [
        { in: { mask: '022' }, match: /New files[\s\S]*644  rw-r--r--[\s\S]*New directories[\s\S]*755  rwxr-xr-x/ },
        { in: { mask: '077' }, match: /600  rw-------/ },
      ],
    },

    {
      id: 'dev-gitignore',
      name: '.gitignore',
      icon: 'git',
      family: 'dev',
      desc: 'A starting .gitignore for a stack, with what each rule is actually keeping out.',
      keywords: ['gitignore', 'git', 'ignore', 'node_modules'],
      fields: [
        { id: 'stack', label: 'Stack', type: 'select', value: 'node', options: [['node', 'Node / JavaScript'], ['python', 'Python'], ['rust', 'Rust'], ['general', 'Editors and OS only']] },
      ],
      run(v) {
        const COMMON = ['# Editors and OS', '.DS_Store', 'Thumbs.db', '.idea/', '.vscode/*', '!.vscode/extensions.json', '*.swp', ''];
        const STACKS = {
          node: ['# Node', 'node_modules/', 'npm-debug.log*', 'yarn-error.log*', '.pnpm-store/', 'dist/', 'build/', '.cache/', '', '# Secrets — never commit these', '.env', '.env.*', '!.env.example'],
          python: ['# Python', '__pycache__/', '*.py[cod]', '.venv/', 'venv/', '.pytest_cache/', '.mypy_cache/', 'dist/', '*.egg-info/', '', '# Secrets', '.env'],
          rust: ['# Rust', 'target/', '**/*.rs.bk', 'Cargo.lock  # keep this for a binary, ignore it for a library'],
          general: [],
        };
        return [...COMMON, ...(STACKS[v.stack] || [])].join('\n');
      },
      examples: [
        { in: { stack: 'node' }, match: /node_modules\/[\s\S]*\.env/ },
        { in: { stack: 'python' }, match: /__pycache__\// },
      ],
    },

    {
      id: 'web-og-tags',
      name: 'Open Graph tags',
      icon: 'link',
      family: 'web',
      desc: 'The meta tags a link preview actually reads, with the sizes each platform wants.',
      keywords: ['open graph', 'og', 'twitter card', 'meta tags', 'link preview', 'seo'],
      fields: [
        { id: 'title', label: 'Title', type: 'text', placeholder: 'Page title' },
        { id: 'desc', label: 'Description', type: 'text', placeholder: 'One sentence' },
        { id: 'url', label: 'URL', type: 'text', placeholder: 'https://example.com/page' },
        { id: 'image', label: 'Image URL', type: 'text', placeholder: 'https://example.com/card.png' },
      ],
      run(v) {
        const title = need(v.title, 'a title');
        const esc = (s) => String(s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
        const lines = [
          `<meta property="og:title" content="${esc(title)}">`,
          v.desc ? `<meta property="og:description" content="${esc(v.desc)}">` : null,
          v.url ? `<meta property="og:url" content="${esc(v.url)}">` : null,
          v.image ? `<meta property="og:image" content="${esc(v.image)}">` : null,
          '<meta property="og:type" content="website">',
          '',
          `<meta name="twitter:card" content="${v.image ? 'summary_large_image' : 'summary'}">`,
          `<meta name="twitter:title" content="${esc(title)}">`,
          v.desc ? `<meta name="twitter:description" content="${esc(v.desc)}">` : null,
          v.image ? `<meta name="twitter:image" content="${esc(v.image)}">` : null,
          '',
          '<!-- Image: 1200×630 works everywhere. Under 300×200 is ignored.',
          '     The URL must be absolute — a relative path silently shows nothing. -->',
        ].filter(l => l !== null);
        if (title.length > 60) lines.push(`<!-- Title is ${title.length} characters; most previews cut around 60. -->`);
        return lines.join('\n');
      },
      examples: [
        { in: { title: 'Hello', desc: '', url: '', image: '' }, match: /og:title" content="Hello"/ },
      ],
    },
  ]);
})();
