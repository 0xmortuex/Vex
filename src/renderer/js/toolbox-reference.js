// === Vex tool reference ====================================================
//
// The reference panel content for pack tools, keyed by tool id.
//
// It lives here rather than inside each pack because a pack is about *doing*
// the work — the formula, the validation, the output rows. This is the part a
// good standalone tool site gets right and a calculator does not: what the
// number means, where the method breaks down, the table you would otherwise go
// and look up. Splitting it keeps both halves readable, and lets a tool gain a
// reference without its pack file being touched at all.
//
// Shape, matching ToolboxWorkbench's `details`:
//   'tool-id': [
//     { title: 'Heading', text: 'A paragraph.' },
//     { title: 'Heading', rows: [['left', 'right'], …] },
//   ]
//
// A spec's own `details` still wins — see Toolbox._specToWorkbench. Anything
// stated here has to be true; a reference that guesses is worse than none.
(function () {
  const REF = {

    // ---------------------------------------------------------------- dev

    'dev-json-yaml': [
      { title: 'Why YAML', text: 'YAML is JSON with the punctuation removed and indentation put in its place. Every JSON document is already valid YAML 1.2, so this conversion is a re-spelling, not a translation — nothing is added or lost.' },
      { title: 'Traps', rows: [
        ['Norway problem', 'Unquoted no, off and n read as false in YAML 1.1 parsers. Quote them.'],
        ['Leading zeros', '08 and 09 are errors in YAML 1.1 octal; 0o10 is the 1.2 spelling.'],
        ['Tabs', 'YAML forbids tabs for indentation, anywhere. Spaces only.'],
        ['Duplicate keys', 'Legal-ish in JSON parsers, an error in strict YAML.'],
        ['Version strings', '1.10 unquoted becomes the number 1.1.'],
      ] },
      { title: 'Where each wins', text: 'YAML for files people edit — config, CI, Kubernetes. JSON for anything a machine writes or an API returns: no ambiguity, no indentation to get wrong, and a parser in every language.' },
    ],

    'dev-yaml-json': [
      { title: 'What survives', text: 'Comments, anchors and aliases, multi-document streams and block scalars are YAML features with no JSON equivalent. Comments are dropped; anchors are expanded into copies of their value.' },
      { title: 'Scalar rules', rows: [
        ['true / false', 'Boolean'],
        ['null / ~ / (empty)', 'null'],
        ['0x1f, 0o17, 1e3', 'Number'],
        ['2026-09-13', 'A date in YAML, a string in JSON — quote it to be sure.'],
        ['"123"', 'Quoted stays a string.'],
      ] },
      { title: 'Block scalars', text: '| keeps newlines, > folds them into spaces. A trailing - strips the final newline, + keeps every one. That suffix is the difference between a key that works and one that has a stray \\n at the end.' },
    ],

    'dev-json-ts': [
      { title: 'What it infers', text: 'Types come from one sample, so they describe that sample. A field that happens to be null in the example cannot be told apart from one that is always null, and an empty array gives no element type at all.' },
      { title: 'Check by hand', rows: [
        ['null fields', 'Usually `T | null`, not `null`.'],
        ['Empty arrays', 'Inferred as `unknown[]` — supply the type.'],
        ['Optional keys', 'A key missing from the sample will be missing from the type.'],
        ['Numbers', 'TypeScript has one number type; ids that are really strings stay numbers here.'],
        ['Unions', 'A field that varies between calls needs a union you write yourself.'],
      ] },
      { title: 'Beyond a sample', text: 'For an API you do not control, a runtime validator (zod, valibot, io-ts) buys more than a static type: the type alone is a promise the network is under no obligation to keep.' },
    ],

    'dev-json-path': [
      { title: 'Syntax', rows: [
        ['$', 'The root'],
        ['.name or ["name"]', 'A child key — brackets for keys with dots or spaces'],
        ['[0], [-1]', 'Array index, negative counts from the end'],
        ['[1:4], [:3]', 'A slice'],
        ['[*]', 'Every element'],
        ['..name', 'Every `name` at any depth'],
      ] },
      { title: 'Not one standard', text: 'JSONPath was a 2007 blog post, not a spec, and implementations disagree about slices, filters and what a result set even is. RFC 9535 (2024) finally standardised it; older libraries predate it.' },
      { title: 'The alternative', text: 'JSON Pointer (RFC 6901) does one path to one value — /users/0/name — with no wildcards and no ambiguity. If you only need to address a single node, it is the safer choice.' },
    ],

    'dev-json-diff': [
      { title: 'How it compares', text: 'Structurally, not textually: objects match by key regardless of order, arrays by position. Reformatting a file changes nothing here, which is the whole point of diffing the data rather than the text.' },
      { title: 'Array positions', text: 'One element inserted at the front shifts everything after it, so a positional diff reports every following index as changed. Diffs that track moves need a key per element — that is why APIs give list items ids.' },
      { title: 'Equality corners', rows: [
        ['1 vs 1.0', 'Equal as numbers; different as text.'],
        ['{} vs []', 'Different types.'],
        ['null vs missing', 'A null value is present; a missing key is not.'],
        ['Key order', 'Ignored — JSON objects are unordered by definition.'],
      ] },
    ],

    'dev-json-escape': [
      { title: 'What must be escaped', rows: [
        ['" and \\', 'Always'],
        ['Control chars', 'Anything below U+0020, as \\n \\r \\t \\b \\f or \\u00XX'],
        ['/', 'Optional — \\/ exists only to keep </script> out of HTML'],
        ['U+2028 / U+2029', 'Legal JSON, illegal in old JavaScript source. Escape for JSONP.'],
      ] },
      { title: 'Surrogate pairs', text: 'JSON strings are UTF-16. Anything above U+FFFF — emoji, most CJK extensions — escapes as two \\uD83D\\uDE00 units. A single unpaired surrogate is invalid JSON that many parsers still accept.' },
      { title: 'Never hand-build JSON', text: 'Escaping by string concatenation is how injection bugs happen. Use the serialiser your language ships; this tool is for the times you must paste a string into a file by hand.' },
    ],

    'dev-css-format': [
      { title: 'What minifying removes', text: 'Comments, whitespace between tokens, the last semicolon in a block, and leading zeros. It does not reorder or merge rules — CSS cascade order is significant, and changing it changes the page.' },
      { title: 'Where whitespace matters', rows: [
        ['Descendant combinator', 'div p and div>p are different selectors.'],
        ['calc()', 'calc(100%-20px) is invalid — the minus needs spaces.'],
        ['Custom properties', 'The value is kept verbatim, whitespace included.'],
        ['content: " "', 'Inside a string, every space is data.'],
      ] },
      { title: 'Size in context', text: 'Minified CSS gzips to roughly a third again. The bigger win is usually removing rules no page uses, not squeezing the ones that stay.' },
    ],

    'dev-html-format': [
      { title: 'Whitespace is content', text: 'In HTML, a run of spaces between inline elements collapses to one space — but it does not vanish. Minifying it away closes the gap between two links; keeping it adds one that was not there. This is why HTML minifiers are more cautious than CSS ones.' },
      { title: 'Left alone', rows: [
        ['<pre>, <textarea>', 'Whitespace is significant; never touched.'],
        ['<script>, <style>', 'Different languages — a different minifier\'s job.'],
        ['Conditional comments', 'Look like comments, act like markup.'],
        ['Attribute quotes', 'Removable only when the value has no space, quote, =, < or >.'],
      ] },
    ],

    'dev-sql-format': [
      { title: 'Why the river style', text: 'Keywords right-aligned against a centre gutter, one column per line: the shape shows the clause structure at a glance, and a diff of a changed column touches one line rather than reflowing a paragraph.' },
      { title: 'Formatting is not parsing', text: 'A formatter recognises keywords and brackets; it does not validate your SQL or know your dialect\'s functions. Valid-looking output is not a promise the query runs.' },
      { title: 'Dialect notes', rows: [
        ['Quoting', '"ident" in standard SQL and Postgres, `ident` in MySQL, [ident] in T-SQL.'],
        ['String literals', 'Single quotes everywhere; doubling escapes them.'],
        ['LIMIT', 'LIMIT n in MySQL/Postgres, TOP n in T-SQL, FETCH FIRST n ROWS in standard SQL.'],
        ['Comments', '-- to end of line, /* … */ blocks.'],
      ] },
    ],

    'dev-querystring': [
      { title: 'Not a standard', text: 'The query string has no spec for structure. ?a=1&a=2 might mean a list or a last-wins value depending entirely on the server. Nested objects (a[b]=1, a.b=1) are conventions of particular frameworks, not of URLs.' },
      { title: 'Encoding', rows: [
        ['Space', '+ in form encoding, %20 in a URL path. Both appear in query strings.'],
        ['& = ? #', 'Must be percent-encoded inside a value.'],
        ['Unicode', 'UTF-8 bytes, each percent-encoded — é is %C3%A9.'],
        ['+ as a literal', 'Has to be %2B, or it reads as a space.'],
      ] },
      { title: 'Length', text: 'No limit in the standard, but browsers stop around 32 KB of URL and servers often reject a request line over 8 KB. Anything larger belongs in a request body.' },
    ],

    'dev-url-parse': [
      { title: 'The parts', rows: [
        ['scheme', 'https — decides everything else about how the URL is read'],
        ['authority', 'user@host:port'],
        ['path', 'Case-sensitive on most servers, unlike the host'],
        ['query', 'After ?, sent to the server'],
        ['fragment', 'After #, never sent to the server'],
      ] },
      { title: 'Security corners', text: 'Parsing differences are an attack surface: https://good.com@evil.com goes to evil.com, and a host written in punycode can read like a familiar name. Compare hosts after normalising, never by matching the string.' },
      { title: 'Fragments stay home', text: 'Everything after # is handled by the browser alone. It never appears in a server log — which also means it is no safer a place for a secret, because it is fully visible in the address bar and in JavaScript.' },
    ],

    'dev-http-status': [
      { title: 'The classes', rows: [
        ['1xx', 'Informational — keep going'],
        ['2xx', 'Success'],
        ['3xx', 'Redirect — look elsewhere'],
        ['4xx', 'The request was wrong'],
        ['5xx', 'The server was wrong'],
      ] },
      { title: 'The ones people confuse', rows: [
        ['401 vs 403', 'Not authenticated vs authenticated and still not allowed.'],
        ['301 vs 308', 'Both permanent; 308 keeps the method and body, 301 may turn POST into GET.'],
        ['302 vs 307', 'Same distinction, temporarily.'],
        ['404 vs 410', 'Missing vs deliberately, permanently gone.'],
        ['422 vs 400', 'Well-formed but semantically wrong vs malformed.'],
        ['429', 'Rate limited — pair it with Retry-After.'],
      ] },
      { title: 'Cached by default', text: '200, 203, 204, 206, 300, 301, 308, 404, 405, 410, 414 and 501 are heuristically cacheable without explicit headers. A 301 in particular can be cached by a browser effectively forever — test redirects with 302 first.' },
    ],

    'dev-mime': [
      { title: 'What it decides', text: 'The Content-Type header, not the file extension, tells a browser what a response is. Get it wrong and a page renders as source, a download opens inline, or a script is refused — especially with X-Content-Type-Options: nosniff set.' },
      { title: 'Worth knowing', rows: [
        ['application/json', 'No charset parameter; JSON is UTF-8 by definition.'],
        ['text/javascript', 'The current registration. application/javascript is obsolete but works.'],
        ['image/svg+xml', 'Scriptable — never serve user-uploaded SVG from your own origin.'],
        ['application/octet-stream', 'Unknown bytes. Triggers a download.'],
        ['multipart/form-data', 'File uploads; the boundary parameter is mandatory.'],
      ] },
      { title: 'Sniffing', text: 'Without nosniff, browsers guess from the first bytes and may override your header. That guess is the basis of a family of upload attacks, so set the type correctly and send nosniff.' },
    ],

    'dev-chmod': [
      { title: 'The bits', rows: [
        ['4', 'read'],
        ['2', 'write'],
        ['1', 'execute (on a directory: enter it)'],
        ['Three digits', 'owner, group, everyone else'],
        ['A fourth', 'setuid 4, setgid 2, sticky 1'],
      ] },
      { title: 'Common modes', rows: [
        ['644', 'A normal file — owner writes, everyone reads'],
        ['755', 'A script or a directory'],
        ['600', 'Private — an SSH key, a .env'],
        ['700', 'A private directory'],
        ['1777', '/tmp: everyone writes, only the owner deletes (sticky)'],
      ] },
      { title: 'Directories differ', text: 'On a directory, r lists names, x reaches the contents, and w creates or deletes entries. r without x gives you names you cannot stat; x without r lets you open a path you already know. Deleting a file needs write on its directory, not on the file.' },
      { title: 'umask', text: 'New files are created with 666 minus the umask, directories with 777 minus it. The usual 022 gives 644 and 755 — which is why a file you just made is not executable.' },
    ],

    'dev-semver': [
      { title: 'MAJOR.MINOR.PATCH', text: 'Increment MAJOR for a breaking change, MINOR for a backwards-compatible addition, PATCH for a backwards-compatible fix. The promise is about the public API only — and below 1.0.0, there is no promise at all.' },
      { title: 'Precedence', rows: [
        ['1.0.0-alpha < 1.0.0', 'A pre-release is lower than the release'],
        ['alpha < alpha.1 < beta', 'Dot-separated identifiers compare left to right'],
        ['Numeric < alphanumeric', 'alpha.1 < alpha.beta'],
        ['+build', 'Build metadata is ignored entirely when comparing'],
      ] },
      { title: 'Ranges', rows: [
        ['^1.2.3', '≥1.2.3 <2.0.0 — but ^0.2.3 means ≥0.2.3 <0.3.0'],
        ['~1.2.3', '≥1.2.3 <1.3.0'],
        ['1.2.x', 'Same as ~1.2.0'],
        ['*', 'Anything. Rarely what you want.'],
      ] },
    ],

    'dev-line-endings': [
      { title: 'Three conventions', rows: [
        ['LF (\\n)', 'Unix, Linux, macOS since 10.0, and the inside of every git repo'],
        ['CRLF (\\r\\n)', 'Windows, and the wire format of HTTP, SMTP and CSV'],
        ['CR (\\r)', 'Classic Mac OS before 10. Historical.'],
      ] },
      { title: 'Symptoms', text: 'A stray \\r shows as ^M in a diff, breaks a shell script with "bad interpreter", makes the last field of a CSV row carry an invisible character, and turns a one-line change into a whole-file diff.' },
      { title: 'Fix it once', text: 'A .gitattributes with `* text=auto` normalises to LF in the repository and checks out whatever the platform wants. That is more reliable than core.autocrlf, because it travels with the repo.' },
    ],

    'dev-indent': [
      { title: 'The argument, settled', text: 'Tabs are one character that each reader can size to taste, which is why they are the accessibility-friendlier default. Spaces render identically everywhere, which is why they win where alignment matters. What actually matters is that a file picks one.' },
      { title: 'Where you cannot choose', rows: [
        ['Makefiles', 'Recipe lines must begin with a tab.'],
        ['YAML', 'Tabs are forbidden as indentation.'],
        ['Python', 'Mixing them is an error in Python 3.'],
        ['Go', 'gofmt uses tabs, and does not ask.'],
      ] },
      { title: 'Keep it in the repo', text: 'An .editorconfig sets indent_style and indent_size for every editor at once, so the next person does not reformat the file just by saving it.' },
    ],

    'dev-env-json': [
      { title: 'What a .env is', text: 'A convention, not a format — KEY=value lines read by a library, not by the shell. Quoting, escapes, multi-line values and interpolation all differ between dotenv implementations, so a file that works in one may not in another.' },
      { title: 'Rules that mostly hold', rows: [
        ['KEY=value', 'No spaces around ='],
        ['# comment', 'Whole-line comments; inline ones are not universal'],
        ['"value"', 'Quotes preserve spaces and allow \\n escapes'],
        ['Everything is a string', 'true and 0 arrive as text; convert deliberately'],
        ['Empty value', 'Set to empty, which is different from unset'],
      ] },
      { title: 'Never commit one', text: 'Put .env in .gitignore and commit a .env.example with the keys and no values. If a secret has already been committed, rotate it — removing it from history does not un-leak it.' },
    ],

    'dev-unicode': [
      { title: 'Code point vs character', text: 'What a reader calls one character can be several code points: é may be U+00E9 or e + U+0301, and a family emoji is half a dozen joined with U+200D. Length depends on what you count — bytes, code units, code points, or grapheme clusters.' },
      { title: 'Encodings', rows: [
        ['UTF-8', '1–4 bytes; ASCII is unchanged. The web default.'],
        ['UTF-16', '2 or 4 bytes; what JavaScript strings are made of.'],
        ['Astral planes', 'Above U+FFFF: emoji, rare CJK, historic scripts.'],
        ['BOM', 'U+FEFF at the start. Unnecessary in UTF-8, and it breaks shebangs.'],
      ] },
      { title: 'Invisible trouble', text: 'Zero-width spaces, right-to-left overrides and lookalike Cyrillic letters all survive a copy and paste. When a string compares unequal to one that looks identical, inspect the code points.' },
    ],

    'dev-byte-length': [
      { title: 'Why the number differs', text: 'Database columns, HTTP headers and most APIs count bytes. JavaScript\'s .length counts UTF-16 code units. A user counts what they can see. For anything non-ASCII those are three different numbers.' },
      { title: 'UTF-8 sizes', rows: [
        ['1 byte', 'ASCII — U+0000 to U+007F'],
        ['2 bytes', 'Latin accents, Greek, Cyrillic, Hebrew, Arabic'],
        ['3 bytes', 'Most CJK, and the rest of the basic plane'],
        ['4 bytes', 'Emoji and anything above U+FFFF'],
      ] },
      { title: 'The classic bug', text: 'MySQL\'s "utf8" is three bytes at most and cannot store an emoji; utf8mb4 can. A VARCHAR(255) is 255 characters in Postgres and 255 bytes in plenty of other places — check which before trusting a limit.' },
    ],

    'dev-number-base': [
      { title: 'Bases in use', rows: [
        ['2', 'Bit patterns, flags, masks'],
        ['8', 'Unix permissions, and little else now'],
        ['10', 'People'],
        ['16', 'Bytes, colours, addresses, hashes — one digit per nibble'],
      ] },
      { title: "Two's complement", text: 'Negatives are stored by flipping every bit and adding one, so the top bit reads as the sign and ordinary addition works unchanged. It is also why the range is asymmetric: an 8-bit byte holds −128 to 127, and negating −128 overflows.' },
      { title: 'Widths', rows: [
        ['8-bit', '0…255 unsigned, −128…127 signed'],
        ['16-bit', '0…65 535 / −32 768…32 767'],
        ['32-bit', '±2.1 billion — the 2038 problem'],
        ['53-bit', 'Where JavaScript integers stop being exact'],
      ] },
    ],

    'dev-bitwise': [
      { title: 'The operators', rows: [
        ['a & b', 'AND — test or clear bits with a mask'],
        ['a | b', 'OR — set bits'],
        ['a ^ b', 'XOR — flip bits; twice returns the original'],
        ['~a', 'NOT — every bit flipped'],
        ['a << n', 'Shift left, multiply by 2ⁿ'],
        ['a >> n', 'Arithmetic shift right, sign preserved'],
        ['a >>> n', 'Logical shift right, zeros shifted in'],
      ] },
      { title: 'Flags', text: 'Give each option a distinct power of two, combine with |, test with (flags & FLAG) !== 0, clear with & ~FLAG, toggle with ^ FLAG. One integer then carries 32 independent switches.' },
      { title: 'The JavaScript catch', text: 'Bitwise operators convert to 32-bit signed integers first, so 1 << 31 is negative and anything above 2³²−1 is truncated. Use BigInt for wider work.' },
    ],

    'dev-useragent': [
      { title: 'A history of lies', text: 'Every browser claims to be Mozilla/5.0 because early servers checked for it. Chrome says Safari, Edge says Chrome, and the string has accumulated compatibility tokens for thirty years. Parsing it is guesswork dressed as fact.' },
      { title: 'Use instead', rows: [
        ['Feature detection', "Ask whether the API exists, not who's asking"],
        ['Client Hints', 'Sec-CH-UA headers — structured, and requested explicitly'],
        ['navigator.userAgentData', 'The scripting side of the same idea'],
        ['CSS @supports', 'For style-level differences'],
      ] },
      { title: 'Being frozen', text: 'Browsers are deliberately reducing the detail in the string — version numbers pinned, platform generalised — because it was a fingerprinting vector. Anything you infer from it gets less reliable every year.' },
    ],

    'dev-curl-fetch': [
      { title: 'What maps across', rows: [
        ['-X POST', 'method'],
        ['-H "K: V"', 'headers'],
        ['-d / --data', 'body, and implies POST'],
        ['--data-urlencode', 'body as URLSearchParams'],
        ['-F', 'body as FormData — do not set Content-Type yourself'],
        ['-u user:pass', 'An Authorization: Basic header'],
        ['-L', 'redirect: "follow" — already the default'],
      ] },
      { title: 'What does not', text: 'Cookies, proxies, TLS client certificates and --insecure have no fetch equivalent in a browser: they belong to the environment, not the request. In Node, most of them are options on the agent.' },
      { title: 'Check what you paste', text: 'A cURL copied from devtools carries live cookies and auth headers. Strip them before sharing it, and before committing it into a test.' },
    ],

    'dev-commit-lint': [
      { title: 'Conventional Commits', text: 'type(scope)!: subject. The type and the ! are what release tooling reads: fix → patch, feat → minor, ! or a BREAKING CHANGE footer → major. Everything else is for humans.' },
      { title: 'Types', rows: [
        ['feat', 'A new capability'],
        ['fix', 'A bug fix'],
        ['docs, style', 'No behaviour change'],
        ['refactor, perf', 'Internal change, or a faster one'],
        ['test, build, ci, chore', 'Supporting work'],
      ] },
      { title: 'The old rules still apply', text: 'Imperative mood ("add", not "added"), a subject under ~50 characters, a blank line, then a body wrapped near 72 that says why rather than what. The diff already says what.' },
    ],

    // --------------------------------------------------------------- data

    'data-csv-json': [
      { title: 'CSV is barely a format', text: 'RFC 4180 arrived in 2005, long after everyone had shipped something. Delimiters, quoting, encoding and line endings all vary, which is why a file that opens in one program is mangled in the next.' },
      { title: 'The quoting rules', rows: [
        ['"a,b"', 'A quoted field may contain the delimiter'],
        ['"say ""hi"""', 'A quote inside a quoted field is doubled'],
        ['"line1\\nline2"', 'A field may span lines'],
        ['Leading space', 'a, "b" — the quote is not special after a space'],
      ] },
      { title: 'Excel corners', text: 'Excel writes the list separator from your locale (a semicolon across much of Europe), turns 00123 into 123 and 3-5 into a date, and reads a file as UTF-8 only if it starts with a BOM. None of that is in the standard.' },
    ],

    'data-json-csv': [
      { title: 'Flattening is lossy', text: 'CSV is a rectangle; JSON is a tree. Nested objects have to become dotted column names and arrays have to be joined or exploded into rows. Neither round-trips without a convention agreed in advance.' },
      { title: 'Decide before exporting', rows: [
        ['Missing keys', 'Empty cell, or the string "null"?'],
        ['Nested objects', 'user.name columns, or JSON in one cell?'],
        ['Arrays', 'Joined with a separator, or one row each?'],
        ['Column order', 'From the first row, or the union of every row?'],
      ] },
      { title: 'Formula injection', text: 'A cell starting with =, +, - or @ is executed as a formula when the file is opened in a spreadsheet. For untrusted data, prefix such cells with an apostrophe — it is a real and frequently exploited hole.' },
    ],

    'data-tsv-csv': [
      { title: 'Why TSV is easier', text: 'Tabs almost never appear inside data, so TSV usually needs no quoting at all — which makes it trivial to process with cut, awk and paste, and immune to the delimiter-inside-a-field problem that defines CSV.' },
      { title: 'The catch', text: 'There is no agreed way to encode a literal tab or newline inside a TSV field. The IANA text/tab-separated-values registration simply forbids them; some tools use \\t and \\n escapes instead. Converting to CSV is safe, coming back may not be.' },
      { title: 'Clipboard fact', text: 'Copying cells from Excel, Sheets or Numbers puts TSV on the clipboard. Pasting into a plain text field gives tab-separated text — which is often the quickest way to get a table out of a spreadsheet.' },
    ],

    'data-csv-column': [
      { title: 'Before you extract', text: 'Check that the header row says what you think: duplicate names, a BOM stuck to the first header, and trailing spaces are all common, and each makes a column lookup fail in a way that looks like missing data.' },
      { title: 'Equivalents', rows: [
        ['cut -d, -f3', 'Fast, but has no idea about quotes'],
        ['awk -F,', 'Same limitation'],
        ['csvcut -c name', 'csvkit — quote-aware'],
        ['df["col"]', 'pandas'],
      ] },
    ],

    'data-csv-dedupe': [
      { title: 'What counts as duplicate', text: 'Byte-identical rows are the easy case. Real data duplicates differ by whitespace, case, quoting or a trailing \\r — normalise before comparing, or decide deliberately that you will not.' },
      { title: 'Key vs whole row', text: 'Deduping on the whole row keeps two records that differ only in a timestamp. Deduping on a key column keeps one and silently discards the rest — which is right only if you know which copy you kept.' },
    ],

    'data-csv-sort': [
      { title: 'Text or number', text: 'Sorted as text, 10 comes before 9 and −5 after 100. Sorted as numbers, an empty cell is not zero — it has no position at all. Pick the type per column, and decide where blanks go.' },
      { title: 'Stability', text: 'A stable sort keeps equal rows in their original order, so sorting by city and then by country groups correctly. An unstable one throws that away, and the second sort undoes the first.' },
      { title: 'Locale', text: 'Alphabetical order is language-specific: å sorts after z in Swedish and with a in German, and ch is one letter in traditional Czech. Byte order is the only order that is the same everywhere, and it is nobody\'s alphabet.' },
    ],

    'data-csv-stats': [
      { title: 'Which average', rows: [
        ['Mean', 'Every value counts; one outlier moves it'],
        ['Median', 'The middle value; ignores how extreme the extremes are'],
        ['Mode', 'The most common; the only one that works on categories'],
      ] },
      { title: 'Spread matters more than it looks', text: 'Two columns with the same mean can be completely different data. The standard deviation says how far from the mean a typical value sits; quartiles say the same thing without assuming a shape.' },
      { title: 'Sample or population', text: 'Dividing by n−1 rather than n corrects the bias you get when your rows are a sample of something larger. With a few thousand rows the difference is invisible; with ten it is not.' },
    ],

    'data-csv-sql': [
      { title: 'Escaping', text: "Single quotes are doubled inside a SQL string literal: O'Brien becomes 'O''Brien'. Backslash escapes are a MySQL extension, off in ANSI mode, and relying on them is how injection gets in." },
      { title: 'Faster than INSERT', rows: [
        ['COPY FROM', 'Postgres — by far the fastest path'],
        ['LOAD DATA INFILE', 'MySQL'],
        ['.import', 'SQLite shell'],
        ['Multi-row VALUES', 'One statement, many rows — good enough for thousands'],
      ] },
      { title: 'Wrap it', text: 'Generated INSERTs belong inside a transaction: one BEGIN, one COMMIT. Otherwise each row is its own transaction with its own fsync, and a thousand rows take a thousand times longer than they should.' },
    ],

    'data-xml-json': [
      { title: 'The impedance mismatch', text: 'XML has attributes, ordered mixed content, namespaces and comments; JSON has none of them. Every converter invents a convention — @ for attributes, #text for content — and no two agree.' },
      { title: 'Ambiguities', rows: [
        ['One child or many', '<a><b/></a> is an object; two <b> make an array'],
        ['Empty element', '<a/> — null, empty string or empty object?'],
        ['Whitespace', 'Significant in mixed content, noise elsewhere'],
        ['Namespaces', 'The prefix is not the namespace; the URI is'],
      ] },
      { title: 'Security', text: 'Parsing untrusted XML means turning off external entities. XXE reads local files and reaches internal networks through a document that looks inert, and the billion-laughs entity expansion exhausts memory in a few kilobytes.' },
    ],

    'data-json-xml': [
      { title: 'Naming rules', text: 'An XML element name cannot start with a digit or contain a space, so a JSON key like "2024 total" has no legal equivalent and must be renamed or moved into an attribute. Array elements have no name at all — the converter has to invent one.' },
      { title: 'Must be escaped', rows: [
        ['&', '&amp;'],
        ['<', '&lt;'],
        ['>', '&gt; — required inside ]]>'],
        ['" \'', '&quot; &apos; inside attribute values'],
        ['Control chars', 'Illegal in XML 1.0 at any escaping'],
      ] },
    ],

    // ---------------------------------------------------------------- web

    'web-subnet': [
      { title: 'What the prefix means', text: 'The /n is how many leading bits identify the network. Everything after them addresses hosts, so each bit you give to the network halves the hosts and doubles the number of subnets.' },
      { title: 'Sizes', rows: [
        ['/24', '256 addresses, 254 usable'],
        ['/25', '128 / 126'],
        ['/26', '64 / 62'],
        ['/30', '4 / 2 — a point-to-point link'],
        ['/31', '2 usable, for links only (RFC 3021)'],
        ['/32', 'A single host'],
      ] },
      { title: 'The two you cannot use', text: 'The first address in a block is the network itself and the last is the broadcast, which is why a /24 holds 254 hosts and not 256. Above /30 the arithmetic stops being generous.' },
      { title: 'Private ranges', rows: [
        ['10.0.0.0/8', '16.7 million addresses'],
        ['172.16.0.0/12', '1 million — note it stops at 172.31'],
        ['192.168.0.0/16', '65 536'],
        ['100.64.0.0/10', 'Carrier-grade NAT, not yours'],
        ['169.254.0.0/16', 'Link-local — means DHCP failed'],
      ] },
    ],

    'web-ipv4-int': [
      { title: 'The conversion', text: 'An IPv4 address is a 32-bit number written as four bytes. 192.168.1.1 is 192×2²⁴ + 168×2¹⁶ + 1×2⁸ + 1 = 3 232 235 777. Storing it as an integer makes range queries a simple BETWEEN.' },
      { title: 'Where you meet it', rows: [
        ['GeoIP tables', 'Ranges as integer pairs'],
        ['INET_ATON()', 'MySQL, both directions'],
        ['Firewall rules', 'Integer comparison is cheaper than parsing'],
        ['Obfuscated links', 'http://3232235777/ works in most browsers'],
      ] },
      { title: 'Sign trouble', text: 'Anything above 127.255.255.255 sets the top bit, so a signed 32-bit column stores it as a negative number. Use an unsigned or 64-bit column, or the ordering breaks exactly where the public internet starts.' },
    ],

    'web-ipv6': [
      { title: 'Compression rules', rows: [
        ['Drop leading zeros', '0db8 → db8'],
        ['::', 'One run of zero groups, once per address'],
        ['Lower case', 'RFC 5952 requires it for the canonical form'],
        ['Longest run wins', 'And on a tie, the leftmost'],
      ] },
      { title: 'Ranges to recognise', rows: [
        ['::1/128', 'Loopback'],
        ['fe80::/10', 'Link-local — every interface has one'],
        ['fc00::/7', 'Unique local, the private-range equivalent'],
        ['2000::/3', 'Global unicast — the routable internet'],
        ['::ffff:0:0/96', 'An IPv4 address wearing an IPv6 coat'],
      ] },
      { title: 'In a URL', text: 'Brackets are mandatory: http://[2001:db8::1]:8080/ — otherwise the colons are unparseable against the port. The brackets are part of the URL syntax, not part of the address.' },
    ],

    'web-mac': [
      { title: 'Structure', text: 'Six bytes: the first three are the OUI identifying the manufacturer, the last three are assigned by them. Two bits in the first byte matter — one marks a locally administered address, the other a multicast one.' },
      { title: 'Notations', rows: [
        ['00:1A:2B:3C:4D:5E', 'Unix, and most documentation'],
        ['00-1A-2B-3C-4D-5E', 'Windows'],
        ['001A.2B3C.4D5E', 'Cisco'],
        ['001a2b3c4d5e', 'Bare, in logs and APIs'],
      ] },
      { title: 'Randomised now', text: 'Phones present a different MAC to each network by default, because a stable one tracked people between shops. Anything that identifies a device by MAC — captive portals, licences, allow-lists — is working on sand.' },
    ],

    'web-meta-tags': [
      { title: 'What actually matters', rows: [
        ['<title>', 'The single most important tag on the page'],
        ['description', 'Not a ranking factor; it is the snippet people read'],
        ['og:image', 'The preview card. 1200×630 is the safe size'],
        ['canonical', 'Which URL is the real one'],
        ['viewport', 'Without it, phones render at 980px and zoom out'],
      ] },
      { title: 'Obsolete', text: 'meta keywords has been ignored by every major engine for over a decade. meta refresh is worse than a 301 for both users and crawlers. A charset declaration, though, still belongs in the first 1024 bytes.' },
      { title: 'Cards', text: 'Twitter/X falls back to Open Graph, so og:title, og:description and og:image cover both; add twitter:card only to choose summary_large_image. Both are read by a crawler that does not run JavaScript — client-rendered tags may never be seen.' },
    ],

    'web-robots': [
      { title: 'It is a request, not a fence', text: 'robots.txt asks well-behaved crawlers not to fetch a path. It does not authenticate, does not hide, and is itself public — listing /admin tells everyone where it is. Anything that must not be read needs a login.' },
      { title: 'Directives', rows: [
        ['User-agent: *', 'Starts a group; the most specific group wins'],
        ['Disallow: /path', 'Prefix match, not a glob'],
        ['Allow: /path/ok', 'Exception within a Disallow'],
        ['Sitemap:', 'Absolute URL, and group-independent'],
        ['Crawl-delay', 'Honoured by Bing and Yandex, ignored by Google'],
      ] },
      { title: 'Blocked is not deindexed', text: 'A page blocked in robots.txt can still be listed if others link to it — the crawler never fetches it, so it never sees your noindex. To remove a page, allow the crawl and serve noindex.' },
    ],

    'web-utm': [
      { title: 'The five parameters', rows: [
        ['utm_source', 'Where it came from — newsletter, twitter'],
        ['utm_medium', 'The channel type — email, cpc, social'],
        ['utm_campaign', 'Which campaign'],
        ['utm_term', 'Paid keyword'],
        ['utm_content', 'Which of two links in the same message'],
      ] },
      { title: 'Consistency is the whole game', text: 'Analytics treats Email, email and E-mail as three sources. Pick lower case, no spaces, and a written-down naming scheme before the first campaign, because the data cannot be cleaned afterwards.' },
      { title: 'Do not tag internal links', text: 'A UTM on a link between your own pages starts a new session and attributes the visit to itself, overwriting the real source. Tag only links that arrive from somewhere else.' },
    ],

    'web-strip-tracking': [
      { title: 'What gets added', rows: [
        ['utm_*', 'Campaign attribution'],
        ['fbclid, gclid, msclkid', 'Per-click ids from ad platforms'],
        ['igshid, ttclid', 'Instagram, TikTok'],
        ['ref, ref_src', 'Referrer, spelled by hand'],
        ['mc_eid', 'Mailchimp — identifies the individual recipient'],
      ] },
      { title: 'Why it is worth doing', text: 'Some of these identify a person, not a campaign. Pasting a link with mc_eid into a group chat hands everyone your subscriber id — and any click they make is recorded as yours.' },
      { title: 'Safe to remove', text: 'Tracking parameters are read by analytics, not by the server routing the request, so stripping them leaves the destination unchanged. The exception is a site using a parameter for real state; if the page breaks, put it back.' },
    ],

    'web-email-check': [
      { title: 'What can be checked', text: 'Syntax, a plausible domain, and whether that domain has MX records. Whether a mailbox exists cannot be checked without sending to it — servers stopped answering VRFY and accept-then-bounce for exactly this reason.' },
      { title: 'Legal and surprising', rows: [
        ['"quoted string"@x.com', 'Valid — quotes allow almost anything'],
        ['user+tag@x.com', 'Valid, and useful. Rejecting it is a bug.'],
        ['user@[192.168.0.1]', 'An address literal, valid'],
        ['UTF-8 local parts', 'Valid since RFC 6531'],
        ['Local part case', 'Technically significant; in practice nobody relies on it'],
      ] },
      { title: 'The pragmatic rule', text: 'Validate that there is one @ with something either side, then send a confirmation. Every elaborate regex on the internet rejects addresses that work and accepts ones that do not.' },
    ],

    'web-phone-e164': [
      { title: 'E.164', text: 'The international format: a +, a country code, then the national number — at most 15 digits total, no spaces, no punctuation. It is unambiguous worldwide, which is why every SMS and telephony API demands it.' },
      { title: 'The trunk zero', text: 'Most countries write a leading 0 nationally and drop it internationally: 020 7946 0958 in London is +44 20 7946 0958. Italy is the well-known exception — the 0 is kept. Guessing wrong makes the number undialable.' },
      { title: 'Store it formatted once', text: 'Keep E.164 in the database and format for display at the edges. The reverse — storing what the user typed — means every downstream system re-implements parsing, and they will not agree.' },
    ],

    'web-http-headers': [
      { title: 'Case and repetition', text: 'Header names are case-insensitive and lower-cased on the wire in HTTP/2 and /3. Most may appear more than once and combine with commas; Set-Cookie may not, which is why it gets special handling in every HTTP library.' },
      { title: 'Security headers worth having', rows: [
        ['Strict-Transport-Security', 'HTTPS only, for a stated max-age'],
        ['Content-Security-Policy', 'What the page may load and run'],
        ['X-Content-Type-Options: nosniff', 'Believe the Content-Type'],
        ['Referrer-Policy', 'How much URL leaks to other sites'],
        ['Permissions-Policy', 'Camera, microphone, geolocation'],
      ] },
      { title: 'Caching, in one line', text: 'Cache-Control: max-age tells the browser how long, s-maxage tells shared caches, no-cache means revalidate rather than do not store, and no-store means genuinely do not keep it. immutable is the promise that lets a hashed asset be cached for a year.' },
    ],

    'web-cookie': [
      { title: 'The attributes', rows: [
        ['HttpOnly', 'Unreadable from JavaScript — the XSS mitigation'],
        ['Secure', 'HTTPS only'],
        ['SameSite=Lax', 'The default now; sent on top-level navigation'],
        ['SameSite=Strict', 'Never sent cross-site — breaks "log in from an email link"'],
        ['SameSite=None', 'Cross-site, and requires Secure'],
        ['Domain', 'Omit it for host-only. Setting it widens the scope.'],
      ] },
      { title: 'Limits', text: 'Roughly 4 KB per cookie and about 50 per domain, and every one is sent on every matching request — including images. Cookies are for identifying a session, not for storing data.' },
      { title: 'Prefixes', text: '__Secure- requires the Secure flag; __Host- additionally requires path=/ and no Domain, which pins the cookie to exactly one host. A browser rejects a cookie whose name breaks its prefix, making the guarantee tamper-proof.' },
    ],

    'web-csp': [
      { title: 'What it is for', text: 'CSP is the second line of defence against XSS: even if a script gets injected, the browser refuses to run it unless it matches the policy. It cannot replace escaping output — it limits the damage when escaping fails.' },
      { title: 'Directives', rows: [
        ['default-src', 'The fallback for everything unset'],
        ["script-src 'self'", 'No inline scripts, no third-party scripts'],
        ['style-src', 'Inline styles need a nonce or a hash too'],
        ['img-src, connect-src', 'Images; fetch, XHR and WebSocket'],
        ["frame-ancestors 'none'", 'The modern X-Frame-Options'],
        ['base-uri, form-action', 'Cheap, and closes real holes'],
      ] },
      { title: 'unsafe-inline undoes it', text: "Allowing 'unsafe-inline' in script-src disables essentially the whole protection. Use a per-response nonce or a hash instead. And note that a nonce makes 'unsafe-inline' ignored in modern browsers — which is the intended upgrade path." },
      { title: 'Roll it out safely', text: 'Deploy as Content-Security-Policy-Report-Only with a report-to endpoint first. You will find inline handlers and analytics snippets you had forgotten; fix those before enforcing.' },
    ],

    // ----------------------------------------------------------- security

    'sec-hmac': [
      { title: 'Not a hash of the key plus message', text: 'HMAC hashes the key twice with two different pads — H((K⊕opad) ‖ H((K⊕ipad) ‖ m)). That construction exists to defeat length-extension, which a naive H(key ‖ message) with SHA-256 is wide open to.' },
      { title: 'Choosing', rows: [
        ['HMAC-SHA256', 'The default. Fast, and universally available.'],
        ['HMAC-SHA512', 'Faster than SHA-256 on 64-bit hardware'],
        ['HMAC-SHA1', 'Still unbroken as a MAC, but do not start here'],
        ['Key length', 'A random key the length of the hash output. Longer is hashed down.'],
      ] },
      { title: 'Compare in constant time', text: 'Verifying a signature with == leaks where the first byte differs, and that is enough to forge one a byte at a time. Use crypto.timingSafeEqual, hmac.compare_digest, or your language\'s equivalent.' },
      { title: 'Sign what you mean', text: 'Webhook signatures cover an exact byte sequence — usually a timestamp and the raw body. Parse and re-serialise before verifying and it will never match; check the timestamp too, or an old valid request can be replayed.' },
    ],

    'sec-totp': [
      { title: 'How it works', text: 'RFC 6238: take the Unix time divided by 30, HMAC it with the shared secret, truncate dynamically to 31 bits and take the last six digits. The server does the same arithmetic — nothing is transmitted between you.' },
      { title: 'Parameters', rows: [
        ['Period', '30 seconds, almost always'],
        ['Digits', '6; some banks use 8'],
        ['Algorithm', 'SHA-1 by default — fine here, and what most apps assume'],
        ['Secret', 'Base32, no padding, in the otpauth:// URI'],
        ['Window', 'Servers accept ±1 step for clock drift'],
      ] },
      { title: 'What it does and does not stop', text: 'TOTP stops password reuse and credential stuffing. It does not stop a convincing phishing page, which simply asks for the code and uses it within thirty seconds. Only origin-bound factors — passkeys, security keys — close that.' },
      { title: 'The secret is the account', text: 'Anyone holding the secret can generate codes forever. A screenshot of the QR code in a photo library is a permanent second factor sitting next to the first.' },
    ],

    'sec-base32': [
      { title: 'Why it exists', text: 'Base32 (RFC 4648) uses A–Z and 2–7: no lower case, no 0/O or 1/I/L confusion, and safe in case-insensitive contexts like DNS labels and filenames. The cost is size — 8 characters per 5 bytes, against Base64\'s 4 per 3.' },
      { title: 'Where you meet it', rows: [
        ['TOTP secrets', 'Typed by hand, so ambiguity matters'],
        ['Tor addresses', 'A .onion is Base32'],
        ['DNS', 'NSEC3 hashes'],
        ['Geohashes', 'A different, custom alphabet'],
      ] },
      { title: 'Padding', text: 'Encoded output is padded with = to a multiple of eight characters. Many TOTP apps omit it, and every sane decoder accepts either — but a strict one will not, which is the usual cause of "invalid secret".' },
    ],

    'sec-hex-base64': [
      { title: 'Size', text: 'Hex is two characters per byte, always. Base64 is four per three bytes — about 33% overhead against hex\'s 100%. For anything long, Base64; for anything a person reads a byte at a time, hex.' },
      { title: 'Variants', rows: [
        ['Standard', '+ and / with = padding'],
        ['URL-safe', '- and _ , usually unpadded — RFC 4648 §5'],
        ['MIME', 'Line breaks every 76 characters'],
        ['Hex case', 'Either; compare case-insensitively'],
      ] },
      { title: 'Not encryption', text: 'Both are reversible without a key. Base64 in a token or a config file hides nothing from anyone who looks — it is there so that binary survives a text channel.' },
    ],

    'sec-crc32': [
      { title: 'For accidents, not attackers', text: 'CRC-32 detects transmission errors and typos. It is trivially forgeable: given any target checksum, you can construct data that produces it in milliseconds. Never use it to verify that a file was not tampered with.' },
      { title: 'Variants', rows: [
        ['CRC-32 (IEEE)', 'zip, gzip, png, Ethernet'],
        ['CRC-32C', 'Castagnoli — iSCSI, btrfs, and a CPU instruction'],
        ['CRC-32K', 'Koopman'],
        ['Same input, different answers', 'Always state which variant'],
      ] },
      { title: 'What it catches', text: 'Any single burst error up to 32 bits, and all odd numbers of flipped bits. Collisions are guaranteed for long inputs — 32 bits cannot distinguish more than four billion possibilities — so a match is strong evidence, not proof.' },
    ],

    'sec-adler32': [
      { title: 'Faster, weaker', text: 'Two running sums modulo 65521, combined into 32 bits. Much cheaper than CRC-32 on old hardware, and noticeably worse at catching errors — especially in short messages, where the sums barely move.' },
      { title: 'Where it lives', text: 'zlib puts an Adler-32 at the end of every stream, which is why it survives at all. gzip, wrapping the same deflate data, chose CRC-32 instead.' },
      { title: 'Rolling', text: 'Both halves update in constant time as a window slides, which is what makes it useful to rsync-style chunking — the reason to pick it is that property, not its error detection.' },
    ],

    'sec-luhn': [
      { title: 'What it proves', text: 'Only that the digits are internally consistent. It catches every single-digit typo and almost every transposition of adjacent digits — which is what it was designed for in 1954. It says nothing about whether the card exists or has money on it.' },
      { title: 'The algorithm', text: 'From the right, double every second digit; if a doubled value exceeds 9, subtract 9. Sum everything. The number is valid when the total is divisible by 10 — the last digit is chosen to make that true.' },
      { title: 'Also Luhn-checked', rows: [
        ['IMEI', 'Phone hardware ids'],
        ['Canadian SIN', ''],
        ['South African ID', ''],
        ['Some loyalty cards', ''],
      ] },
      { title: 'Do not store the number', text: 'If you are validating a real card, you are in PCI DSS scope. Tokenise through the payment provider; the safest card number is the one that never reaches your server.' },
    ],

    'sec-iban': [
      { title: 'Structure', text: 'Two-letter country, two check digits, then a country-specific account part of fixed length — 22 characters in Germany, 27 in France, 34 at the maximum. Length alone rules out most mistyped IBANs.' },
      { title: 'The check', text: 'Move the first four characters to the end, replace each letter with its position plus 9 (A=10 … Z=35), and read the result as one enormous integer. It is a valid IBAN when that number mod 97 equals 1 — an ISO 7064 check that catches essentially every realistic typo.' },
      { title: 'What it does not tell you', text: 'That the account exists, or whose it is. Confirmation-of-Payee schemes exist precisely because a valid IBAN belonging to the wrong person is the core of invoice-redirection fraud.' },
    ],

    'sec-isbn': [
      { title: 'Two lengths', text: 'ISBN-10 ran until 2007 and uses a mod-11 check whose digit can be X (for 10). ISBN-13 is an EAN-13 barcode with a 978 or 979 prefix and a mod-10 check. Every ISBN-10 has a 978-prefixed ISBN-13 twin.' },
      { title: 'Parts', rows: [
        ['Prefix', '978 or 979 (ISBN-13 only)'],
        ['Registration group', 'Language or country area'],
        ['Registrant', 'The publisher'],
        ['Publication', 'The specific title and edition'],
        ['Check digit', 'The last one'],
      ] },
      { title: 'One per edition', text: 'Hardback, paperback and ebook each get their own ISBN, and so does a revised edition. An ISBN identifies a product, not a work — which is why library catalogues use other identifiers as well.' },
    ],

    'sec-ean': [
      { title: 'The family', rows: [
        ['EAN-13', 'The global retail standard'],
        ['UPC-A', '12 digits — an EAN-13 with a leading 0'],
        ['EAN-8', 'Short, for small packages'],
        ['ISBN-13', 'Books, under 978/979'],
        ['GTIN-14', 'Cases and cartons'],
      ] },
      { title: 'Check digit', text: 'Multiply the digits alternately by 1 and 3 from the right, sum, and the check digit is whatever brings the total to a multiple of ten. It catches every single-digit error, but not a transposition of two adjacent digits differing by 5.' },
      { title: 'Prefixes are not origin', text: 'The leading digits identify the GS1 member organisation that issued the number, not where the product was made. 20–29 is reserved for in-store use — which is why supermarket scales print barcodes nobody else can read.' },
    ],

    // ------------------------------------------------------------- design

    'design-color-formats': [
      { title: 'The formats', rows: [
        ['#RRGGBB', 'Hex — 8 digits adds alpha'],
        ['rgb(r g b / a)', 'The modern space-separated syntax'],
        ['hsl(h s% l%)', 'Hue in degrees; easy to shift by hand'],
        ['oklch(l c h)', 'Perceptually uniform — equal steps look equal'],
        ['color(display-p3 …)', 'Wide gamut, beyond what sRGB can show'],
      ] },
      { title: 'Why OKLCH is different', text: 'In HSL, hsl(60 100% 50%) and hsl(240 100% 50%) claim the same lightness — yellow and blue, one blinding and one nearly black. OKLCH is built on measured perception, so a fixed lightness looks equally light at every hue. That is what makes generated palettes stop looking lumpy.' },
      { title: 'Sixteen million, not really', text: '8 bits per channel is plenty for photographs and visibly banded for a gentle gradient across a large area. Dithering, or a wider gamut, is the fix — adding more stops is not.' },
    ],

    'design-shades': [
      { title: 'Tint, shade, tone', text: 'A tint mixes in white, a shade mixes in black, a tone mixes in grey. Mixing in the complement instead of grey desaturates without the muddiness, which is the trick behind palettes that look designed rather than generated.' },
      { title: 'Scales that work', text: 'A useful UI ramp is not linear in lightness. Steps near the ends should be smaller than steps in the middle, because the eye discriminates light tones far more finely than dark ones — 50, 100, 200 … 900 exists for that reason.' },
      { title: 'Check the contrast', text: 'A ramp is only usable if you know which pairs meet contrast. As a rule of thumb, two stops five steps apart clear 4.5:1 in a well-built scale — but measure rather than assume, especially for yellows and cyans.' },
    ],

    'design-palette': [
      { title: 'The harmonies', rows: [
        ['Complementary', 'Opposite hues — maximum tension'],
        ['Analogous', 'Neighbours — calm, low contrast'],
        ['Triadic', 'Three at 120° — vivid and balanced'],
        ['Split-complementary', 'Complementary contrast, less shouting'],
        ['Tetradic', 'Two complementary pairs; hard to balance'],
      ] },
      { title: 'The 60-30-10 rule', text: 'Sixty per cent dominant, thirty secondary, ten accent. Most palettes fail not because the hues are wrong but because they are used in equal amounts, which leaves nothing to look at first.' },
      { title: 'Do not encode meaning in hue alone', text: 'Around one man in twelve cannot reliably distinguish red from green. Anything that means something — error, success, a line on a chart — needs a second channel: a label, a shape, or a difference in lightness.' },
    ],

    'design-gradient': [
      { title: 'The banding problem', text: 'A gradient between two saturated hues passes through grey in sRGB, because interpolation happens in a space that is not perceptual. `in oklab` or `in oklch` on the gradient keeps the midpoint colourful — a one-word fix for the classic muddy fade.' },
      { title: 'Syntax worth knowing', rows: [
        ['linear-gradient(90deg, …)', '0deg points up, angles go clockwise'],
        ['radial-gradient(circle at 30% 40%, …)', 'Position the centre'],
        ['conic-gradient()', 'Pie charts and colour wheels without an image'],
        ['repeating-linear-gradient()', 'Stripes'],
        ['Double stop: red 40% 60%', 'A hard edge, no fade'],
      ] },
      { title: 'Fading to transparent', text: 'to transparent fades through transparent black and greys out. Fade to the same colour with zero alpha — rgb(255 0 0 / 0) — and the ramp stays clean.' },
    ],

    'design-box-shadow': [
      { title: 'The five values', rows: [
        ['offset-x, offset-y', 'Where the light is coming from'],
        ['blur', 'Softness — roughly twice the visual edge'],
        ['spread', 'Grows or shrinks the shadow before blurring'],
        ['color', 'Almost never pure black'],
        ['inset', 'Casts inward, for a pressed or recessed look'],
      ] },
      { title: 'Layer them', text: 'Real shadows are not one blur. Two or three comma-separated shadows — a tight dark one for contact, a wide faint one for depth — read as physical in a way a single 20px blur never does.' },
      { title: 'Colour the shadow', text: 'Black at low opacity greys everything it falls on. A shadow tinted toward the background hue, or toward the element\'s own colour, looks like light rather than dirt. On dark themes, shadows barely work at all — use a lighter border instead.' },
      { title: 'Cost', text: 'Large blur radii are expensive to paint and re-paint on every animation frame. Animate transform and opacity; if a shadow must change, cross-fade two stacked layers rather than animating the blur.' },
    ],

    'design-border-radius': [
      { title: 'Nested corners', text: 'A rounded box inside a rounded box looks wrong when both use the same radius. The inner radius should be the outer minus the padding — otherwise the curves are not concentric and the gap visibly pinches at the corner.' },
      { title: 'The elliptical form', text: 'border-radius takes a slash: `50% / 20%` gives horizontal and vertical radii independently. Eight values in total, and that is how a leaf or a squircle-ish blob is drawn in plain CSS.' },
      { title: 'The pill', text: '9999px clamps to exactly half the shorter side, which keeps a pill a pill at any size. 50% on a square gives a circle; on a rectangle it gives an ellipse.' },
    ],

    'design-css-units': [
      { title: 'Relative to what', rows: [
        ['em', 'The element\'s own font-size — compounds when nested'],
        ['rem', 'The root font-size; the safe default for type'],
        ['%', 'The parent\'s matching dimension'],
        ['vw / vh', 'The viewport'],
        ['ch', 'The width of a "0" — measure line length in it'],
        ['ex, cap', 'x-height and cap-height'],
      ] },
      { title: 'Never fix the root size in px', text: 'Setting html { font-size: 14px } overrides the size a reader chose in their browser settings. Scale from the default with rem, or a percentage, and the page respects them.' },
      { title: 'The mobile viewport units', text: 'vh is the large viewport, so 100vh sits under a phone\'s collapsing toolbar. svh is the small one, lvh the large, dvh the one that changes as the bar hides — dvh is usually what "full screen" should mean.' },
      { title: 'Absolute units are nominal', text: '1in is defined as 96px regardless of the actual screen. Physical units only mean anything in print stylesheets; on screen, pt and in are just fixed multiples of px.' },
    ],

    'design-aspect-ratio': [
      { title: 'Common ratios', rows: [
        ['16:9', 'Video, and most screens'],
        ['4:3', 'Older cameras, iPads, projectors'],
        ['3:2', 'Most DSLR photographs, and 35mm film'],
        ['1:1', 'Avatars and grids'],
        ['21:9', 'Ultrawide, and the cinema look'],
        ['1.91:1', 'Open Graph preview cards'],
      ] },
      { title: 'Reserve the space', text: 'An image with width, height or aspect-ratio set lets the browser reserve the box before the file arrives, so nothing jumps when it loads. That is most of Cumulative Layout Shift, fixed with one attribute.' },
      { title: 'Fit or fill', text: 'object-fit: cover fills the box and crops; contain fits and letterboxes. Pair cover with object-position to choose what survives the crop — the default centre cuts heads off portraits.' },
    ],

    'design-type-scale': [
      { title: 'Why a ratio', text: 'Sizes picked one at a time drift into near-duplicates that fight each other. A fixed ratio compounding from a base gives every step an obvious relationship, so headings differ enough to read as a hierarchy.' },
      { title: 'Ratios', rows: [
        ['1.125 Major second', 'Dense UI, lots of levels'],
        ['1.200 Minor third', 'A good general default'],
        ['1.250 Major third', 'Clear hierarchy'],
        ['1.333 Perfect fourth', 'Editorial'],
        ['1.618 Golden ratio', 'Dramatic; few steps fit on a screen'],
      ] },
      { title: 'Line height moves opposite', text: 'Small text needs proportionally more leading than large. Roughly 1.5 for body, 1.2 or less for display — a heading at 1.5 looks like it fell apart, and body at 1.2 is a wall.' },
    ],

    'design-clamp': [
      { title: 'What clamp does', text: 'clamp(min, preferred, max) is max(min, min(preferred, max)) written once. With a vw-based middle term it gives type that scales with the viewport and stops at both ends — no media queries, no jumps at a breakpoint.' },
      { title: 'Keep a rem in the middle', text: 'A purely vw-based preferred size cannot be zoomed: the text stays the same physical size no matter what the reader does. Mixing in rem — `clamp(1rem, 0.5rem + 2vw, 2rem)` — keeps zoom working, and it is a genuine accessibility requirement.' },
      { title: 'Also for layout', text: 'width: clamp(20ch, 60%, 75ch) gives a column that never gets unreadably wide or uselessly narrow. Measure is a clamp problem more often than a breakpoint problem.' },
    ],

    'design-print-size': [
      { title: 'Pixels have no size', text: 'An image is a grid of samples; DPI only decides how big each sample is printed. The same 3000×2000 file is a 10×6.7in print at 300dpi or a 30×20in one at 100dpi — nothing about the file changes.' },
      { title: 'What resolution you need', rows: [
        ['300 dpi', 'Books, magazines, anything held close'],
        ['150 dpi', 'Posters read from a metre away'],
        ['72–100 dpi', 'Large-format, viewed across a room'],
        ['Billboards', '10–20 dpi is normal'],
      ] },
      { title: 'Bleed', text: 'A commercial printer wants 3mm past every trimmed edge, because trimming is not perfect. Design to the trim, extend the background into the bleed, and keep anything important 5mm inside.' },
    ],

    'design-golden-ratio': [
      { title: 'The number', text: 'φ = (1+√5)/2 ≈ 1.6180339887. Its defining property is that 1:φ equals φ:(1+φ) — the only ratio where removing a square from a rectangle leaves one of the same shape. Successive Fibonacci ratios converge on it.' },
      { title: 'The honest version', text: 'The claim that it governs the Parthenon, the Mona Lisa and human beauty is mostly retrofitted; the measurements only work if you pick the lines afterwards. It is a pleasant ratio, well suited to type scales and layout, and not a law of nature.' },
      { title: 'Where it genuinely appears', text: 'In phyllotaxis — the golden angle, 137.5°, is the packing that leaves the fewest gaps as a plant adds leaves or seeds, which is why sunflower spirals count in Fibonacci numbers. That part is real.' },
    ],

    // ------------------------------------------------------------ convert

    'unit-length': [
      { title: 'Everything is defined from the metre', text: 'Since 1959 the international inch is exactly 25.4mm — by agreement, not measurement. The metre itself is defined by the speed of light, which is fixed at exactly 299 792 458 m/s, so the definition cannot drift.' },
      { title: 'Worth remembering', rows: [
        ['1 in', '25.4 mm exactly'],
        ['1 ft', '0.3048 m exactly'],
        ['1 mi', '1.609344 km'],
        ['1 nautical mile', '1852 m — one minute of latitude'],
        ['1 light-year', '9.4607 × 10¹² km'],
        ['1 Å', '0.1 nm — atom-sized'],
      ] },
      { title: 'The survey foot', text: 'The US kept a second, very slightly longer foot for land surveying until 2023. The difference is two parts per million — invisible in a room, and several centimetres across a state.' },
    ],

    'unit-area': [
      { title: 'Area scales as the square', text: 'Doubling every length quadruples the area. It is why 1 m² is 10 000 cm² and not 100, and the single most common conversion mistake there is.' },
      { title: 'Land units', rows: [
        ['1 hectare', '10 000 m² — a 100m square'],
        ['1 acre', '4046.86 m², about 0.405 ha'],
        ['1 acre', 'A chain by a furlong — an ox-day of ploughing'],
        ['1 mi²', '640 acres, 2.59 km²'],
        ['1 football pitch', 'Roughly 0.7 ha, and not standardised'],
      ] },
    ],

    'unit-volume': [
      { title: 'The gallon problem', text: 'A US gallon is 3.785 L and an imperial gallon is 4.546 L — 20% larger. Pints, quarts and fluid ounces inherit the gap, so a US pint is 473 mL against the imperial 568 mL. Any recipe or fuel figure needs to say which.' },
      { title: 'And the ounces', rows: [
        ['1 US fl oz', '29.57 mL'],
        ['1 imperial fl oz', '28.41 mL'],
        ['1 US cup', '236.6 mL'],
        ['1 metric cup', '250 mL'],
        ['1 L', '1000 cm³, exactly — 1 dm³'],
      ] },
      { title: 'Fluid ounces are not ounces', text: 'One measures volume, the other mass. They coincide only for water, and only in the imperial system, which is where the "a pint\'s a pound" rhyme comes from — and it is wrong in the US, where a pint of water weighs about 1.04 lb.' },
    ],

    'unit-mass': [
      { title: 'Mass, not weight', text: 'A kilogram is mass and stays the same on the Moon; a pound-force is weight and does not. The pound-mass is defined as exactly 0.45359237 kg, which is why every imperial mass conversion is exact rather than measured.' },
      { title: 'Ounces', rows: [
        ['1 oz (avoirdupois)', '28.3495 g — food, post, everything ordinary'],
        ['1 troy oz', '31.1035 g — gold and silver only'],
        ['1 lb', '16 oz, 453.592 g'],
        ['1 stone', '14 lb, 6.35 kg'],
        ['1 short ton', '2000 lb, 907 kg'],
        ['1 tonne', '1000 kg, 2205 lb'],
      ] },
      { title: 'The kilogram is a constant now', text: 'Until 2019 it was a platinum-iridium cylinder in a vault near Paris, which had measurably drifted against its own copies. It is now defined from the Planck constant, and defined constants cannot lose weight.' },
    ],

    'unit-temperature': [
      { title: 'Two conversions, not one', text: 'A temperature converts with the offset: °F = °C × 9/5 + 32. A temperature *difference* does not — a rise of 10°C is a rise of 18°F, not 50. Mixing the two is the classic thermodynamics slip.' },
      { title: 'Fixed points', rows: [
        ['−273.15 °C', 'Absolute zero, 0 K'],
        ['−40°', 'Where the two scales cross'],
        ['0 °C / 32 °F', 'Water freezes'],
        ['37 °C / 98.6 °F', 'Body temperature — the decimal is false precision'],
        ['100 °C / 212 °F', 'Water boils, at sea level'],
      ] },
      { title: 'Degrees kelvin is wrong', text: 'It is simply "kelvin", with no degree sign: 300 K. The kelvin has the same size as a degree Celsius, which makes differences interchangeable between them.' },
    ],

    'unit-speed': [
      { title: 'Handy conversions', rows: [
        ['1 m/s', '3.6 km/h — the only one worth memorising'],
        ['1 mph', '1.609 km/h'],
        ['1 knot', '1 nautical mile/h = 1.852 km/h'],
        ['Mach 1', '≈1235 km/h at sea level, and it varies'],
        ['c', '299 792 458 m/s exactly'],
      ] },
      { title: 'Why knots', text: 'One knot is one minute of latitude per hour, so a navigator reading a chart converts distance and time without arithmetic. That is also why nautical miles survive in aviation.' },
      { title: 'Mach is not a speed', text: 'It is a ratio to the local speed of sound, which falls with temperature. Mach 1 is about 1235 km/h at sea level and roughly 1060 km/h at cruising altitude — the same Mach number, 175 km/h apart.' },
    ],

    'unit-time': [
      { title: 'The awkward ones', rows: [
        ['1 day', '86 400 s — except when a leap second is inserted'],
        ['1 year', '365.2422 days (tropical)'],
        ['1 Julian year', '365.25 days exactly — what astronomers use'],
        ['1 month', 'Has no fixed length; 30.44 days on average'],
        ['1 fortnight', '14 days'],
      ] },
      { title: 'Never store a duration in months', text: 'A month is 28 to 31 days, so "one month" added to 31 January has no correct answer. Store seconds or days for durations, and use calendar arithmetic only where the user means calendar months.' },
      { title: 'Leap seconds are ending', text: 'They have been inserted 27 times since 1972 to keep clocks matched to the Earth\'s slightly irregular rotation. The practice is agreed to stop by 2035 — because a minute that lasts 61 seconds breaks more software than it fixes.' },
    ],

    'unit-data': [
      { title: 'The 1000 vs 1024 split', text: 'SI prefixes are powers of 1000; binary prefixes are powers of 1024 and have their own names — kibibyte, mebibyte, gibibyte. A "1 TB" drive holds 10¹² bytes, and Windows reports it as 931 GiB while calling it GB. Nothing is missing.' },
      { title: 'The gap grows', rows: [
        ['kB vs KiB', '2.4% apart'],
        ['MB vs MiB', '4.9%'],
        ['GB vs GiB', '7.4%'],
        ['TB vs TiB', '10.0%'],
      ] },
      { title: 'Bits or bytes', text: 'Network speeds are bits per second, file sizes are bytes. A 100 Mb/s connection moves at most 12.5 MB/s — divide by eight, then a little more for protocol overhead. Lower-case b is bits, capital B is bytes, and the distinction is never optional.' },
    ],

    'unit-pressure': [
      { title: 'Reference points', rows: [
        ['1 atm', '101 325 Pa exactly, 14.696 psi, 1013.25 mbar'],
        ['1 bar', '100 000 Pa — close to an atmosphere, not equal'],
        ['1 psi', '6894.76 Pa'],
        ['Car tyre', '≈2.2 bar / 32 psi, gauge'],
        ['1 mmHg', '133.322 Pa — blood pressure'],
      ] },
      { title: 'Gauge or absolute', text: 'A tyre gauge reads zero in open air: it measures pressure above atmospheric. Absolute pressure includes the atmosphere, so 32 psig is about 46.7 psia. Vacuum work and gas-law arithmetic need absolute; get it wrong and the ideal gas law gives nonsense.' },
    ],

    'unit-energy': [
      { title: 'One quantity, many names', rows: [
        ['1 J', 'One newton-metre, one watt-second'],
        ['1 cal', '4.184 J'],
        ['1 food Calorie', '1 kcal = 4184 J — the capital C matters'],
        ['1 kWh', '3.6 MJ'],
        ['1 BTU', '1055 J'],
        ['1 eV', '1.602 × 10⁻¹⁹ J'],
      ] },
      { title: 'A sense of scale', text: 'A running laptop draws roughly 50 W, so an hour is 180 kJ. A single doughnut is about 1 MJ — enough to run that laptop most of a working day. Human food energy is remarkably dense compared with electronics.' },
    ],

    'unit-power': [
      { title: 'Power is energy per second', text: 'One watt is one joule per second. Multiply by time for energy — which is why the unit on a bill is the kilowatt-hour, a power times a duration, and not a kilowatt.' },
      { title: 'Horsepower, plural', rows: [
        ['1 mechanical hp', '745.7 W — the US and UK figure'],
        ['1 metric hp (PS)', '735.5 W — European car specs'],
        ['1 boiler hp', '9810 W — unrelated, historical'],
        ['1 ton of refrigeration', '3517 W'],
      ] },
      { title: 'Watt\'s marketing', text: 'James Watt chose the horsepower so that his engines could be sold by comparison to the horses they replaced — deliberately generous, so nobody felt short-changed. It has outlived the steam engine by two centuries.' },
    ],

    'unit-force': [
      { title: 'Newtons', text: 'One newton accelerates one kilogram at one metre per second squared. Your weight in newtons is your mass times 9.80665 — about 686 N for a 70 kg person, which is why kilogram-force exists as a convenience unit.' },
      { title: 'Conversions', rows: [
        ['1 kgf', '9.80665 N'],
        ['1 lbf', '4.44822 N'],
        ['1 dyne', '10⁻⁵ N'],
        ['1 kip', '1000 lbf'],
      ] },
      { title: 'Gravity is not constant', text: 'g ranges from about 9.78 m/s² at the equator to 9.83 at the poles — the Earth bulges, and it spins. Standard gravity, 9.80665, is a defined value chosen near the middle, not a measurement of anywhere in particular.' },
    ],

    'unit-angle': [
      { title: 'Three systems', rows: [
        ['Degrees', '360 in a circle — Babylonian, and divisible by a lot'],
        ['Radians', '2π in a circle; the only unit calculus works in'],
        ['Gradians', '400 in a circle; surveying, and little else'],
        ['Turns', '1 per circle — CSS accepts it'],
      ] },
      { title: 'Why radians', text: 'An angle in radians is the arc length divided by the radius, so arc = rθ with no constant. Every trigonometric identity and derivative is clean in radians and carries a π/180 in degrees — which is why every programming language\'s sin() takes radians.' },
      { title: 'Minutes and seconds', text: 'One degree is 60 arcminutes, one arcminute is 60 arcseconds. An arcminute of latitude is a nautical mile; an arcsecond is roughly 31 metres, which is the resolution latitude/longitude to two decimal places gives you.' },
    ],

    'unit-fuel-economy': [
      { title: 'Two opposite scales', text: 'mpg and km/L measure distance per fuel — bigger is better. L/100km measures fuel per distance — smaller is better. They are reciprocals, so you cannot average mpg figures meaningfully, and L/100km is the one that adds up linearly.' },
      { title: 'The MPG illusion', text: 'Going from 10 to 15 mpg saves more fuel over the same distance than going from 30 to 50. Per-distance consumption makes that obvious; per-fuel distance hides it. It is a genuine, measured policy problem, not a curiosity.' },
      { title: 'Which gallon', rows: [
        ['1 US mpg', '0.425 km/L'],
        ['1 imperial mpg', '0.354 km/L'],
        ['UK figures', 'Are about 20% higher than US ones for the same car'],
        ['L/100km → mpg(US)', '235.2 ÷ the value'],
      ] },
    ],

    'unit-cooking': [
      { title: 'Volume is not mass', text: 'A cup of flour is 120–150 g depending on whether it was scooped or spooned; a cup of sugar is 200 g. That variance is why baking by volume is unreliable and why every serious recipe gives grams.' },
      { title: 'Spoons vary too', rows: [
        ['1 US tsp', '4.93 mL'],
        ['1 metric tsp', '5 mL'],
        ['1 US tbsp', '14.79 mL — 3 tsp'],
        ['1 Australian tbsp', '20 mL — 4 tsp'],
        ['1 UK tbsp', '15 mL'],
      ] },
      { title: 'Ounces again', text: 'A US recipe\'s "8 oz of flour" is 8 ounces by weight; "8 fl oz" is a cup by volume. They are not the same amount of flour, and the abbreviation is routinely dropped.' },
    ],

    'unit-shoe-size': [
      { title: 'No standard exists', text: 'UK, US, EU and Japanese sizes each use a different origin and step, and manufacturers deviate from all of them. A conversion table gets you to the right shelf; it cannot promise a fit.' },
      { title: 'How the scales work', rows: [
        ['UK', 'Barleycorns — ⅓ inch per size, from a child\'s zero'],
        ['US men', 'UK + 1, roughly'],
        ['US women', 'US men + 1.5, roughly'],
        ['EU (Paris point)', '⅔ cm per size — so EU steps are smaller'],
        ['JP / Mondopoint', 'Foot length in cm. The only honest one.'],
      ] },
      { title: 'Measure instead', text: 'Mondopoint — foot length in millimetres — is what ski boots and military boots use, because it describes the foot rather than the last. Measure standing, late in the day, and buy for the longer foot.' },
    ],

    'unit-number-base': [
      { title: 'Positional notation', text: 'Each place is the base times the one to its right. Base 16 is convenient for bytes because one hex digit is exactly four bits, so two digits are one byte with no arithmetic at all.' },
      { title: 'Bases you meet', rows: [
        ['2', 'Hardware'],
        ['8', 'Unix permissions'],
        ['16', 'Bytes, colours, hashes'],
        ['36', 'Compact ids — digits plus the alphabet'],
        ['60', 'Time and angles, inherited from Babylon'],
      ] },
      { title: 'Fractions do not survive', text: '0.1 is exact in base 10 and infinitely repeating in base 2, which is the whole reason 0.1 + 0.2 ≠ 0.3 in floating point. A fraction terminates only when its denominator shares all its prime factors with the base.' },
    ],

    'unit-density': [
      { title: 'Reference densities', rows: [
        ['Water', '1000 kg/m³ = 1 g/cm³, at 4 °C'],
        ['Ice', '917 — which is why it floats'],
        ['Air', '1.225 kg/m³ at sea level'],
        ['Aluminium', '2700'],
        ['Steel', '≈7850'],
        ['Gold', '19 300'],
      ] },
      { title: 'The metric system\'s neat trick', text: 'The gram was defined so that a cubic centimetre of water weighs one. That makes 1 L of water 1 kg and 1 m³ one tonne — conversions you can do in your head, by design.' },
      { title: 'Specific gravity', text: 'Density relative to water, so it is a bare number with no units. Above 1 sinks, below 1 floats — which is all a hydrometer in beer or a battery is measuring.' },
    ],

    'unit-frequency': [
      { title: 'Hertz is per second', text: 'One hertz is one cycle per second; it has the same dimensions as becquerels and as radians per second, and is kept distinct only to say what kind of thing is being counted. 1 rpm = 1/60 Hz.' },
      { title: 'Ranges', rows: [
        ['20 Hz – 20 kHz', 'Human hearing, when young'],
        ['50 / 60 Hz', 'Mains electricity'],
        ['440 Hz', 'Concert A'],
        ['2.4 / 5 GHz', 'Wi-Fi'],
        ['430–750 THz', 'Visible light'],
      ] },
      { title: 'Octaves are doublings', text: 'Pitch is logarithmic: every doubling of frequency is one octave, and a semitone is the twelfth root of two — about 5.95%. That is why frequency sliders in audio software are never linear.' },
    ],

    'unit-torque': [
      { title: 'Not energy, despite the units', text: 'A newton-metre of torque and a joule of energy have identical dimensions and mean entirely different things — torque is a force applied at a distance about an axis, a cross product rather than a dot product. Convention keeps them written differently for exactly this reason.' },
      { title: 'Conversions', rows: [
        ['1 N·m', '0.7376 lb·ft'],
        ['1 lb·ft', '1.3558 N·m'],
        ['1 lb·in', '0.113 N·m'],
        ['1 kgf·m', '9.807 N·m'],
      ] },
      { title: 'Why a torque wrench', text: 'Bolt tension is what holds a joint, and torque is only a proxy for it — friction under the head and in the threads absorbs most of the effort. Lubricating a thread specified dry can overtighten it by a third at the same reading.' },
    ],

    'unit-illuminance': [
      { title: 'Lux and lumens', text: 'Lumens measure light leaving a source; lux measures light arriving on a surface — one lumen per square metre. The same bulb gives high lux close up and low lux across a room, following the inverse square.' },
      { title: 'Typical levels', rows: [
        ['Full daylight', '10 000 – 25 000 lx'],
        ['Overcast day', '1000 lx'],
        ['Office', '300 – 500 lx'],
        ['Living room', '50 – 150 lx'],
        ['Full moon', '0.1 – 0.3 lx'],
      ] },
      { title: 'Weighted to the eye', text: 'Both units are weighted by human photopic sensitivity, which peaks in green at 555 nm. A watt of green light produces far more lumens than a watt of deep red — so lumens measure usefulness to a person, not energy.' },
    ],

    'unit-acceleration': [
      { title: 'The g', text: 'One g is 9.80665 m/s² by definition. It is a convenient unit because human tolerance is naturally expressed in it: sustained 5 g is about the limit even for trained pilots, and brief impacts of 50 g are survivable in a car seat.' },
      { title: 'For scale', rows: [
        ['A brisk car', '0.3 – 0.4 g'],
        ['Hard braking', '≈1 g'],
        ['Roller coaster', '3 – 5 g briefly'],
        ['Space launch', '3 g sustained'],
        ['A sneeze', '≈3 g, at your head'],
      ] },
      { title: '0–60 arithmetic', text: '60 mph is 26.8 m/s, so a 6-second 0–60 is an average of 4.5 m/s² — about 0.46 g. Peak acceleration is higher, because traction and gearing make it anything but constant.' },
    ],

    'unit-flow-rate': [
      { title: 'Volume per time', rows: [
        ['1 m³/s', '1000 L/s — an enormous flow'],
        ['1 L/min', '0.0167 L/s'],
        ['1 US gpm', '3.785 L/min'],
        ['1 imperial gpm', '4.546 L/min'],
        ['1 CFM', '1.699 m³/h — airflow'],
      ] },
      { title: 'For a sense of scale', text: 'A kitchen tap runs about 6 L/min, a shower 8–15, and a garden hose 15–20. A domestic water main delivers perhaps 30 L/min in total, which is why two showers at once are noticeably weaker.' },
      { title: 'Pipe diameter dominates', text: 'Flow through a pipe scales with roughly the fourth power of the radius (Poiseuille), so doubling the diameter carries about sixteen times the flow. Small increases in bore make very large differences.' },
    ],

    // --------------------------------------------------------------- date

    'date-days-between': [
      { title: 'Inclusive or not', text: 'From the 1st to the 5th is four days of elapsed time and five days of calendar dates. Neither is wrong — but billing, notice periods and holiday entitlements each pick a different one, so state which you mean.' },
      { title: 'What can go wrong', rows: [
        ['DST', 'Two days apart can be 47 or 49 hours'],
        ['Time zones', 'Subtract dates, not timestamps, for calendar questions'],
        ['Leap days', '29 February exists once every four years, mostly'],
        ['Before 1582', 'Julian calendar; 10 days simply do not exist in October 1582'],
      ] },
      { title: 'Count days, not milliseconds', text: 'Dividing a millisecond difference by 86 400 000 is off by an hour twice a year and rounds the wrong way. Compare calendar dates at midnight, or use a date library that knows about civil time.' },
    ],

    'date-add': [
      { title: 'Months are not uniform', text: '31 January plus one month has no correct answer. Most libraries clamp to 28 or 29 February, which means adding a month twice is not the same as adding two — the arithmetic is not associative, and cannot be made so.' },
      { title: 'Order matters', text: 'Adding a month then a day gives a different result from adding a day then a month, near the end of a month. Libraries apply larger units first by convention; if a rule matters legally, write it down rather than trusting a default.' },
      { title: 'Days are safer', text: 'Where a contract can be written in days, write it in days. "30 days" is unambiguous everywhere; "one month" means different things in different jurisdictions.' },
    ],

    'date-business-days': [
      { title: 'Business day is a local idea', text: 'Monday to Friday is not universal: the weekend is Friday–Saturday across much of the Middle East and Sunday-only in a few places. Anything international has to carry a calendar per region, not one flag.' },
      { title: 'Holidays are not a fixed list', rows: [
        ['Moving feasts', 'Easter shifts the dates around it by weeks'],
        ['Observed days', 'A holiday on a Saturday may move to the Friday'],
        ['Regional', 'Bank holidays differ within a single country'],
        ['Lunar calendars', 'Some dates are announced only weeks ahead'],
      ] },
      { title: 'Settlement conventions', text: 'Finance says T+1 or T+2 meaning business days on a specific exchange calendar — which is why a trade on the Thursday before a long weekend settles the following Wednesday.' },
    ],

    'date-age': [
      { title: 'How age is counted', text: 'In most of the world, age increases on the birthday: you are 29 until the day you turn 30. East Asian age reckoning traditionally counted from birth as one and advanced at new year, which can put a person two years apart from their international age.' },
      { title: '29 February', text: 'A leap-day birthday has no legal answer that everyone shares. Some jurisdictions treat 28 February as the birthday in common years, some 1 March. For anything with a legal threshold, check the local rule.' },
      { title: 'Ages are not durations', text: 'Age in years is a calendar count, not elapsed time divided by 365.25. Computing it by division puts a birthday on the wrong side of midnight for a noticeable fraction of people.' },
    ],

    'date-weekday': [
      { title: 'Zeller, or a table', text: 'The weekday of any Gregorian date can be computed in a few operations from the year, month and day, with a correction because the calendar\'s leap rule skips centuries that are not divisible by 400. Doomsday rule and Zeller\'s congruence are two spellings of the same fact.' },
      { title: 'Which day starts the week', rows: [
        ['ISO 8601', 'Monday is day 1'],
        ['US, Canada, Japan', 'Sunday'],
        ['Middle East', 'Saturday or Sunday'],
        ['JavaScript getDay()', '0 is Sunday'],
      ] },
      { title: 'The calendar repeats', text: 'The Gregorian calendar has a 400-year cycle containing 146 097 days — exactly 20 871 weeks. So 1 January 2026 falls on the same weekday as 1 January 1626, and dates are very slightly more likely to land on some weekdays than others.' },
    ],

    'date-week-number': [
      { title: 'ISO 8601 weeks', text: 'A week starts Monday, and week 1 is the one containing the first Thursday of January — equivalently, the week containing 4 January. So 1 January can fall in week 52 or 53 of the previous year, and that is correct, not a bug.' },
      { title: 'Other systems', rows: [
        ['US', 'Week 1 contains 1 January; weeks start Sunday'],
        ['Broadcast', 'Starts the Monday on or before 1 January'],
        ['Retail 4-5-4', 'A fiscal calendar, unrelated to ISO'],
      ] },
      { title: 'The separate year', text: 'An ISO week date carries its own year: 29 December 2025 is 2026-W01-1. Storing a week number without its ISO year loses the days at each end, and those are exactly the days people query about.' },
    ],

    'date-day-of-year': [
      { title: 'Ordinal dates', text: 'Day 1 to 365, or 366 in a leap year. ISO 8601 writes it 2026-256. It is the natural form for anything periodic — sunrise tables, growing degree days, seasonal series — because it removes the uneven months.' },
      { title: 'Useful anchors', rows: [
        ['Day 32', '1 February'],
        ['Day 60', '1 March in a common year, 29 Feb in a leap year'],
        ['Day 100', '10 April (9 April in a leap year)'],
        ['Day 200', '19 July (18 July in a leap year)'],
        ['Day 365', '31 December, unless it is a leap year'],
      ] },
    ],

    'date-countdown': [
      { title: 'Count against a real instant', text: 'A deadline is a moment in a specific time zone. "Midnight on the 1st" is nine different instants around the world, and a countdown that ignores that is wrong for most of its audience.' },
      { title: 'The DST jump', text: 'A countdown computed in local days changes by an hour on the clock-change weekend. Compute the difference in UTC and format it locally, and both the number and the displayed time stay right.' },
      { title: 'Drift', text: 'setInterval(1000) drifts and stops entirely when a tab is backgrounded. Recompute from the target timestamp on every tick rather than decrementing a counter, and a tab that slept for an hour still shows the right number.' },
    ],

    'date-utc-offset': [
      { title: 'An offset is not a time zone', text: 'A zone is a set of rules — "Europe/London" — that produces different offsets at different dates. Storing +01:00 loses the rule, so any future date you compute from it is wrong half the year.' },
      { title: 'Offsets are not all whole hours', rows: [
        ['UTC+05:30', 'India — a whole country, one zone'],
        ['UTC+05:45', 'Nepal'],
        ['UTC+08:45', 'Eucla, Western Australia'],
        ['UTC+12:45', 'Chatham Islands'],
        ['UTC+14:00', 'Kiribati — the furthest ahead'],
      ] },
      { title: 'Store UTC, display local', text: 'Keep instants in UTC and the zone id alongside anything a person scheduled. That is the only combination that survives a government changing its DST rules — which happens somewhere most years.' },
    ],

    'date-duration-sum': [
      { title: 'Beyond 24 hours', text: 'A total of 27:30 is a duration, not a clock time. Spreadsheets need the [h]:mm format to show it; without the brackets 27:30 wraps to 03:30 and the day is silently lost.' },
      { title: 'Minutes or decimals', rows: [
        ['7:30', 'Seven hours thirty minutes'],
        ['7.5', 'The same, in decimal hours'],
        ['7.30', 'Neither. A common and expensive typo.'],
        ['Rounding', 'Payroll often rounds to 6-minute units — 0.1 h'],
      ] },
    ],

    'date-time-diff': [
      { title: 'Crossing midnight', text: 'A shift from 22:00 to 06:00 is eight hours, not minus sixteen. Add a day when the end is earlier than the start — and note that this assumption breaks for anything longer than 24 hours, which then needs real dates.' },
      { title: 'The DST shifts', text: 'On the spring change a 00:30–03:30 shift is two hours, and on the autumn change it is four. Staff worked those hours; a subtraction of clock times says otherwise, which is why rota software works in UTC.' },
    ],

    'date-timesheet': [
      { title: 'Decimal hours', text: 'Payroll works in decimal hours: 7 h 45 m is 7.75, not 7.45. Multiply the minutes by 100 and divide by 60 — the single most common timesheet error, and it always favours the same party.' },
      { title: 'Rounding rules', rows: [
        ['Nearest 15 min', 'Common; must round both ways to be lawful in many places'],
        ['0.1 h (6 min)', 'Professional services billing'],
        ['Down only', 'Illegal wage theft in most jurisdictions'],
        ['Breaks', 'Unpaid breaks come out before the total'],
      ] },
    ],

    'date-leap-year': [
      { title: 'The rule', text: 'Divisible by 4, except centuries, except centuries divisible by 400. 2000 was a leap year, 1900 was not, 2100 will not be. The exception to the exception is the part people forget, and it is why some 1900-era software still miscounts.' },
      { title: 'Why the correction', text: 'A tropical year is 365.2422 days. Adding a day every four years overshoots by about 11 minutes a year; the century rule removes three days every 400 years and brings the error down to one day in roughly 3200 years.' },
      { title: 'The 29 February bugs', text: 'Code that adds one year by incrementing the year field crashes, or silently produces 1 March, on a single day every four years. It is a perennial outage cause — Microsoft Azure lost a day to it in 2012.' },
    ],

    'date-month-calendar': [
      { title: 'The knuckle trick', text: 'Count the months across your knuckles: a knuckle is 31 days, a gap is 30 (February excepted). It works because the lengths were set by Roman politics and not by anything regular.' },
      { title: 'Why February is short', text: 'The Roman year began in March — which is why September, October, November and December are named seventh through tenth. February, the last month, absorbed the days left over, and later lost more to July and August.' },
    ],

    'date-easter': [
      { title: 'The rule', text: 'The first Sunday after the first ecclesiastical full moon on or after 21 March. The moon in question comes from a table, not from observation, so the date is computable — anywhere from 22 March to 25 April.' },
      { title: 'Two Easters', text: 'Western churches use the Gregorian calendar, most Orthodox ones the Julian, so the dates usually differ — sometimes by more than a month. They coincide only occasionally.' },
      { title: 'What moves with it', rows: [
        ['Ash Wednesday', '46 days before'],
        ['Palm Sunday', 'The Sunday before'],
        ['Good Friday', 'Two days before'],
        ['Ascension', '39 days after'],
        ['Pentecost', '49 days after'],
      ] },
    ],

    'date-julian-day': [
      { title: 'One continuous count', text: 'Julian Day numbers count days from 1 January 4713 BC, with no months, years or calendar reforms in the way. Subtracting two of them gives an elapsed interval that is correct across the Gregorian changeover — which is why astronomy uses nothing else.' },
      { title: 'Variants', rows: [
        ['JD', 'Starts at noon UT — so an observing night has one date'],
        ['MJD', 'JD − 2 400 000.5; starts at midnight'],
        ['Unix time', 'Seconds since 1970-01-01, the same idea'],
        ['Rata Die', 'Days since 0001-01-01, used in date libraries'],
      ] },
      { title: 'Not the Julian calendar', text: 'The name honours Julius Scaliger, the proposer\'s father, and has nothing to do with Julius Caesar\'s calendar. They are unrelated concepts with confusingly similar names.' },
    ],

    // --------------------------------------------------------------- math

    'math-percent': [
      { title: 'The three questions', rows: [
        ['What is 15% of 80?', '80 × 0.15 = 12'],
        ['12 is what % of 80?', '12 ÷ 80 = 15%'],
        ['12 is 15% of what?', '12 ÷ 0.15 = 80'],
        ['From 80 to 92?', '(92−80)/80 = +15%'],
      ] },
      { title: 'Increases do not cancel', text: 'Up 20% then down 20% leaves you at 96%, not 100 — the second percentage is taken from a bigger number. To undo a rise of p, divide by (1+p); a 50% discount needs a 100% rise to get back.' },
      { title: 'Points are not per cent', text: 'A rate moving from 4% to 5% is up one percentage point and up 25%. Headlines pick whichever is more dramatic; in writing, always say which.' },
      { title: 'The commutative trick', text: 'x% of y equals y% of x. 4% of 75 is awkward; 75% of 4 is three. Worth remembering for mental arithmetic.' },
    ],

    'math-ratio': [
      { title: 'Ratio, proportion, fraction', text: 'A ratio 2:3 compares two parts; the fraction 2/5 compares a part to the whole. Reading "two to three" as two-thirds is the standard mistake, and it is off by a fifth.' },
      { title: 'Simplifying', text: 'Divide both sides by their greatest common divisor. Ratios with units must share them first — 500g : 1kg is 1:2, not 500:1.' },
      { title: 'Where ratios beat percentages', text: 'Odds, gearing, mixing and aspect ratios all have no natural whole. 16:9 says something a percentage cannot, and a 1:10 dilution is clearer than "9.09%".' },
    ],

    'math-fraction-decimal': [
      { title: 'When a fraction terminates', text: 'In base 10, only when the denominator\'s prime factors are just 2s and 5s. 1/8 terminates, 1/3 and 1/7 do not — and 1/7 repeats with a six-digit cycle, 142857, that is the same digits rotated for every numerator.' },
      { title: 'Recurring back to a fraction', text: 'For 0.̅363636…, the repeating block has length 2, so multiply by 10² − 1 = 99: the fraction is 36/99 = 4/11. Any repeating decimal is rational, and this is the proof that 0.999… = 1.' },
      { title: 'Common equivalents', rows: [
        ['1/3', '0.333…'],
        ['1/7', '0.142857 repeating'],
        ['1/8', '0.125'],
        ['1/16', '0.0625'],
        ['5/8', '0.625'],
      ] },
    ],

    'math-fraction-calc': [
      { title: 'The operations', rows: [
        ['a/b + c/d', '(ad + cb) / bd, then simplify'],
        ['a/b × c/d', 'ac / bd'],
        ['a/b ÷ c/d', 'a/b × d/c — multiply by the reciprocal'],
        ['Comparing', 'Cross-multiply: a/b > c/d when ad > cb (positive b, d)'],
      ] },
      { title: 'Why exact beats decimal', text: 'A third has no decimal representation, so a/3 computed in floating point is already wrong before you do anything with it. Fractions stay exact through any number of operations — which is why symbolic algebra systems keep them.' },
      { title: 'Improper is not wrong', text: '7/4 and 1¾ are the same number. Improper fractions are easier to calculate with; mixed numbers are easier to picture. Convert at the end, not in the middle.' },
    ],

    'math-gcd-lcm': [
      { title: 'Euclid\'s algorithm', text: 'gcd(a,b) = gcd(b, a mod b), repeated until the remainder is zero. It is 2300 years old, takes a handful of steps even for enormous numbers, and is still what every library uses.' },
      { title: 'The identity', text: 'gcd(a,b) × lcm(a,b) = a × b. So the LCM is found from the GCD with one multiplication and one division — and computing the LCM by multiplying and then reducing overflows far sooner.' },
      { title: 'Where they turn up', rows: [
        ['Adding fractions', 'LCM of the denominators'],
        ['Simplifying', 'GCD of numerator and denominator'],
        ['Gears and cycles', 'LCM — when two rotations realign'],
        ['Cryptography', 'Coprimality: gcd = 1'],
      ] },
    ],

    'math-prime-factors': [
      { title: 'The fundamental theorem', text: 'Every integer above 1 factors into primes in exactly one way, order aside. That uniqueness is what makes factorisation a fingerprint — and why 1 is deliberately not prime, since it would break it.' },
      { title: 'Trial division is enough here', text: 'Testing divisors up to √n suffices: if n = ab with both above the root, their product exceeds n. That makes checking a ten-digit number instant and a hundred-digit one impossible.' },
      { title: 'Why the difficulty matters', text: 'RSA rests on multiplication being easy and factoring being hard. A 2048-bit modulus is the product of two ~300-digit primes; no classical method factors it in the lifetime of the universe, and Shor\'s algorithm on a large enough quantum computer would.' },
    ],

    'math-factorial': [
      { title: 'How fast it grows', rows: [
        ['10!', '3.6 million'],
        ['13!', 'Overflows a 32-bit integer'],
        ['21!', 'Overflows a 64-bit integer'],
        ['170!', 'The largest that fits a double'],
        ['52!', 'Orderings of a shuffled deck — about 8 × 10⁶⁷'],
      ] },
      { title: 'Why 0! = 1', text: 'There is exactly one way to arrange nothing — the empty arrangement. It is also forced by n! = n × (n−1)!, and by every formula for combinations, which would otherwise divide by zero.' },
      { title: 'Beyond integers', text: 'The gamma function extends factorials to all complex numbers except the non-positive integers, with Γ(n) = (n−1)!. It is how (1/2)! turns out to be √π/2.' },
    ],

    'math-combinations': [
      { title: 'Order or not', rows: [
        ['Permutations P(n,k)', 'n!/(n−k)! — order matters'],
        ['Combinations C(n,k)', 'n!/(k!(n−k)!) — order does not'],
        ['With repetition', 'nᵏ arrangements'],
        ['Multiset combinations', 'C(n+k−1, k)'],
      ] },
      { title: 'Symmetry', text: 'C(n,k) = C(n,n−k): choosing which five to take is the same as choosing which to leave. It halves the work, and it is why Pascal\'s triangle is symmetric.' },
      { title: 'Lottery arithmetic', text: 'Six from 49 is C(49,6) ≈ 13.98 million. A ticket a week gives one expected win every 269 000 years — and because the draws are independent, previous results change nothing at all.' },
    ],

    'math-quadratic': [
      { title: 'The discriminant', rows: [
        ['b² − 4ac > 0', 'Two distinct real roots'],
        ['= 0', 'One repeated root'],
        ['< 0', 'Two complex conjugate roots'],
      ] },
      { title: 'Catastrophic cancellation', text: 'When b² is much larger than 4ac, −b + √(b²−4ac) subtracts two nearly equal numbers and loses most of the precision. Compute the root with the same sign as −b first, then get the other from x₁x₂ = c/a. Numerical libraries all do this; the schoolbook formula does not.' },
      { title: 'Completing the square', text: 'Every quadratic is a(x + b/2a)² + (c − b²/4a). That form gives the vertex directly — the turning point is at x = −b/2a — which is often what a problem actually wants.' },
    ],

    'math-linear-system': [
      { title: 'Three outcomes', rows: [
        ['One solution', 'The lines cross — determinant ≠ 0'],
        ['No solution', 'Parallel lines, different intercepts'],
        ['Infinitely many', 'The same line twice'],
      ] },
      { title: 'Cramer\'s rule', text: 'For two equations, x = (ce − bf)/(ae − bd) with the analogous expression for y. Elegant at this size and hopeless beyond about 4×4, where the factorial cost of determinants makes elimination the only sensible method.' },
      { title: 'Near-singular systems', text: 'When the lines cross at a very shallow angle, a tiny change in the coefficients moves the solution enormously. The system is ill-conditioned, and the answer is arithmetically correct while being practically meaningless.' },
    ],

    'math-statistics': [
      { title: 'Centre', rows: [
        ['Mean', 'The balance point; every value contributes'],
        ['Median', 'The middle; unaffected by extremes'],
        ['Mode', 'The most frequent; works on categories too'],
      ] },
      { title: 'Spread', text: 'The standard deviation is the typical distance from the mean, in the original units. Variance is its square, which has the wrong units for reporting but the right algebra for combining — variances of independent things add, standard deviations do not.' },
      { title: 'When the mean misleads', text: 'Income, house prices and response times are right-skewed: a few enormous values drag the mean above what most people experience. Quote the median, and say that you have.' },
      { title: 'n or n−1', text: 'Dividing by n−1 (Bessel\'s correction) compensates for measuring spread against a mean estimated from the same data. Use it when the numbers are a sample of something larger, which they usually are.' },
    ],

    'math-weighted-average': [
      { title: 'What weighting is for', text: 'A plain mean treats every value as equally important. Weighting says otherwise — by size, by confidence, by time. A grade average weighted by credit hours is the everyday example.' },
      { title: 'The classic trap', text: 'Averaging percentages that come from different-sized groups gives the wrong answer. Two groups at 50% and 100% average 75% only if they are the same size; weight by the group sizes and it is whatever the combined count says.' },
      { title: 'Related means', rows: [
        ['Arithmetic', 'Ordinary sums'],
        ['Geometric', 'Growth rates and ratios — multiply and take the nth root'],
        ['Harmonic', 'Rates over a fixed distance — average speed'],
      ] },
    ],

    'math-round': [
      { title: 'The modes', rows: [
        ['Half up', 'What most people are taught; biases upward'],
        ['Half even', 'Banker\'s rounding — unbiased over many values'],
        ['Floor / ceiling', 'Always down / always up'],
        ['Truncate', 'Toward zero — differs from floor for negatives'],
      ] },
      { title: 'Why banker\'s rounding', text: 'Always rounding .5 up adds a systematic bias that accumulates across thousands of transactions. Rounding half to even splits them evenly, which is why it is the IEEE 754 default and why financial code uses it.' },
      { title: 'Round once', text: 'Rounding at each step compounds the error: 2.4 → 2, 2.6 → 3 done twice is not the same as doing it once. Keep full precision through a calculation and round only for display.' },
      { title: 'Money is not a float', text: '0.1 + 0.2 is 0.30000000000000004 in binary floating point. Store currency in minor units as integers, or in a decimal type — and never compare two money values with ==.' },
    ],

    'math-sci-notation': [
      { title: 'The form', text: 'One digit before the point, times a power of ten. 0.00042 is 4.2 × 10⁻⁴. The exponent is how many places the point moves — negative to the right, positive to the left.' },
      { title: 'Significant figures', rows: [
        ['4.2 × 10³', 'Two significant figures — 4200 is ambiguous'],
        ['4.20 × 10³', 'Three; the trailing zero is a measurement claim'],
        ['Adding', 'Keep the least precise decimal place'],
        ['Multiplying', 'Keep the fewest significant figures'],
      ] },
      { title: 'Engineering notation', text: 'A variant where the exponent is always a multiple of three, so it lines up with kilo, mega, micro and nano. 47 × 10⁻⁶ F reads as 47 µF; 4.7 × 10⁻⁵ F is the same and nobody says it.' },
    ],

    'math-power': [
      { title: 'The rules', rows: [
        ['aᵐ × aⁿ', 'a^(m+n)'],
        ['aᵐ / aⁿ', 'a^(m−n)'],
        ['(aᵐ)ⁿ', 'a^(mn)'],
        ['a⁻ⁿ', '1/aⁿ'],
        ['a^(1/n)', 'The nth root'],
      ] },
      { title: 'Why a⁰ = 1', text: 'Because aⁿ/aⁿ = a⁰ and anything divided by itself is one. 0⁰ is left undefined in analysis and defined as 1 in combinatorics — both conventions are defensible, which is why it is a convention.' },
      { title: 'Exponential intuition', text: 'Doubling 30 times is a billion; the rice-on-a-chessboard total is 18 quintillion grains. Human intuition is linear, and this is the gap that makes compound interest and epidemic growth both feel impossible right up until they are obvious.' },
    ],

    'math-log': [
      { title: 'The inverse of a power', text: 'log_b(x) answers "b to what power gives x". Logs turn multiplication into addition, which is what made slide rules work and what makes them indispensable for anything spanning many orders of magnitude.' },
      { title: 'The bases', rows: [
        ['log₂', 'Information, algorithms, octaves'],
        ['log₁₀', 'Decibels, pH, Richter'],
        ['ln (base e)', 'Growth, decay, calculus'],
        ['Change base', 'log_b(x) = ln(x)/ln(b)'],
      ] },
      { title: 'Why e', text: 'e ≈ 2.71828 is the base where the curve\'s slope equals its height, so d/dx eˣ = eˣ. Every other exponential carries a constant factor; that is the whole reason natural logs are called natural.' },
    ],

    'math-root': [
      { title: 'Roots are fractional powers', text: 'The nth root of x is x^(1/n), so the same rules apply: the cube root of x² is x^(2/3). That identity is how a calculator computes any root from a single exponential.' },
      { title: 'Sign rules', text: 'Even roots of negatives are not real — there is no real number whose square is −4. Odd roots are fine: the cube root of −8 is −2. And √(x²) is |x|, not x, which is the source of a great many algebra errors.' },
      { title: 'Estimating by hand', text: 'To approximate √n, guess g and average g with n/g; repeat. Two iterations from a rough guess give three or four correct digits. This is Newton\'s method, and the Babylonians had it four thousand years ago.' },
    ],

    'math-pythagoras': [
      { title: 'a² + b² = c²', text: 'Only for right triangles, and c must be the hypotenuse — the side opposite the right angle, and always the longest. Reversed, the theorem tests whether a triangle is right-angled at all.' },
      { title: 'Triples worth knowing', rows: [
        ['3, 4, 5', 'And its multiples — 6-8-10, 9-12-15'],
        ['5, 12, 13', ''],
        ['8, 15, 17', ''],
        ['7, 24, 25', ''],
      ] },
      { title: 'The builder\'s 3-4-5', text: 'Measure 3 units along one wall, 4 along the other; when the diagonal is exactly 5, the corner is square. It needs no instrument and is still how foundations are checked.' },
      { title: 'In three dimensions', text: 'The diagonal of a box is √(a²+b²+c²) — Pythagoras applied twice. The same formula is the distance between two points in any number of dimensions.' },
    ],

    'math-triangle': [
      { title: 'Does it exist', text: 'Three lengths form a triangle only if each pair sums to more than the third. Equality gives a degenerate, flat triangle; less gives nothing. Check before trusting any area.' },
      { title: 'Heron\'s formula', text: 'With s as half the perimeter, the area is √(s(s−a)(s−b)(s−c)) — no angle and no height needed. For very thin triangles it loses precision badly, and a rearranged version is used numerically.' },
      { title: 'Classifying by the largest angle', rows: [
        ['a² + b² = c²', 'Right'],
        ['a² + b² > c²', 'Acute'],
        ['a² + b² < c²', 'Obtuse'],
      ] },
    ],

    'math-circle': [
      { title: 'The formulas', rows: [
        ['Circumference', '2πr, or πd'],
        ['Area', 'πr²'],
        ['Arc length', 'rθ, θ in radians'],
        ['Sector area', '½r²θ'],
        ['Chord', '2r·sin(θ/2)'],
      ] },
      { title: 'Area scales with the square', text: 'A 16-inch pizza has 1.8 times the area of a 12-inch one, not 1.3. The same reasoning says a cake tin one size up needs noticeably more batter, and that doubling a pipe\'s diameter quadruples its cross-section.' },
      { title: 'π', text: 'Irrational, and transcendental — which is why squaring the circle with compass and straightedge is impossible, proved in 1882. Forty digits suffice to compute the circumference of the observable universe to within an atom.' },
    ],

    'math-solid': [
      { title: 'Volumes', rows: [
        ['Sphere', '4/3 πr³'],
        ['Cylinder', 'πr²h'],
        ['Cone', '⅓πr²h'],
        ['Surface, sphere', '4πr²'],
      ] },
      { title: 'Archimedes\' favourite', text: 'A sphere inscribed in a cylinder has exactly two-thirds of its volume, and exactly two-thirds of its surface area. He asked for the figure on his tombstone, and considered it his best result.' },
      { title: 'The square-cube law', text: 'Double a shape\'s size and area goes up fourfold while volume goes up eightfold. It is why large animals need disproportionately thick legs, why big things overheat, and why scale models never behave like the real thing.' },
    ],

    'math-rectangle': [
      { title: 'Perimeter and area are independent', text: 'A fixed perimeter encloses anything from almost nothing to a maximum at the square. 20 m of fence gives 25 m² as a square and 9 m² as a 1×9 rectangle — for the same fence.' },
      { title: 'The isoperimetric result', text: 'Among all shapes with a given perimeter, the circle encloses the most area; among rectangles, the square does. It is why bubbles are spherical and why packaging optimises toward cubes.' },
      { title: 'Paper ratios', text: 'A-series paper is √2:1, so halving it gives the same proportion — the only ratio where that works. A4 is 210×297mm and an A0 sheet is exactly one square metre.' },
    ],

    'math-polygon': [
      { title: 'Angles', rows: [
        ['Interior sum', '(n−2) × 180°'],
        ['Each interior (regular)', '(n−2) × 180° / n'],
        ['Exterior sum', '360°, always'],
        ['Each exterior (regular)', '360°/n'],
      ] },
      { title: 'Which tile a plane', text: 'Only triangles, squares and hexagons tile by themselves with regular shapes, because only 60°, 90° and 120° divide into 360°. Pentagons leave a gap — which is why honeycombs are hexagonal: the most area per unit of wall.' },
      { title: 'Constructible ones', text: 'Gauss proved a regular n-gon is constructible with compass and straightedge exactly when n is a power of two times distinct Fermat primes. So 17 sides yes, 7 and 9 no — settled at nineteen years old.' },
    ],

    'math-two-points': [
      { title: 'What you can derive', rows: [
        ['Distance', '√((x₂−x₁)² + (y₂−y₁)²)'],
        ['Slope', '(y₂−y₁)/(x₂−x₁)'],
        ['Midpoint', 'The average of each coordinate'],
        ['Line', 'y − y₁ = m(x − x₁)'],
      ] },
      { title: 'Vertical lines', text: 'When x₂ = x₁ the slope is undefined, not infinite, and y = mx + c cannot express the line at all — it is x = k. Any code that computes a slope needs this case handled explicitly.' },
      { title: 'Perpendicular slopes', text: 'Two non-vertical lines are perpendicular when their slopes multiply to −1. So the perpendicular to a slope of 2 has slope −½ — useful for normals, bisectors and hit-testing.' },
    ],

    'math-proportion': [
      { title: 'Rule of three', text: 'If a/b = c/d, then any three of the four give the fourth by cross-multiplication. It is the most-used piece of arithmetic in the world — recipes, maps, exchange rates, dosages.' },
      { title: 'Direct or inverse', text: 'More workers, less time: that is inverse proportion, where the product stays constant rather than the ratio. Applying the direct rule to an inverse problem is the classic word-problem error.' },
      { title: 'The linearity assumption', text: 'Proportion assumes doubling the input doubles the output. Cooking times, drug doses and shipping costs are all conspicuously not proportional — scaling a recipe\'s ingredients works, scaling its oven time does not.' },
    ],

    'math-determinant': [
      { title: 'What it measures', text: 'The factor by which the matrix scales area (2×2) or volume (3×3). A negative determinant means the orientation flips; zero means everything collapses onto a line or plane, and the transformation cannot be undone.' },
      { title: 'Consequences', rows: [
        ['det ≠ 0', 'Invertible; the system has one solution'],
        ['det = 0', 'Singular; no unique solution'],
        ['det(AB)', 'det(A) × det(B)'],
        ['det(Aᵀ)', 'The same'],
      ] },
      { title: 'Do not expand by minors', text: 'Cofactor expansion costs n! operations — a 20×20 matrix would take longer than the age of the universe. LU decomposition does it in n³, which is what every library actually uses.' },
    ],

    'math-fibonacci': [
      { title: 'The sequence', text: '1, 1, 2, 3, 5, 8, 13, 21 … each the sum of the two before. Introduced to Europe in 1202 by Leonardo of Pisa, as an idealised model of breeding rabbits that is biologically nonsense and mathematically fertile.' },
      { title: 'Properties', rows: [
        ['F(n)/F(n−1)', 'Converges on φ ≈ 1.618'],
        ['Binet\'s formula', 'A closed form using φ — and it gives exact integers'],
        ['gcd(F(m),F(n))', 'F(gcd(m,n))'],
        ['Every third', 'Is even'],
      ] },
      { title: 'Where it really appears', text: 'In phyllotaxis — pine cones, sunflower heads, leaf arrangement — because the golden angle packs new growth with the fewest gaps. The claims about nautilus shells and the Parthenon do not survive measurement.' },
    ],

    'math-sequence': [
      { title: 'Two kinds', rows: [
        ['Arithmetic', 'Add d each time: aₙ = a₁ + (n−1)d'],
        ['Geometric', 'Multiply by r: aₙ = a₁ rⁿ⁻¹'],
        ['Arithmetic sum', 'n(a₁ + aₙ)/2'],
        ['Geometric sum', 'a₁(1−rⁿ)/(1−r)'],
      ] },
      { title: 'Gauss\'s trick', text: 'Pair the first term with the last, the second with the second-last: every pair has the same total. Summing 1 to 100 becomes 50 × 101. He is said to have worked it out as a schoolboy, to his teacher\'s annoyance.' },
      { title: 'Infinite geometric series', text: 'When |r| < 1 the sum converges to a₁/(1−r). That is why 0.9 + 0.09 + 0.009 … equals exactly 1, and why halving distances forever still gets you across the room.' },
    ],

    'math-trig': [
      { title: 'The ratios', rows: [
        ['sin', 'opposite / hypotenuse'],
        ['cos', 'adjacent / hypotenuse'],
        ['tan', 'opposite / adjacent — and sin/cos'],
        ['Identity', 'sin²θ + cos²θ = 1'],
      ] },
      { title: 'Exact values', rows: [
        ['0°', '0, 1, 0'],
        ['30°', '½, √3/2, 1/√3'],
        ['45°', '√2/2, √2/2, 1'],
        ['60°', '√3/2, ½, √3'],
        ['90°', '1, 0, undefined'],
      ] },
      { title: 'atan2, not atan', text: 'atan(y/x) loses the sign information and cannot tell the first quadrant from the third. atan2(y, x) takes both and returns the correct angle over the full circle — it is the right function for any heading or bearing.' },
      { title: 'Beyond right triangles', text: 'The sine rule a/sin A = b/sin B and the cosine rule c² = a² + b² − 2ab·cos C handle any triangle. The cosine rule is Pythagoras with a correction term, and reduces to it exactly when C is 90°.' },
    ],

    'math-speed-distance-time': [
      { title: 'The triangle', text: 'distance = speed × time, and the other two follow by division. Keep the units consistent — km/h with hours, m/s with seconds — because most errors here are unit errors, not arithmetic.' },
      { title: 'Average speed is harmonic', text: 'Driving out at 60 and back at 30 averages 40 km/h, not 45: you spend twice as long at the slow speed. Total distance over total time is the only safe method.' },
      { title: 'Handy conversions', rows: [
        ['÷ 3.6', 'km/h → m/s'],
        ['× 0.6', 'km/h → mph, roughly'],
        ['60 km/h', 'One kilometre a minute'],
        ['Sound', '≈343 m/s — 3 seconds per kilometre'],
      ] },
    ],

    // ------------------------------------------------------------ science

    'sci-ohms-law': [
      { title: 'V = IR', text: 'Voltage is the push, current the flow, resistance the opposition. Rearranged: I = V/R, R = V/I. Power follows as P = VI = I²R = V²/R — the I²R form is why thick cables run cool.' },
      { title: 'It is not universal', text: 'Ohm\'s law describes ohmic materials. Diodes, transistors, LEDs and filament lamps all have resistance that changes with current or temperature, which is why an LED needs a series resistor rather than a chosen voltage.' },
      { title: 'Series and parallel', rows: [
        ['Series', 'Resistances add; current is shared'],
        ['Parallel', 'Reciprocals add; voltage is shared'],
        ['Two in parallel', 'R₁R₂/(R₁+R₂)'],
        ['n equal in parallel', 'R/n'],
      ] },
      { title: 'What is dangerous', text: 'Current kills, not voltage — but voltage drives current through the body\'s resistance, which drops sharply when skin is wet. Around 10 mA across the chest is the threshold of serious harm.' },
    ],

    'sci-resistor-colors': [
      { title: 'The bands', text: 'Four bands: two digits, a multiplier, a tolerance. Five bands: three digits, multiplier, tolerance — used for precision parts. Read from the end where the bands are closest to the lead.' },
      { title: 'The code', rows: [
        ['Black 0, Brown 1, Red 2', 'Orange 3, Yellow 4, Green 5'],
        ['Blue 6, Violet 7, Grey 8', 'White 9'],
        ['Gold multiplier', '×0.1, and ±5% tolerance'],
        ['Silver multiplier', '×0.01, and ±10%'],
        ['Brown/Red/Green/Blue', 'Tolerance ±1/2/0.5/0.25%'],
      ] },
      { title: 'E-series values', text: 'Resistors come in preferred values spaced so the tolerance bands just meet: E12 has 12 per decade (10, 12, 15, 18 …), E24 has 24. That is why 1kΩ and 1.2kΩ exist and 1.1kΩ mostly does not.' },
    ],

    'sci-resistors-combined': [
      { title: 'The rules', text: 'In series, resistances add — the current has to pass through each in turn. In parallel, conductances add, so 1/R = 1/R₁ + 1/R₂ + …, and the total is always smaller than the smallest branch.' },
      { title: 'Rules of thumb', rows: [
        ['Two equal in parallel', 'Half the value'],
        ['10:1 ratio in parallel', 'The small one, within 10%'],
        ['n equal in series', 'n × R'],
        ['Power rating', 'Series shares it; parallel shares the current'],
      ] },
      { title: 'Dividers', text: 'Two resistors in series divide voltage in proportion to their values: Vout = Vin × R₂/(R₁+R₂). It holds only while whatever you connect draws negligible current — a divider is a reference, not a power supply.' },
    ],

    'sci-energy-cost': [
      { title: 'The arithmetic', text: 'Cost = power in kW × hours × price per kWh. A 2 kW heater for 5 hours at 30p is £3.00. Everything else is finding the real power, which is rarely the number on the label.' },
      { title: 'Typical draws', rows: [
        ['LED bulb', '8 W'],
        ['Laptop', '30 – 65 W'],
        ['Fridge', '100 W running, ~35 W averaged'],
        ['Kettle', '2 – 3 kW, briefly'],
        ['Electric shower', '8 – 10 kW'],
      ] },
      { title: 'Standby is smaller than you think', text: 'Modern standby is under a watt, so a year of it costs pennies. The real savings are in things that heat or cool — heating, hot water, the tumble dryer. Chasing standby while running a dryer daily is optimising the wrong number.' },
    ],

    'sci-kinetic-energy': [
      { title: 'Half m v squared', text: 'Energy rises with the square of speed. Double the speed and the energy — and the braking distance — quadruples. That single fact is the entire argument behind speed limits in built-up areas.' },
      { title: 'For scale', rows: [
        ['80 kg person at 5 m/s', '1000 J'],
        ['1500 kg car at 30 km/h', '52 kJ'],
        ['The same at 60 km/h', '208 kJ'],
        ['9 mm bullet', '≈500 J'],
      ] },
      { title: 'Relativistic correction', text: '½mv² is an approximation valid while v is small compared with light. At 10% of c it is already about 1% low, and the true expression diverges as v approaches c — which is why nothing with mass reaches it.' },
    ],

    'sci-potential-energy': [
      { title: 'mgh', text: 'Mass times gravity times height. Only the height difference matters; where you call zero is arbitrary, which is why potential energy is always relative to a reference you choose.' },
      { title: 'The conversion', text: 'Dropped from rest, mgh becomes ½mv², so v = √(2gh) regardless of mass. A 5 m fall gives 9.9 m/s — about 36 km/h — which is why falls from a first-floor window are serious.' },
      { title: 'Pumped storage', text: 'Grid-scale batteries made of water: pump uphill when power is cheap, release through turbines when it is not. Dinorwig in Wales stores about 9 GWh and reaches full output in 16 seconds.' },
    ],

    'sci-force': [
      { title: 'F = ma', text: 'Force equals mass times acceleration — and acceleration is any change in velocity, including a change in direction at constant speed. That is why turning a corner requires force.' },
      { title: 'The three laws', rows: [
        ['First', 'No net force, no change in motion'],
        ['Second', 'F = ma'],
        ['Third', 'Equal and opposite reaction'],
      ] },
      { title: 'Impulse is what hurts', text: 'Force × time equals the change in momentum. The same collision spread over a longer time needs less force — which is the entire principle of crumple zones, airbags, helmets and bending your knees on landing.' },
    ],

    'sci-density': [
      { title: 'ρ = m/V', text: 'Density is mass per unit volume, and it is what decides whether something floats: an object floats in a fluid of greater density, displacing its own weight.' },
      { title: 'Temperature matters', text: 'Water is densest at 4 °C, not at freezing — which is why ice floats and why lakes freeze from the top, leaving life beneath. Almost no other common substance behaves this way.' },
      { title: 'The famous story', text: 'Archimedes was asked whether a crown was pure gold. Gold is 19 300 kg/m³ and silver 10 500, so weighing it in and out of water settles it without damaging the crown. The bath and the shouting are probably embellishment.' },
    ],

    'sci-ideal-gas': [
      { title: 'PV = nRT', text: 'Pressure times volume equals moles times the gas constant times absolute temperature. R is 8.314 J/(mol·K). Temperature must be in kelvin — using Celsius produces nonsense, including negative volumes.' },
      { title: 'The special cases', rows: [
        ['Boyle', 'PV constant at fixed T'],
        ['Charles', 'V/T constant at fixed P'],
        ['Gay-Lussac', 'P/T constant at fixed V'],
        ['Avogadro', 'Equal volumes, equal molecules'],
      ] },
      { title: 'Molar volume', text: 'One mole of any ideal gas occupies 22.4 L at 0 °C and 1 atm, or 24.0 L at 25 °C. The identity of the gas does not matter — which was a genuinely shocking result when Avogadro proposed it.' },
      { title: 'Where it fails', text: 'At high pressure and low temperature, molecules have real volume and attract each other. Van der Waals adds two correction terms; below the critical point the gas condenses and no equation of state saves you.' },
    ],

    'sci-molar-mass': [
      { title: 'Grams per mole', text: 'The molar mass in g/mol is numerically the same as the molecular mass in atomic mass units — that is the whole point of how the mole is defined. Water is 18.015 u and 18.015 g/mol.' },
      { title: 'Avogadro\'s number', text: 'Exactly 6.02214076 × 10²³ since the 2019 redefinition — it is now a defined constant, not a measurement. A mole of anything is that many of it; a mole of sand grains would bury the Earth.' },
      { title: 'Common masses', rows: [
        ['H₂O', '18.02 g/mol'],
        ['CO₂', '44.01'],
        ['NaCl', '58.44'],
        ['C₆H₁₂O₆ glucose', '180.16'],
        ['Air (average)', '≈28.96'],
      ] },
    ],

    'sci-moles': [
      { title: 'Both directions', text: 'moles = grams ÷ molar mass, and grams = moles × molar mass. Everything in stoichiometry passes through moles, because balanced equations count particles rather than mass.' },
      { title: 'Concentration', rows: [
        ['Molarity (M)', 'mol per litre of solution'],
        ['Molality (m)', 'mol per kg of solvent — unaffected by temperature'],
        ['ppm', 'mg per litre, for dilute aqueous solutions'],
        ['% w/v', 'g per 100 mL'],
      ] },
      { title: 'Limiting reagent', text: 'A reaction stops when the first reactant runs out, regardless of how much of the others remain. Convert each to moles, divide by its coefficient, and the smallest quotient is the one that limits the yield.' },
    ],

    'sci-dilution': [
      { title: 'C₁V₁ = C₂V₂', text: 'The amount of solute does not change when you add solvent, so concentration times volume is conserved. Solve for whichever quantity is unknown — most often the volume of stock you need.' },
      { title: 'Acid into water', text: 'Always add acid to water, never the reverse. Dilution releases heat, and concentrated acid meeting a little water can boil and spit. The mnemonic is old because the injuries are.' },
      { title: 'Serial dilutions', text: 'Ten 1:10 steps give 1:10¹⁰ with accurately measurable volumes at every stage. It is the only practical way to reach very low concentrations, and errors multiply — so mix thoroughly between steps.' },
    ],

    'sci-ph': [
      { title: 'A logarithmic scale', text: 'pH = −log₁₀[H⁺]. Each whole number is a tenfold change in acidity, so pH 3 is a hundred times more acidic than pH 5. Averaging pH values directly is meaningless for the same reason.' },
      { title: 'For reference', rows: [
        ['0 – 1', 'Battery acid, stomach acid'],
        ['2 – 3', 'Lemon juice, vinegar'],
        ['4 – 5', 'Tomato, black coffee'],
        ['7', 'Pure water at 25 °C'],
        ['7.35 – 7.45', 'Human blood — a very narrow window'],
        ['11 – 13', 'Ammonia, bleach'],
      ] },
      { title: 'Neutral is not always 7', text: 'Neutral means [H⁺] = [OH⁻], and water\'s ionisation depends on temperature. At 50 °C neutral water has pH 6.63 and is not acidic. pH 7 is neutral at 25 °C, by convention.' },
    ],

    'sci-half-life': [
      { title: 'Exponential decay', text: 'After each half-life, half of what remains decays — so it is never all gone in theory. N = N₀ × (½)^(t/t½). After ten half-lives less than a thousandth is left, which is the usual practical limit.' },
      { title: 'Half-lives', rows: [
        ['Carbon-14', '5730 years — dating up to ~50 000'],
        ['Iodine-131', '8 days — why it clears quickly'],
        ['Caesium-137', '30 years — why it contaminates for decades'],
        ['Uranium-238', '4.5 billion years'],
        ['Caffeine (biological)', '≈5 hours'],
      ] },
      { title: 'Not just radioactivity', text: 'Any process removing a constant fraction per unit time has a half-life: drug clearance, capacitor discharge, a cooling cup of coffee approaching room temperature. The mathematics is identical.' },
    ],

    'sci-wave-photon': [
      { title: 'The relationships', text: 'c = λf and E = hf = hc/λ. Shorter wavelength means higher frequency and more energetic photons — which is the whole difference between radio waves and gamma rays.' },
      { title: 'The spectrum', rows: [
        ['Radio', '> 1 m'],
        ['Microwave', '1 mm – 1 m'],
        ['Infrared', '700 nm – 1 mm'],
        ['Visible', '380 – 700 nm'],
        ['Ultraviolet', '10 – 380 nm'],
        ['X-ray, gamma', '< 10 nm'],
      ] },
      { title: 'Ionising or not', text: 'Above about 10 eV — the ultraviolet boundary — a photon can knock an electron off a molecule and damage DNA. Below it, including all radio, microwave and visible light, it cannot, no matter how intense. Intensity heats; energy per photon ionises.' },
    ],

    'sci-speed-of-sound': [
      { title: 'It depends on the medium', rows: [
        ['Air, 20 °C', '343 m/s'],
        ['Air, 0 °C', '331 m/s'],
        ['Water', '≈1480 m/s'],
        ['Steel', '≈5100 m/s'],
        ['Vacuum', 'No sound at all'],
      ] },
      { title: 'Temperature, not pressure', text: 'In an ideal gas the speed goes with √T and is independent of pressure, because density and pressure change together. So it is colder air, not thinner air, that slows sound at altitude.' },
      { title: 'The thunder rule', text: 'Three seconds per kilometre, or five per mile. Count from the flash to the thunder — light\'s travel time is negligible over any distance you can hear.' },
    ],

    'sci-planet-weight': [
      { title: 'Mass stays, weight changes', text: 'Weight is mass times local surface gravity. You would weigh 38% as much on Mars and 2.5 times as much on Jupiter — while being exactly as much matter in both places.' },
      { title: 'Surface gravity', rows: [
        ['Mercury', '0.38 g'],
        ['Venus', '0.90 g'],
        ['Moon', '0.17 g'],
        ['Mars', '0.38 g'],
        ['Jupiter', '2.53 g (at the cloud tops)'],
        ['Sun', '28 g'],
      ] },
      { title: 'Not simply bigger is stronger', text: 'Surface gravity is GM/r², so a large low-density planet can pull more weakly than a small dense one. Uranus is fourteen times Earth\'s mass and has slightly less surface gravity, because its surface is so much further from its centre.' },
    ],

    'sci-dew-point': [
      { title: 'What it means', text: 'The temperature at which air becomes saturated and water condenses. Unlike relative humidity it does not change as the air warms, which makes it the honest measure of how much moisture is actually present.' },
      { title: 'How it feels', rows: [
        ['< 10 °C', 'Dry'],
        ['10 – 15', 'Comfortable'],
        ['16 – 18', 'Noticeably humid'],
        ['19 – 21', 'Uncomfortable'],
        ['> 21', 'Oppressive — sweat stops evaporating'],
      ] },
      { title: 'Where it matters practically', text: 'Condensation forms on any surface below the dew point — which is why cold pipes drip, why windows mist, and why a room that is warm but damp still grows mould in its coldest corner.' },
    ],

    'sci-heat-index': [
      { title: 'Why humidity matters', text: 'The body cools by evaporating sweat. Humid air slows evaporation, so the same temperature feels hotter and the cooling mechanism works less well — the heat index estimates the equivalent dry-air temperature.' },
      { title: 'Thresholds', rows: [
        ['27 – 32 °C', 'Caution — fatigue with exertion'],
        ['32 – 41', 'Extreme caution — cramps, exhaustion'],
        ['41 – 54', 'Danger — heatstroke likely with exertion'],
        ['> 54', 'Extreme danger'],
      ] },
      { title: 'The wet-bulb limit', text: 'A sustained wet-bulb temperature of about 35 °C is unsurvivable regardless of fitness or shade, because no amount of sweating can shed heat. It has begun to be recorded briefly in the Persian Gulf and South Asia.' },
    ],

    'sci-wind-chill': [
      { title: 'What it models', text: 'How fast exposed skin loses heat in moving air. It applies to bare skin, at face height, walking — not to a covered body, and not to objects. A car does not freeze faster because of wind chill; it just reaches air temperature sooner.' },
      { title: 'Frostbite time', rows: [
        ['−15 °C, 10 km/h', '≈ −20 wind chill; low risk'],
        ['−20 °C, 30 km/h', '≈ −33; 10–30 minutes'],
        ['−30 °C, 40 km/h', '≈ −46; under 10 minutes'],
        ['−40 °C, 50 km/h', '≈ −58; 2–5 minutes'],
      ] },
      { title: 'Only below freezing', text: 'The formula is defined for air at or below 10 °C with wind above about 5 km/h. Outside that range it is not merely inaccurate — it is not applicable, and the heat index takes over at the other end.' },
    ],

    'sci-constants': [
      { title: 'Defined, not measured', text: 'Since 2019 the SI fixes c, h, e, k and N_A exactly, and derives the units from them. The speed of light has no uncertainty because the metre is defined from it — the measurement moved into the definition.' },
      { title: 'The fixed set', rows: [
        ['c', '299 792 458 m/s'],
        ['h', '6.62607015 × 10⁻³⁴ J·s'],
        ['e', '1.602176634 × 10⁻¹⁹ C'],
        ['k_B', '1.380649 × 10⁻²³ J/K'],
        ['N_A', '6.02214076 × 10²³ /mol'],
      ] },
      { title: 'Still measured', text: 'G, the gravitational constant, is known to only about four significant figures — the worst-determined of the major constants, because gravity is so weak that everything nearby interferes with the experiment.' },
    ],

    'sci-projectile': [
      { title: 'Two independent motions', text: 'Horizontal velocity is constant; vertical acceleration is −g. They do not affect each other, which is why a bullet fired horizontally and one dropped at the same instant hit the ground together.' },
      { title: 'In a vacuum', rows: [
        ['Range', 'v² sin(2θ) / g'],
        ['Max range', 'At 45°, from level ground'],
        ['Peak height', 'v² sin²θ / (2g)'],
        ['Time of flight', '2v sinθ / g'],
        ['Equal ranges', 'θ and 90°−θ give the same distance'],
      ] },
      { title: 'Air changes everything', text: 'Drag makes the real trajectory asymmetric and the optimal launch angle noticeably less than 45° — around 35° for a shot put, lower still for a golf ball, where lift from spin matters as much as drag.' },
    ],

    'sci-lens': [
      { title: 'The thin lens equation', text: '1/f = 1/u + 1/v, with sign conventions that matter more than the algebra. Converging lenses have positive f, diverging negative; a negative image distance means a virtual image on the same side as the object.' },
      { title: 'Magnification', text: 'm = −v/u. Negative means inverted. A magnitude below one means the image is smaller — which is what every camera does, projecting a large world onto a small sensor.' },
      { title: 'Dioptres', text: 'Optical power is 1/f in metres, so a +2.00 D reading lens has a 50 cm focal length. Powers of lenses in contact simply add, which is why prescriptions are written this way.' },
    ],

    'sci-decibel-sum': [
      { title: 'Decibels do not add', text: 'Two 60 dB sources make 63 dB, not 120 — a doubling of power is +3 dB. Ten equal sources add 10 dB. Convert to power, sum, convert back; arithmetic on the dB values themselves is meaningless.' },
      { title: 'What the numbers mean', rows: [
        ['+3 dB', 'Twice the power'],
        ['+6 dB', 'Twice the pressure, or half the distance'],
        ['+10 dB', 'Roughly twice as loud, to a listener'],
        ['0 dB SPL', 'The threshold of hearing, by definition'],
      ] },
      { title: 'Exposure', text: 'Damage depends on energy over time: 85 dB for eight hours is the usual limit, and every 3 dB halves the safe duration. At 100 dB — a loud club — that is about fifteen minutes.' },
    ],

    'sci-gravitation': [
      { title: 'The inverse square', text: 'F = Gm₁m₂/r². Double the separation and the force falls to a quarter. G is 6.674 × 10⁻¹¹, which is tiny — gravity only matters because mass accumulates and never cancels.' },
      { title: 'Measured in a shed', text: 'Cavendish weighed the Earth in 1798 with lead spheres on a torsion balance, in a sealed room he observed through a telescope to avoid disturbing it with his own body heat. His value is within 1% of today\'s.' },
      { title: 'Inside a sphere', text: 'A uniform shell exerts no net gravity on anything inside it. So falling down a tunnel through the Earth, only the mass below you pulls — the force falls linearly to zero at the centre, not to infinity.' },
    ],

    'sci-escape-velocity': [
      { title: 'The formula', text: 'v = √(2GM/r). It is independent of the escaping object\'s mass — a pebble and a spacecraft need the same speed, which is 11.2 km/s from the Earth\'s surface.' },
      { title: 'Orbital is lower', text: 'Circular orbital velocity is √(GM/r), exactly 1/√2 of escape velocity. Low Earth orbit needs 7.8 km/s; escaping needs 41% more speed, which is very nearly twice the energy.' },
      { title: 'Speed, not a rule about rockets', text: 'Escape velocity is the speed needed for an unpowered projectile. A rocket with enough fuel could leave at walking pace; it is prohibitively expensive, not impossible. The number matters because chemical rockets cannot afford to thrust for long.' },
      { title: 'Values', rows: [
        ['Moon', '2.4 km/s'],
        ['Mars', '5.0'],
        ['Earth', '11.2'],
        ['Jupiter', '59.5'],
        ['Sun, from its surface', '617.5'],
      ] },
    ],

    // ------------------------------------------------------------ finance

    'fin-loan': [
      { title: 'Where the payment comes from', text: 'The annuity formula: P = L·r / (1 − (1+r)⁻ⁿ), with r the monthly rate and n the number of payments. Every payment is the same; what changes is how much of it is interest.' },
      { title: 'The shape of a mortgage', text: 'Early payments are almost entirely interest, because interest is charged on the outstanding balance. On a 25-year loan at 5%, the first payment is roughly two-thirds interest and the balance barely moves for years.' },
      { title: 'What moves the number', rows: [
        ['Rate +1%', 'Roughly +10% on a 25-year payment'],
        ['Term 25 → 30 yr', 'Lower payment, much more total interest'],
        ['Overpaying early', 'Comes straight off the principal — the highest-value pound you can pay'],
        ['APR vs rate', 'APR includes fees; compare APRs, not headline rates'],
      ] },
      { title: 'Not the whole cost', text: 'Property tax, insurance, service charges and maintenance are not in this figure and routinely add 30–50% to the true monthly cost of owning. Budget on the total, not the mortgage payment.' },
    ],

    'fin-amortization': [
      { title: 'What the schedule shows', text: 'Payment by payment: how much goes to interest, how much to principal, and what is left. It is the only honest picture of a loan, and it is why lenders are required to provide one.' },
      { title: 'The crossover', text: 'The point where principal exceeds interest in a single payment comes surprisingly late — well past the halfway mark on a typical 30-year mortgage at moderate rates. Until then, most of what you pay is rent on the money.' },
      { title: 'Overpayments', text: 'An extra payment removes its entire future interest, so £100 paid in year one is worth far more than £100 paid in year twenty. Check whether your lender applies it to the principal or holds it against the next payment — the difference is substantial.' },
    ],

    'fin-compound': [
      { title: 'The formula', text: 'A = P(1 + r/n)^(nt) — principal, annual rate, compounds per year, years. More frequent compounding raises the effective rate, but with diminishing returns: daily and continuous barely differ.' },
      { title: 'Nominal vs effective', rows: [
        ['12% annual, yearly', '12.00% effective'],
        ['12% compounded monthly', '12.68%'],
        ['12% compounded daily', '12.75%'],
        ['12% continuous', '12.75% — e^0.12 − 1'],
      ] },
      { title: 'Time beats rate', text: 'Money invested at 7% doubles roughly every decade. Starting ten years earlier at the same rate beats starting later with twice the contributions, for most realistic careers — the compounding periods are what you cannot buy back.' },
    ],

    'fin-simple-interest': [
      { title: 'Interest on the principal only', text: 'I = P × r × t. Nothing is earned on previous interest, so growth is linear rather than exponential — and always less than compound interest over the same period.' },
      { title: 'Where it is still used', rows: [
        ['Short-term loans', 'Under a year, where the difference is small'],
        ['Car finance', 'Often quoted simple, computed otherwise'],
        ['Bonds', 'Coupons are simple interest on the face value'],
        ['Late-payment terms', 'Usually a simple daily rate'],
      ] },
      { title: 'Watch the quoted rate', text: 'A "flat rate" on a car loan charges interest on the original amount for the whole term, even as you repay it. A 5% flat rate is roughly a 9–10% APR — the comparison the law requires precisely because the flat figure misleads.' },
    ],

    'fin-savings-goal': [
      { title: 'Two ways to get there', text: 'Raise the monthly contribution, or extend the time. Returns help, but over short horizons contributions dominate — for a three-year goal, what you pay in matters far more than what it earns.' },
      { title: 'Match the horizon to the risk', rows: [
        ['Under 3 years', 'Cash or short bonds — capital must be there'],
        ['3 – 10 years', 'A mix; some volatility is affordable'],
        ['10+ years', 'Equities have historically won over this long'],
      ] },
      { title: 'Inflation is a real cost', text: 'A goal set in today\'s money needs more nominal pounds by the time you reach it. At 3% inflation, £10 000 in ten years buys what £7 440 does now — so target a real amount, not a nominal one.' },
    ],

    'fin-retirement': [
      { title: 'The 4% rule', text: 'A 1990s study found that withdrawing 4% of the initial pot, adjusted for inflation, survived 30 years in almost every historical US window. It assumes a particular asset mix, a 30-year horizon, and that the future resembles the past — treat it as a starting point, not a guarantee.' },
      { title: 'The arithmetic that follows', rows: [
        ['£40 000 a year', 'Needs about £1 000 000 at 4%'],
        ['A 3% rate', 'Needs £1 333 000 — safer, and much harder'],
        ['Each £1000/yr of spending', 'About £25 000 of capital'],
      ] },
      { title: 'Sequence-of-returns risk', text: 'A bad decade at the start of retirement does far more damage than the same decade later, because you are selling assets while they are down. It is why glide paths reduce equity exposure near the transition.' },
    ],

    'fin-present-value': [
      { title: 'Money now is worth more', text: 'PV = FV / (1+r)ⁿ. A pound today can be invested; a pound in ten years cannot. Discounting is how you compare amounts that arrive at different times, and it is the foundation of every valuation method.' },
      { title: 'The discount rate is the argument', text: 'Nearly every disagreement about a valuation is a disagreement about the rate. It should reflect the risk and the opportunity cost of the money — and small changes in it swing long-dated cash flows enormously.' },
      { title: 'Where it bites', text: 'A lottery\'s "£10 million" paid over 30 years is worth perhaps half that today. The lump-sum option is not a discount — it is the present value, correctly computed.' },
    ],

    'fin-npv': [
      { title: 'The decision rule', text: 'Discount every cash flow to today, subtract the initial outlay. Positive NPV creates value at that discount rate; negative destroys it. Among competing projects, the highest NPV wins — not the highest return percentage.' },
      { title: 'What people get wrong', rows: [
        ['Sunk costs', 'Already spent, so irrelevant to the decision'],
        ['Sign conventions', 'Outflows negative, inflows positive, consistently'],
        ['Timing', 'End-of-period is the convention; state it'],
        ['Terminal value', 'Often most of the total — and the least reliable part'],
      ] },
      { title: 'NPV over IRR', text: 'NPV is additive and always well defined. IRR can have several values, or none, and implicitly assumes reinvestment at itself. When they disagree, NPV is the one to trust.' },
    ],

    'fin-irr': [
      { title: 'What IRR is', text: 'The discount rate at which NPV equals zero — the project\'s own break-even rate of return. It is appealing because it is a single percentage, and that is also its weakness.' },
      { title: 'The failure modes', rows: [
        ['Multiple IRRs', 'Any cash flow that changes sign more than once'],
        ['No IRR', 'Possible for some patterns'],
        ['Reinvestment', 'Assumes interim cash earns the IRR — rarely true'],
        ['Scale blindness', 'A 50% return on £100 beats 20% on £1M, by IRR'],
      ] },
      { title: 'MIRR', text: 'Modified IRR discounts outflows at the finance rate and compounds inflows at a realistic reinvestment rate. It is always unique, and closer to what the money will actually do.' },
    ],

    'fin-roi': [
      { title: 'The simple version', text: '(Gain − Cost) / Cost. Easy, comparable, and silent about time — which is its central flaw. A 50% ROI over one year and over ten are wildly different investments with the same number.' },
      { title: 'Annualise to compare', text: 'Convert to a compound annual rate before comparing anything with different durations: (1 + ROI)^(1/years) − 1. Otherwise you are comparing a sprint with a marathon.' },
      { title: 'Include everything', text: 'Fees, taxes, and the time you spent are all costs. A property\'s headline gain routinely ignores stamp duty, agent fees, maintenance and interest — which between them can consume the entire apparent return.' },
    ],

    'fin-cagr': [
      { title: 'A smoothed growth rate', text: 'CAGR = (End/Start)^(1/years) − 1. It is the constant rate that would have produced the same final value — a useful summary that deliberately hides every fluctuation along the way.' },
      { title: 'What it conceals', text: 'A fund that fell 50% then rose 100% has a 0% CAGR and an extremely uncomfortable two years. Pair it with a volatility measure, or with the worst year, before drawing conclusions.' },
      { title: 'Volatility drag', text: 'Down 50% then up 50% leaves you at 75%. Because losses and gains compound rather than add, the arithmetic mean return always exceeds the geometric one — and it is the geometric one you actually get.' },
    ],

    'fin-inflation': [
      { title: 'What it does', text: 'Inflation reduces what a unit of currency buys. £100 in 2000 bought roughly what £180 does now in the UK — so any comparison across years that ignores it is comparing different things.' },
      { title: 'Rules of thumb', rows: [
        ['2% a year', 'Prices double in ~35 years'],
        ['3%', '~24 years'],
        ['7%', '~10 years'],
        ['Real return', 'Nominal return minus inflation'],
      ] },
      { title: 'The index is an average', text: 'CPI tracks a basket that may look nothing like your spending. Anyone renting in a city, or paying for childcare or energy, has routinely faced personal inflation well above the headline figure.' },
    ],

    'fin-tip': [
      { title: 'Norms vary enormously', rows: [
        ['US, Canada', '15–20%, and effectively part of the wage'],
        ['UK', '10–12.5%, often already on the bill'],
        ['Japan, South Korea', 'Not tipped; it can offend'],
        ['Much of Europe', 'Round up, or 5–10%'],
        ['Australia, NZ', 'Uncommon'],
      ] },
      { title: 'Before or after tax', text: 'Tipping on the pre-tax total is the traditional rule; card terminals routinely suggest percentages of the post-tax, post-service-charge total. Check whether service is already included before adding more.' },
      { title: 'Splitting fairly', text: 'Splitting the total evenly overcharges whoever ate lightly. Splitting by item and then sharing tax and tip proportionally is fairer and takes the same two minutes.' },
    ],

    'fin-sales-tax': [
      { title: 'VAT and sales tax differ', text: 'VAT is collected at every stage with credits for tax already paid, and is quoted inside the shelf price in most of the world. US sales tax is charged once at the final sale and added at the till — which is why American prices look lower than they are.' },
      { title: 'Removing tax', text: 'To get the net from a gross price, divide — do not subtract the percentage. At 20% VAT the net is gross ÷ 1.2, which is 83.33%, not 80%. Subtracting overstates the tax by a fifth.' },
      { title: 'Rates are not uniform', text: 'Most VAT systems have reduced or zero rates for food, books, children\'s clothes and energy, with famously arbitrary boundaries. US rates combine state, county and city, and can differ between two shops on the same street.' },
    ],

    'fin-discount': [
      { title: 'Stacked discounts multiply', text: '20% off then a further 10% off is 28% off, not 30% — the second is taken from the already reduced price. The order does not matter; the result is the same either way.' },
      { title: 'Getting back to the original', text: 'If £80 is 20% off, the original is 80 ÷ 0.8 = £100. Adding 20% to £80 gives £96 and is wrong — the same asymmetry as percentage rises and falls.' },
      { title: 'Reference prices', text: '"Was £200, now £100" is only a saving if anything ever sold at £200. Advertising rules in most jurisdictions require the higher price to have been genuine and recent, which is why the small print exists.' },
    ],

    'fin-markup-margin': [
      { title: 'They are not the same number', text: 'Markup is profit over cost; margin is profit over price. A 50% markup is a 33.3% margin. Confusing them is one of the most common and most expensive errors in small-business pricing.' },
      { title: 'The conversions', rows: [
        ['25% markup', '20% margin'],
        ['50% markup', '33.3% margin'],
        ['100% markup', '50% margin'],
        ['Margin → markup', 'm / (1 − m)'],
        ['Markup → margin', 'k / (1 + k)'],
      ] },
      { title: 'Keystone', text: 'Traditional retail doubles the wholesale cost — a 100% markup, a 50% margin. It exists because gross margin has to cover rent, staff, shrinkage and unsold stock, not just profit.' },
    ],

    'fin-break-even': [
      { title: 'The formula', text: 'Fixed costs ÷ (price − variable cost per unit). The denominator is the contribution margin: what each sale contributes toward the fixed costs before anything is profit.' },
      { title: 'What moves it', rows: [
        ['Raising price', 'The strongest lever — it widens the margin directly'],
        ['Cutting variable cost', 'Also widens it, usually harder'],
        ['Cutting fixed cost', 'Lowers the bar, but not the slope'],
        ['Volume', 'Does nothing to break-even; it decides which side you are on'],
      ] },
      { title: 'Operating leverage', text: 'High fixed costs and low variable costs mean a distant break-even and steep profits past it — software, airlines, cinemas. The same shape amplifies losses when volume falls, which is why those industries fail spectacularly rather than gradually.' },
    ],

    'fin-card-payoff': [
      { title: 'Minimum payments are designed to last', text: 'A typical minimum is 1–3% of the balance, which barely exceeds the interest. On a £3000 balance at 22%, minimum payments take well over a decade and cost more in interest than the original debt.' },
      { title: 'What actually helps', rows: [
        ['Fixed payment', 'Pay a fixed amount, not the falling minimum'],
        ['Stop using the card', 'New spending resets the arithmetic'],
        ['0% transfer', 'Real, if the fee is less than the interest saved'],
        ['Highest rate first', 'Mathematically optimal'],
      ] },
      { title: 'The daily-rate detail', text: 'Interest is usually computed daily on the balance, so paying earlier in the cycle costs less than paying on the due date. And clearing the balance in full keeps the grace period — carrying any balance often forfeits it on new purchases too.' },
    ],

    'fin-debt-payoff': [
      { title: 'Avalanche or snowball', rows: [
        ['Avalanche', 'Highest interest rate first — cheapest, always'],
        ['Snowball', 'Smallest balance first — faster visible wins'],
        ['Both', 'Minimums on everything, extra on the target debt'],
      ] },
      { title: 'Which to pick', text: 'Avalanche costs less. Snowball has better completion rates in studies of real behaviour, because a cleared debt is motivating and motivation is the binding constraint for most people. The difference in cost is usually small; the difference in follow-through is not.' },
      { title: 'Before either', text: 'Get any employer pension match first — it is an immediate 50–100% return. Then clear anything above roughly 8–10%. Below that, the arithmetic against investing gets genuinely close.' },
    ],

    'fin-salary': [
      { title: 'The convention', text: '2080 hours a year — 40 hours × 52 weeks — is the standard divisor, which quietly assumes paid holiday. Contractors working the same hours with no paid leave need roughly 15% more per hour to match.' },
      { title: 'Quick conversions', rows: [
        ['Annual → hourly', '÷ 2080'],
        ['Hourly → annual', '× 2000, roughly'],
        ['£1/hour', '≈ £2080 a year'],
        ['Monthly', 'Annual ÷ 12, not weekly × 4'],
      ] },
      { title: 'Total compensation', text: 'Pension contributions, health cover, bonus, equity and paid leave routinely add 20–40% to a salary figure. A contract rate that looks higher often is not, once the employer-side costs land on you.' },
    ],

    'fin-pay-rise': [
      { title: 'Real terms', text: 'A 3% rise when inflation is 4% is a 1% pay cut. The only rise worth measuring is the one above inflation — which is why several recent years of nominal rises were, in real terms, reductions.' },
      { title: 'Compounding matters', text: 'A percentage rise compounds for the rest of your career, and future rises are percentages of the higher base. Negotiating £2000 more once is worth many times that over a decade.' },
      { title: 'Promotion versus rise', text: 'Internal rises have historically tracked a few per cent; changing employer has averaged considerably more. That gap is a structural feature of how pay bands work, not a statement about loyalty.' },
    ],

    'fin-currency-format': [
      { title: 'Separators are not universal', rows: [
        ['1,234.56', 'UK, US, most of Asia'],
        ['1.234,56', 'Germany, Spain, Italy, Brazil'],
        ['1 234,56', 'France, Russia, Scandinavia'],
        ['1,23,456.78', 'India — lakh and crore grouping'],
        ["1'234.56", 'Switzerland'],
      ] },
      { title: 'Symbol placement', text: '$1,234.56 leads in English; 1 234,56 € trails in French, with a non-breaking space. Getting it wrong is the fastest way to look unlocalised — and Intl.NumberFormat knows all of it already.' },
      { title: 'Minor units vary', text: 'Not every currency has two decimal places: the yen has none, Kuwaiti and Bahraini dinars have three. Assuming cents breaks storage and rounding for a substantial part of the world.' },
    ],

    'fin-budget': [
      { title: 'The 50/30/20 split', text: 'Half of take-home to needs, 30% to wants, 20% to savings and debt repayment. Popularised by Elizabeth Warren — it is a starting frame, not a law, and it assumes housing costs that are no longer typical in expensive cities.' },
      { title: 'Which side is which', rows: [
        ['Needs', 'Housing, food, utilities, transport, minimum debt payments'],
        ['Wants', 'Dining out, subscriptions, travel, upgrades'],
        ['Savings', 'Emergency fund, pension, extra debt payments'],
      ] },
      { title: 'Order of operations', text: 'Build one month of expenses in cash, take any pension match, clear high-interest debt, then build three to six months, then invest. Following that order beats optimising any single step.' },
    ],

    'fin-rule-72': [
      { title: 'Divide 72 by the rate', text: 'At 6%, money doubles in about 12 years. It is a mental approximation of the logarithm, and it is accurate to within a few per cent for rates between roughly 5 and 12.' },
      { title: 'Variants', rows: [
        ['Rule of 72', 'Doubling; best around 8%'],
        ['Rule of 70', 'More accurate at low rates'],
        ['Rule of 69.3', 'Exact for continuous compounding'],
        ['Rule of 114', 'Tripling'],
      ] },
      { title: 'It works in reverse', text: 'At 3% inflation, prices double in 24 years — so the same rule tells you how fast your money loses value, not just how fast it grows. Both are compounding; only the sign of the effect differs.' },
    ],

    'fin-depreciation': [
      { title: 'The methods', rows: [
        ['Straight line', 'Equal amounts each year — simple, and usual'],
        ['Declining balance', 'A fixed percentage of what is left; front-loaded'],
        ['Double declining', 'Twice the straight-line rate'],
        ['Units of production', 'By usage rather than time'],
      ] },
      { title: 'Book value is not market value', text: 'Depreciation is an accounting allocation of cost, not an estimate of what something would sell for. A fully depreciated machine with a book value of zero can still be working and worth money.' },
      { title: 'Tax rules override', text: 'Tax authorities specify their own schedules and classes regardless of the economic life you estimate. The accounting and tax figures routinely differ, which is where deferred tax comes from.' },
    ],

    'fin-invoice': [
      { title: 'The order of operations', text: 'Line totals, then the discount, then tax on the discounted subtotal, then shipping — with tax on the shipping where local rules require it. Applying tax before a discount overcharges, and is the most common invoice error.' },
      { title: 'What an invoice must carry', rows: [
        ['A unique number', 'Sequential, and never reused'],
        ['Both parties', 'Names, addresses, tax registration numbers'],
        ['Dates', 'Issue date, and the payment due date'],
        ['Tax', 'Rate and amount shown separately'],
        ['Terms', 'Net 30, late-payment interest'],
      ] },
      { title: 'Rounding', text: 'Round each line to the currency\'s minor unit, then sum — or sum and round once, but do it the same way every time. Mixing the two produces totals that differ by a penny, and reconciliation that takes hours.' },
    ],

    'fin-unit-price': [
      { title: 'Compare on one unit', text: 'Price per 100g, per litre, per sheet. The larger pack is usually but not always cheaper per unit — "bigger is cheaper" fails often enough that it is worth the ten seconds to check.' },
      { title: 'What distorts it', rows: [
        ['Different units', 'Per 100g against per kg, on the same shelf'],
        ['Shrinkflation', 'Same price, smaller pack, same shelf label'],
        ['Multibuys', 'Often no better than the single unit price'],
        ['Waste', 'Cheap per unit is worthless if half is thrown away'],
      ] },
      { title: 'It is often required by law', text: 'Many jurisdictions mandate unit pricing on the shelf label precisely because comparison is otherwise impractical. When it is present, it is the number to read — not the large one.' },
    ],

    'fin-fuel-cost': [
      { title: 'The calculation', text: 'Distance ÷ economy × price. Keep units consistent: L/100km with litres, mpg with gallons — and check whether the mpg figure is US or imperial before trusting a result.' },
      { title: 'What quoted economy ignores', text: 'Official figures come from a standardised test. Real consumption is worse with a cold engine, short trips, roof boxes, low tyre pressure, air conditioning and speed — highway consumption rises sharply above about 110 km/h because drag goes with the square of speed.' },
      { title: 'The full cost of driving', text: 'Fuel is typically a third of the per-kilometre cost once depreciation, insurance, tyres and servicing are counted. Comparisons against a train fare that count only fuel are not comparing like with like.' },
    ],

    'fin-electricity': [
      { title: 'kWh is the unit', text: 'A kilowatt for an hour. A 2 kW appliance for 30 minutes is 1 kWh. Everything on a bill reduces to that number times a price, plus a standing charge that you pay regardless of use.' },
      { title: 'Where the money goes', rows: [
        ['Heating and hot water', 'Usually the majority'],
        ['Tumble dryer', '2–4 kWh per load'],
        ['Electric shower', '≈1.5 kWh per 10 minutes'],
        ['Oven', '≈1 kWh per hour'],
        ['Fridge', '≈0.8 kWh a day, running constantly'],
      ] },
      { title: 'Standing charge', text: 'A fixed daily fee before a single unit is used, so cutting consumption cannot reduce it. It is why a rarely used property can still receive a meaningful bill, and why per-kWh comparisons between tariffs are incomplete.' },
    ],

    'fin-rent-vs-buy': [
      { title: 'What is actually being compared', text: 'Not rent against a mortgage payment, but rent against the unrecoverable costs of owning: interest, maintenance, insurance, property tax and transaction costs — plus what the deposit would have earned elsewhere.' },
      { title: 'The 5% rule of thumb', text: 'Annual unrecoverable cost is roughly 5% of the property value — about 3% maintenance and tax, 1–2% net of interest and opportunity cost. Divide by twelve; if rent is below that, renting is not obviously worse.' },
      { title: 'Break-even takes years', text: 'Buying and selling costs 5–10% of the price between them, so a short stay rarely recovers it. Five years is the usual rule of thumb, and it is highly sensitive to what the market does in the meantime.' },
      { title: 'The part no model captures', text: 'Security of tenure, freedom to change the place, and the discipline of forced saving on one side; mobility and no exposure to a single illiquid asset on the other. These are preferences, not errors in the arithmetic.' },
    ],

    // ----------------------------------------------------------- business

    'biz-profit-margin': [
      { title: 'Three margins', rows: [
        ['Gross', 'Revenue minus cost of goods — the unit economics'],
        ['Operating', 'After salaries, rent, marketing — the business'],
        ['Net', 'After interest and tax — what is left'],
      ] },
      { title: 'What good looks like', text: 'It is entirely industry-dependent: supermarkets run 2–3% net and software 20–40%. Comparing a margin against anything other than a direct competitor tells you nothing.' },
      { title: 'Margin is not markup', text: 'Margin divides profit by price; markup divides by cost. Pricing from a target margin using the markup formula undercharges by a widening amount as the margin rises.' },
    ],

    'biz-cac': [
      { title: 'Count everything', text: 'Total sales and marketing spend divided by new customers acquired in the same period — including salaries, tools and agency fees, not just ad spend. Excluding staff costs is how CAC gets understated by half.' },
      { title: 'Blended or paid', text: 'Blended CAC divides by every new customer including organic ones; paid CAC counts only those from paid channels. Blended looks better and hides whether the paid channel works at all. Track both.' },
      { title: 'The timing mismatch', text: 'Money spent this month wins customers over the following months, so dividing within one period distorts anything with a long sales cycle. Cohort the spend against the customers it actually produced.' },
    ],

    'biz-ltv': [
      { title: 'The simple form', text: 'Average revenue per customer × gross margin ÷ churn rate. Dividing by churn is what turns a monthly figure into a lifetime one — a 5% monthly churn implies a 20-month average life.' },
      { title: 'Use margin, not revenue', text: 'LTV computed on revenue ignores the cost of serving the customer, and for anything with real delivery costs that is most of the number. The honest version is contribution, not turnover.' },
      { title: 'LTV:CAC', rows: [
        ['Below 1:1', 'Losing money on every customer'],
        ['3:1', 'The usual healthy target'],
        ['Above 5:1', 'Often under-investing in growth'],
        ['Payback period', 'Matters more than the ratio for cash flow'],
      ] },
    ],

    'biz-churn': [
      { title: 'Customer or revenue', text: 'Customer churn counts departures; revenue churn weights them by what they paid. Losing small accounts and keeping large ones gives high customer churn and low revenue churn — a completely different business.' },
      { title: 'Net negative churn', text: 'When expansion from existing customers exceeds losses, revenue grows with no new customers at all. It is the single strongest signal in subscription businesses, and it is what upgrade tiers exist to produce.' },
      { title: 'The compounding', rows: [
        ['1% monthly', '11% a year'],
        ['3%', '31%'],
        ['5%', '46%'],
        ['10%', '72% — the business is a treadmill'],
      ] },
    ],

    'biz-conversion': [
      { title: 'Define the denominator', text: 'Conversion rate is meaningless without saying conversions of what: sessions, unique visitors, qualified leads. Two teams reporting different numbers for the same funnel are usually both right and measuring different things.' },
      { title: 'Funnel multiplication', text: 'Stage rates multiply. 50% × 40% × 20% is 4% end to end, so the cheapest improvement is usually the worst stage, not the last one. Fixing a 20% step to 30% beats fixing a 50% step to 60%.' },
      { title: 'Beware small samples', text: '2 conversions from 20 visits is 10% ± a very large amount. Below a few hundred observations per variant, the difference you are looking at is mostly noise — which is what significance testing is for.' },
    ],

    'biz-ab-test': [
      { title: 'What significance means', text: 'A p-value below 0.05 says: if there were truly no difference, data this extreme would appear less than 5% of the time. It does not say the effect is real, large, or worth shipping.' },
      { title: 'The common mistakes', rows: [
        ['Peeking', 'Stopping when it first looks significant inflates false positives badly'],
        ['Too small', 'Underpowered tests miss real effects'],
        ['Many metrics', 'Test twenty things and one will hit 0.05 by chance'],
        ['Short runs', 'Weekday and weekend behaviour differ; run whole weeks'],
        ['Novelty', 'Regulars react to change itself, then revert'],
      ] },
      { title: 'Power first', text: 'Decide the minimum effect worth detecting, compute the sample size before starting, and run to it. A test whose size was chosen afterwards has no meaningful error rate at all.' },
    ],

    'biz-nps': [
      { title: 'How it is scored', text: 'On 0–10: 9–10 promoters, 7–8 passives, 0–6 detractors. NPS is the percentage of promoters minus the percentage of detractors, so it ranges from −100 to +100 and discards the passives entirely.' },
      { title: 'Why statisticians dislike it', text: 'Collapsing an eleven-point scale into three buckets throws away information, and the subtraction means very different distributions produce the same score. The mean rating is a better statistic; NPS survives because it is simple and comparable.' },
      { title: 'Reading a score', rows: [
        ['Above 0', 'More promoters than detractors'],
        ['30+', 'Generally considered good'],
        ['50+', 'Excellent'],
        ['Comparisons', 'Only meaningful within an industry and a survey method'],
      ] },
    ],

    'biz-meeting-cost': [
      { title: 'The arithmetic nobody does', text: 'Attendees × hourly cost × duration. Eight people at £60 an hour for ninety minutes is £720 — before counting the interruption cost of fragmenting everyone\'s afternoon.' },
      { title: 'Loaded cost, not salary', text: 'The real hourly figure includes employer taxes, benefits, equipment and overhead — typically 1.25 to 1.4 times base salary. Using the salary alone understates every meeting by a third.' },
      { title: 'What actually reduces it', text: 'Fewer attendees, a written agenda, and a document circulated beforehand. A meeting with no agenda has no way to end, which is why the default duration expands to whatever the calendar offers.' },
    ],

    'biz-deadline': [
      { title: 'Count working days', text: 'Ten working days is two calendar weeks only if no holiday intervenes. Estimates given in working days and read as calendar days are a reliable source of missed dates.' },
      { title: 'The planning fallacy', text: 'People underestimate their own tasks even when they know that they historically do. The robust correction is reference-class forecasting: ask how long similar work actually took, not how long this one should take.' },
      { title: 'Buffers do not survive', text: 'Padding each task invites the time to be consumed (Parkinson\'s law) and the buffer disappears anyway. Pooling one buffer at the end of the project protects the date better than distributing it.' },
    ],

    'biz-okr-score': [
      { title: 'The 0.7 target', text: 'Well-set objectives are meant to land around 0.6–0.7. Consistently scoring 1.0 means the targets were sandbagged; consistently below 0.4 means they were fantasy. The score is a calibration signal, not a performance rating.' },
      { title: 'Committed versus aspirational', text: 'Committed OKRs are expected to hit 1.0 — they are commitments. Aspirational ones are meant to fall short. Mixing the two in one list and averaging them produces a number that means nothing.' },
      { title: 'Not a performance review', text: 'Tying OKR scores to compensation guarantees conservative objectives, which destroys the only thing they are good for. Every published implementation that works keeps them separate.' },
    ],

    'biz-subject-line': [
      { title: 'What gets truncated', rows: [
        ['Mobile', '~35 characters visible'],
        ['Gmail desktop', '~70'],
        ['Outlook', '~60'],
        ['Preview text', 'Another 40–100 — and it is wasted by default'],
      ] },
      { title: 'Front-load it', text: 'Put the substance in the first few words, because that is all a phone shows. A subject that only makes sense complete is a subject most recipients never read.' },
      { title: 'What trips filters', text: 'ALL CAPS, several exclamation marks, "free", "act now", excessive punctuation. Modern filters weigh sender reputation far more heavily than wording — but a subject that looks like spam still loses human readers.' },
    ],

    'biz-speaking-time': [
      { title: 'Rates', rows: [
        ['Conversational', '150 – 160 wpm'],
        ['Presentation', '120 – 150 wpm'],
        ['Audiobook', '150 – 160'],
        ['Auctioneer', '250+'],
        ['Non-native audience', 'Slow to 100 – 120'],
      ] },
      { title: 'Budget less than you think', text: 'A 20-minute slot holds roughly 2500 spoken words — and that is before questions, pauses, or a demonstration going wrong. Preparing to fill the whole slot guarantees overrunning it.' },
      { title: 'Pauses are content', text: 'A deliberate two-second pause after a key point does more for retention than another sentence. Reading a script at a constant rate is the fastest way to lose a room.' },
    ],

    'biz-payback': [
      { title: 'How long to get the money back', text: 'The period until cumulative cash flow turns positive. It is a liquidity measure, not a profitability one — it deliberately ignores everything that happens after the break-even point.' },
      { title: 'Its two blind spots', text: 'It ignores the time value of money, and it ignores all later cash flows. A project paying back in two years and then stopping scores better than one paying back in three and running for a decade.' },
      { title: 'Use it alongside NPV', text: 'Payback answers "can we survive the wait", NPV answers "is it worth doing". For CAC payback in subscription businesses the liquidity question is the binding one, which is why the metric persists there.' },
    ],

    'biz-inventory-turnover': [
      { title: 'The ratio', text: 'Cost of goods sold ÷ average inventory. It counts how many times stock is sold and replaced in a period. Days of inventory is 365 divided by it — usually the more intuitive number.' },
      { title: 'Higher is not always better', rows: [
        ['Too low', 'Cash tied up, obsolescence, storage cost'],
        ['Too high', 'Stockouts, lost sales, rush shipping'],
        ['Groceries', 'Very high — perishable'],
        ['Jewellery, cars', 'Very low, and normal'],
      ] },
      { title: 'Use cost, not revenue', text: 'Inventory is carried at cost, so dividing revenue by it inflates the ratio by the whole gross margin. It is a common error in spreadsheets built from a P&L rather than a balance sheet.' },
    ],

    'biz-ad-metrics': [
      { title: 'The relationships', rows: [
        ['CTR', 'Clicks ÷ impressions'],
        ['CPC', 'Spend ÷ clicks'],
        ['CPM', 'Cost per thousand impressions'],
        ['CPA', 'Spend ÷ conversions'],
        ['ROAS', 'Revenue ÷ spend'],
        ['CPC', '= CPM ÷ (CTR × 1000)'],
      ] },
      { title: 'ROAS is not profit', text: 'A 4:1 ROAS on a 25% margin product loses money. The break-even ROAS is 1 ÷ gross margin — so a 25% margin needs 4:1 just to stand still, before counting any fixed costs.' },
      { title: 'Attribution decides everything', text: 'Last-click credits the final ad and undervalues everything that created the demand. Changing the attribution window or model changes every number above without a single thing changing in the market.' },
    ],

    // ------------------------------------------------------------- health

    'health-bmr': [
      { title: 'What BMR is', text: 'The energy your body uses at complete rest — breathing, circulation, keeping warm, maintaining tissue. It is typically 60–70% of total daily expenditure, which is why exercise moves the total less than people expect.' },
      { title: 'Mifflin-St Jeor', text: '10×kg + 6.25×cm − 5×age, then +5 for men or −161 for women. It replaced Harris-Benedict in 1990 as the more accurate equation for modern populations, and it is still only accurate to about ±10% for an individual.' },
      { title: 'Why estimates vary', rows: [
        ['Body composition', 'Muscle burns more at rest than fat; the formula cannot see it'],
        ['Genetics', 'Individuals differ by hundreds of calories'],
        ['Thyroid', 'A real and substantial factor'],
        ['Adaptation', 'Prolonged restriction lowers BMR'],
      ] },
    ],

    'health-tdee': [
      { title: 'The components', rows: [
        ['BMR', '60–70% — at rest'],
        ['NEAT', '15–30% — fidgeting, walking, everything unplanned'],
        ['TEF', '~10% — digesting food itself'],
        ['Exercise', 'Often only 5–15%'],
      ] },
      { title: 'Activity multipliers are crude', text: 'The 1.2 to 1.9 multipliers are broad buckets, and most people overestimate which one they are in. Treat the output as a starting point, then adjust from two weeks of actual weight data.' },
      { title: 'NEAT adapts', text: 'Cutting calories reduces spontaneous movement — people become measurably less fidgety and walk less without noticing. It is a large part of why weight loss slows beyond what the arithmetic predicts.' },
    ],

    'health-water': [
      { title: 'The eight-glasses myth', text: 'There is no good evidence behind it. The likely origin is a 1945 recommendation of about 2.5 L a day which also said most of that comes from food — the second sentence got dropped.' },
      { title: 'What actually drives need', rows: [
        ['Body size', 'Larger bodies need more'],
        ['Activity', 'Sweat losses of 0.5–2 L an hour'],
        ['Climate', 'Heat and altitude both raise it'],
        ['Food', '20–30% of intake comes from food'],
        ['Coffee, tea', 'Count toward intake; mild diuresis does not offset them'],
      ] },
      { title: 'Thirst mostly works', text: 'For healthy adults with access to fluid, drinking to thirst is adequate — and urine that is pale yellow is a better guide than any target. Overdrinking is a genuine risk in endurance sport, where hyponatraemia has killed athletes.' },
    ],

    'health-ideal-weight': [
      { title: 'Where the formulas came from', text: 'Devine (1974) was devised for calculating drug doses, not for health advice. Robinson, Miller and Hamwi are variations of the same idea. None was derived from outcomes, and all of them ignore body composition.' },
      { title: 'Treat it as a range', text: 'The formulas disagree with each other by several kilograms, which is itself the useful message: there is a band, not a number. A healthy BMI range for your height is a better-founded target.' },
      { title: 'What matters more', text: 'Waist-to-height ratio, fitness, blood pressure and blood markers all predict outcomes better than weight alone. A person can improve every one of them without the scale moving.' },
    ],

    'health-body-fat': [
      { title: 'The US Navy method', text: 'A circumference-based estimate: neck and waist for men, plus hips for women, scaled by height. It is free and repeatable, and typically within 3–4 percentage points of a DEXA scan — sometimes considerably worse.' },
      { title: 'Healthy ranges', rows: [
        ['Men, essential', '2–5%'],
        ['Men, fitness', '14–17%'],
        ['Men, average', '18–24%'],
        ['Women, essential', '10–13%'],
        ['Women, fitness', '21–24%'],
        ['Women, average', '25–31%'],
      ] },
      { title: 'Consistency beats accuracy', text: 'Measure at the same time of day, in the same posture, with the tape snug but not compressing. The trend over weeks is informative even when the absolute number is not.' },
    ],

    'health-hr-zones': [
      { title: 'The 220-minus-age problem', text: 'That formula has a standard deviation of about 10–12 beats — so for a 40-year-old it might say 180 when the true maximum is anywhere from 160 to 200. Tanaka (208 − 0.7×age) is somewhat better; a measured maximum is far better still.' },
      { title: 'The zones', rows: [
        ['1: 50–60%', 'Recovery'],
        ['2: 60–70%', 'Aerobic base — most training time belongs here'],
        ['3: 70–80%', 'Tempo'],
        ['4: 80–90%', 'Threshold'],
        ['5: 90–100%', 'Maximum, briefly'],
      ] },
      { title: 'Polarised training', text: 'Elite endurance athletes spend roughly 80% of their time in zones 1–2 and the rest hard, largely avoiding the middle. Amateurs tend to do the opposite — moderately hard all the time, which accumulates fatigue without building much.' },
    ],

    'health-run-pace': [
      { title: 'Pace and speed are reciprocals', text: 'Pace is time per distance, speed is distance per time. 5:00/km is 12 km/h. Paces cannot be averaged directly — average the times over a fixed distance instead.' },
      { title: 'Reference paces', rows: [
        ['6:00/km', '10 km/h — a 42:11 10K'],
        ['5:00/km', '12 km/h — a 1:45 half'],
        ['4:00/km', '15 km/h — a 2:49 marathon'],
        ['2:50/km', 'World-record marathon pace'],
      ] },
      { title: 'Negative splits', text: 'Running the second half slightly faster than the first is how nearly every distance record has been set. Going out fast feels efficient and costs more later — the fade is larger than the time banked.' },
    ],

    'health-pace-convert': [
      { title: 'The conversions', rows: [
        ['min/km → km/h', '60 ÷ pace'],
        ['min/mile → min/km', '÷ 1.609'],
        ['5:00/km', '8:03/mile'],
        ['8:00/mile', '4:58/km'],
      ] },
      { title: 'Treadmill mismatch', text: 'Treadmill speeds are often optimistic and there is no air resistance, so the same effort produces a faster reading. A 1% incline is the usual correction to approximate outdoor running.' },
    ],

    'health-race-predictor': [
      { title: 'Riegel\'s formula', text: 'T₂ = T₁ × (D₂/D₁)^1.06. The exponent above 1 encodes the fact that pace inevitably slows over longer distances — it was fitted to race results, not derived from physiology.' },
      { title: 'Where it breaks', rows: [
        ['Untrained for the distance', 'Marathons punish inadequate long runs'],
        ['Very short → very long', 'The extrapolation compounds'],
        ['5K → marathon', 'Usually optimistic by several minutes'],
        ['Heat, hills, wind', 'Not modelled at all'],
      ] },
      { title: 'The training matters more', text: 'A prediction from a 10K time assumes marathon-appropriate endurance. Without the weekly mileage behind it, the last 10 km will not resemble the prediction — which is the entire reason the race is hard.' },
    ],

    'health-calories-met': [
      { title: 'What a MET is', text: 'A multiple of resting metabolic rate, defined as 3.5 mL of oxygen per kg per minute. Walking is about 3.5 METs, running 8–12. Calories ≈ METs × kg × hours.' },
      { title: 'Typical values', rows: [
        ['Sitting', '1.0'],
        ['Walking, 5 km/h', '3.5'],
        ['Cycling, moderate', '6–8'],
        ['Running, 10 km/h', '10'],
        ['Swimming, vigorous', '9–10'],
      ] },
      { title: 'Estimates run high', text: 'MET tables were derived from small studies of young fit adults, and machine displays are worse. Real expenditure is commonly 20–30% below the figure shown — which is why "earning back" calories from exercise reliably stalls weight loss.' },
    ],

    'health-macros': [
      { title: 'Energy per gram', rows: [
        ['Protein', '4 kcal'],
        ['Carbohydrate', '4 kcal'],
        ['Fat', '9 kcal'],
        ['Alcohol', '7 kcal'],
        ['Fibre', '~2 kcal, partially fermented'],
      ] },
      { title: 'What the evidence supports', text: 'Total energy drives weight change; macro ratios affect satiety, training performance and how much lean mass is retained. Protein around 1.6–2.2 g per kg of body weight is the best-supported single number for anyone training.' },
      { title: 'Fat has a floor', text: 'Roughly 0.5 g per kg is needed for hormone production and fat-soluble vitamin absorption. Very low fat intakes sustained for months cause real problems, which is why extreme versions of either low-fat or low-carb converge on the same advice.' },
    ],

    'health-due-date': [
      { title: 'Naegele\'s rule', text: 'Last menstrual period plus 280 days — 40 weeks. It assumes a 28-day cycle with ovulation on day 14, and dates pregnancy from two weeks before conception, which is why "weeks pregnant" starts before pregnancy does.' },
      { title: 'How accurate it is', text: 'About 4% of births occur on the estimated date, and roughly 70% within ten days either side. An early ultrasound is considerably more accurate and is what clinicians re-date from when the two disagree.' },
      { title: 'Terminology', rows: [
        ['Early term', '37 0/7 – 38 6/7 weeks'],
        ['Full term', '39 0/7 – 40 6/7'],
        ['Late term', '41 0/7 – 41 6/7'],
        ['Post-term', '42 weeks and beyond'],
      ] },
    ],

    'health-ovulation': [
      { title: 'The fertile window', text: 'Sperm survive up to five days; the egg about 24 hours. So the window is roughly the five days before ovulation plus the day itself — and the highest-probability days are the two immediately before.' },
      { title: 'The luteal phase is the stable half', text: 'The time from ovulation to the next period is consistently 12–16 days. Cycle length varies because the follicular phase varies, which is why counting back 14 days from the expected period is more reliable than counting forward.' },
      { title: 'Not contraception', text: 'Calendar prediction alone has a typical-use failure rate around 24% a year. Symptothermal methods combining temperature and cervical mucus do far better, and still require training and consistency.' },
    ],

    'health-sleep-cycles': [
      { title: 'About 90 minutes', text: 'A full cycle runs roughly 90 minutes — light, deep, then REM — and repeats four to six times a night. Waking at the end of a cycle rather than mid-deep-sleep is what reduces grogginess.' },
      { title: 'The cycle is not fixed', rows: [
        ['Range', '70 – 120 minutes between individuals'],
        ['Deep sleep', 'Concentrated in the first half of the night'],
        ['REM', 'Lengthens toward morning'],
        ['Falling asleep', 'Add 10–20 minutes to any bedtime calculation'],
      ] },
      { title: 'Total sleep still wins', text: 'Timing to a cycle boundary is a minor optimisation next to getting seven to nine hours. Cutting an hour to land on a boundary makes things worse, not better.' },
    ],

    'health-caffeine': [
      { title: 'Half-life around five hours', text: 'It varies from about 2 to 10 hours depending on genetics, liver enzymes, oral contraceptives, pregnancy and smoking. A 200 mg coffee at 4pm leaves roughly 100 mg at 9pm and 50 mg at 2am.' },
      { title: 'Typical amounts', rows: [
        ['Filter coffee, 240 ml', '95 mg'],
        ['Espresso shot', '63 mg'],
        ['Black tea', '47 mg'],
        ['Energy drink, 250 ml', '80 mg'],
        ['Cola, 330 ml', '34 mg'],
        ['Dark chocolate, 50 g', '~40 mg'],
      ] },
      { title: 'Effect on sleep', text: 'Caffeine blocks adenosine, the molecule that makes you feel sleepy — it masks tiredness rather than removing it. Even when it does not delay sleep onset, an evening dose measurably reduces deep sleep, which is why people who "sleep fine on coffee" still wake unrefreshed.' },
      { title: 'Upper limits', text: 'Around 400 mg a day is generally considered safe for healthy adults, 200 mg in pregnancy. Doses above roughly 1 g cause real toxicity, and powdered caffeine has killed people who mismeasured it.' },
    ],

    'health-bac': [
      { title: 'This is an estimate only', text: 'Widmark\'s formula uses weight, sex and drinks consumed. Real BAC depends on food, hydration, genetics, medication, body composition and how fast you drank. Never use any calculator to decide whether to drive.' },
      { title: 'Elimination is roughly constant', text: 'The body clears about 0.015% per hour regardless of what you do. Coffee, cold showers, food after the fact and exercise change alertness, not blood alcohol — there is no way to speed it up.' },
      { title: 'Legal limits vary', rows: [
        ['0.08%', 'US, England, Wales'],
        ['0.05%', 'Most of Europe, Scotland'],
        ['0.02%', 'Sweden, Norway, Poland'],
        ['0.00%', 'Czechia, Hungary, and for novice drivers in many places'],
      ] },
      { title: 'Impairment starts below the limit', text: 'Measurable effects on reaction time and judgement appear from about 0.02%. The legal threshold is a line drawn for enforcement, not the point at which driving becomes affected.' },
    ],

    'health-one-rep-max': [
      { title: 'The formulas', text: 'Epley (w × (1 + reps/30)) and Brzycki (w × 36/(37 − reps)) are the common two. They agree closely up to about five reps and diverge sharply beyond ten, where neither is reliable.' },
      { title: 'Percentages of 1RM', rows: [
        ['100%', '1 rep'],
        ['95%', '2'],
        ['90%', '4'],
        ['85%', '6'],
        ['80%', '8'],
        ['70%', '12'],
      ] },
      { title: 'Estimate rather than test', text: 'A true one-rep max is technically demanding and carries real injury risk, especially without a spotter. Estimating from a hard set of three to five gives most of the information at a fraction of the risk — which is why most programmes prescribe it that way.' },
    ],

    // --------------------------------------------------------------- text

    'text-reverse': [
      { title: 'Reversing is harder than it looks', text: 'Reversing a string by code unit breaks emoji into unpaired surrogates and detaches combining accents from their letters. Café reversed naively can become éfaC or a mojibake, depending on how the é was encoded.' },
      { title: 'The right unit', rows: [
        ['Code units', 'Fast, and wrong for anything above U+FFFF'],
        ['Code points', 'Better; still splits combining marks'],
        ['Grapheme clusters', 'What a reader calls a character'],
        ['Intl.Segmenter', 'The correct tool, built into browsers'],
      ] },
    ],

    'lines-sort': [
      { title: 'Sorting is language-specific', text: 'Byte order puts every capital before every lower-case letter and every accent after z. Locale-aware comparison does what a dictionary does — and disagrees between languages, since ä files with a in German and after z in Swedish.' },
      { title: 'Natural sort', text: 'Text sorting puts file10 before file2, because "1" precedes "2". Natural sort compares embedded numbers numerically, which is what file managers do and what plain sort does not.' },
      { title: 'Stability', text: 'A stable sort preserves the order of equal lines, so sorting twice by different keys gives a usable secondary order. Unstable sorts throw that away, and the second pass undoes the first.' },
    ],

    'lines-dedupe': [
      { title: 'What counts as identical', text: 'Trailing whitespace, a stray \\r from a Windows file, and differing case all make otherwise identical lines distinct. Decide whether to normalise first — silently ignoring them is how "the dedupe did nothing" happens.' },
      { title: 'Order matters', rows: [
        ['Keep first', 'Preserves the original order'],
        ['Keep last', 'Keeps the most recent entry'],
        ['Sort then dedupe', 'Loses the order; what `sort -u` does'],
        ['uniq alone', 'Only removes *adjacent* duplicates'],
      ] },
    ],

    'lines-remove-empty': [
      { title: 'Empty or blank', text: 'A truly empty line has no characters; a blank one may hold spaces or tabs and looks identical. Most "this did not work" reports are whitespace-only lines that the tool was not asked to treat as empty.' },
      { title: 'Where blank lines matter', text: 'Markdown uses them to separate paragraphs, .env and config files to group entries, and a diff to keep hunks readable. Stripping every one turns readable text into a wall.' },
    ],

    'text-trim': [
      { title: 'What gets trimmed', text: 'Leading and trailing whitespace — which in Unicode is more than the space character: tabs, non-breaking spaces, zero-width spaces, line separators and a dozen others. A trim that only removes U+0020 leaves invisible characters behind.' },
      { title: 'The invisible culprits', rows: [
        ['U+00A0', 'Non-breaking space — arrives from copied web pages'],
        ['U+200B', 'Zero-width space'],
        ['U+FEFF', 'Byte order mark, at the start of a file'],
        ['U+3000', 'Ideographic space, from CJK input'],
      ] },
    ],

    'lines-number': [
      { title: 'Where numbering helps', text: 'Referring to a specific line in review, quoting a stack trace, or making a printed listing navigable. For anything to be pasted back into a file, number a copy — the numbers are not part of the content.' },
      { title: 'Choices that matter', rows: [
        ['Start at 0 or 1', 'Editors count from 1; arrays from 0'],
        ['Padding', 'Right-aligned numbers keep the text aligned'],
        ['Separator', 'A tab survives copy-paste better than spaces'],
        ['Blank lines', 'cat -b skips them; cat -n does not'],
      ] },
    ],

    'find-replace': [
      { title: 'Literal or regular expression', text: 'In a regex, . ? * + ( ) [ ] { } ^ $ | and \\ are all special. Searching for "3.50" as a regex also matches "3x50". When in doubt, escape — or use literal mode.' },
      { title: 'Replacement syntax', rows: [
        ['$1, $2', 'Captured groups'],
        ['$&', 'The whole match'],
        ['$$', 'A literal dollar sign'],
        ['\\1', 'The same thing in sed, grep and Python'],
      ] },
      { title: 'Greedy by default', text: '.* takes as much as it can, so <.*> across "<a> and <b>" matches the entire span. Add a ? — .*? — to make it stop at the first possible end. This is the single most common regex surprise.' },
      { title: 'Word boundaries', text: '\\b matches the edge between a word character and anything else, so \\bcat\\b will not match "concatenate". It is almost always what you want when replacing an identifier.' },
    ],

    'slugify': [
      { title: 'What a slug should be', text: 'Lower case, ASCII, words joined by single hyphens, no leading or trailing hyphen. Hyphens rather than underscores, because search engines have historically treated a hyphen as a word separator and an underscore as a joiner.' },
      { title: 'Transliteration', text: 'Straight accent-stripping turns é into e, which is right for French and wrong for German — ü should become ue, and ß becomes ss. There is no single correct mapping; it depends on the source language.' },
      { title: 'Keep them stable', text: 'A slug generated from a title changes when the title is edited, which breaks every existing link. Store the slug once, keep it, and redirect if it must ever change.' },
    ],

    'case-more': [
      { title: 'Case is not a simple mapping', rows: [
        ['ß → SS', 'One character becomes two'],
        ['İ / ı', 'Turkish has dotted and dotless i — locale matters'],
        ['ﬁ ligature', 'Uppercases to FI'],
        ['Chinese, Hebrew', 'No case at all'],
      ] },
      { title: 'Title case is a style choice', text: 'Chicago, AP, APA and MLA each capitalise different small words and handle hyphens differently. There is no algorithmic answer; pick a style guide and follow it.' },
      { title: 'The Turkish-i bug', text: 'Lower-casing "I" gives "ı" in a Turkish locale, so a case-insensitive comparison of "INDEX" fails there. Use a locale-invariant comparison for identifiers and protocol tokens — it is a real, shipped class of bug.' },
    ],

    'char-frequency': [
      { title: 'English letter frequency', rows: [
        ['e', '~12.7%'],
        ['t', '9.1%'],
        ['a', '8.2%'],
        ['o i n s h r', '6–7% each'],
        ['z q', 'Under 0.1%'],
      ] },
      { title: 'Why it matters', text: 'Frequency analysis breaks every simple substitution cipher — it is how al-Kindi cracked them in the ninth century, and why Morse gave e the shortest code and Scrabble gives it one point.' },
      { title: 'It is language-dependent', text: 'The most common letter is e in English, French and German, a in Spanish and Portuguese. Frequency profiles are themselves a reliable way to identify which language a text is in.' },
    ],

    'word-frequency': [
      { title: "Zipf's law", text: 'Word frequency is inversely proportional to rank: the second most common word appears about half as often as the first, the third a third as often. It holds startlingly well across every natural language, and nobody fully agrees why.' },
      { title: 'Stop words', text: 'The, of, and, to and a make up roughly a quarter of English text and carry almost no topical information. Removing them is the first step in most text analysis — and it destroys phrase meaning, so it is wrong for search on exact quotes.' },
      { title: 'Counting decisions', rows: [
        ['Case', 'Is "The" the same word as "the"?'],
        ['Punctuation', "don't — one word or two?"],
        ['Stemming', 'Do run, runs and running count together?'],
        ['Hyphenation', 'well-known: one token or two?'],
      ] },
    ],

    'vowel-count': [
      { title: 'Y is the awkward one', text: 'Y is a vowel in rhythm and myth and a consonant in yes. Any count has to pick a rule and state it — which is why two tools give different answers for the same text.' },
      { title: 'Beyond English', text: 'W is a vowel in Welsh (cwm), and vowel length and diacritics change the count in most languages. Counting letters is not the same as counting vowel sounds — English has around 20 vowel sounds and five vowel letters.' },
    ],

    'text-binary': [
      { title: 'Text has no binary, encodings do', text: 'A character becomes bits only through an encoding. "A" is 01000001 in ASCII and UTF-8, and 00000000 01000001 in UTF-16 — so any text-to-binary conversion has to say which it used.' },
      { title: 'Grouping', rows: [
        ['8 bits', 'One byte — the usual grouping'],
        ['Spaces', 'Between bytes, for readability only'],
        ['UTF-8 multibyte', 'Non-ASCII becomes 2–4 bytes'],
        ['Endianness', 'Matters for UTF-16 and UTF-32, not UTF-8'],
      ] },
    ],

    'text-hex': [
      { title: 'Two digits per byte', text: 'Hex is the standard way to show bytes because one digit is exactly four bits. It is what a hex editor, a network capture and a hash output all display, and it is unambiguous in a way that "the characters" is not.' },
      { title: 'Bytes to recognise', rows: [
        ['20', 'Space'],
        ['0A / 0D', 'LF / CR'],
        ['EF BB BF', 'A UTF-8 BOM at the start of a file'],
        ['FF D8 FF', 'A JPEG'],
        ['89 50 4E 47', 'A PNG'],
        ['50 4B 03 04', 'A zip — including .docx and .jar'],
      ] },
    ],

    'rot13': [
      { title: 'Its own inverse', text: 'Thirteen is half of twenty-six, so applying ROT13 twice returns the original. That symmetry is the entire appeal — one function encodes and decodes.' },
      { title: 'Not encryption', text: 'It was never meant to be. On Usenet it hid punchlines and spoilers from casual reading, which is exactly as much security as it provides — the key is public and there is only one.' },
      { title: 'A curiosity', text: 'ROT13 of "n" is "a", and a handful of words map to other words: "ebg" is "rot", and "purely" becomes "cheryl". ROT47 extends the idea across printable ASCII, and is equally not encryption.' },
    ],

    'caesar-cipher': [
      { title: 'Shift by a fixed amount', text: 'Suetonius records Julius Caesar using a shift of three for military correspondence. With 25 possible keys it is breakable by trying all of them — brute force takes seconds by hand.' },
      { title: 'How it breaks', rows: [
        ['Brute force', '25 keys; read the one that makes sense'],
        ['Frequency', 'The most common letter is probably e'],
        ['Pattern words', 'A single letter is likely a or I'],
        ['Doubles', 'll, ss, ee are common; qq is not'],
      ] },
      { title: 'The honest descendant', text: 'A Caesar shift with a different key per letter is the Vigenère cipher, and extending that to a truly random key as long as the message is the one-time pad — the only cipher with a proof of perfect secrecy.' },
    ],

    'morse': [
      { title: 'Frequency-weighted by design', text: 'Samuel Morse counted the letters in a printer\'s type case, so the commonest get the shortest codes: e is one dot, t one dash. It is a hand-built prefix code, a century before Huffman formalised the idea.' },
      { title: 'The timing is the code', rows: [
        ['Dot', 'One unit'],
        ['Dash', 'Three units'],
        ['Between symbols', 'One unit'],
        ['Between letters', 'Three units'],
        ['Between words', 'Seven units'],
      ] },
      { title: 'SOS', text: '···---··· was chosen because it is unmistakable, not as an abbreviation — "save our souls" was invented afterwards. It is sent as one continuous symbol with no letter gaps.' },
    ],

    'nato-phonetic': [
      { title: 'Chosen to be unmistakable', text: 'The 1956 NATO alphabet was tested across English, French and Spanish speakers over bad radio links. Words were picked for distinctness under noise, not for being obvious — which is why it is Quebec and not Queen.' },
      { title: 'The odd spellings', text: 'Alfa and Juliett are deliberate: "Alpha" invites a silent ph in several languages, and "Juliet" would be read with a silent t by French speakers. The spellings are official and often corrected wrongly.' },
      { title: 'Numbers too', text: 'Nine is spoken "niner" to distinguish it from the German nein, three as "tree" and four as "fower". Aviation still uses all of them.' },
    ],

    'html-entities': [
      { title: 'What must be escaped', rows: [
        ['&', '&amp; — always first, or you double-encode'],
        ['<', '&lt;'],
        ['>', '&gt;'],
        ['"', '&quot; — inside attribute values'],
        ["'", '&#39; — &apos; is not in HTML 4'],
      ] },
      { title: 'Escaping is context-specific', text: 'HTML escaping does not protect a value placed inside a <script> block, a URL, or a CSS rule — each needs its own encoding. Applying the wrong one is a working XSS vector that looks escaped.' },
      { title: 'Prefer textContent', text: 'Setting element.textContent escapes everything automatically and correctly. Hand-escaping is only for when you must produce a string of HTML — and even then, a template library does it better.' },
    ],

    'strip-html': [
      { title: 'Not a security measure', text: 'Removing tags with a regular expression is defeated by malformed markup, nested constructs and encoded characters. Sanitising untrusted HTML requires a real parser with an allow-list — DOMPurify, not a replace.' },
      { title: 'What to do with the text', text: 'Block elements should become line breaks, not disappear — otherwise paragraphs run together into one sentence. And &amp; entities in the remaining text still need decoding afterwards.' },
    ],

    'remove-accents': [
      { title: 'How it works', text: 'Normalise to NFD, which splits é into e plus a combining acute, then drop everything in the combining-marks range. It is three lines of Unicode-aware code and handles most Latin scripts correctly.' },
      { title: 'What it cannot do', rows: [
        ['ß, ø, đ, ł', 'Not decomposable — they need a lookup table'],
        ['German', 'ü should become ue, not u'],
        ['Turkish ı', 'Not an i with something removed'],
        ['Greek, Cyrillic', 'Needs transliteration, not stripping'],
      ] },
      { title: 'Useful for matching', text: 'Stripping accents makes search forgiving — typing "cafe" should find "café". Store the original and match against a folded copy; never overwrite the real text with the folded one.' },
    ],

    'text-wrap': [
      { title: 'Line length and readability', text: 'Studies converge on 45–75 characters per line for comfortable reading, with 66 a frequently cited ideal. Longer lines make the eye lose its place on the return sweep; much shorter ones break the rhythm.' },
      { title: 'The conventions', rows: [
        ['72 characters', 'Email and commit message bodies'],
        ['79 / 80', 'Python, and the historic terminal'],
        ['100 – 120', 'Modern code style guides'],
        ['65ch', 'The CSS way to say the same thing'],
      ] },
      { title: 'Hard or soft', text: 'Hard wrapping inserts real newlines, which fixes the layout and ruins it on a narrow screen. Soft wrapping leaves the text as one paragraph and lets the viewer decide — better for anything that will be re-flowed.' },
    ],

    'text-unwrap': [
      { title: 'Joining safely', text: 'Paragraphs are separated by blank lines, so unwrap within a paragraph and preserve the blanks between them. Joining everything turns a document into a single line and loses its structure permanently.' },
      { title: 'Watch for', rows: [
        ['Hyphenated breaks', 'A word split across lines needs the hyphen removed'],
        ['Lists', 'Bullets and numbers must stay on their own lines'],
        ['Code blocks', 'Newlines are significant; never join'],
        ['Double spaces', 'Joining can leave them mid-sentence'],
      ] },
    ],

    'lines-join': [
      { title: 'Choosing a separator', text: 'A comma is the obvious choice and the wrong one whenever the items themselves contain commas. Pipes, tabs and semicolons collide less often — and for anything that must round-trip, use real CSV quoting.' },
      { title: 'Trailing separators', text: 'A trailing comma is valid in modern JavaScript arrays and objects and invalid in JSON. It is also the difference between a clean diff and one that touches the previous line every time an item is added.' },
    ],

    'text-split': [
      { title: 'Splitting on what', rows: [
        ['A fixed string', 'Simple, and blind to quoting'],
        ['A regex', 'Handles runs of whitespace: /\\s+/'],
        ['Fixed width', 'Legacy mainframe formats'],
        ['A real parser', 'The only correct option for CSV or JSON'],
      ] },
      { title: 'Empty results', text: 'Splitting "a,,b" gives three parts, the middle one empty — which is usually correct and occasionally not. Splitting an empty string gives one empty element, not zero, in most languages.' },
    ],

    'extract-emails': [
      { title: 'Extraction is not validation', text: 'A pattern that finds plausible addresses in prose will also catch version numbers, file paths and Twitter handles. Review the output; the pattern cannot know what was meant.' },
      { title: 'What text does to addresses', rows: [
        ['Trailing punctuation', 'A full stop after the address gets captured'],
        ['Obfuscation', '"name at example dot com" will not match'],
        ['Line wrapping', 'An address split across lines is lost'],
        ['Plus tags', 'name+tag@ is valid and often wrongly excluded'],
      ] },
      { title: 'Scraping has rules', text: 'Collecting addresses from pages is regulated under GDPR, CAN-SPAM and PECR. Extracting from a document you own is fine; harvesting for unsolicited mail is not, regardless of how the addresses were found.' },
    ],

    'extract-urls': [
      { title: 'Where URLs end is ambiguous', text: 'Punctuation is legal inside a URL, so "see https://example.com/a." could end with or without the stop. Every extractor guesses, and the usual rule — strip trailing . , ) ; : — is a heuristic, not a rule.' },
      { title: 'Forms to expect', rows: [
        ['https://…', 'The easy case'],
        ['www.example.com', 'No scheme; needs one added'],
        ['example.com/path', 'Indistinguishable from prose'],
        ['<https://…>', 'Angle brackets — the RFC 3986 recommendation'],
        ['Markdown links', 'The URL is inside the parentheses'],
      ] },
      { title: 'Check before following', text: 'A URL extracted from untrusted text may point anywhere, and the visible text of a link says nothing about its target. Look at the host, and watch for punycode lookalikes.' },
    ],

    'extract-numbers': [
      { title: 'What counts as a number', text: 'Decimals, negatives, thousands separators, scientific notation, percentages and currency all complicate the pattern. "1,234" is one number in English and two in German — the separator conventions are reversed.' },
      { title: 'Traps', rows: [
        ['Phone numbers', 'Extracted as several numbers'],
        ['Dates', '2026-09-13 becomes three'],
        ['Versions', '1.2.3 is not a decimal'],
        ['Ranges', '5-10 may read as negative ten'],
      ] },
    ],

    'text-diff': [
      { title: 'How diffs are computed', text: 'Most diffs find the longest common subsequence and report what is left. It is optimal in the sense of the fewest changes, which is not always the most readable — a moved paragraph shows as a deletion and an addition.' },
      { title: 'Granularity', rows: [
        ['Line', 'What git shows; good for code'],
        ['Word', 'Better for prose'],
        ['Character', 'Precise, and noisy'],
        ['Semantic', 'Ignores reformatting — needs a parser'],
      ] },
      { title: 'Whitespace noise', text: 'A change in indentation or line endings marks every line as modified. Ignoring whitespace makes the real change visible — which is why `git diff -w` exists, and why reformatting belongs in its own commit.' },
    ],

    'table-transpose': [
      { title: 'Rows become columns', text: 'Transposing swaps the two axes, so a table of months across the top becomes months down the side. It is the fastest way to make a wide table readable, and the fastest way to break a formula that referenced a column.' },
      { title: 'What breaks', rows: [
        ['Headers', 'The first row becomes the first column'],
        ['Ragged rows', 'Missing cells become gaps'],
        ['Types', 'A column of one type becomes a row of mixed ones'],
        ['Formulas', 'Relative references no longer point anywhere sensible'],
      ] },
    ],

    'csv-to-list': [
      { title: 'Pulling one column out', text: 'Useful for turning a spreadsheet column into a list for a query, an allow-list or a form. Check the header offset — off-by-one here silently produces the wrong column, and the output looks perfectly plausible.' },
      { title: 'Quoted fields', text: 'A field containing a comma is quoted, so splitting on commas produces garbage for exactly the rows that matter. Anything beyond simple data needs a real CSV parse.' },
    ],

    'list-to-csv': [
      { title: 'Quote what needs it', text: 'Any value containing a comma, a quote or a newline must be wrapped in quotes, with internal quotes doubled. Producing CSV without this rule creates files that open wrongly in every spreadsheet.' },
      { title: 'Before sending it anywhere', text: 'Prefix any cell beginning with =, +, - or @ so a spreadsheet does not execute it as a formula. It is the standard CSV injection defence and it costs one character.' },
    ],

    'whitespace-show': [
      { title: 'Why you would want to', text: 'Trailing spaces, mixed tabs and spaces, and non-breaking spaces are all invisible and all cause real failures — a Python indentation error, a YAML parse failure, a string comparison that will not match.' },
      { title: 'The usual suspects', rows: [
        ['Trailing space', 'Breaks Markdown line endings and lint rules'],
        ['Tab among spaces', 'An error in Python 3'],
        ['U+00A0', 'Copied from a web page; not a space to most parsers'],
        ['CRLF', 'Shows as an extra character at line end'],
      ] },
    ],

    'emoji-remove': [
      { title: 'Emoji are not one code point', text: 'A single visible emoji can be a base character, a skin-tone modifier, a variation selector and zero-width joiners — the family emoji is seven code points. Removing "the emoji character" leaves the rest behind.' },
      { title: 'Where removal matters', rows: [
        ['Filenames', 'Rejected by some filesystems and tools'],
        ['Identifiers', 'Slugs, usernames, database keys'],
        ['Legacy systems', 'Anything on MySQL utf8 rather than utf8mb4'],
        ['Speech output', 'Screen readers announce every one by name'],
      ] },
    ],

    'text-pad': [
      { title: 'Aligning columns', text: 'Padding to a fixed width lines text up in a monospaced font, which is how fixed-width data formats and terminal tables work. In a proportional font it does nothing — the characters are different widths.' },
      { title: 'Width is not character count', text: 'CJK characters occupy two terminal cells, and combining marks occupy none. Padding by counting characters misaligns any table containing them, which is why terminal libraries measure display width instead.' },
    ],

    'text-truncate': [
      { title: 'Truncate at a boundary', text: 'Cutting at a fixed character count can split a word, a surrogate pair, or an emoji — producing a broken character. Cut at a word boundary, and count grapheme clusters rather than code units.' },
      { title: 'The ellipsis', rows: [
        ['…', 'One character, U+2026 — preferred'],
        ['...', 'Three periods; wider, and breaks across lines'],
        ['Counting', 'Does the ellipsis count toward the limit?'],
        ['CSS', 'text-overflow: ellipsis does it without touching the data'],
      ] },
    ],

    'upside-down': [
      { title: 'Not a transformation', text: 'There is no "upside-down" property in Unicode. The effect is a lookup table of characters that happen to resemble inverted letters — ɐ for a, ǝ for e — most of them from the IPA and from other alphabets entirely.' },
      { title: 'The consequences', text: 'Screen readers announce the actual characters, which is gibberish. Search will not find the text, and some systems reject it outright. Fine for a message; never for anything anyone needs to read or find.' },
    ],

    'fancy-letters': [
      { title: 'Mathematical alphanumerics', text: 'The bold, italic and script letters are Unicode\'s mathematical symbols — 𝐀 is MATHEMATICAL BOLD CAPITAL A, a different character from A. They exist so equations keep their meaning in plain text.' },
      { title: 'Why not to use them in a profile', rows: [
        ['Screen readers', 'Read them as symbol names, or skip them'],
        ['Search', 'Your name becomes unfindable'],
        ['Sorting', 'Files under symbols, not letters'],
        ['Copy-paste', 'Breaks in systems that expect ASCII'],
      ] },
      { title: 'Use real styling', text: 'Where formatting is supported, bold is a formatting instruction the whole stack understands. Fancy letters are a workaround that shifts the cost onto anyone using assistive technology.' },
    ],

    'lines-affix': [
      { title: 'Everyday uses', text: 'Turning a list into quoted SQL values, adding Markdown bullets, commenting out a block, or prefixing a batch of file paths. It is the quickest path from a copied column to a usable snippet.' },
      { title: 'Watch the last line', text: 'A suffix applied to every line leaves a trailing separator on the last one — valid in some formats, a syntax error in others. Check before pasting into JSON.' },
    ],

    'lines-filter': [
      { title: 'Keeping or removing', text: 'Filtering by a substring is the text equivalent of grep. Inverting it (grep -v) is often the more useful direction: removing the noise leaves the signal, and the noise is usually easier to describe.' },
      { title: 'Patterns worth knowing', rows: [
        ['^text', 'Lines starting with'],
        ['text$', 'Lines ending with'],
        ['^$', 'Empty lines'],
        ['^\\s*#', 'Comments'],
        ['a|b', 'Either'],
      ] },
    ],

    'text-repeat': [
      { title: 'What it is for', text: 'Test fixtures, separator rules, padding, and checking how a layout behaves with long content. Repeating to a byte length is the quickest way to build an input that probes a limit.' },
      { title: 'Size grows fast', text: 'A 1 KB string repeated ten thousand times is 10 MB, which will lock a browser tab if it is then rendered. Generate large test data in a file, not in a text box.' },
    ],

    'string-escape': [
      { title: 'The escape depends on the target', rows: [
        ['JSON', '\\" \\\\ \\n \\uXXXX'],
        ['JavaScript', 'Also \\\' and template backticks'],
        ['SQL', 'Double the single quotes'],
        ['Shell', 'Single quotes stop everything except a single quote'],
        ['Regex', 'Escape . * + ? ( ) [ ] { } ^ $ | \\'],
        ['CSV', 'Double the quotes, wrap the field'],
      ] },
      { title: 'Escape once, in the right place', text: 'Double-escaping is as broken as not escaping — \\\\n in a value that should be a newline. Escape at the boundary where the string enters the other language, never earlier "just in case".' },
      { title: 'Escaping is not sanitising', text: 'Correct escaping makes data safe for one context. It does not make the content trustworthy, and it does not help if the value is then moved into a different context.' },
    ],

    'unicode-info': [
      { title: 'What to look at', text: 'The code point identifies the character; the category says what kind it is; the name is often the fastest way to tell two lookalikes apart. U+0041 LATIN CAPITAL A and U+0410 CYRILLIC CAPITAL A render identically.' },
      { title: 'Categories', rows: [
        ['Lu / Ll', 'Upper- and lower-case letters'],
        ['Nd', 'Decimal digits — including non-ASCII ones'],
        ['Mn', 'Non-spacing marks: combining accents'],
        ['Cf', 'Format characters — invisible, and significant'],
        ['Zs', 'Space separators, of which there are many'],
      ] },
      { title: 'Normalisation forms', text: 'NFC composes (é as one code point), NFD decomposes (e + accent). Two visually identical strings in different forms compare unequal — normalise before storing or comparing, and pick NFC unless you have a reason not to.' },
    ],

    'quotes-smart': [
      { title: 'Typographic or straight', text: 'Curly quotes (“ ” ‘ ’) are correct in prose; the straight ones are required in code. An editor that "helpfully" curls a quote inside a code block produces a syntax error that is invisible on screen.' },
      { title: 'The apostrophe', text: 'A right single quotation mark (U+2019) is the correct apostrophe in typeset text — don’t, not don\'t. It is also why a search for "dont" fails and why copied text breaks string comparisons.' },
      { title: 'Other languages', rows: [
        ['German', '„so“'],
        ['French', '« so » with spaces'],
        ['Japanese', '「so」'],
        ['Polish', '„so”'],
      ] },
    ],

    'pig-latin': [
      { title: 'The rules', text: 'Move the initial consonant cluster to the end and add "ay"; a word beginning with a vowel just takes "way" or "yay". "Scram" becomes "amscray" — the whole cluster moves, not one letter.' },
      { title: 'A language game, not a language', text: 'It is one of many: French verlan, Swedish rövarspråket, and dozens more. They share a purpose — obscuring speech from listeners — and none has anything to do with Latin.' },
    ],

    'palindrome-check': [
      { title: 'What to ignore', text: 'Almost every famous palindrome needs case, spaces and punctuation removed: "A man, a plan, a canal: Panama". Whether to ignore accents is a further choice, and languages differ on it.' },
      { title: 'Kinds', rows: [
        ['Character', 'Reads the same backwards'],
        ['Word-level', '"You can cage a swallow, can\'t you?"'],
        ['Numeric', '12321, and every palindromic year'],
        ['Semordnilap', 'Reverses into a different word: stressed / desserts'],
      ] },
    ],

    'anagram-check': [
      { title: 'How it is tested', text: 'Normalise case and drop non-letters, then compare sorted characters — or compare letter counts, which is linear rather than n log n. Both answer the same question.' },
      { title: 'Beyond letters', text: 'Unicode makes it harder: é and e+accent have the same appearance and different characters, so normalise first. And a "letter" in one language may be two characters in another.' },
    ],

    // -------------------------------------------------------------- write

    'readability': [
      { title: 'What the scores measure', text: 'Sentence length and syllable count — nothing else. They cannot tell whether the vocabulary is familiar, whether the argument is clear, or whether the text is any good. A sentence of short unfamiliar words scores well and communicates nothing.' },
      { title: 'The scales', rows: [
        ['Flesch Reading Ease', '0–100; higher is easier. 60–70 is plain English'],
        ['Flesch-Kincaid Grade', 'A US school grade level'],
        ['Gunning Fog', 'Years of education needed'],
        ['SMOG', 'Widely used for health materials'],
      ] },
      { title: 'Sensible targets', text: 'General public: grade 8–9. Technical documentation: 10–12. Legal and insurance documents routinely land at 15+, which is why plain-language legislation exists in several countries.' },
      { title: 'Gaming it', text: 'Splitting every sentence in two improves the score without improving the writing. Use the number to find the paragraph that needs attention, then fix it by rewriting rather than by chopping.' },
    ],

    'speech-time': [
      { title: 'Words per minute', rows: [
        ['Presentation', '120 – 150'],
        ['Conversation', '150 – 160'],
        ['Reading aloud', '~150'],
        ['Podcast', '150 – 170'],
        ['Slow, for clarity', '100 – 120'],
      ] },
      { title: 'What the count omits', text: 'Pauses, slide transitions, demonstrations, laughter and questions. A realistic estimate adds 20–25% to the raw word count — which is why a talk rehearsed to exactly fill its slot always overruns.' },
      { title: 'Slides are not the unit', text: 'The "one slide per minute" rule is folklore; some slides take fifteen seconds and some take five minutes. Time the script, not the deck.' },
    ],

    'text-stats': [
      { title: 'Counting is not standardised', text: 'Word processors, browsers and command-line tools all disagree: hyphenated words, contractions, numbers and em-dashes are each counted differently. A "1000 word" limit means whatever the checker at the other end says.' },
      { title: 'Useful yardsticks', rows: [
        ['Sentence', '15 – 20 words average'],
        ['Paragraph', '3 – 5 sentences'],
        ['A4 page', '~500 words, double-spaced ~250'],
        ['Blog post', '600 – 2000'],
        ['Novel', '70 000 – 100 000'],
      ] },
      { title: 'Variation is the real signal', text: 'Uniform sentence length reads as monotonous regardless of what that length is. Mixing short and long sentences is what makes prose feel alive — a statistic that no readability score captures.' },
    ],

    'filler-words': [
      { title: 'In writing, mostly delete', text: 'Very, really, just, actually, basically, quite, literally. They dilute the sentence and almost never survive a good edit — "very important" is weaker than "critical".' },
      { title: 'Hedges have a purpose', text: 'Perhaps, might, seems and arguably are not always filler: in technical and scientific writing they state a genuine degree of confidence. Deleting them makes claims stronger than the evidence supports.' },
      { title: 'In speech they are normal', text: 'Um and uh are universal across languages and appear at points of planning difficulty. Listeners barely notice them and they slightly aid comprehension. Eliminating them entirely makes a speaker sound recorded.' },
    ],

    'acronym': [
      { title: 'Acronym or initialism', text: 'An acronym is pronounced as a word — NASA, laser, scuba. An initialism is spelled out — FBI, HTML. Both are abbreviations; only one is strictly an acronym, though usage has largely merged them.' },
      { title: 'Expand on first use', text: 'Write the full term followed by the abbreviation in parentheses, then use the short form. A document that assumes familiarity excludes exactly the readers who most needed it.' },
      { title: 'Backronyms', text: 'Some expansions were invented after the fact: "golf" is not an acronym, "SOS" stands for nothing, and Wi-Fi was a brand name chosen to sound like hi-fi — "Wireless Fidelity" was retrofitted and later abandoned.' },
    ],

    'bullet-list': [
      { title: 'Parallel structure', text: 'Every bullet should start the same grammatical way — all verbs, or all nouns, or all full sentences. Mixed structures are the most common reason a list reads as sloppy, and the easiest thing to fix.' },
      { title: 'Punctuation', rows: [
        ['Full sentences', 'Capital letter, full stop'],
        ['Fragments', 'Lower case, no terminal punctuation'],
        ['Never', 'Semicolons at the end of each, "and" before the last'],
        ['Consistency', 'Matters more than which rule you pick'],
      ] },
      { title: 'When not to use one', text: 'Bullets remove the connections between ideas — the because, therefore and however. For an argument, prose carries reasoning that a list cannot. Bullets are for genuinely parallel items.' },
    ],

    'markdown-table': [
      { title: 'The syntax', text: 'Pipes separate cells, and the second row sets the alignment: :--- left, :---: centre, ---: right. Outer pipes are optional in most parsers and improve readability.' },
      { title: 'The limitations', rows: [
        ['No merged cells', 'Requires HTML'],
        ['No multi-line cells', 'Use <br> or a list'],
        ['No nested tables', 'Not in any common flavour'],
        ['Not in core Markdown', 'Tables are a GFM extension'],
      ] },
      { title: 'Alignment is cosmetic', text: 'Padding the source so columns line up makes the raw file readable and changes nothing in the output. Worth doing for anything that will be edited by hand in a diff.' },
    ],

    'hashtags': [
      { title: 'How many', rows: [
        ['Instagram', '3 – 5 targeted beats 30 generic'],
        ['X / Twitter', '1 – 2; more reduces engagement'],
        ['LinkedIn', '3 – 5'],
        ['TikTok', '3 – 5, mixing broad and specific'],
      ] },
      { title: 'Camel case them', text: '#ThisIsReadable is announced correctly by screen readers, which read capitalisation as word boundaries; #thisisreadable is read as one nonsense word. It is also easier for sighted readers, and costs nothing.' },
      { title: 'Check before posting', text: 'A hashtag can already belong to something unrelated or unwelcome, and run-together words have produced some famous accidents. Search it first — every platform makes that a five-second check.' },
    ],

    // ------------------------------------------------------------ general

    'everyday-gpa': [
      { title: 'The 4.0 scale', text: 'A is 4, B is 3, C is 2, D is 1, F is 0, and the GPA is the credit-weighted average. Weighting by credit hours is the part people omit — a 4-credit course counts twice as much as a 2-credit one.' },
      { title: 'Variations', rows: [
        ['Plus/minus', 'A− = 3.7, B+ = 3.3 in most schemes'],
        ['Weighted', 'AP and IB courses on a 5.0 scale'],
        ['A+', '4.0 at some institutions, 4.3 at others'],
        ['Pass/fail', 'Usually excluded from the average entirely'],
      ] },
      { title: 'Not internationally comparable', text: 'UK degree classifications, the ECTS grade scale and the Indian percentage system do not convert to a GPA by any agreed formula. Institutions publish their own conversion tables, and they disagree.' },
    ],

    'everyday-final-grade': [
      { title: 'Weighted arithmetic', text: 'Needed = (target − current × (1 − weight)) ÷ weight. If the final is worth 30% and you need 70% overall with 65% so far, the final must be about 81.7%.' },
      { title: 'The ceiling', text: 'When the required score exceeds 100%, the target is unreachable — which is worth knowing early enough to talk to the lecturer rather than late enough to be a surprise.' },
      { title: 'Check the rules', text: 'Dropped lowest scores, curves, extra credit, and minimum exam thresholds all change the arithmetic. Some courses require a passing final regardless of the accumulated average.' },
    ],

    'everyday-grade-percent': [
      { title: 'Cutoffs vary', rows: [
        ['US typical', 'A 90+, B 80+, C 70+, D 60+'],
        ['UK degree', '1st 70+, 2:1 60+, 2:2 50+, 3rd 40+'],
        ['Pass mark', '40% in the UK, 60% in much of the US'],
        ['Curved', 'The percentage alone means nothing'],
      ] },
      { title: 'A UK 70 is not a C', text: 'British marking rarely awards above 80, so 70% is a first-class result. Converting UK marks to US letter grades by the raw number systematically misrepresents them — in both directions.' },
    ],

    'everyday-recipe-scale': [
      { title: 'Not everything scales', text: 'Ingredients scale linearly; cooking times, pan sizes and leavening do not. Doubling a cake recipe into the same tin gives a raw middle and a burnt edge — the depth changed, so the heat transfer did.' },
      { title: 'What to adjust by hand', rows: [
        ['Baking time', 'Longer, but far from double'],
        ['Salt and spices', 'Scale to about 75% and taste'],
        ['Leavening', 'Slightly less than proportional at large multiples'],
        ['Alcohol, extracts', 'Do not scale linearly in flavour'],
        ['Pan area', 'Scale the area, not the diameter'],
      ] },
      { title: 'Weigh, do not measure', text: 'Scaling by volume compounds the error in every cup of flour. Converting the recipe to grams once makes every future scaling exact — and the results repeatable.' },
    ],

    'everyday-paint': [
      { title: 'Coverage', text: 'One litre covers roughly 10–12 m² per coat on a smooth surface. Textured walls, bare plaster and a dark-to-light change all use considerably more — and two coats is the norm, not the exception.' },
      { title: 'What to measure', rows: [
        ['Walls', 'Perimeter × height'],
        ['Doors and windows', 'Subtract only if they are large'],
        ['Ceiling', 'Length × width'],
        ['Primer', 'On new plaster or a big colour change'],
        ['Waste', 'Add 10%'],
      ] },
      { title: 'Buy the same batch', text: 'Paint colour varies slightly between production batches, and the difference is visible on a large wall. Buy all of it at once, and mix the tins together if the wall needs more than one.' },
    ],

    'everyday-flooring': [
      { title: 'Always add waste', rows: [
        ['Straight lay', '5 – 10%'],
        ['Diagonal', '15%'],
        ['Herringbone', '15 – 20%'],
        ['Patterned, matching', '20%+'],
        ['Awkward rooms', 'More again'],
      ] },
      { title: 'Order it together', text: 'Like paint, tiles and boards vary between batches. Buy the whole job at once with the waste included — running out means either a visible mismatch or ripping up what is laid.' },
      { title: 'Keep the offcuts', text: 'A box of spare tiles or boards is the difference between replacing one damaged piece and re-floorng the room. Store them flat and dry; discontinued lines are discontinued quickly.' },
    ],

    'everyday-split-expenses': [
      { title: 'Equal or proportional', text: 'Splitting equally is simple and unfair when incomes differ greatly; splitting in proportion to income is fairer and requires disclosure. Neither is right in general — but agreeing which, in advance, prevents most arguments.' },
      { title: 'Settling up', text: 'With several people, a naive settlement has everyone paying everyone. Netting the balances first reduces it to at most n−1 transfers — which is what every expense-splitting app is really doing.' },
      { title: 'Record as you go', text: 'Reconstructing a shared holiday from memory is where disputes come from. A running list, updated the same day, costs nothing and settles everything.' },
    ],

    'number-words': [
      { title: 'Where it is needed', text: 'Cheques, contracts and legal documents spell amounts out because digits can be altered and a written word cannot be — "one thousand" is much harder to change than "1,000".' },
      { title: 'Conventions differ', rows: [
        ['UK', 'One hundred and one'],
        ['US', 'One hundred one — no "and"'],
        ['Hyphens', 'Twenty-one through ninety-nine'],
        ['Billion', '10⁹ everywhere now; historically 10¹² in the UK'],
        ['Indian', 'Lakh (10⁵) and crore (10⁷)'],
      ] },
      { title: 'Style rules', text: 'Most style guides spell out numbers under ten (or under a hundred), and always spell out a number that begins a sentence. Consistency within a document matters more than which guide.' },
    ],

    'ordinal': [
      { title: 'The English rule', text: 'th for everything, except 1st, 2nd and 3rd — and not for 11th, 12th and 13th, which are th despite ending in 1, 2 and 3. That exception is what naive code gets wrong.' },
      { title: 'The algorithm', text: 'If the last two digits are 11–13, use th. Otherwise switch on the last digit: 1 → st, 2 → nd, 3 → rd, anything else → th. So 111th, 112th, 113th, but 121st.' },
      { title: 'Other languages', text: 'French uses 1er/1re and e for the rest; German appends a full stop (1.); Spanish uses º and ª with gender. Ordinal formatting is locale data, not string manipulation — Intl.PluralRules handles it.' },
    ],

    'roman-numerals': [
      { title: 'The symbols', rows: [
        ['I', '1'],
        ['V', '5'],
        ['X', '10'],
        ['L', '50'],
        ['C', '100'],
        ['D', '500'],
        ['M', '1000'],
      ] },
      { title: 'Subtractive notation', text: 'Only I before V and X, X before L and C, C before D and M. So 4 is IV and 9 is IX; IL and IC are not valid, and 99 is XCIX rather than IC.' },
      { title: 'What the system cannot do', text: 'There is no zero, no negative numbers and no standard way to write fractions or anything above a few thousand. Arithmetic is possible but painful, which is why the positional system displaced it entirely.' },
      { title: 'Where they survive', text: 'Clock faces (often with IIII rather than IV), book prefaces, monarch names, film sequels and copyright dates. Four on a clock is a genuine and unresolved typographic tradition, not an error.' },
    ],

    'password-strength': [
      { title: 'Length beats complexity', text: 'Each extra character multiplies the search space; adding a symbol to a short password barely helps. A four-word passphrase outlasts a mangled eight-character password by orders of magnitude, and is easier to remember.' },
      { title: 'Entropy in bits', rows: [
        ['< 40 bits', 'Broken quickly'],
        ['60 bits', 'Resists most offline attacks'],
        ['80 bits', 'Strong'],
        ['128 bits', 'Beyond any feasible brute force'],
      ] },
      { title: 'What entropy assumes', text: 'The figure assumes random generation. A password you chose yourself has far less real entropy than its character set suggests — "P@ssw0rd!" scores well on naive meters and appears in every cracking dictionary.' },
      { title: 'The modern guidance', text: 'NIST now recommends long passphrases, screening against breach lists, and no forced periodic rotation — rotation was found to produce predictable, weaker passwords. Unique passwords in a manager, plus two-factor, matters far more than composition rules.' },
    ],

    // ----------------------------------------------------------- generate

    'lorem-ipsum': [
      { title: 'It is real Latin, sort of', text: 'The text is corrupted from Cicero\'s De finibus bonorum et malorum, written in 45 BC. "Lorem" is the tail of "dolorem". It has been used by typesetters since at least the 1500s.' },
      { title: 'Why nonsense text', text: 'Readable placeholder text pulls attention to the content rather than the design, and real content that is not final gets published by accident. Latin-like text also has roughly Western letter distribution, so line breaks fall naturally.' },
      { title: 'When not to use it', text: 'Layouts designed against lorem ipsum break on real content — real headlines are longer, real names are shorter, real text has links and numbers. Test with the worst real content you expect, not with the prettiest fake.' },
    ],

    'random-number': [
      { title: 'Pseudo-random', text: 'Math.random and its equivalents are deterministic algorithms seeded from the system. They are fine for shuffling a playlist or picking a colour and unfit for anything security-related.' },
      { title: 'When it must be unpredictable', rows: [
        ['Tokens, keys, salts', 'crypto.getRandomValues'],
        ['Node', 'crypto.randomBytes'],
        ['Python', 'secrets, not random'],
        ['Never', 'Math.random for a password or session id'],
      ] },
      { title: 'Modulo bias', text: 'Taking a random byte mod 10 makes 0–5 slightly more likely than 6–9, because 256 is not a multiple of 10. Rejection sampling — discard and redraw when outside a clean range — removes the bias.' },
    ],

    'dice-roll': [
      { title: 'Sums are not uniform', text: 'Two six-sided dice give 7 six times as often as 2, because there are six ways to make 7 and one to make 2. Multiple dice always produce a bell-shaped distribution — which is exactly why games use them.' },
      { title: 'Notation', rows: [
        ['3d6', 'Three six-sided dice, summed'],
        ['d20+5', 'One twenty-sided die plus a modifier'],
        ['4d6 drop lowest', 'The classic ability-score roll'],
        ['2d10', 'A curve; d100 is flat'],
      ] },
      { title: 'The gambler\'s fallacy', text: 'Dice have no memory. After five sixes, the next roll is still one in six — the sequence is unlikely, the next roll is not. Any system that claims otherwise is selling something.' },
    ],

    'coin-flip': [
      { title: 'Not quite fair', text: 'A physically flipped coin lands on the face it started on about 51% of the time — a large 2023 study of 350 000 flips confirmed the prediction. Spinning a coin on a table is considerably more biased than that.' },
      { title: 'Making a biased coin fair', text: 'Von Neumann\'s trick: flip twice, take HT as heads and TH as tails, discard HH and TT. The result is exactly fair for any fixed bias — at the cost of some discarded flips.' },
      { title: 'Streaks are normal', text: 'In 100 flips, a run of six or seven identical results is more likely than not. People asked to fake a random sequence produce far fewer streaks than chance does, which is how faked data is detected.' },
    ],

    'random-pick': [
      { title: 'Picking fairly', text: 'Every item must have the same probability. Picking an index with a biased modulo, or sorting by a random comparator, does not achieve that — and the bias is often invisible in small samples.' },
      { title: 'With or without replacement', text: 'Drawing with replacement can pick the same item twice; without replacement cannot. For a raffle it must be without; for a random sample it depends on the statistics you intend to do.' },
    ],

    'lines-shuffle': [
      { title: 'Fisher-Yates', text: 'Walk from the end, swapping each element with a random one at or before it. It is O(n), uses no extra memory, and produces every permutation with equal probability — which is the part naive shuffles get wrong.' },
      { title: 'The broken shuffle', text: 'sort(() => Math.random() - 0.5) is not a shuffle. Comparison sorts assume a consistent comparator, so the result is biased in a way that depends on the sort implementation. It is a famously common bug.' },
      { title: 'How many arrangements', text: '52! is about 8 × 10⁶⁷. A properly shuffled deck of cards has, with near certainty, never existed before in the history of the world — there are vastly more orderings than there have been shuffles.' },
    ],

    'team-split': [
      { title: 'Splitting fairly', text: 'A fair split means shuffling first and then dealing, not taking the list in order. Any pre-existing order — alphabetical, by signup, by skill — survives an unshuffled split and stops it being random.' },
      { title: 'Uneven groups', text: 'When the count does not divide evenly, distribute the remainder one per team rather than adding it all to the last. The difference between teams should never be more than one.' },
    ],

    'random-string': [
      { title: 'Choose the alphabet deliberately', rows: [
        ['Hex', '4 bits per character'],
        ['Base32 (Crockford)', '5 bits, no ambiguous characters'],
        ['Base62', '~5.95 bits'],
        ['Base64url', '6 bits, URL-safe'],
      ] },
      { title: 'Length for the purpose', text: 'A session token or API key wants at least 128 bits of entropy — 22 base64 characters, or 32 hex. Short "random" ids collide sooner than intuition suggests, by the birthday bound.' },
      { title: 'Use a CSPRNG', text: 'Anything that acts as a credential must come from a cryptographic generator. A string that merely looks random from Math.random is predictable to anyone who can observe a few outputs.' },
    ],

    'username-gen': [
      { title: 'What makes a good handle', text: 'Short, pronounceable, spellable after hearing it once, and free of ambiguous characters. Anything with l/1/I or O/0 will be mistyped forever.' },
      { title: 'Practical checks', rows: [
        ['Availability', 'Check every platform you care about at once'],
        ['Read it aloud', 'Run-together words produce accidents'],
        ['Numbers', 'Appended digits read as a fallback'],
        ['Longevity', 'A handle tied to an age or a job dates quickly'],
      ] },
      { title: 'It is an identifier', text: 'A username often survives longer than the account and is frequently searchable across services. Reusing a distinctive one everywhere links those accounts permanently — which is convenient, and a privacy decision.' },
    ],

  };

  if (typeof window !== 'undefined') window.VexToolReference = REF;
  if (typeof module !== 'undefined' && module.exports) module.exports = REF;
})();
