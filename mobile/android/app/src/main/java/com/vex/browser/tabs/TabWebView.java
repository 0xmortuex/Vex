package com.vex.browser.tabs;

import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.util.Base64;
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
import androidx.webkit.WebViewFeature;

import com.getcapacitor.JSObject;
import com.vex.browser.block.BlockEngine;

import java.io.ByteArrayOutputStream;
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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) settings.setSafeBrowsingEnabled(true);

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
                startDownload(url, userAgent, contentDisposition, mimeType));
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

    /** A scaled JPEG of the current page, for the tab switcher's cards. */
    public String snapshot() {
        int width = getWidth(), height = getHeight();
        if (width <= 0 || height <= 0) return "";
        float scale = Math.min(1f, 480f / width);
        Bitmap bitmap = Bitmap.createBitmap(Math.round(width * scale), Math.round(height * scale), Bitmap.Config.RGB_565);
        Canvas canvas = new Canvas(bitmap);
        canvas.scale(scale, scale);
        draw(canvas);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        bitmap.compress(Bitmap.CompressFormat.JPEG, 55, out);
        bitmap.recycle();
        return "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
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

    private void startDownload(String url, String userAgent, String contentDisposition, String mimeType) {
        String filename = URLUtil.guessFileName(url, contentDisposition, mimeType);
        JSObject data = new JSObject();
        data.put("id", id);
        data.put("url", url);
        data.put("filename", filename);
        data.put("mimeType", mimeType);
        host.emit("download", data);
        try {
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setMimeType(mimeType);
            request.addRequestHeader("User-Agent", userAgent);
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null) request.addRequestHeader("Cookie", cookie);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename);
            DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            if (manager != null) manager.enqueue(request);
        } catch (Exception ex) {
            JSObject error = new JSObject();
            error.put("id", id);
            error.put("description", "Download failed: " + ex.getMessage());
            host.emit("error", error);
        }
    }

    // ── Clients ──────────────────────────────────────────────────────────────

    private final class VexWebViewClient extends WebViewClient {

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
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
            if (scheme.equals("http") && httpsOnly) {
                view.loadUrl(uri.buildUpon().scheme("https").build().toString());
                return true;
            }
            if (scheme.equals("http") || scheme.equals("https") || scheme.equals("about")
                    || scheme.equals("data") || scheme.equals("file")) {
                return false;
            }
            // mailto:, tel:, intent:, market: … belong to other apps.
            try {
                Intent intent = scheme.equals("intent")
                        ? Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME)
                        : new Intent(Intent.ACTION_VIEW, uri);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            } catch (ActivityNotFoundException | java.net.URISyntaxException ex) {
                JSObject data = new JSObject();
                data.put("id", id);
                data.put("description", "No app can open " + scheme + ":");
                host.emit("error", data);
            }
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            pageHost = Uri.parse(url).getHost();
            if (pageHost == null) pageHost = "";
            JSObject data = new JSObject();
            data.put("id", id);
            data.put("url", url);
            host.emit("loadStart", data);
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
        public void onReceivedTitle(WebView view, String title) {
            JSObject data = new JSObject();
            data.put("id", id);
            data.put("title", title == null ? "" : title);
            host.emit("title", data);
        }

        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
            // A link the user tapped: the hit-test already knows where it goes.
            WebView.HitTestResult hit = view.getHitTestResult();
            String href = hit == null ? null : hit.getExtra();
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
            // Grant only what the app itself already holds; anything else is a
            // deny plus an event, so the chrome can explain why.
            String[] wanted = request.getResources();
            java.util.List<String> granted = new java.util.ArrayList<>();
            java.util.List<String> missing = new java.util.ArrayList<>();
            for (String resource : wanted) {
                if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) {
                    if (hasPermission(android.Manifest.permission.CAMERA)) granted.add(resource);
                    else missing.add("camera");
                } else if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                    if (hasPermission(android.Manifest.permission.RECORD_AUDIO)) granted.add(resource);
                    else missing.add("microphone");
                }
            }
            if (!missing.isEmpty()) {
                JSObject data = new JSObject();
                data.put("id", id);
                data.put("missing", android.text.TextUtils.join(",", missing));
                host.emit("permission", data);
            }
            if (granted.isEmpty()) request.deny();
            else request.grant(granted.toArray(new String[0]));
        }

        @Override
        public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
            boolean allowed = hasPermission(android.Manifest.permission.ACCESS_FINE_LOCATION)
                    || hasPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION);
            callback.invoke(origin, allowed, false);
            if (!allowed) {
                JSObject data = new JSObject();
                data.put("id", id);
                data.put("missing", "location");
                host.emit("permission", data);
            }
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
