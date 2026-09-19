// === What is this file, before you run it? =================================
//
// A downloaded installer is the one thing a browser hands you that can do
// anything to the machine, and the browser says nothing about it. Windows will
// ask "are you sure" and name the publisher — after you have already
// double-clicked, and only if the file is signed.
//
// This says it first, in the browser, from what can be known locally:
//
//   who signed it        an unsigned installer is not automatically bad, but an
//                        unsigned one claiming to be from a company is
//   where it came from   the site it was downloaded from, which is what you
//                        actually meant to trust
//   its fingerprint      the SHA-256, so it can be compared with what the
//                        project publishes — or looked up, if the user asks
//
// Nothing is sent anywhere. The hash is computed here and shown; whether to
// look it up online is the user's decision, not Vex's.
const path = require('path');

// The kinds of file worth stopping for. A PDF or an image cannot run itself.
const RUNNABLE = /\.(exe|msi|msix|appx|bat|cmd|com|scr|ps1|psm1|vbs|js|jse|wsf|wsh|hta|reg|jar|dll|sh|apk|dmg|pkg|deb|rpm|AppImage)$/i;
const ARCHIVE = /\.(zip|7z|rar|tar|gz|tgz|xz|bz2|iso|cab)$/i;

function createFileCheck({ fs, crypto, execFile, platform = process.platform, log }) {
  const note = typeof log === 'function' ? log : () => {};

  function kindOf(filePath) {
    const name = path.basename(String(filePath || ''));
    if (RUNNABLE.test(name)) return 'runnable';
    if (ARCHIVE.test(name)) return 'archive';
    return 'ordinary';
  }

  // SHA-256, streamed, so a 4 GB file does not become 4 GB of memory.
  function hash(filePath) {
    return new Promise((resolve, reject) => {
      const h = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('error', reject);
      stream.on('data', (chunk) => h.update(chunk));
      stream.on('end', () => resolve(h.digest('hex')));
    });
  }

  // Windows records who signed an executable. PowerShell reads it without
  // running the file, which is the whole point.
  function signature(filePath) {
    if (platform !== 'win32') return Promise.resolve({ status: 'unknown', signer: '', why: 'signatures are only read on Windows' });
    return new Promise((resolve) => {
      const ps = `${process.env.SystemRoot || 'C:\\\\Windows'}\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe`;
      const script = `$ErrorActionPreference='Stop'; $s = Get-AuthenticodeSignature -LiteralPath ${JSON.stringify(filePath)}; ` +
        `[Console]::Out.Write($s.Status.ToString() + "\`n" + $s.SignerCertificate.Subject)`;
      execFile(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { timeout: 15000, windowsHide: true, maxBuffer: 256 * 1024 },
        (err, stdout) => {
          if (err) { resolve({ status: 'unknown', signer: '', why: 'the signature could not be read' }); return; }
          const [statusLine, subject = ''] = String(stdout || '').split('\n');
          const status = String(statusLine || '').trim();
          // "CN=Example Ltd, O=Example Ltd, …" — the common name is the bit a
          // person recognises.
          const cn = (subject.match(/CN=([^,]+)/) || [])[1] || subject.trim();
          resolve({ status: status || 'unknown', signer: cn.replace(/^"|"$/g, ''), why: '' });
        });
    });
  }

  // → { name, kind, sizeBytes, sha256, signature, from, verdict, lines }
  async function inspect(filePath, from) {
    const name = path.basename(String(filePath || ''));
    const out = { name, kind: kindOf(filePath), from: String(from || ''), sizeBytes: 0, sha256: '', signature: null, verdict: 'ordinary', lines: [] };
    let stat;
    try { stat = fs.statSync(filePath); }
    catch (err) { throw new Error('That file is not there any more', { cause: err }); }
    out.sizeBytes = stat.size;
    out.sha256 = await hash(filePath);
    if (out.kind === 'runnable') out.signature = await signature(filePath);

    let host = '';
    try { host = new URL(out.from).hostname; } catch { /* a file with no recorded source */ }

    // The verdict is deliberately plain: Vex is not an antivirus and does not
    // pretend to be one. It reports what is knowable and lets the user decide.
    if (out.kind !== 'runnable') out.verdict = out.kind === 'archive' ? 'archive' : 'ordinary';
    else if (out.signature && out.signature.status === 'Valid') out.verdict = 'signed';
    else if (out.signature && out.signature.status === 'NotSigned') out.verdict = 'unsigned';
    else out.verdict = 'unclear';

    out.lines = [
      `${name} — ${(stat.size / (1024 * 1024)).toFixed(1)} MB`,
      host ? `Downloaded from ${host}` : 'No record of where this came from',
      out.kind === 'runnable'
        ? (out.verdict === 'signed' ? `Signed by ${out.signature.signer}`
          : out.verdict === 'unsigned' ? 'Not signed — nobody has put their name to this file'
            : `The signature could not be checked${out.signature && out.signature.status ? ' (' + out.signature.status + ')' : ''}`)
        : out.kind === 'archive' ? 'An archive — what is inside it is not checked here' : 'Not a program',
      `SHA-256 ${out.sha256}`,
    ];
    note('[FileCheck] ' + name + ': ' + out.verdict);
    return out;
  }

  return { inspect, kindOf, hash, signature, RUNNABLE, ARCHIVE };
}

module.exports = { createFileCheck, RUNNABLE, ARCHIVE };
