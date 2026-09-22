package com.vex.browser.block;

import android.net.Uri;
import android.text.TextUtils;

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
 *     request host's parent domains — O(number of labels), no scanning.
 *   • everything else is a substring rule checked against the full URL, with
 *     $third-party and $domain= honoured.
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

    private static final class Rule {
        final String pattern;          // lower-cased substring to look for
        final boolean thirdPartyOnly;
        final Set<String> domains;     // $domain=a.com|b.com, empty = any

        Rule(String pattern, boolean thirdPartyOnly, Set<String> domains) {
            this.pattern = pattern;
            this.thirdPartyOnly = thirdPartyOnly;
            this.domains = domains;
        }
    }

    private volatile Set<String> blockedHosts = Collections.emptySet();
    private volatile List<Rule> blockRules = Collections.emptyList();
    private volatile List<Rule> allowRules = Collections.emptyList();
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
        return blockedHosts.size() + blockRules.size();
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
        List<Rule> blocks = new ArrayList<>();
        for (String line : block) {
            String hostRule = hostAnchoredHost(line);
            if (hostRule != null) hosts.add(hostRule);
            else {
                Rule rule = parse(line);
                if (rule != null) blocks.add(rule);
            }
        }
        List<Rule> allows = new ArrayList<>();
        for (String line : allow) {
            Rule rule = parse(line);
            if (rule != null) allows.add(rule);
        }
        blockedHosts = hosts;
        blockRules = blocks;
        allowRules = allows;
        cosmetic = hide == null ? Collections.<String, List<String>>emptyMap() : new HashMap<>(hide);
    }

    /**
     * "||ads.example.com^" — the common case, and the only one worth a hash
     * lookup. Returns the host, or null when the rule has a path or options
     * that make it a substring rule instead.
     */
    private static String hostAnchoredHost(String line) {
        if (!line.startsWith("||")) return null;
        String rest = line.substring(2);
        int cut = rest.length();
        for (int i = 0; i < rest.length(); i++) {
            char c = rest.charAt(i);
            if (c == '^' || c == '/' || c == '$' || c == '*') {
                cut = i;
                break;
            }
        }
        String host = rest.substring(0, cut);
        // Only a bare host followed by ^ or end counts; "||a.com/x" keeps its path.
        if (host.isEmpty() || host.indexOf('.') < 0) return null;
        String tail = rest.substring(cut);
        if (!tail.isEmpty() && !tail.equals("^") && !tail.startsWith("^$third-party")) return null;
        for (int i = 0; i < host.length(); i++) {
            char c = host.charAt(i);
            boolean ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
                    || c == '.' || c == '-' || c == '_';
            if (!ok) return null;
        }
        return host.toLowerCase(Locale.US);
    }

    private static Rule parse(String line) {
        if (TextUtils.isEmpty(line)) return null;
        String pattern = line;
        boolean thirdParty = false;
        Set<String> domains = Collections.emptySet();

        int options = pattern.indexOf('$');
        if (options >= 0) {
            String opts = pattern.substring(options + 1);
            pattern = pattern.substring(0, options);
            for (String opt : opts.split(",")) {
                if (opt.equals("third-party") || opt.equals("3p")) thirdParty = true;
                else if (opt.startsWith("domain=")) {
                    domains = new HashSet<>();
                    for (String domain : opt.substring(7).split("\\|")) {
                        if (!domain.startsWith("~")) domains.add(domain.toLowerCase(Locale.US));
                    }
                }
                // Unsupported options (regex, csp, redirect, …) are ignored
                // rather than dropped: a slightly broader match beats a rule
                // silently doing nothing.
            }
        }
        // Strip the anchors the substring matcher cannot use.
        if (pattern.startsWith("||")) pattern = pattern.substring(2);
        else if (pattern.startsWith("|")) pattern = pattern.substring(1);
        if (pattern.endsWith("|")) pattern = pattern.substring(0, pattern.length() - 1);
        pattern = pattern.replace("^", "").replace("*", "");
        pattern = pattern.trim().toLowerCase(Locale.US);
        if (pattern.length() < 4) return null;          // too generic to be safe
        if (pattern.startsWith("/") && pattern.endsWith("/")) return null;   // regex rule
        return new Rule(pattern, thirdParty, domains);
    }

    /**
     * The hot path. Returns an empty response for a blocked request, or null
     * to let it through.
     */
    public WebResourceResponse intercept(String pageHost, Uri url, boolean isMainFrame) {
        if (!enabled || isMainFrame || url == null) return null;
        if (isSiteAllowed(pageHost)) return null;

        String host = url.getHost();
        if (host == null) return null;
        String full = url.toString().toLowerCase(Locale.US);
        String lowerHost = host.toLowerCase(Locale.US);
        boolean thirdParty = pageHost != null && !sameSite(pageHost, lowerHost);

        for (Rule rule : allowRules) {
            if (matches(rule, full, pageHost, thirdParty)) return null;
        }

        String candidate = lowerHost;
        while (!candidate.isEmpty()) {
            if (blockedHosts.contains(candidate)) {
                blockedCount.incrementAndGet();
                return emptyResponse();
            }
            int dot = candidate.indexOf('.');
            if (dot < 0) break;
            candidate = candidate.substring(dot + 1);
        }

        for (Rule rule : blockRules) {
            if (matches(rule, full, pageHost, thirdParty)) {
                blockedCount.incrementAndGet();
                return emptyResponse();
            }
        }
        return null;
    }

    private static boolean matches(Rule rule, String url, String pageHost, boolean thirdParty) {
        if (rule.thirdPartyOnly && !thirdParty) return false;
        if (!rule.domains.isEmpty()) {
            if (pageHost == null) return false;
            boolean hit = false;
            for (String domain : rule.domains) {
                if (pageHost.equals(domain) || pageHost.endsWith("." + domain)) {
                    hit = true;
                    break;
                }
            }
            if (!hit) return false;
        }
        return url.contains(rule.pattern);
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
        // Cap it: a 40k-selector generic list injected into every page is a
        // bigger tax than the ads it hides.
        int limit = Math.min(selectors.size(), 4000);
        StringBuilder css = new StringBuilder();
        for (int i = 0; i < limit; i++) {
            if (i > 0) css.append(',');
            css.append(selectors.get(i));
        }
        css.append("{display:none !important}");
        return css.toString();
    }
}
