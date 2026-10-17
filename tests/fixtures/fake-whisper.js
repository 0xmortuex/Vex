// A stand-in for whisper.cpp's command line, used only by tests. Not part of Vex.
// Usage seen by the real program:  whisper-cli -m MODEL -f FILE.wav -l LANG -nt -np
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const at = (flag) => args[args.indexOf(flag) + 1];
const wav = at('-f');
const log = process.env.FAKE_WHISPER_LOG;
if (log) fs.appendFileSync(log, JSON.stringify({ args, cwd: process.cwd(), wavExists: fs.existsSync(wav) }) + '\n');
const mode = process.env.FAKE_WHISPER_MODE || 'ok';
if (mode === 'fail') { process.stderr.write('model file is damaged\n'); process.exit(3); }
if (mode === 'hang') { setInterval(() => {}, 1000); return; }
if (mode === 'flood') { process.stdout.write('x'.repeat(400 * 1024)); setInterval(() => {}, 1000); return; }
const bytes = fs.readFileSync(wav);
const samples = (bytes.length - 44) / 2;
if (mode === 'blank') { process.stdout.write(' [BLANK_AUDIO]\n'); process.exit(0); }
process.stdout.write(' hello from ' + path.basename(wav) + ' with ' + samples + ' samples lang=' + at('-l') + '\n');
