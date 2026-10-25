// What a file is, from its name: the icon, the words for its type, and how it opens. Nothing here reads a file.
//
// How a file opens (openMode):
//   'folder'   goes into the folder
//   'tab'      a kind Chromium shows by itself: opened in a tab (the viewers of Vex's own take such files over there, by address)
//   'external' any other kind: handed to the program Windows has for it, on the person's click or Enter
//   'runnable' a program, script, shortcut or disk image: never opened by a click or Enter. A warning comes first, and only its
//              "Open with Windows" button opens it (main checks the same list again, file-check.js RUNNABLE)

export const extOf = (name) => { const i = String(name).lastIndexOf('.'); return i > 0 ? String(name).slice(i + 1).toLowerCase() : ''; };

const set = (text) => new Set(text.split(/\s+/).filter(Boolean));

// Shown by Chromium itself when a file: address is opened. md, csv and the code kinds are not here: Chromium would download them.
// The lead adds the extensions the text, Markdown, CSV, media and Office viewers of Vex take over when they are merged.
export const OPEN_IN_TAB = set(`html htm xhtml svg txt log json xml css png jpg jpeg jfif gif webp avif bmp ico pdf
  mp3 wav ogg oga opus m4a flac aac mp4 m4v webm ogv`);

// The same list as RUNNABLE in src/main/file-check.js (a test holds them equal).
export const RUNNABLE_EXT = set(`exe msi msix msixbundle appx appxbundle bat cmd com scr ps1 psm1 vbs js jse wsf wsh hta reg jar dll sh apk dmg pkg deb rpm appimage
  lnk url scf pif website library-ms search-ms searchconnector-ms settingcontent-ms
  cpl msc chm hlp msp mst application appref-ms xbap
  vb vbe wsc ws sct shb shs ps1xml ps2 ps2xml psc1 psc2 msh msh1 msh2 mshxml msh1xml msh2xml
  inf ins isp xll ocx gadget one jnlp
  iso img vhd vhdx`);

// Kinds a picture can be made of (the same list as THUMB_EXT in main/folder-viewer.js; a test holds them equal).
export const THUMB_EXT = set(`jpg jpeg jfif png gif bmp webp avif ico tif tiff heic heif mp4 m4v mkv avi mov webm wmv mpg mpeg pdf`);

// [type words, icon, extensions]. The words are English sentences; strings-tr.js has each in Turkish.
const KINDS = [
  ['Image', 'image', 'jpg jpeg jfif png gif bmp webp avif ico tif tiff heic heif svg raw cr2 nef arw dng psd'],
  ['PDF document', 'file-pdf', 'pdf'],
  ['Markdown document', 'file-text', 'md markdown mdx'],
  ['Text file', 'file-text', 'txt log text rtf srt vtt'],
  ['Web page', 'globe', 'html htm xhtml mhtml'],
  ['Audio file', 'music', 'mp3 wav ogg oga opus m4a flac aac wma mid midi'],
  ['Video file', 'video', 'mp4 m4v mkv avi mov webm wmv mpg mpeg ogv flv 3gp'],
  ['Archive', 'archive', 'zip 7z rar tar gz tgz xz bz2 cab zst'],
  ['Spreadsheet', 'file-sheet', 'xls xlsx xlsm ods csv tsv'],
  ['Document', 'file-text', 'doc docx odt pages epub mobi'],
  ['Presentation', 'file-slides', 'ppt pptx odp key'],
  ['Shortcut', 'link', 'lnk url website'],
  ['Disk image', 'drive', 'iso img vhd vhdx dmg'],
  ['Program', 'window', 'exe msi msix msixbundle appx appxbundle com scr jar apk deb rpm appimage'],
  ['Script', 'terminal', 'bat cmd ps1 psm1 vbs vbe wsf wsh hta reg sh js jse'],
  ['Library', 'puzzle', 'dll ocx cpl xll'],
  ['Source code', 'code', 'mjs cjs jsx ts tsx py rb php java kt c h cpp hpp cs go rs swift sql vue svelte css scss less lua pl r dart'],
  ['Data file', 'braces', 'json jsonc xml yml yaml toml ini cfg conf env properties db sqlite lock'],
  ['Font', 'type', 'ttf otf woff woff2'],
];
// Every type sentence kindOf can return (the test that holds the Turkish complete reads this).
export const KIND_LABELS = [...new Set([...KINDS.map((k) => k[0]), 'Folder', 'File', '{ext} file'])];
const BY_EXT = new Map();
for (const [label, icon, list] of KINDS) for (const e of list.split(' ')) if (!BY_EXT.has(e)) BY_EXT.set(e, { label, icon });

export function openModeOf(name, isDir) {
  if (isDir) return 'folder';
  const ext = extOf(name);
  if (OPEN_IN_TAB.has(ext)) return 'tab';
  if (RUNNABLE_EXT.has(ext)) return 'runnable';
  return 'external';
}

// -> { label, icon, ext, args, open }: label is the English sentence for t(label, args).
export function kindOf(name, isDir) {
  if (isDir) return { label: 'Folder', icon: 'folder', ext: '', args: null, open: 'folder' };
  const ext = extOf(name);
  const found = BY_EXT.get(ext);
  const open = openModeOf(name, false);
  if (found) return { label: found.label, icon: found.icon, ext, args: null, open };
  if (!ext) return { label: 'File', icon: 'file', ext, args: null, open };
  return { label: '{ext} file', icon: 'file', ext, args: { ext: ext.toUpperCase().slice(0, 8) }, open };
}

export const canThumb = (name) => THUMB_EXT.has(extOf(name));
