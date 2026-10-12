// === Is this address this machine or the local network? ===
//
// The agent is steered by text it reads, so it must not be talked into
// reading the user's router or a service on this machine (found 2026-10-10:
// http://[::ffff:127.0.0.1]/, the machine's own name and a redirect all got
// through a check that only looked at dotted IPv4 prefixes).
//
// Shared by the window (an early, friendly refusal in AgentTools) and main
// (src/main/public-fetch.js), which makes the real decision on every hop and
// on the resolved address. Plain functions, no DOM, no Node.
// Public API: VexPrivateAddress.{ isPrivateHost, isPrivateIp, parseIPv4, expandIPv6 }.

(function () {
  // Dotted IPv4 → [a, b, c, d], or null. Only the canonical form: the URL
  // parser has already turned 0x7f.1 and 2130706433 into 127.0.0.1.
  function parseIPv4(s) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(s || ''));
    if (!m) return null;
    const parts = m.slice(1).map(Number);
    return parts.every(n => n <= 255) ? parts : null;
  }

  function privateIPv4([a, b]) {
    return a === 0                                   // "this network", 0.0.0.0
      || a === 10
      || (a === 100 && b >= 64 && b <= 127)          // carrier-grade NAT
      || a === 127
      || (a === 169 && b === 254)                    // link-local
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 192 && b === 0)                      // 192.0.0.0/24 IETF + 192.0.2.0/24 docs
      || (a === 198 && (b === 18 || b === 19))       // benchmarking
      || a >= 224;                                   // multicast, reserved, broadcast
  }

  // An IPv6 address → its eight 16-bit groups, or null. Takes an embedded
  // dotted IPv4 tail (::ffff:127.0.0.1) and a zone (fe80::1%eth0).
  function expandIPv6(s) {
    let h = String(s || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
    if (!h.includes(':')) return null;
    const tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(h);
    if (tail) {
      const v4 = parseIPv4(tail[1]);
      if (!v4) return null;
      h = h.slice(0, -tail[1].length) + ((v4[0] << 8) | v4[1]).toString(16) + ':' + ((v4[2] << 8) | v4[3]).toString(16);
    }
    const halves = h.split('::');
    if (halves.length > 2) return null;
    const side = (x) => (x ? x.split(':') : []);
    const head = side(halves[0]), rest = halves.length === 2 ? side(halves[1]) : [];
    const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
    if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
    const groups = [...head, ...Array(fill).fill('0'), ...rest];
    if (groups.length !== 8 || !groups.every(g => /^[0-9a-f]{1,4}$/.test(g))) return null;
    return groups.map(g => parseInt(g, 16));
  }

  function v4From(hi, lo) { return [hi >> 8, hi & 255, lo >> 8, lo & 255]; }

  function privateIPv6(g) {
    const zeroTo = (n) => g.slice(0, n).every(x => x === 0);
    if (zeroTo(8)) return true;                                        // :: unspecified
    if (zeroTo(7) && g[7] === 1) return true;                          // ::1 loopback
    if (zeroTo(5) && g[5] === 0xffff) return privateIPv4(v4From(g[6], g[7]));   // ::ffff:a.b.c.d
    if (zeroTo(6)) return privateIPv4(v4From(g[6], g[7]));             // ::a.b.c.d (old compatible form)
    if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every(x => x === 0)) return privateIPv4(v4From(g[6], g[7])); // NAT64
    if (g[0] === 0x2002) return privateIPv4(v4From(g[1], g[2]));       // 6to4
    if ((g[0] & 0xfe00) === 0xfc00) return true;                       // fc00::/7 unique local
    if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true; // link-/site-local
    if ((g[0] & 0xff00) === 0xff00) return true;                       // multicast
    return false;
  }

  // A literal address (v4 or v6, brackets allowed). Not an address → false.
  function isPrivateIp(ip) {
    const v4 = parseIPv4(ip);
    if (v4) return privateIPv4(v4);
    const v6 = expandIPv6(ip);
    return v6 ? privateIPv6(v6) : false;
  }

  function isIpLiteral(host) {
    return !!(parseIPv4(host) || expandIPv6(host));
  }

  // A host name as the URL parser gives it (lower case, IPv6 in brackets).
  // A name with no dot is a machine on the local network (or this one), so
  // it is refused whatever it resolves to.
  function isPrivateHost(host) {
    const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
    if (!h) return true;
    if (isIpLiteral(h)) return isPrivateIp(h);
    if (!h.includes('.')) return true;
    return /(^|\.)(localhost|local|internal|lan|home\.arpa|intranet|corp)$/.test(h);
  }

  const api = { isPrivateHost, isPrivateIp, isIpLiteral, parseIPv4, expandIPv6 };
  if (typeof window !== 'undefined') window.VexPrivateAddress = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
