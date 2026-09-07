// Never retain complete URLs or credentials in diagnostic output.
(function () {
  function redact(value) {
    let text = value instanceof Error ? value.stack || value.message : typeof value === 'string' ? value : JSON.stringify(value);
    return String(text).replace(/(?:https?|file):\/\/[^\s"'<>]+/gi, '[URL redacted]')
      .replace(/("(?:authorization|password|sessionToken|api[_-]?key|access[_-]?token|secret|encryptionKey)"\s*:\s*)"(?:\\.|[^"\\])*"/gi, '$1"[redacted]"')
      .replace(/(authorization\s*[=:]\s*)(?:Bearer\s+)?[^\r\n,}]+/gi, '$1[redacted]')
      .replace(/((?:password|sessionToken|api[_-]?key|access[_-]?token|secret)\s*[=:]\s*)[^\s,}]+/gi, '$1[redacted]');
  }
  function install(verbose = false) {
    for (const method of ['log','info','debug','warn','error']) {
      const output = console[method].bind(console);
      console[method] = (...args) => {
        if (!verbose && ['log','info','debug'].includes(method) && !String(args[0]).startsWith('SMOKE:')) return;
        output(...args.map(value => { try { return redact(value); } catch { return '[unserializable]'; } }));
      };
    }
  }
  if (typeof module !== 'undefined') module.exports = { redact, install };
  else install(false);
})();
