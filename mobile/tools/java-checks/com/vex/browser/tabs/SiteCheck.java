package com.vex.browser.tabs;

/**
 * "Another site", for handing a tapped link to its app: a link inside the
 * site you are using must stay in the browser, or every YouTube page opened in
 * Vex would throw you into the app the moment you touched a video.
 */
public class SiteCheck {
    static void expect(boolean ok, String what) {
        if (!ok) throw new AssertionError(what);
        System.out.println("ok  " + what);
    }

    public static void main(String[] args) {
        expect(TabWebView.sameSite("m.youtube.com", "www.youtube.com"), "a subdomain is the same site");
        expect(TabWebView.sameSite("YouTube.com", "youtube.com"), "case does not matter");
        expect(!TabWebView.sameSite("youtube.com", "news.example"), "another site is another site");
        expect(!TabWebView.sameSite("x.com", ""), "the start page is no site");
        expect(!TabWebView.sameSite("x.com", null), "nothing is no site");
    }
}
