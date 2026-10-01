package com.vex.browser.block;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * The request matcher, with rules in the shapes EasyList and EasyPrivacy
 * actually use. What it must get right is both halves: what it blocks, and —
 * as much — what it leaves alone, because a blocker that breaks the page is
 * one people switch off.
 */
public class BlockCheck {
    static int passed = 0;

    static void expect(boolean ok, String what) {
        if (!ok) throw new AssertionError(what);
        passed++;
        System.out.println("ok  " + what);
    }

    public static void main(String[] args) {
        BlockEngine engine = BlockEngine.get();
        engine.setEnabled(true);
        engine.load(Arrays.asList(
                "||doubleclick.net^",
                "||ads.example.com^$third-party",
                "/banner/*/ad_",
                "&ad_type=",
                "-ad-300x250.",
                "||cdn.example.net/track^",
                "|https://exact.example/pixel.gif|",
                "/sponsor.js$domain=news.example|~blog.news.example",
                "/first-only-tracker.$~third-party",
                "||evil.example/*.js$3p",
                "ads"                                   // too generic: dropped
        ), Arrays.asList(
                "||doubleclick.net/allowed/",
                "/banner/ok/*"
        ), Collections.<String, List<String>>emptyMap());

        expect(engine.blocks("site.example", "https://ad.doubleclick.net/x.js", false), "a host rule blocks its subdomains");
        expect(!engine.blocks("site.example", "https://doubleclick.net/allowed/thing.js", false), "an exception wins");
        expect(engine.blocks("site.example", "https://ads.example.com/a.js", false), "third-party host rule, from another site");
        expect(!engine.blocks("www.example.com", "https://ads.example.com/a.js", false), "third-party host rule, from its own site");
        expect(engine.blocks("x.example", "https://cdn.x/banner/123/ad_top.png", false), "a wildcard rule matches across the gap");
        expect(!engine.blocks("x.example", "https://cdn.x/banner/123/top.png", false), "a wildcard rule needs every piece");
        expect(!engine.blocks("x.example", "https://cdn.x/banner/ok/ad_top.png", false), "an exception with a path wins over a wildcard rule");
        expect(engine.blocks("x.example", "https://x.example/load?id=1&ad_type=video", false), "a plain substring rule");
        expect(engine.blocks("x.example", "https://img.x/promo-ad-300x250.jpg", false), "a rule with punctuation on both ends");
        expect(engine.blocks("x.example", "https://cdn.example.net/track?u=1", false), "a separator after the path");
        expect(engine.blocks("x.example", "https://cdn.example.net/track", false), "a separator matches the end");
        expect(!engine.blocks("x.example", "https://cdn.example.net/tracker.js", false), "a separator is not a letter");
        expect(!engine.blocks("x.example", "https://notcdn.example.net/track", false), "|| anchors to a label, not inside one");
        expect(engine.blocks("x.example", "https://exact.example/pixel.gif", false), "start and end anchors, exact");
        expect(!engine.blocks("x.example", "https://exact.example/pixel.gif?x=1", false), "the end anchor is the end");
        expect(engine.blocks("news.example", "https://cdn.y/sponsor.js", false), "$domain= applies on its domain");
        expect(!engine.blocks("blog.news.example", "https://cdn.y/sponsor.js", false), "$domain=~ excludes a subdomain");
        expect(!engine.blocks("other.example", "https://cdn.y/sponsor.js", false), "$domain= does not apply elsewhere");
        expect(engine.blocks("a.example", "https://a.example/first-only-tracker.js", false), "$~third-party applies first-party");
        expect(!engine.blocks("b.example", "https://a.example/first-only-tracker.js", false), "$~third-party leaves third-party alone");
        expect(engine.blocks("b.example", "https://evil.example/lib/x.js", false), "|| with a wildcard path");
        expect(!engine.blocks("b.example", "https://uploads.example/files/ads.png", false), "a two-letter-generic rule is dropped");
        expect(!engine.blocks("b.example", "https://ad.doubleclick.net/x.js", true), "the page itself is never blocked");

        // Speed: thousands of rules, and still a lookup rather than a scan.
        List<String> many = new ArrayList<>();
        for (int i = 0; i < 30000; i++) many.add("/path" + i + "/adunit" + i + ".");
        engine.load(many, Collections.<String>emptyList(), Collections.<String, List<String>>emptyMap());
        long start = System.nanoTime();
        int hits = 0;
        for (int i = 0; i < 2000; i++) {
            if (engine.blocks("p.example", "https://cdn.example/assets/app" + i + "/main.js?v=" + i, false)) hits++;
        }
        long perRequestMicros = (System.nanoTime() - start) / 2000 / 1000;
        expect(hits == 0, "nothing blocked that should not be");
        expect(engine.blocks("p.example", "https://cdn.example/path29999/adunit29999.js", false), "the last of 30,000 rules is found");
        expect(perRequestMicros < 200, "a request against 30,000 rules takes " + perRequestMicros + " µs");

        // Cosmetic CSS: one rule per selector, so one bad one costs only itself.
        Map<String, List<String>> hide = new HashMap<>();
        hide.put("*", Arrays.asList(".ad-slot", "div:-abp-contains(Sponsored)", "#banner"));
        engine.load(Collections.<String>emptyList(), Collections.<String>emptyList(), hide);
        String css = engine.cosmeticCss("any.example");
        expect(css.contains(".ad-slot{display:none !important}") && css.contains("#banner{display:none !important}"),
                "each selector is a rule of its own");
    }
}
