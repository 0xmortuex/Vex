package com.vex.browser.tabs;

import android.app.DownloadManager;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.net.Uri;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.util.Base64;
import android.view.ActionMode;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.content.ContextCompat;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import com.getcapacitor.JSObject;
import com.vex.browser.block.BlockEngine;

import java.io.ByteArrayOutputStream;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * One tab: an Android WebView plus the clients that turn its callbacks into
 * the events the Vex chrome listens for.
 *
 * This is the file that replaces src/renderer/js/webview.js from the desktop
 * app. The shapes are deliberately the same — loadStart / loadEnd / title /
 * urlChange are the &lt;webview&gt; events renamed — so the chrome's handling of a
 * tab reads the same on both platforms.
 */
public class TabWebView extends WebView {

    /** What a tab needs from the plugin that owns it. */
    public interface Host {
        void emit(String event, JSObject data);

        void openInNewTab(String url, boolean background);

        void chooseFile(Intent intent, ValueCallback<Uri[]> callback);

        void showFullscreen(View view, WebChromeClient.CustomViewCallback callback);

        void hideFullscreen();

        /**
         * A page has asked for the camera, the microphone or your location.
         *
         * The answer is the chrome's, not this file's: js/permissions.js keeps a
         * decision per site, and until this existed it was never consulted — the
         * WebView handed a page whatever Android had already granted Vex, which
         * made the site-permissions screen a list nobody wrote to.
         */
        void askPermission(String tabId, String origin, java.util.List<String> kinds, PermissionDecision decision);
    }

    /** What the chrome calls back with: the kinds it decided to allow. */
    public interface PermissionDecision {
        void answer(java.util.List<String> granted);
    }

    private static final String DESKTOP_UA =
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
                    + "Chrome/140.0.0.0 Safari/537.36 Vex/0.1";

    private final String id;
    private final boolean incognito;
    private final Host host;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final AtomicInteger blockedPending = new AtomicInteger();

    private String pageHost = "";
    // The last HLS playlist this page asked for. A player built on Media Source
    // Extensions hands its <video> a blob: URL, so the element says nothing
    // about where the picture comes from — but the playlist went past here on
    // its way in, which is how "download this video" finds it. Written on the
    // WebView's network thread, read on the bridge's.
    private volatile String lastStream = "";
    private int scrollPending;
    private long lastScrollReport;
    private String pendingStartScript = "";
    private androidx.webkit.ScriptHandler documentStart;
    private boolean desktopMode;
    private boolean flushScheduled;
    private static boolean httpsOnly = true;
    private static boolean sendDnt = true;

    public TabWebView(Context context, String id, boolean incognito, Host host) {
        super(context);
        this.id = id;
        this.incognito = incognito;
        this.host = host;
        configure();
    }

    public String id() {
        return id;
    }

    public boolean isIncognito() {
        return incognito;
    }

    // Hand a tapped link to the app that owns it (Samsung's "open links in
    // apps"). Static like the privacy switches: it is one setting for every tab.
    private static volatile boolean openInApps = true;

    public static void setOpenInApps(boolean enabled) { openInApps = enabled; }

    /** Close enough to "the same site": the last two labels of the host. */
    static boolean sameSite(String a, String b) {
        if (a == null || b == null) return false;
        return siteOf(a).equals(siteOf(b));
    }

    private static String siteOf(String host) {
        String[] labels = host.toLowerCase(java.util.Locale.ROOT).split("\\.");
        int n = labels.length;
        return n >= 2 ? labels[n - 2] + "." + labels[n - 1] : host.toLowerCase(java.util.Locale.ROOT);
    }

    public static void setPrivacy(boolean upgradeToHttps, boolean doNotTrack) {
        httpsOnly = upgradeToHttps;
        sendDnt = doNotTrack;
    }

    private void configure() {
        WebSettings settings = getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(!incognito);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setGeolocationEnabled(true);
        settings.setUserAgentString(settings.getUserAgentString() + " Vex/0.1");
        // Mixed content stays off: an https page pulling http subresources is
        // exactly what the desktop build's HTTPS-only mode refuses too.
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSaveFormData(!incognito);
        if (incognito) settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setSafeBrowsingEnabled(true);

        setBackgroundColor(0xFFFFFFFF);
        setVerticalScrollBarEnabled(true);
        setHorizontalScrollBarEnabled(false);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        // Third-party cookies off by default, like the desktop privacy defaults.
        cookies.setAcceptThirdPartyCookies(this, false);

        // A private tab wants its own cookie jar and cache. WebView grew real
        // profiles in 2023 (androidx.webkit MULTI_PROFILE); on a device whose
        // WebView is older there is no separation to be had, and the tab is
        // only "private" in that nothing is written to Vex's own history —
        // see mobile/PORTING.md.
        if (incognito) applyPrivateProfile();

        setWebViewClient(new VexWebViewClient());
        setWebChromeClient(new VexChromeClient());
        setFindListener((activeMatchOrdinal, numberOfMatches, isDoneCounting) -> {
            if (!isDoneCounting) return;
            JSObject data = new JSObject();
            data.put("id", id);
            data.put("activeMatch", activeMatchOrdinal);
            data.put("matches", numberOfMatches);
            host.emit("findResult", data);
        });
        setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) ->
                startDownload(url, userAgent, contentDisposition, mimeType, contentLength));

        // Long-press on a link or an image. The chrome draws the sheet; all it
        // needs from here is what was under the finger.
        setOnLongClickListener(view -> {
            HitTestResult hit = getHitTestResult();
            if (hit == null) return false;
            String link = null, image = null;
            switch (hit.getType()) {
                case HitTestResult.SRC_ANCHOR_TYPE:
                    link = hit.getExtra();
                    break;
                case HitTestResult.SRC_IMAGE_ANCHOR_TYPE:
                    // An image that is also a link: the hit result has the image,
                    // and the href has to be asked for. Both go in ONE event —
                    // emitting the image now and the link a moment later gave the
                    // chrome two sheets, and the second replaced the first and
                    // took the image's own actions with it.
                    requestLinkForImage(hit.getExtra());
                    return true;
                case HitTestResult.IMAGE_TYPE:
                    image = hit.getExtra();
                    break;
                default:
                    return false;
            }
            JSObject data = new JSObject();
            data.put("id", id);
            data.put("link", link == null ? "" : link);
            data.put("image", image == null ? "" : image);
            host.emit("longPress", data);
            return true;
        });
    }

    public static final String PRIVATE_PROFILE = "vex-private";

    /**
     * Put this tab on its own WebView profile when the device's WebView has the
     * multi-profile API, so private tabs get a separate cookie jar and cache.
     *
     * Reflection on purpose: the API landed in androidx.webkit 1.10 and the
     * feature constant only exists from that version, so calling it directly
     * would make the whole app fail to compile against an older webkit
     * artifact. A device without it still gets a tab that writes nothing to
     * Vex's history — but it shares the cookie jar. PORTING.md says so plainly.
     */
    private void applyPrivateProfile() {
        try {
            Class<?> featureClass = Class.forName("androidx.webkit.WebViewFeature");
            String feature = (String) featureClass.getField("MULTI_PROFILE").get(null);
            boolean supported = (Boolean) featureClass
                    .getMethod("isFeatureSupported", String.class)
                    .invoke(null, feature);
            if (!supported) return;
            Class<?> storeClass = Class.forName("androidx.webkit.ProfileStore");
            Object store = storeClass.getMethod("getInstance").invoke(null);
            storeClass.getMethod("getOrCreateProfile", String.class).invoke(store, PRIVATE_PROFILE);
            Class.forName("androidx.webkit.WebViewCompat")
                    .getMethod("setProfile", WebView.class, String.class)
                    .invoke(null, this, PRIVATE_PROFILE);
        } catch (Throwable ignored) {
            // No multi-profile support on this device's WebView.
        }
    }

    /** Drop the private profile's cookies and cache when the last one closes. */
    public static void deletePrivateProfile() {
        try {
            Class<?> storeClass = Class.forName("androidx.webkit.ProfileStore");
            Object store = storeClass.getMethod("getInstance").invoke(null);
            storeClass.getMethod("deleteProfile", String.class).invoke(store, PRIVATE_PROFILE);
        } catch (Throwable ignored) {
        }
    }

    // ── Public controls used by the plugin ───────────────────────────────────

    public void navigate(String url) {
        String target = url;
        if (httpsOnly && target != null && target.startsWith("http://")) {
            target = "https://" + target.substring("http://".length());
        }
        if (sendDnt) {
            Map<String, String> headers = new HashMap<>();
            headers.put("DNT", "1");
            headers.put("Sec-GPC", "1");
            loadUrl(target, headers);
        } else {
            loadUrl(target);
        }
    }

    public void setDesktopMode(boolean enabled) {
        desktopMode = enabled;
        WebSettings settings = getSettings();
        if (enabled) {
            settings.setUserAgentString(DESKTOP_UA);
            settings.setUseWideViewPort(true);
            settings.setLoadWithOverviewMode(true);
        } else {
            settings.setUserAgentString(null);
            settings.setUserAgentString(settings.getUserAgentString() + " Vex/0.1");
        }
        reload();
    }

    public boolean isDesktopMode() {
        return desktopMode;
    }

    public void setDarkPages(boolean enabled) {
        try {
            if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
                WebSettingsCompat.setAlgorithmicDarkeningAllowed(getSettings(), enabled);
            }
        } catch (Throwable ignored) {
        }
    }

    public void setTextZoom(int percent) {
        getSettings().setTextZoom(Math.max(50, Math.min(300, percent)));
    }

    /**
     * A scaled JPEG of the current page, for the tab switcher's cards.
     *
     * Drawing the view has to happen on the UI thread; encoding it does not, and
     * should not — a JPEG and a base64 string of a phone-sized bitmap is tens of
     * milliseconds of jank every time you open the switcher, which is exactly the
     * moment an animation is running. So: draw here, encode on a worker, answer
     * through the callback.
     */
    public interface Snapshot {
        void onSnapshot(String dataUrl);
    }

    public void snapshot(final Snapshot callback) {
        int width = getWidth(), height = getHeight();
        if (width <= 0 || height <= 0) { callback.onSnapshot(""); return; }
        float scale = Math.min(1f, 480f / width);
        final Bitmap bitmap = Bitmap.createBitmap(Math.round(width * scale), Math.round(height * scale),
                Bitmap.Config.RGB_565);
        Canvas canvas = new Canvas(bitmap);
        canvas.scale(scale, scale);
        draw(canvas);
        SNAPSHOTS.execute(() -> {
            String dataUrl = "";
            try {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                bitmap.compress(Bitmap.CompressFormat.JPEG, 55, out);
                dataUrl = "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
            } catch (Throwable ignored) {
                // A snapshot nobody can take is a card without a picture.
            } finally {
                bitmap.recycle();
            }
            callback.onSnapshot(dataUrl);
        });
    }

    /** One thread: snapshots are never urgent and never want to be parallel. */
    private static final java.util.concurrent.ExecutorService SNAPSHOTS =
            java.util.concurrent.Executors.newSingleThreadExecutor();

    public void setScriptsEnabled(boolean enabled) {
        // A page cannot be un-run, so this takes effect on the next load. The
        // chrome reloads after flipping it (js/site-rules.js).
        getSettings().setJavaScriptEnabled(enabled);
    }

    public void setImagesEnabled(boolean enabled) {
        getSettings().setLoadsImagesAutomatically(enabled);
        getSettings().setBlockNetworkImage(!enabled);
    }

    /**
     * Vex requires a gesture before media plays, everywhere, which is why a news
     * site cannot start a video at you. Some sites are the reason you went there
     * — a music player, the next episode — so it can be allowed per site.
     */
    public void setAutoplayAllowed(boolean allowed) {
        getSettings().setMediaPlaybackRequiresUserGesture(!allowed);
    }

    public void setZoom(float factor) {
        // WebView has no setZoomFactor; text zoom is the honest equivalent and
        // does not break layouts the way a forced viewport scale does.
        getSettings().setTextZoom(Math.max(50, Math.min(300, Math.round(factor * 100))));
    }

    public void setUserAgent(String userAgent) {
        getSettings().setUserAgentString(userAgent == null || userAgent.isEmpty() ? null : userAgent);
    }

    /**
     * Run a script before any page script on every future navigation. This is
     * the hook the desktop build gets from a preload: fingerprint shims have to
     * be in place before the page's first line runs, and anything injected at
     * onPageStarted is already too late for a script in <head>.
     *
     * Needs WebView 83+ (DOCUMENT_START_SCRIPT). Without it the caller still
     * gets the page-started injection, which covers most pages and not the
     * fastest ones — see PORTING.md.
     */
    public boolean setDocumentStartScript(String script) {
        if (documentStart != null) {
            try { documentStart.remove(); } catch (Throwable ignored) { }
            documentStart = null;
        }
        if (script == null || script.isEmpty()) return true;
        pendingStartScript = script;
        try {
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return false;
            documentStart = WebViewCompat.addDocumentStartJavaScript(this, script, Collections.singleton("*"));
            return true;
        } catch (Throwable ignored) {
            return false;
        }
    }

    /** The system print dialog, which is also how Android saves a page as PDF. */
    public void print() {
        PrintManager manager = (PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);
        if (manager == null) return;
        String name = (getTitle() == null || getTitle().isEmpty() ? "Vex page" : getTitle()).replaceAll("[\\\\/:*?\"<>|]", "-");
        PrintDocumentAdapter adapter = createPrintDocumentAdapter(name);
        manager.print(name, adapter, new PrintAttributes.Builder().build());
    }

    /** Download a URL the user chose from the long-press sheet. */
    public void download(String url) {
        startDownload(url, getSettings().getUserAgentString(), null, null, 0);
    }

    public int scrollY() {
        return getScrollY();
    }

    /**
     * The toolbar gets out of the way as you read and comes back when you go
     * up, the way Samsung Internet's does. The chrome cannot see the page's
     * scrolling — the page is a native view on top of it — so the deltas are
     * reported from here, throttled, because this fires on every frame of a
     * fling.
     */
    @Override
    protected void onScrollChanged(int left, int top, int oldLeft, int oldTop) {
        super.onScrollChanged(left, top, oldLeft, oldTop);
        int delta = top - oldTop;
        if (delta == 0) return;
        scrollPending += delta;
        long now = System.currentTimeMillis();
        if (now - lastScrollReport < 80) return;
        lastScrollReport = now;
        JSObject data = new JSObject();
        data.put("id", id);
        data.put("dy", scrollPending);
        data.put("y", top);
        data.put("atTop", top <= 0);
        scrollPending = 0;
        host.emit("scroll", data);
    }

    /**
     * The menu that appears when you select text. Android gives a page's
     * selection Copy/Share/Web search; Vex adds its own — ask the assistant
     * about the selection, translate it, keep it as a note — because the
     * selection is the one moment the browser knows exactly what you mean.
     */
    @Override
    public ActionMode startActionMode(ActionMode.Callback callback, int type) {
        return super.startActionMode(wrapSelectionMenu(callback), type);
    }

    @Override
    public ActionMode startActionMode(ActionMode.Callback callback) {
        return super.startActionMode(wrapSelectionMenu(callback));
    }

    // "Polish" is Gemini Nano's: proofreading and rewriting happen on the phone,
    // which is why it sits beside Copy rather than behind the assistant.
    private static final String[] SELECTION_ACTIONS = { "Ask Vex", "Translate", "Polish", "Keep as a note" };

    private ActionMode.Callback wrapSelectionMenu(final ActionMode.Callback inner) {
        return new ActionMode.Callback() {
            @Override
            public boolean onCreateActionMode(ActionMode mode, Menu menu) {
                return inner.onCreateActionMode(mode, menu);
            }

            @Override
            public boolean onPrepareActionMode(ActionMode mode, Menu menu) {
                boolean changed = inner.onPrepareActionMode(mode, menu);
                for (int index = 0; index < SELECTION_ACTIONS.length; index++) {
                    if (menu.findItem(SELECTION_MENU_BASE + index) == null) {
                        menu.add(Menu.NONE, SELECTION_MENU_BASE + index, Menu.CATEGORY_SECONDARY + index,
                                SELECTION_ACTIONS[index]);
                    }
                }
                return true;
            }

            @Override
            public boolean onActionItemClicked(ActionMode mode, MenuItem item) {
                int index = item.getItemId() - SELECTION_MENU_BASE;
                if (index < 0 || index >= SELECTION_ACTIONS.length) return inner.onActionItemClicked(mode, item);
                final String action = index == 0 ? "ask" : index == 1 ? "translate"
                        : index == 2 ? "polish" : "note";
                // The text lives in the page, so ask the page for it.
                evaluateJavascript("(function(){return window.getSelection?String(window.getSelection()):''})()",
                        value -> {
                            String text = value == null ? "" : value;
                            if (text.startsWith("\"") && text.endsWith("\"")) {
                                text = text.substring(1, text.length() - 1)
                                        .replace("\\n", "\n").replace("\\\"", "\"").replace("\\\\", "\\");
                            }
                            JSObject data = new JSObject();
                            data.put("id", id);
                            data.put("action", action);
                            data.put("text", text);
                            host.emit("selection", data);
                        });
                mode.finish();
                return true;
            }

            @Override
            public void onDestroyActionMode(ActionMode mode) {
                inner.onDestroyActionMode(mode);
            }
        };
    }

    private static final int SELECTION_MENU_BASE = 0x7e10;

    /** Render a saved page: its own HTML, under its own address. */
    /**
     * Put HTML on screen under a base URL. Two callers: Vex's own error page,
     * and a saved page being read back.
     *
     * loadDataWithBaseURL gives the document the ORIGIN of its base URL, which
     * is what makes a saved page's relative images and stylesheets resolve — and
     * would also let a script in it run as that site against today's cookies.
     * That is dealt with where it belongs: js/tools.js takes the scripts out
     * when the page is saved, so there is nothing left to run. Turning
     * JavaScript off here instead would also turn off the chrome's own
     * evaluateJavascript, which is how the reader, the selection menu and the
     * translator reach a page at all.
     */
    public void loadHtml(String html, String baseUrl) {
        loadDataWithBaseURL(baseUrl == null || baseUrl.isEmpty() ? null : baseUrl,
                html, "text/html", "utf-8", baseUrl);
    }

    /**
     * A picture of the page. `full` scrolls through it and stitches, capped at
     * six screens — past that the bitmap is bigger than the memory a phone
     * will hand out for a screenshot.
     */
    public Bitmap capture(boolean full) {
        int width = getWidth(), height = getHeight();
        if (width <= 0 || height <= 0) return null;
        if (!full) {
            Bitmap single = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
            draw(new Canvas(single));
            return single;
        }
        int contentHeight = Math.round(getContentHeight() * getScale());
        int total = Math.min(contentHeight, height * 6);
        if (total <= 0) return null;
        Bitmap stitched = Bitmap.createBitmap(width, total, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(stitched);
        int originalScroll = getScrollY();
        for (int offset = 0; offset < total; offset += height) {
            scrollTo(0, offset);
            canvas.save();
            canvas.translate(0, offset);
            draw(canvas);
            canvas.restore();
        }
        scrollTo(0, originalScroll);
        return stitched;
    }

    public void restoreScroll(int y) {
        // The page is still laying out when a restored tab first paints; try a
        // few times rather than scrolling into a document that has no height yet.
        final int[] attempts = {0};
        final Runnable[] retry = new Runnable[1];
        retry[0] = () -> {
            scrollTo(0, y);
            if (++attempts[0] < 6 && getScrollY() < y) main.postDelayed(retry[0], 180);
        };
        main.postDelayed(retry[0], 180);
    }

    /**
     * The link around an image, best-effort, and then one event carrying both.
     *
     * With scripts off for the site there is nobody to ask, and the callback
     * would never arrive — so the sheet is sent straight away with the image
     * alone rather than not at all.
     */
    private void requestLinkForImage(String image) {
        final String picture = image == null ? "" : image;
        if (!getSettings().getJavaScriptEnabled()) {
            emitLongPress("", picture);
            return;
        }
        evaluateJavascript(
                "(function(){var a=document.activeElement;return a&&a.closest?"
                        + "(a.closest('a')||{}).href||'':'';})()",
                value -> {
                    String link = value == null ? "" : value.replaceAll("^\"|\"$", "");
                    if ("null".equals(link) || link.length() < 3) link = "";
                    emitLongPress(link, picture);
                });
    }

    private void emitLongPress(String link, String image) {
        JSObject data = new JSObject();
        data.put("id", id);
        data.put("link", link);
        data.put("image", image);
        host.emit("longPress", data);
    }

    private static String encodeIcon(Bitmap icon) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        icon.compress(Bitmap.CompressFormat.PNG, 100, out);
        return "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
    }

    // ── Events ───────────────────────────────────────────────────────────────

    private JSObject base() {
        JSObject data = new JSObject();
        data.put("id", id);
        data.put("url", getUrl() == null ? "" : getUrl());
        data.put("title", getTitle() == null ? "" : getTitle());
        data.put("canGoBack", canGoBack());
        data.put("canGoForward", canGoForward());
        return data;
    }

    /** Blocked requests arrive on network threads; report them in batches. */
    private void reportBlocked() {
        blockedPending.incrementAndGet();
        if (flushScheduled) return;
        flushScheduled = true;
        main.postDelayed(() -> {
            flushScheduled = false;
            int count = blockedPending.getAndSet(0);
            if (count <= 0) return;
            JSObject data = new JSObject();
            data.put("id", id);
            data.put("count", count);
            host.emit("blocked", data);
        }, 700);
    }

    private void injectCosmetic() {
        String css = BlockEngine.get().cosmeticCss(pageHost);
        if (css.isEmpty()) return;
        String script = "(function(){var s=document.getElementById('vex-cosmetic');"
                + "if(!s){s=document.createElement('style');s.id='vex-cosmetic';"
                + "(document.head||document.documentElement).appendChild(s);}"
                + "s.textContent=" + org.json.JSONObject.quote(css) + ";})();";
        evaluateJavascript(script, null);
    }

    private void startDownload(String url, String userAgent, String contentDisposition, String mimeType, long size) {
        String filename = URLUtil.guessFileName(url, contentDisposition, mimeType);
        String scheme = Uri.parse(url).getScheme();

        // A PDF is the one thing a WebView hands straight to the downloader
        // rather than showing, because Android's WebView cannot render one. Vex
        // can, so a PDF is an event for the chrome instead of a file in
        // Downloads — which is what every other browser does and what a person
        // tapping a link to a timetable expects.
        boolean isPdf = (mimeType != null && mimeType.toLowerCase().contains("pdf"))
                || filename.toLowerCase().endsWith(".pdf");
        if (isPdf) {
            JSObject pdf = new JSObject();
            pdf.put("id", id);
            pdf.put("url", url);
            pdf.put("filename", filename);
            pdf.put("size", size);
            host.emit("pdf", pdf);
            return;
        }

        JSObject data = new JSObject();
        data.put("id", id);
        data.put("url", url);
        data.put("filename", filename);
        data.put("mimeType", mimeType);
        data.put("size", size);
        // A file the page made itself — a generated CSV, an exported drawing —
        // arrives as blob: or data:, and DownloadManager takes neither: it refuses
        // anything it cannot fetch over the network, so those downloads simply
        // failed. The chrome reads them out of the page instead and hands the
        // bytes back to saveBytes(), so the flag has to travel with the event.
        boolean local = !"http".equals(scheme) && !"https".equals(scheme);
        data.put("local", local);
        if (local) {
            host.emit("download", data);
            return;
        }
        // Queued before the event goes out, so the event can carry the queue's
        // id: the downloads list matches a row to its progress by that id, and
        // by address alone two downloads of the same file were one row twice.
        try {
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setMimeType(mimeType);
            request.addRequestHeader("User-Agent", userAgent);
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null) request.addRequestHeader("Cookie", cookie);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename);
            DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            if (manager != null) data.put("downloadId", String.valueOf(manager.enqueue(request)));
            host.emit("download", data);
        } catch (Exception ex) {
            JSObject error = new JSObject();
            error.put("id", id);
            error.put("description", "Download failed: " + ex.getMessage());
            host.emit("error", error);
        }
    }

    private void noteStream(Uri url) {
        if (url == null) return;
        String scheme = url.getScheme();
        if (!"https".equals(scheme) && !"http".equals(scheme)) return;
        String path = url.getPath();
        if (path != null && path.toLowerCase(java.util.Locale.ROOT).endsWith(".m3u8")) lastStream = url.toString();
    }

    /** The playlist the page is playing from, if it played one. */
    public String streamUrl() { return lastStream; }

    public String userAgent() { return getSettings().getUserAgentString(); }

    /**
     * Save a file the chrome chose to download after all — a PDF, a video.
     * Returns the queue's id, so the downloads list can follow it; -1 when it
     * could not be queued.
     */
    public long saveToDownloads(String url, String filename) {
        try {
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.addRequestHeader("User-Agent", getSettings().getUserAgentString());
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null) request.addRequestHeader("Cookie", cookie);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename);
            DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            return manager != null ? manager.enqueue(request) : -1;
        } catch (Exception ex) {
            JSObject error = new JSObject();
            error.put("id", id);
            error.put("description", "Download failed: " + ex.getMessage());
            host.emit("error", error);
            return -1;
        }
    }

    /**
     * Write bytes into the phone's Downloads folder and return the Uri.
     *
     * Two paths, because minSdk is 26: MediaStore from Android 10, where an app
     * cannot write the public folder directly, and the folder itself before that,
     * which is what the WRITE_EXTERNAL_STORAGE permission in the manifest is
     * capped at API 28 for.
     */
    public String saveBytes(String filename, String mimeType, byte[] bytes) throws Exception {
        return saveBytes(getContext(), filename, mimeType, bytes);
    }

    /** The same, for a file with no tab behind it: a backup, an export. */
    public static String saveBytes(Context context, String filename, String mimeType, byte[] bytes) throws Exception {
        String name = filename == null || filename.trim().isEmpty() ? "download" : filename.trim();
        // A name is not a path: a page does not get to choose where this lands.
        name = name.replace('/', '_').replace('\\', '_');
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
            android.content.ContentValues values = new android.content.ContentValues();
            values.put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, name);
            if (mimeType != null && !mimeType.isEmpty()) {
                values.put(android.provider.MediaStore.MediaColumns.MIME_TYPE, mimeType);
            }
            values.put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
            Uri target = context.getContentResolver()
                    .insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (target == null) throw new java.io.IOException("Downloads is not writable");
            java.io.OutputStream out = context.getContentResolver().openOutputStream(target);
            if (out == null) throw new java.io.IOException("Downloads is not writable");
            try { out.write(bytes); } finally { out.close(); }
            return target.toString();
        }
        java.io.File folder = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        if (folder != null && !folder.exists()) folder.mkdirs();
        java.io.File file = new java.io.File(folder, name);
        java.io.FileOutputStream out = new java.io.FileOutputStream(file);
        try { out.write(bytes); } finally { out.close(); }
        return Uri.fromFile(file).toString();
    }

    // ── Clients ──────────────────────────────────────────────────────────────

    private final class VexWebViewClient extends WebViewClient {

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            noteStream(request.getUrl());
            WebResourceResponse blocked =
                    BlockEngine.get().intercept(pageHost, request.getUrl(), request.isForMainFrame());
            if (blocked != null) reportBlocked();
            return blocked;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            String scheme = uri.getScheme();
            if (scheme == null) return false;
            // A link you tapped to another site that an app owns — a YouTube
            // video, a post on X — opens in that app, as Samsung Internet and
            // Chrome do. Only a tap (a redirect or a script is not you), only
            // to another site (a page you are using in the browser keeps its
            // own links), never from a private tab, and only an app that is not
            // a browser: FLAG_ACTIVITY_REQUIRE_NON_BROWSER makes Android refuse
            // rather than offer Vex itself or another browser.
            if (openInApps && !incognito && request.isForMainFrame() && request.hasGesture()
                    && ("http".equals(scheme) || "https".equals(scheme))
                    && android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R
                    && uri.getHost() != null && !sameSite(uri.getHost(), pageHost)) {
                Intent app = new Intent(Intent.ACTION_VIEW, uri);
                app.addCategory(Intent.CATEGORY_BROWSABLE);
                app.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REQUIRE_NON_BROWSER);
                try {
                    getContext().startActivity(app);
                    JSObject data = new JSObject();
                    data.put("id", id);
                    data.put("url", uri.toString());
                    host.emit("openedInApp", data);
                    return true;
                } catch (ActivityNotFoundException ignored) {
                    // No app for it: the browser it is.
                }
            }
            if (scheme.equals("http") && httpsOnly) {
                view.loadUrl(uri.buildUpon().scheme("https").build().toString());
                return true;
            }
            if (scheme.equals("http") || scheme.equals("https") || scheme.equals("about")
                    || scheme.equals("data") || scheme.equals("file")) {
                return false;
            }
            // vex:// is the chrome talking to itself: the buttons on Vex's own
            // error page are links, because a page cannot call the chrome.
            if (scheme.equals("vex")) {
                JSObject data = new JSObject();
                data.put("id", id);
                data.put("command", uri.getHost() == null ? "" : uri.getHost());
                data.put("value", uri.getQuery() == null ? "" : uri.getQuery());
                host.emit("command", data);
                return true;
            }
            // mailto:, tel:, intent:, market: … belong to other apps.
            String fallback = null;
            try {
                Intent intent = scheme.equals("intent")
                        ? Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME)
                        : new Intent(Intent.ACTION_VIEW, uri);
                // An intent: link names a web page to use when the app is not
                // installed — Maps, the "open in the app" banners. Chrome goes
                // there; Vex said "No app can open intent:" instead.
                String named = intent.getStringExtra("browser_fallback_url");
                if (named != null && (named.startsWith("https://") || named.startsWith("http://"))) fallback = named;
                // An intent: URL is written by the page, so everything in it that
                // could aim it somewhere a web page should not reach is removed.
                // A component or a selector picked by the page is how an intent:
                // link becomes a way to start something on your behalf; BROWSABLE
                // is the category an app declares to say "a web page may open me",
                // and requiring it is what keeps the rest out. The uri-permission
                // flags are dropped because granting a page's chosen Uri to
                // another app is not something a link gets to ask for.
                intent.setComponent(null);
                intent.setSelector(null);
                intent.addCategory(Intent.CATEGORY_BROWSABLE);
                intent.removeFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                        | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                        | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                        | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            } catch (ActivityNotFoundException | java.net.URISyntaxException ex) {
                if (fallback != null) {
                    view.loadUrl(fallback);
                    return true;
                }
                JSObject data = new JSObject();
                data.put("id", id);
                data.put("description", "No app can open " + scheme + ":");
                host.emit("error", data);
            }
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            lastStream = "";
            pageHost = Uri.parse(url).getHost();
            if (pageHost == null) pageHost = "";
            JSObject data = new JSObject();
            data.put("id", id);
            data.put("url", url);
            host.emit("loadStart", data);
            // Without DOCUMENT_START_SCRIPT this is the earliest we can be.
            if (documentStart == null && !pendingStartScript.isEmpty()) {
                evaluateJavascript(pendingStartScript, null);
            }
            injectCosmetic();
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            injectCosmetic();
            host.emit("loadEnd", base());
        }

        @Override
        public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
            host.emit("urlChange", base());
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame()) return;
            JSObject data = new JSObject();
            data.put("id", id);
            data.put("code", error.getErrorCode());
            data.put("description", String.valueOf(error.getDescription()));
            host.emit("error", data);
        }

        @Override
        public void onReceivedSslError(WebView view, android.webkit.SslErrorHandler handler, android.net.http.SslError error) {
            // No "proceed anyway" here: the desktop build refuses a bad
            // certificate outright, and a phone is a worse place to override one.
            handler.cancel();
            JSObject data = new JSObject();
            data.put("id", id);
            data.put("description", "This site's certificate is not valid.");
            host.emit("error", data);
        }
    }

    private final class VexChromeClient extends WebChromeClient {

        @Override
        public void onProgressChanged(WebView view, int newProgress) {
            JSObject data = new JSObject();
            data.put("id", id);
            data.put("progress", newProgress);
            host.emit("loadProgress", data);
        }

        @Override
        public void onReceivedIcon(WebView view, Bitmap icon) {
            if (icon == null) return;
            JSObject data = new JSObject();
            data.put("id", id);
            data.put("icon", encodeIcon(icon));
            host.emit("icon", data);
        }

        @Override
        public void onReceivedTitle(WebView view, String title) {
            JSObject data = new JSObject();
            data.put("id", id);
            data.put("title", title == null ? "" : title);
            host.emit("title", data);
        }

        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
            // A link the user tapped: the hit-test already knows where it goes.
            // Only for a tap — the hit-test keeps the last thing touched, so a
            // script's window.open() with no gesture behind it used to open
            // whatever link you had tapped before instead of what it asked for.
            // And only for a plain link: on an image inside a link the hit-test's
            // address is the picture's, not the link's, so the relay below is
            // the way to learn where it really goes.
            WebView.HitTestResult hit = isUserGesture ? view.getHitTestResult() : null;
            String href = hit == null || hit.getType() != WebView.HitTestResult.SRC_ANCHOR_TYPE ? null : hit.getExtra();
            if (href != null && (href.startsWith("http://") || href.startsWith("https://"))) {
                host.openInNewTab(href, !isUserGesture);
                return false;
            }
            // window.open() with a computed URL: hand the transport a throwaway
            // WebView and take the first navigation it attempts.
            final WebView[] holder = new WebView[1];
            WebView relay = new WebView(getContext());
            holder[0] = relay;
            relay.getSettings().setJavaScriptEnabled(false);
            relay.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                    host.openInNewTab(request.getUrl().toString(), !isUserGesture);
                    if (holder[0] != null) {
                        holder[0].destroy();
                        holder[0] = null;
                    }
                    return true;
                }
            });
            ((WebView.WebViewTransport) resultMsg.obj).setWebView(relay);
            resultMsg.sendToTarget();
            // window.open('') with nothing following it leaves this WebView with
            // no navigation to take and nobody to destroy it — a whole WebView
            // and the context it holds, per pop-up. Ten seconds is longer than a
            // transport takes to be used.
            main.postDelayed(() -> {
                if (holder[0] != null) {
                    holder[0].destroy();
                    holder[0] = null;
                }
            }, 10000);
            return true;
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            try {
                host.chooseFile(params.createIntent(), callback);
                return true;
            } catch (Exception ex) {
                return false;
            }
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            // Two layers have to agree, and this is the first of them: the chrome
            // decides whether THIS SITE may have it. Android's own grant is
            // checked again below, because a yes from the person is not a yes
            // from the system.
            java.util.List<String> kinds = new java.util.ArrayList<>();
            for (String resource : request.getResources()) {
                if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) kinds.add("camera");
                else if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) kinds.add("microphone");
            }
            if (kinds.isEmpty()) { request.deny(); return; }
            String origin = request.getOrigin() == null ? "" : request.getOrigin().toString();
            host.askPermission(id, origin, kinds, allowed -> {
                java.util.List<String> resources = new java.util.ArrayList<>();
                java.util.List<String> missing = new java.util.ArrayList<>();
                if (allowed.contains("camera")) {
                    if (hasPermission(android.Manifest.permission.CAMERA)) {
                        resources.add(PermissionRequest.RESOURCE_VIDEO_CAPTURE);
                    } else missing.add("camera");
                }
                if (allowed.contains("microphone")) {
                    if (hasPermission(android.Manifest.permission.RECORD_AUDIO)) {
                        resources.add(PermissionRequest.RESOURCE_AUDIO_CAPTURE);
                    } else missing.add("microphone");
                }
                if (!missing.isEmpty()) {
                    JSObject data = new JSObject();
                    data.put("id", id);
                    data.put("missing", android.text.TextUtils.join(",", missing));
                    host.emit("permission", data);
                }
                // The callbacks belong to the WebView's own thread.
                main.post(() -> {
                    if (resources.isEmpty()) request.deny();
                    else request.grant(resources.toArray(new String[0]));
                });
            });
        }

        @Override
        public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
            host.askPermission(id, origin, java.util.Collections.singletonList("location"), allowed -> {
                boolean ours = hasPermission(android.Manifest.permission.ACCESS_FINE_LOCATION)
                        || hasPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION);
                boolean yes = allowed.contains("location") && ours;
                if (allowed.contains("location") && !ours) {
                    JSObject data = new JSObject();
                    data.put("id", id);
                    data.put("missing", "location");
                    host.emit("permission", data);
                }
                // false, false: not remembered here either. The remembering is
                // the chrome's, in one place, where you can see and change it.
                main.post(() -> callback.invoke(origin, yes, false));
            });
        }

        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            host.showFullscreen(view, callback);
        }

        @Override
        public void onHideCustomView() {
            host.hideFullscreen();
        }
    }

    private boolean hasPermission(String permission) {
        return ContextCompat.checkSelfPermission(getContext(), permission) == PackageManager.PERMISSION_GRANTED;
    }
}
