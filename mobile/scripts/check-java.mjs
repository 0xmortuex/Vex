// Type-check the Android sources without an Android SDK.
//
// Gradle needs the SDK, Google's Maven and a network most CI images do not
// have. This compiles the same sources with plain javac against:
//
//   • the real Android framework — Robolectric's android-all jar carries the
//     actual android.webkit classes, so a wrong WebView signature fails here
//     exactly as it would in a real build;
//   • tools/stubs — hand-written androidx and Capacitor shims, because those
//     live on Google's Maven. They check our calls, not the libraries: if a
//     stub drifts from the real signature this passes and Gradle still fails.
//   • a generated R.java, built from the resources the app declares — strings,
//     layouts, drawables and the ids inside the layouts — so a reference to a
//     resource that does not exist is a compile error rather than a crash on a
//     device.
//
// Resolution order for the framework jar: $ANDROID_JAR → $ANDROID_HOME's
// platform → a cached download → Maven Central. Offline with no cache, it
// says so and exits 0 rather than failing a check it could not run.
//
//   node scripts/check-java.mjs [--offline]

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const appJava = path.join(root, 'android', 'app', 'src', 'main', 'java');
const stubs = path.join(root, 'tools', 'stubs');
const res = path.join(root, 'android', 'app', 'src', 'main', 'res');
const strings = path.join(res, 'values', 'strings.xml');

const ROBOLECTRIC = {
  version: '17-robolectric-15733970',
  url: 'https://repo1.maven.org/maven2/org/robolectric/android-all/17-robolectric-15733970/android-all-17-robolectric-15733970.jar'
};
const cacheDir = path.join(os.homedir(), '.cache', 'vex-mobile');
const cachedJar = path.join(cacheDir, 'android-all-' + ROBOLECTRIC.version + '.jar');

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function findPlatformJar() {
  const home = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!home) return null;
  const platforms = path.join(home, 'platforms');
  if (!fs.existsSync(platforms)) return null;
  const best = fs.readdirSync(platforms)
    .filter(name => /^android-\d+$/.test(name))
    .sort((a, b) => Number(b.slice(8)) - Number(a.slice(8)))[0];
  if (!best) return null;
  const jar = path.join(platforms, best, 'android.jar');
  return fs.existsSync(jar) ? jar : null;
}

function resolveFrameworkJar() {
  if (process.env.ANDROID_JAR && fs.existsSync(process.env.ANDROID_JAR)) {
    return { jar: process.env.ANDROID_JAR, from: 'ANDROID_JAR' };
  }
  const platform = findPlatformJar();
  if (platform) return { jar: platform, from: 'Android SDK' };
  if (fs.existsSync(cachedJar)) return { jar: cachedJar, from: 'cache' };
  if (process.argv.includes('--offline')) return { jar: null, from: 'offline' };
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    console.log('fetching the Android framework jar (once, ~210 MB) …');
    execFileSync('curl', ['-sSL', '--fail', '-o', cachedJar + '.part', ROBOLECTRIC.url], { stdio: 'inherit' });
    fs.renameSync(cachedJar + '.part', cachedJar);
    return { jar: cachedJar, from: 'Maven Central' };
  } catch {
    try { fs.unlinkSync(cachedJar + '.part'); } catch {}
    return { jar: null, from: 'unreachable' };
  }
}

// R.java, generated from the resources the app actually declares: the strings,
// every file under res/layout and res/drawable, and every @+id declared inside
// a layout. aapt would generate the same names; this way javac knows them.
function resourceNames(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(name => /\.(xml|png|webp|jpg)$/i.test(name))
    .map(name => name.replace(/\.[^.]+$/, ''));
}

function layoutIds() {
  const ids = new Set();
  for (const file of walk(path.join(res, 'layout'))) {
    if (!file.endsWith('.xml')) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/android:id="@\+id\/([\w.]+)"/g)) ids.add(match[1]);
  }
  return [...ids];
}

function block(name, names, base) {
  return '    public static final class ' + name + ' {\n'
    + names.map((entry, index) => '        public static final int ' + entry + ' = ' + (base + index) + ';').join('\n')
    + (names.length ? '\n' : '') + '    }\n';
}

function writeR(dir) {
  const source = fs.readFileSync(strings, 'utf8');
  const names = [...source.matchAll(/<string\s+name="([^"]+)"/g)].map(match => match[1]);
  const pkgDir = path.join(dir, 'com', 'vex', 'browser');
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'R.java'),
    'package com.vex.browser;\n\n'
    + '// Generated by scripts/check-java.mjs from res/.\n'
    + 'public final class R {\n'
    + block('string', names, 0x7f0a0000)
    + block('layout', resourceNames(path.join(res, 'layout')), 0x7f0b0000)
    + block('drawable', resourceNames(path.join(res, 'drawable')), 0x7f0c0000)
    + block('id', layoutIds(), 0x7f0d0000)
    + '    public static final class mipmap { public static final int ic_launcher = 1; }\n'
    + '    public static final class style { public static final int AppTheme = 2; }\n'
    + '}\n');
}

const { jar, from } = resolveFrameworkJar();
if (!jar) {
  console.log('skipped — no Android framework jar (' + from + '). '
    + 'Set ANDROID_JAR or ANDROID_HOME, or run once with a network to cache it.');
  process.exit(0);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-java-'));
writeR(work);
const sources = [...walk(appJava), ...walk(stubs), ...walk(work)].filter(file => file.endsWith('.java'));
const out = path.join(work, 'classes');
fs.mkdirSync(out, { recursive: true });

// The framework jar goes on the classpath rather than the bootclasspath: a
// modern javac refuses -bootclasspath, and android.* is not in the JDK, so
// there is nothing to shadow.
const result = spawnSync('javac', [
  '-nowarn',
  '-proc:none',
  '-classpath', [jar, stubs, work].join(path.delimiter),
  '-d', out,
  ...sources
], { encoding: 'utf8' });

const output = (result.stdout || '') + (result.stderr || '');
// The JVM's own startup chatter (JAVA_TOOL_OPTIONS in proxied environments)
// and deprecation notes are not findings; drop them.
const noise = /bootstrap class path|source value|target value|deprecat|JAVA_TOOL_OPTIONS|Picked up/i;
const lines = output.split('\n').filter(line => line.trim() && !noise.test(line));

if (result.status !== 0) {
  console.error(lines.join('\n'));
  console.error('\nFAIL — Android sources do not compile (framework from ' + from + ')');
  process.exit(1);
}
if (lines.length) console.log(lines.join('\n'));
const appFiles = sources.filter(file => file.startsWith(appJava)).length;
console.log('ok — ' + appFiles + ' Android sources compile against the framework (' + from + ')');
fs.rmSync(work, { recursive: true, force: true });
