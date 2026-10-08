// Windows code signing (Authenticode), switched on by environment variables.
//
// Vex ships unsigned until the owner has a certificate. Everything needed to
// sign is here, so turning it on is setting a few variables (RELEASING.md,
// "Turn on code signing"); nothing in package.json changes.
//
// This file is two things:
//   1. electron-builder's parent config. package.json "build.extends" points
//      here; electron-builder calls the exported function at build time and
//      merges what it returns UNDER package.json's "build". It returns only
//      the "win" signing options for the mode the environment asks for.
//   2. The checks: what mode is configured (setupFromEnv), and whether built
//      files really carry the signature that mode promises (checkSigned).
//
// Modes (exactly one, or none):
//   pfx    CSC_LINK or WIN_CSC_LINK (+ CSC_KEY_PASSWORD / WIN_CSC_KEY_PASSWORD):
//          a .pfx file (path, https URL or base64). electron-builder reads
//          these itself. Note: since June 2023 public CAs issue code-signing
//          keys only on hardware (token/HSM), so a bought OV/EV certificate
//          usually cannot be exported as a .pfx; use "store" for those.
//   store  VEX_WIN_CERT_SHA1: the thumbprint of a certificate in the Windows
//          certificate store (a USB token, or a cloud card such as Certum
//          SimplySign, shows up there). signtool finds the key by thumbprint.
//   azure  VEX_AZURE_SIGN_ENDPOINT, VEX_AZURE_SIGN_ACCOUNT,
//          VEX_AZURE_SIGN_PROFILE and VEX_WIN_PUBLISHER, plus the service
//          principal AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET
//          (read by Microsoft's TrustedSigning PowerShell module).
//   none   nothing set: the build is exactly what it was before this file
//          existed, and says "unsigned build" once.
//
// VEX_WIN_PUBLISHER (optional for pfx/store, required for azure): the
// certificate's common name. When set, every signed file must be signed by
// exactly that name, so a wrong certificate fails the build.
//
// VEX_SIGN_ALLOW_UNTRUSTED=1 is for testing with a self-signed certificate:
// the check then accepts a signature Windows does not trust (status
// UnknownError/NotTrusted). It is refused for a release (--release).
//
// ORDER WITH WIDEVINE (VMP). castLabs' VMP signature of Vex.exe is a SHA-512
// of the WHOLE file (vmp-resign.py, hash_pe0, in the castLabs electron
// package; a Mach-O excludes its signature section, a PE does not). An
// Authenticode signature is written INTO Vex.exe, so it must be added first
// and VMP-signed after it, never the other way round. electron-builder signs
// every .exe in the app folder (signApp), then calls "afterSign", which is
// where scripts/vmp-sign.js runs; it checks Vex.exe is already signed before
// it asks castLabs for the VMP signature, and that nothing changed after.
'use strict';

const fs = require('fs');
const path = require('path');

// Today's only signing option, kept for the unsigned build so it stays byte
// for byte what it was (it only feeds resources/app-update.yml, which Vex's
// own updater does not read). A function: electron-builder merges INTO the
// object it is given.
const unsignedWin = () => ({ signtoolOptions: { publisherName: '0xmortuex' } });

const AZURE_KEYS = ['VEX_AZURE_SIGN_ENDPOINT', 'VEX_AZURE_SIGN_ACCOUNT', 'VEX_AZURE_SIGN_PROFILE'];
const AZURE_CREDENTIALS = ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET'];

const has = (env, key) => typeof env[key] === 'string' && env[key].trim() !== '';

// → { mode, label, publisher, allowUntrusted, win } ; throws when the
// variables are half set or ask for two modes at once.
function setupFromEnv(env = process.env) {
  const publisher = has(env, 'VEX_WIN_PUBLISHER') ? env.VEX_WIN_PUBLISHER.trim() : null;
  const allowUntrusted = env.VEX_SIGN_ALLOW_UNTRUSTED === '1';
  const pfx = has(env, 'WIN_CSC_LINK') || has(env, 'CSC_LINK');
  const store = has(env, 'VEX_WIN_CERT_SHA1');
  const azureSet = AZURE_KEYS.filter(k => has(env, k));
  const azure = azureSet.length > 0;

  const asked = [pfx && 'pfx (CSC_LINK/WIN_CSC_LINK)', store && 'store (VEX_WIN_CERT_SHA1)', azure && 'azure (VEX_AZURE_SIGN_*)'].filter(Boolean);
  if (asked.length > 1) throw new Error('code signing: more than one signing method is set: ' + asked.join(', ') + '. Set exactly one.');

  if (azure) {
    const missing = [...AZURE_KEYS, ...AZURE_CREDENTIALS, 'VEX_WIN_PUBLISHER'].filter(k => !has(env, k));
    if (missing.length) throw new Error('code signing: Azure Trusted Signing is half set up; missing ' + missing.join(', ') + '.');
    return {
      mode: 'azure', label: 'Azure Trusted Signing (' + env.VEX_AZURE_SIGN_ACCOUNT.trim() + '/' + env.VEX_AZURE_SIGN_PROFILE.trim() + ')', publisher, allowUntrusted,
      win: { azureSignOptions: {
        endpoint: env.VEX_AZURE_SIGN_ENDPOINT.trim(),
        codeSigningAccountName: env.VEX_AZURE_SIGN_ACCOUNT.trim(),
        certificateProfileName: env.VEX_AZURE_SIGN_PROFILE.trim(),
        publisherName: publisher,
      } },
    };
  }
  if (store) {
    const sha1 = env.VEX_WIN_CERT_SHA1.replace(/\s+/g, '').toUpperCase();
    if (!/^[0-9A-F]{40}$/.test(sha1)) throw new Error('code signing: VEX_WIN_CERT_SHA1 must be a 40-character certificate thumbprint.');
    return {
      mode: 'store', label: 'certificate store, thumbprint ' + sha1, publisher, allowUntrusted,
      win: { signtoolOptions: { certificateSha1: sha1, signingHashAlgorithms: ['sha256'], ...(publisher ? { publisherName: publisher } : {}) } },
    };
  }
  if (pfx) {
    return {
      mode: 'pfx', label: 'certificate file (' + (has(env, 'WIN_CSC_LINK') ? 'WIN_CSC_LINK' : 'CSC_LINK') + ')', publisher, allowUntrusted,
      win: { signtoolOptions: { signingHashAlgorithms: ['sha256'], ...(publisher ? { publisherName: publisher } : {}) } },
    };
  }
  return { mode: 'none', label: 'unsigned build', publisher: null, allowUntrusted, win: unsignedWin() };
}

// The line every build prints once about signing.
function describe(setup) {
  return setup.mode === 'none'
    ? '[Sign] unsigned build: no code-signing certificate configured (RELEASING.md, "Turn on code signing")'
    : '[Sign] code signing ON: ' + setup.label + (setup.publisher ? ', expected signer "' + setup.publisher + '"' : '') +
      (setup.allowUntrusted ? ' (TEST: untrusted signatures accepted)' : '');
}

// electron-builder parent config (package.json "build.extends").
function electronBuilderConfig() {
  const setup = setupFromEnv(process.env);
  console.log(describe(setup));
  // A configured build that fails to sign any file stops instead of shipping
  // half signed (electron-builder throws from its signer).
  return setup.mode === 'none' ? { win: setup.win } : { forceCodeSigning: true, win: setup.win };
}

// Whether one file's signature is what the configured mode promises.
// `sig` is file-check.js's signature(): { status, signer, timestamped }.
// → list of problems (empty = fine).
function problemsWith(name, sig, setup, { offline = false } = {}) {
  const out = [];
  if (!sig || sig.status === 'unknown') return [name + ': the signature could not be read' + (sig && sig.why ? ' (' + sig.why + ')' : '')];
  if (sig.status === 'NotSigned') return [name + ': NOT SIGNED'];
  if (sig.status === 'HashMismatch') return [name + ': the signature does not match the file (it was changed after signing)'];
  const untrustedOk = setup.allowUntrusted && (sig.status === 'UnknownError' || sig.status === 'NotTrusted');
  if (sig.status !== 'Valid' && !untrustedOk) out.push(name + ': signature status is ' + sig.status + ', not Valid');
  if (setup.publisher && sig.signer !== setup.publisher) out.push(name + ': signed by "' + sig.signer + '", expected "' + setup.publisher + '"');
  if (!offline && !sig.timestamped) out.push(name + ': the signature has no timestamp (it would stop being valid when the certificate expires)');
  return out;
}

// Read and check every file. `readSignature(file)` → Promise<sig>.
// → { ok, lines, problems, signers }
async function checkSigned(files, setup, readSignature, { offline = false } = {}) {
  const lines = [], problems = [], signers = new Set();
  for (const { name, file } of files) {
    if (!fs.existsSync(file)) { problems.push(name + ': missing (' + file + ')'); continue; }
    const sig = await readSignature(file);
    lines.push(`  ${name}: ${sig.status}${sig.signer ? ' — ' + sig.signer : ''}${sig.timestamped ? ', timestamped' : ''}`);
    if (sig.signer) signers.add(sig.signer);
    problems.push(...problemsWith(name, sig, setup, { offline }));
  }
  if (signers.size > 1) problems.push('the files are signed by different names: ' + [...signers].join(', '));
  return { ok: problems.length === 0, lines, problems, signers: [...signers] };
}

// file-check.js's Authenticode reader (Windows PowerShell 5.1, the path
// passed in an environment variable), shared with the browser's download check.
function signatureReader() {
  const { execFile } = require('child_process');
  const { createFileCheck } = require(path.join(__dirname, '..', 'src', 'main', 'file-check.js'));
  return createFileCheck({ fs, crypto: require('crypto'), execFile }).signature;
}

module.exports = electronBuilderConfig;
Object.assign(module.exports, { setupFromEnv, describe, problemsWith, checkSigned, signatureReader, unsignedWin });
