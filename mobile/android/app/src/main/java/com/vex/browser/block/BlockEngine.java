package com.vex.browser.block;

import android.net.Uri;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicLong;

import android.webkit.WebResourceResponse;

/**
 * Request blocking for the page WebViews.
 *
 * The desktop app runs @ghostery/adblocker-electron against Electron's
 * webRequest API. Android has no webRequest: the only hook is
 * WebViewClient.shouldInterceptRequest, which is called on a network thread,
 * once per subresource, and must answer immediately. So the matcher here is
 * deliberately small and allocation-free on the hot path:
 *
 *   • ||host^ rules go in a hash set keyed by host, matched by walking the
 *     request host's parent domains — O(number of labels), no scanning;
 *     ||host^$third-party ones in a second set consulted only cross-site.
 *   • everything else is compiled into pieces (literals, `*`, `^`, anchors)
 *     and filed under one token it guarantees; a request is split into its
 *     tokens and only those rules are tried. $third-party, $~third-party,
 *     $domain= and $domain=~ are honoured.
 *   • @@ exception rules are checked first and win.
 *
 * What this does NOT implement, and what the parity report says so: regex
 * rules, $csp, $redirect, $removeparam, generichide, and the element-hiding
 * exception syntax (#@#). Cosmetic (##) rules are kept per host and injected
 * as CSS by the tab, which is a different mechanism from blocking.
 */
public final class BlockEngine {

    private static final BlockEngine INSTANCE = new BlockEngine();

    public static BlockEngine get() {
        return INSTANCE;
    }

    /** An empty 200 — a blocked request must look answered, not failed. */
    private static WebResourceResponse emptyResponse() {
        InputStream empty = new ByteArrayInputStream(new byte[0]);
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "*");
        return new WebResourceResponse("text/plain", "utf-8", 200, "OK", headers, empty);
    }

    /**
     * One network rule, compiled.
     *
     * A pattern is a run of pieces: literal text, `*` (anything), and `^` (a
     * separator — anything but a letter, a digit or one of _ - . %, or the end
     * of the address). `||` anchors the first piece to the start of the host or
     * of one of its labels; a leading `|` to the start of the address and a
     * trailing one to its end. These used to be stripped and the rest matched
     * as one substring, which glued "ad*banner" into "adbanner" — a rule that
     * can never match — and let "||ads.example" match inside any address
     * that happened to contain those letters.
     */
    static final class Rule {
        final String[] literals;       // the literal pieces, in order
        final byte[] gaps;             // before each literal after the first: 0 adjacent, 1 '*', 2 '^'
        final byte tail;               // after the last literal: 0 nothing, 1 '*', 2 '^'
        final boolean hostAnchor, startAnchor, endAnchor;
        final boolean thirdPartyOnly, firstPartyOnly;
        final Set<String> domains;     // $domain=a.com|b.com, empty = any
        final Set<String> notDomains;  // $domain=~c.com

        Rule(String[] literals, byte[] gaps, byte tail, boolean hostAnchor, boolean startAnchor, boolean endAnchor,
             boolean thirdPartyOnly, boolean firstPartyOnly, Set<String> domains, Set<String> notDomains) {
            this.literals = literals;
            this.gaps = gaps;
            this.tail = tail;
            this.hostAnchor = hostAnchor;
            this.startAnchor = startAnchor;
            this.endAnchor = endAnchor;
            this.thirdPartyOnly = thirdPartyOnly;
            this.firstPartyOnly = firstPartyOnly;
            this.domains = domains;
            this.notDomains = notDomains;
        }
    }

    /**
     * Rules filed under one token each — a run of letters and digits that the
     * rule guarantees will stand whole in any address it matches. An address
     * is split into its own tokens and only the rules filed under those are
     * tried: a few dozen per request instead of every rule there is, which is
     * what uBlock Origin and Adblock Plus do for the same reason. Rules with
     * no such token (rare) are kept apart and always tried.
     */
    static final class RuleSet {
        final Map<String, List<Rule>> byToken = new HashMap<>();
        final List<Rule> untokened = new ArrayList<>();
        int size;

        void add(Rule rule) {
            size++;
            String token = bestToken(rule);
            if (token == null) { untokened.add(rule); return; }
            List<Rule> bucket = byToken.get(token);
            if (bucket == null) { bucket = new ArrayList<>(2); byToken.put(token, bucket); }
            bucket.add(rule);
        }

        Rule find(String url, String pageHost, boolean thirdParty, int hostStart, int hostEnd) {
            for (Rule rule : untokened) {
                if (matches(rule, url, pageHost, thirdParty, hostStart, hostEnd)) return rule;
            }
            if (byToken.isEmpty()) return null;
            int length = url.length();
            int start = -1;
            for (int i = 0; i <= length; i++) {
                boolean word = i < length && isTokenChar(url.charAt(i));
                if (word && start < 0) start = i;
                else if (!word && start >= 0) {
                    if (i - start >= 2) {
                        List<Rule> bucket = byToken.get(url.substring(start, i));
                        if (bucket != null) {
                            for (Rule rule : bucket) {
                                if (matches(rule, url, pageHost, thirdParty, hostStart, hostEnd)) return rule;
                            }
                        }
                    }
                    start = -1;
                }
            }
            return null;
        }
    }

    static final Set<String> NOT_REQUESTS = new HashSet<>(java.util.Arrays.asList(
            "popup", "popunder", "csp", "redirect", "redirect-rule", "rewrite", "removeparam", "queryprune",
            "document", "doc", "elemhide", "ehide", "generichide", "ghide", "specifichide", "shide",
            "genericblock", "header", "permissions", "replace", "urltransform", "uritransform", "urlskip",
            "cname", "badfilter"));

    // Tokens so common that filing a rule under them would make a bucket
    // every address opens.
    private static final Set<String> COMMON = new HashSet<>(java.util.Arrays.asList(
            "http", "https", "www", "com", "net", "org", "html", "php", "js", "css", "static", "cdn"));

    static boolean isTokenChar(char c) {
        return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '%';
    }

    static boolean isSeparator(char c) {
        return !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
                || c == '_' || c == '-' || c == '.' || c == '%');
    }

    /**
     * The longest token in the rule that is bounded on both sides by something
     * that cannot be a letter or digit in the address — a non-word character
     * in the literal, a `^`, the `||` host anchor or a `|` — so it is certain
     * to be a whole token wherever the rule matches.
     */
    static String bestToken(Rule rule) {
        String best = null;
        for (int index = 0; index < rule.literals.length; index++) {
            String literal = rule.literals[index];
            // What sits just before and just after this literal in the rule.
            boolean leftBounded = index == 0 ? (rule.hostAnchor || rule.startAnchor) : rule.gaps[index - 1] == 2;
            boolean rightBounded = index == rule.literals.length - 1
                    ? (rule.tail == 2 || rule.endAnchor) : rule.gaps[index] == 2;
            int length = literal.length();
            int start = -1;
            for (int i = 0; i <= length; i++) {
                boolean word = i < length && isTokenChar(literal.charAt(i));
                if (word && start < 0) start = i;
                else if (!word && start >= 0) {
                    boolean left = start > 0 || leftBounded;
                    boolean right = i < length || rightBounded;
                    String token = literal.substring(start, i);
                    if (left && right && token.length() >= 2 && !COMMON.contains(token)
                            && (best == null || token.length() > best.length())) {
                        best = token;
                    }
                    start = -1;
                }
            }
        }
        return best;
    }

    private volatile Set<String> blockedHosts = Collections.emptySet();
    // ||host^$third-party: blocked only from another site. These went into
    // the plain set before, which dropped the option — so a site's own
    // resources were blocked on the site itself, and the site broke.
    private volatile Set<String> thirdPartyHosts = Collections.emptySet();
    private volatile RuleSet blockRules = new RuleSet();
    private volatile RuleSet allowRules = new RuleSet();
    private volatile Map<String, List<String>> cosmetic = Collections.emptyMap();
    private volatile Set<String> allowedSites = Collections.newSetFromMap(new HashMap<>());
    private volatile boolean enabled = true;
    private final AtomicLong blockedCount = new AtomicLong();

    private BlockEngine() {
    }

    public void setEnabled(boolean value) {
        enabled = value;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public long blockedCount() {
        return blockedCount.get();
    }

    public int ruleCount() {
        return blockedHosts.size() + thirdPartyHosts.size() + blockRules.size;
    }

    /** Sites the user switched blocking off for, by registrable-ish host. */
    public void setSiteAllowed(String host, boolean allowed) {
        Set<String> next = new HashSet<>(allowedSites);
        if (host == null) return;
        String key = host.toLowerCase(Locale.US);
        if (allowed) next.add(key);
        else next.remove(key);
        allowedSites = next;
    }

    public boolean isSiteAllowed(String host) {
        if (host == null) return false;
        String candidate = host.toLowerCase(Locale.US);
        while (!candidate.isEmpty()) {
            if (allowedSites.contains(candidate)) return true;
            int dot = candidate.indexOf('.');
            if (dot < 0) break;
            candidate = candidate.substring(dot + 1);
        }
        return false;
    }

    /**
     * Replace the rule set. Filter text is parsed in JS (www/js/adblock.js) and
     * arrives already split into block / allow / hide, so the parsing cost is
     * paid once at boot on the JS side rather than on every launch here.
     */
    public void load(List<String> block, List<String> allow, Map<String, List<String>> hide) {
        Set<String> hosts = new HashSet<>();
        Set<String> crossSite = new HashSet<>();
        RuleSet blocks = new RuleSet();
        for (String line : block) {
            String hostRule = hostAnchoredHost(line);
            if (hostRule != null) {
                if (line.endsWith("$third-party") || line.endsWith("$3p")) crossSite.add(hostRule);
                else hosts.add(hostRule);
            }
            else {
                Rule rule = parse(line);
                if (rule != null) blocks.add(rule);
            }
        }
        RuleSet allows = new RuleSet();
        for (String line : allow) {
            Rule rule = parse(line);
            if (rule != null) allows.add(rule);
        }
        blockedHosts = hosts;
        thirdPartyHosts = crossSite;
        blockRules = blocks;
        allowRules = allows;
        cosmetic = hide == null ? Collections.<String, List<String>>emptyMap() : new HashMap<>(hide);
    }

    /**
     * "||ads.example.com^" — the common case, and the only one worth a hash
     * lookup. Returns the host, or null when the rule has a path or options
     * that make it a pattern rule instead.
     */
    static String hostAnchoredHost(String line) {
        if (!line.startsWith("||")) return null;
        String rest = line.substring(2);
        int cut = rest.length();
        for (int i = 0; i < rest.length(); i++) {
            char c = rest.charAt(i);
            if (c == '^' || c == '/' || c == '$' || c == '*' || c == '|') {
                cut = i;
                break;
            }
        }
        String host = rest.substring(0, cut);
        // Only a bare host followed by ^ or end counts; "||a.com/x" keeps its path.
        if (host.isEmpty() || host.indexOf('.') < 0) return null;
        String tail = rest.substring(cut);
        if (!tail.isEmpty() && !tail.equals("^") && !tail.equals("^$third-party") && !tail.equals("^$3p")) return null;
        for (int i = 0; i < host.length(); i++) {
            char c = host.charAt(i);
            boolean ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
                    || c == '.' || c == '-' || c == '_';
            if (!ok) return null;
        }
        return host.toLowerCase(Locale.US);
    }

    static Rule parse(String line) {
        if (line == null || line.isEmpty()) return null;
        String pattern = line;
        boolean thirdParty = false, firstParty = false;
        Set<String> domains = Collections.emptySet();
        Set<String> notDomains = Collections.emptySet();

        int options = pattern.lastIndexOf('$');
        if (options >= 0 && !(pattern.startsWith("/") && pattern.endsWith("/"))) {
            String opts = pattern.substring(options + 1);
            pattern = pattern.substring(0, options);
            for (String opt : opts.split(",")) {
                // Options that make the rule about something other than "this
                // request may not load": a pop-up window, a header, a rewrite,
                // a page-level switch. Matched as a plain rule, "||site^$popup"
                // blocked everything from that site on every page; such rules
                // are not this engine's to apply, so they are left out.
                String name = opt.contains("=") ? opt.substring(0, opt.indexOf('=')) : opt;
                if (NOT_REQUESTS.contains(name)) return null;
                if (opt.equals("third-party") || opt.equals("3p")) thirdParty = true;
                else if (opt.equals("~third-party") || opt.equals("1p") || opt.equals("first-party")) firstParty = true;
                else if (opt.startsWith("domain=")) {
                    for (String domain : opt.substring(7).split("\\|")) {
                        if (domain.isEmpty()) continue;
                        if (domain.startsWith("~")) {
                            if (notDomains.isEmpty()) notDomains = new HashSet<>();
                            notDomains.add(domain.substring(1).toLowerCase(Locale.US));
                        } else {
                            if (domains.isEmpty()) domains = new HashSet<>();
                            domains.add(domain.toLowerCase(Locale.US));
                        }
                    }
                }
                // Unsupported options (csp, redirect, resource types…) are
                // ignored rather than dropping the rule: a slightly broader
                // match beats a rule silently doing nothing.
            }
        }
        if (pattern.startsWith("/") && pattern.endsWith("/") && pattern.length() > 1) return null;   // regex rule

        boolean hostAnchor = false, startAnchor = false, endAnchor = false;
        if (pattern.startsWith("||")) { hostAnchor = true; pattern = pattern.substring(2); }
        else if (pattern.startsWith("|")) { startAnchor = true; pattern = pattern.substring(1); }
        if (pattern.endsWith("|")) { endAnchor = true; pattern = pattern.substring(0, pattern.length() - 1); }
        pattern = pattern.toLowerCase(Locale.US);

        List<String> literals = new ArrayList<>();
        List<Byte> gaps = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        byte pending = 0;            // what lies between the previous literal and the next
        for (int i = 0; i < pattern.length(); i++) {
            char c = pattern.charAt(i);
            if (c == '*' || c == '^') {
                if (current.length() > 0) {
                    if (!literals.isEmpty()) gaps.add(pending);
                    literals.add(current.toString());
                    current.setLength(0);
                    pending = 0;
                }
                // A run of them: any '*' makes it "anything" (which includes a
                // separator); only '^'s make it "one separator".
                byte here = c == '*' ? (byte) 1 : (byte) 2;
                pending = (pending == 1 || here == 1) ? (byte) 1 : (byte) 2;
            } else {
                current.append(c);
            }
        }
        if (current.length() > 0) {
            if (!literals.isEmpty()) gaps.add(pending);
            literals.add(current.toString());
            pending = 0;
        }
        if (literals.isEmpty()) return null;
        int letters = 0;
        for (String literal : literals) letters += literal.length();
        if (letters < 4 && !hostAnchor) return null;          // too generic to be safe
        byte[] gapArray = new byte[gaps.size()];
        for (int i = 0; i < gapArray.length; i++) gapArray[i] = gaps.get(i);
        return new Rule(literals.toArray(new String[0]), gapArray, pending, hostAnchor, startAnchor, endAnchor,
                thirdParty, firstParty, domains, notDomains);
    }

    /**
     * The hot path. Returns an empty response for a blocked request, or null
     * to let it through.
     */
    public WebResourceResponse intercept(String pageHost, Uri url, boolean isMainFrame) {
        if (url == null) return null;
        if (!blocks(pageHost, url.toString(), isMainFrame)) return null;
        blockedCount.incrementAndGet();
        return emptyResponse();
    }

    /** Whether a request from a page on `pageHost` for `url` is blocked. */
    boolean blocks(String pageHost, String rawUrl, boolean isMainFrame) {
        if (!enabled || isMainFrame || rawUrl == null) return false;
        if (isSiteAllowed(pageHost)) return false;
        String url = rawUrl.toLowerCase(Locale.US);
        int schemeEnd = url.indexOf("://");
        if (schemeEnd < 0) return false;
        int hostStart = schemeEnd + 3;
        int hostEnd = hostStart;
        while (hostEnd < url.length()) {
            char c = url.charAt(hostEnd);
            if (c == '/' || c == '?' || c == '#' || c == ':') break;
            hostEnd++;
        }
        int at = url.lastIndexOf('@', hostEnd);
        if (at >= hostStart) hostStart = at + 1;
        String host = url.substring(hostStart, hostEnd);
        if (host.isEmpty()) return false;
        String page = pageHost == null ? null : pageHost.toLowerCase(Locale.US);
        boolean thirdParty = page != null && !page.isEmpty() && !sameSite(page, host);

        if (allowRules.find(url, page, thirdParty, hostStart, hostEnd) != null) return false;

        String candidate = host;
        while (!candidate.isEmpty()) {
            if (blockedHosts.contains(candidate)) return true;
            if (thirdParty && thirdPartyHosts.contains(candidate)) return true;
            int dot = candidate.indexOf('.');
            if (dot < 0) break;
            candidate = candidate.substring(dot + 1);
        }
        return blockRules.find(url, page, thirdParty, hostStart, hostEnd) != null;
    }

    static boolean matches(Rule rule, String url, String pageHost, boolean thirdParty, int hostStart, int hostEnd) {
        if (rule.thirdPartyOnly && !thirdParty) return false;
        if (rule.firstPartyOnly && thirdParty) return false;
        if (!rule.domains.isEmpty() || !rule.notDomains.isEmpty()) {
            if (pageHost == null) return rule.domains.isEmpty();
            if (onDomain(pageHost, rule.notDomains)) return false;
            if (!rule.domains.isEmpty() && !onDomain(pageHost, rule.domains)) return false;
        }
        String first = rule.literals[0];
        if (rule.startAnchor) return url.startsWith(first) && rest(rule, url, first.length(), 1);
        if (rule.hostAnchor) {
            // The first piece starts the host, or one of its labels.
            for (int from = hostStart; from < hostEnd; ) {
                int found = url.indexOf(first, from);
                if (found < 0 || found >= hostEnd) return false;
                if ((found == hostStart || url.charAt(found - 1) == '.') && rest(rule, url, found + first.length(), 1)) return true;
                from = found + 1;
            }
            return false;
        }
        for (int from = 0; ; ) {
            int found = url.indexOf(first, from);
            if (found < 0) return false;
            if (rest(rule, url, found + first.length(), 1)) return true;
            from = found + 1;
        }
    }

    /** Whether the rule's pieces from `index` on match the address from `pos`. */
    private static boolean rest(Rule rule, String url, int pos, int index) {
        if (index == rule.literals.length) {
            if (rule.tail == 2 && pos < url.length() && !isSeparator(url.charAt(pos))) return false;
            if (rule.endAnchor && rule.tail != 1) {
                int end = pos + (rule.tail == 2 && pos < url.length() ? 1 : 0);
                return end == url.length();
            }
            return true;
        }
        byte gap = rule.gaps[index - 1];
        String literal = rule.literals[index];
        if (gap == 0) return url.startsWith(literal, pos) && rest(rule, url, pos + literal.length(), index + 1);
        if (gap == 2) {
            // One separator, or the end — and a separator cannot be the end
            // when there is more of the rule to match.
            if (pos >= url.length() || !isSeparator(url.charAt(pos))) return false;
            return url.startsWith(literal, pos + 1) && rest(rule, url, pos + 1 + literal.length(), index + 1);
        }
        for (int from = pos; ; ) {
            int found = url.indexOf(literal, from);
            if (found < 0) return false;
            if (rest(rule, url, found + literal.length(), index + 1)) return true;
            from = found + 1;
        }
    }

    private static boolean onDomain(String host, Set<String> domains) {
        for (String domain : domains) {
            if (host.equals(domain) || host.endsWith("." + domain)) return true;
        }
        return false;
    }

    /** Good enough without a public-suffix list: compare the last two labels. */
    private static boolean sameSite(String a, String b) {
        return registrable(a).equals(registrable(b));
    }

    private static String registrable(String host) {
        String[] parts = host.split("\\.");
        if (parts.length < 2) return host;
        return parts[parts.length - 2] + "." + parts[parts.length - 1];
    }

    /** CSS selectors to hide on this host, joined for one injected style rule. */
    public String cosmeticCss(String host) {
        if (!enabled || host == null || isSiteAllowed(host)) return "";
        List<String> selectors = new ArrayList<>();
        List<String> generic = cosmetic.get("*");
        if (generic != null) selectors.addAll(generic);
        String candidate = host.toLowerCase(Locale.US);
        while (!candidate.isEmpty()) {
            List<String> forHost = cosmetic.get(candidate);
            if (forHost != null) selectors.addAll(forHost);
            int dot = candidate.indexOf('.');
            if (dot < 0) break;
            candidate = candidate.substring(dot + 1);
        }
        if (selectors.isEmpty()) return "";
        // One rule per selector, not one rule for all of them: in CSS a single
        // selector the engine does not understand (a list's :-abp-contains, a
        // :has-text) throws away the whole comma-separated rule, so one bad
        // selector anywhere in a list switched off every bit of hiding on
        // every page. Capped: a 40k-selector generic list injected into every
        // page is a bigger tax than the ads it hides.
        int limit = Math.min(selectors.size(), 4000);
        StringBuilder css = new StringBuilder();
        for (int i = 0; i < limit; i++) {
            String selector = selectors.get(i);
            if (selector.indexOf('{') >= 0 || selector.indexOf('}') >= 0) continue;   // not a selector
            css.append(selector).append("{display:none !important}");
        }
        return css.toString();
    }
}
