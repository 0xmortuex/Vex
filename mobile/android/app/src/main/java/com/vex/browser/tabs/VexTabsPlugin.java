package com.vex.browser.tabs;

import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.util.DisplayMetrics;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.CookieManager;
import android.widget.FrameLayout;

import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.vex.browser.MainActivity;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The tab layer: creates, positions, shows and destroys the page WebViews, and
 * relays their events to the chrome.
 *
 * Geometry note — the chrome measures its content rect in CSS pixels and sends
 * it here; everything below converts with the display density. The container
 * is sized to exactly that rect rather than filling the window, so a tap on
 * the toolbar still reaches the chrome WebView underneath.
 */
@CapacitorPlugin(name = "VexTabs")
public class VexTabsPlugin extends Plugin implements TabWebView.Host {

    private EdgeSwipeLayout container;
    private FrameLayout fullscreenHost;
    private View fullscreenView;
    private WebChromeClient.CustomViewCallback fullscreenCallback;

    private final Map<String, TabWebView> tabs = new LinkedHashMap<>();
    // Each tab sits in its own pull-to-refresh frame; the frame is what gets
    // added to the container, so hiding a tab hides its refresh spinner too.
    private final Map<String, SwipeRefreshLayout> frames = new LinkedHashMap<>();
    private String activeId;
    private int sequence;
    private boolean visible = true;
    private int textZoom = 100;
    private boolean pullToRefresh = true;
    private boolean backgroundAudio = true;
    private String documentStartScript = "";
    private int[] bounds = new int[]{0, 0, 0, 0};    // left, top, width, height in px

    @Override
    public void load() {
        getActivity().runOnUiThread(() -> {
            View bridgeView = getBridge() == null ? null : getBridge().getWebView();
            ViewGroup root = bridgeView == null ? null : (ViewGroup) bridgeView.getParent();
            if (root == null) return;      // no chrome to hang the pages off yet
            container = new EdgeSwipeLayout(getContext(), direction -> {
                JSObject data = new JSObject();
                data.put("direction", direction);
                notifyListeners("edgeSwipe", data);
            });
            root.addView(container, new ViewGroup.LayoutParams(0, 0));
            fullscreenHost = new FrameLayout(getContext());
            fullscreenHost.setVisibility(View.GONE);
            fullscreenHost.setBackgroundColor(0xFF000000);
            root.addView(fullscreenHost, new ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        });
    }

    private float density() {
        DisplayMetrics metrics = getContext().getResources().getDisplayMetrics();
        return metrics.density;
    }

    private void applyContainerBounds() {
        if (container == null) return;
        ViewGroup.LayoutParams params = container.getLayoutParams();
        if (params instanceof ViewGroup.MarginLayoutParams) {
            ViewGroup.MarginLayoutParams margins = (ViewGroup.MarginLayoutParams) params;
            margins.leftMargin = bounds[0];
            margins.topMargin = bounds[1];
            margins.width = bounds[2];
            margins.height = bounds[3];
        } else {
            params.width = bounds[2];
            params.height = bounds[3];
        }
        container.setLayoutParams(params);
        container.setVisibility(visible && bounds[2] > 0 && bounds[3] > 0 ? View.VISIBLE : View.GONE);
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────

    @PluginMethod
    public void create(PluginCall call) {
        final String url = call.getString("url", "about:blank");
        final boolean incognito = Boolean.TRUE.equals(call.getBoolean("incognito", false));
        final String id = "t" + (++sequence);
        getActivity().runOnUiThread(() -> {
            TabWebView tab = new TabWebView(getContext(), id, incognito, this);
            tab.setTextZoom(textZoom);
            if (!documentStartScript.isEmpty()) tab.setDocumentStartScript(documentStartScript);

            SwipeRefreshLayout frame = new SwipeRefreshLayout(getContext());
            frame.addView(tab, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            frame.setEnabled(pullToRefresh);
            frame.setOnRefreshListener(() -> {
                tab.reload();
                // The spinner is stopped by the load finishing, not by the
                // gesture ending — see loadEnd below.
            });
            // Only pull from the very top: otherwise the gesture fights every
            // scroll-up inside the page.
            frame.setOnChildScrollUpCallback((parent, child) -> tab.getScrollY() > 0);
            frame.setVisibility(View.GONE);
            container.addView(frame, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            tabs.put(id, tab);
            frames.put(id, frame);
            if (url != null && !url.equals("about:blank")) tab.navigate(url);
            JSObject result = new JSObject();
            result.put("id", id);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void close(PluginCall call) {
        final String id = call.getString("id");
        getActivity().runOnUiThread(() -> {
            TabWebView tab = tabs.remove(id);
            SwipeRefreshLayout frame = frames.remove(id);
            if (tab != null) {
                boolean wasPrivate = tab.isIncognito();
                if (frame != null) { frame.removeView(tab); container.removeView(frame); }
                else container.removeView(tab);
                tab.stopLoading();
                tab.loadUrl("about:blank");
                tab.destroy();
                if (id.equals(activeId)) activeId = null;
                if (wasPrivate && !hasPrivateTabs()) TabWebView.deletePrivateProfile();
            }
            call.resolve();
        });
    }

    private boolean hasPrivateTabs() {
        for (TabWebView tab : tabs.values()) if (tab.isIncognito()) return true;
        return false;
    }

    @PluginMethod
    public void activate(PluginCall call) {
        final String id = call.getString("id");
        getActivity().runOnUiThread(() -> {
            for (Map.Entry<String, SwipeRefreshLayout> entry : frames.entrySet()) {
                // A background tab keeps running (audio, timers) but must not
                // draw; onPause would also silence video in the active tab.
                entry.getValue().setVisibility(entry.getKey().equals(id) ? View.VISIBLE : View.GONE);
            }
            activeId = tabs.containsKey(id) ? id : activeId;
            call.resolve();
        });
    }

    @PluginMethod
    public void setBounds(PluginCall call) {
        final float scale = density();
        final int x = Math.round(call.getFloat("x", 0f) * scale);
        final int y = Math.round(call.getFloat("y", 0f) * scale);
        final int width = Math.round(call.getFloat("width", 0f) * scale);
        final int height = Math.round(call.getFloat("height", 0f) * scale);
        getActivity().runOnUiThread(() -> {
            bounds = new int[]{x, y, width, height};
            applyContainerBounds();
            call.resolve();
        });
    }

    @PluginMethod
    public void setVisible(PluginCall call) {
        final boolean value = Boolean.TRUE.equals(call.getBoolean("visible", true));
        getActivity().runOnUiThread(() -> {
            visible = value;
            applyContainerBounds();
            call.resolve();
        });
    }

    // ── Navigation ───────────────────────────────────────────────────────────

    private interface TabAction {
        void run(TabWebView tab);
    }

    private void withTab(PluginCall call, TabAction action) {
        final String id = call.getString("id");
        getActivity().runOnUiThread(() -> {
            TabWebView tab = tabs.get(id);
            if (tab == null) {
                call.reject("No tab " + id);
                return;
            }
            action.run(tab);
            if (!call.isReleased()) call.resolve();
        });
    }

    @PluginMethod
    public void load(PluginCall call) {
        final String url = call.getString("url", "about:blank");
        withTab(call, tab -> tab.navigate(url));
    }

    @PluginMethod
    public void back(PluginCall call) {
        withTab(call, tab -> {
            if (tab.canGoBack()) tab.goBack();
        });
    }

    @PluginMethod
    public void forward(PluginCall call) {
        withTab(call, tab -> {
            if (tab.canGoForward()) tab.goForward();
        });
    }

    @PluginMethod
    public void reload(PluginCall call) {
        final boolean bypassCache = Boolean.TRUE.equals(call.getBoolean("bypassCache", false));
        withTab(call, tab -> {
            if (bypassCache) tab.clearCache(false);
            tab.reload();
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        withTab(call, WebView::stopLoading);
    }

    @PluginMethod
    public void state(PluginCall call) {
        final String id = call.getString("id");
        getActivity().runOnUiThread(() -> {
            TabWebView tab = tabs.get(id);
            JSObject result = new JSObject();
            result.put("url", tab == null || tab.getUrl() == null ? "" : tab.getUrl());
            result.put("title", tab == null || tab.getTitle() == null ? "" : tab.getTitle());
            result.put("canGoBack", tab != null && tab.canGoBack());
            result.put("canGoForward", tab != null && tab.canGoForward());
            result.put("desktopMode", tab != null && tab.isDesktopMode());
            call.resolve(result);
        });
    }

    // ── Page tools ───────────────────────────────────────────────────────────

    @PluginMethod
    public void snapshot(PluginCall call) {
        final String id = call.getString("id");
        getActivity().runOnUiThread(() -> {
            TabWebView tab = tabs.get(id);
            JSObject result = new JSObject();
            result.put("dataUrl", tab == null ? "" : tab.snapshot());
            call.resolve(result);
        });
    }

    @PluginMethod
    public void find(PluginCall call) {
        final String text = call.getString("text", "");
        withTab(call, tab -> tab.findAllAsync(text));
    }

    @PluginMethod
    public void findNext(PluginCall call) {
        final boolean forward = !Boolean.FALSE.equals(call.getBoolean("forward", true));
        withTab(call, tab -> tab.findNext(forward));
    }

    @PluginMethod
    public void clearFind(PluginCall call) {
        withTab(call, WebView::clearMatches);
    }

    @PluginMethod
    public void setDesktopMode(PluginCall call) {
        final boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        withTab(call, tab -> tab.setDesktopMode(enabled));
    }

    @PluginMethod
    public void setDarkMode(PluginCall call) {
        final boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        withTab(call, tab -> tab.setDarkPages(enabled));
    }

    @PluginMethod
    public void setTextZoom(PluginCall call) {
        final int percent = call.getInt("percent", 100);
        getActivity().runOnUiThread(() -> {
            textZoom = percent;
            for (TabWebView tab : tabs.values()) tab.setTextZoom(percent);
            call.resolve();
        });
    }

    @PluginMethod
    public void setScriptsEnabled(PluginCall call) {
        final boolean enabled = !Boolean.FALSE.equals(call.getBoolean("enabled", true));
        withTab(call, tab -> tab.setScriptsEnabled(enabled));
    }

    @PluginMethod
    public void setImagesEnabled(PluginCall call) {
        final boolean enabled = !Boolean.FALSE.equals(call.getBoolean("enabled", true));
        withTab(call, tab -> tab.setImagesEnabled(enabled));
    }

    @PluginMethod
    public void setZoom(PluginCall call) {
        final float factor = call.getFloat("factor", 1f);
        withTab(call, tab -> tab.setZoom(factor));
    }

    @PluginMethod
    public void setUserAgent(PluginCall call) {
        final String userAgent = call.getString("userAgent", "");
        withTab(call, tab -> tab.setUserAgent(userAgent));
    }

    @PluginMethod
    public void print(PluginCall call) {
        withTab(call, TabWebView::print);
    }

    @PluginMethod
    public void download(PluginCall call) {
        final String url = call.getString("url", "");
        withTab(call, tab -> tab.download(url));
    }

    @PluginMethod
    public void scrollPosition(PluginCall call) {
        final String id = call.getString("id");
        getActivity().runOnUiThread(() -> {
            TabWebView tab = tabs.get(id);
            JSObject result = new JSObject();
            result.put("y", tab == null ? 0 : tab.scrollY());
            call.resolve(result);
        });
    }

    @PluginMethod
    public void restoreScroll(PluginCall call) {
        final int y = call.getInt("y", 0);
        withTab(call, tab -> tab.restoreScroll(y));
    }

    /**
     * Install a script that runs before any page script, on every tab. The
     * chrome owns what it says (js/shield.js); this only decides where it goes.
     */
    @PluginMethod
    public void setDocumentStartScript(PluginCall call) {
        final String script = call.getString("script", "");
        getActivity().runOnUiThread(() -> {
            documentStartScript = script;
            boolean everyTab = true;
            for (TabWebView tab : tabs.values()) everyTab &= tab.setDocumentStartScript(script);
            JSObject result = new JSObject();
            // false means the device's WebView is too old for a true
            // document-start hook and the script runs at page-start instead.
            result.put("atDocumentStart", everyTab);
            call.resolve(result);
        });
    }

    /**
     * Paint the window and the system bars in the current theme. Without this
     * the area behind the chrome and the gesture bar stay the launch colour,
     * which is very visible on a dark theme and on rotation.
     */
    @PluginMethod
    public void setWindowBackground(PluginCall call) {
        final String color = call.getString("color", "#000000");
        final boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", true));
        getActivity().runOnUiThread(() -> {
            try {
                int value = Color.parseColor(color);
                getActivity().getWindow().setBackgroundDrawable(new ColorDrawable(value));
                getActivity().getWindow().setNavigationBarColor(value);
                getActivity().getWindow().setStatusBarColor(value);
                View decor = getActivity().getWindow().getDecorView();
                int flags = decor.getSystemUiVisibility();
                // Light system bars need dark icons, and the other way round.
                flags = dark
                        ? flags & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR & ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
                        : flags | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                decor.setSystemUiVisibility(flags);
                call.resolve();
            } catch (IllegalArgumentException ex) {
                call.reject("Not a colour: " + color);
            }
        });
    }

    @PluginMethod
    public void setPullToRefresh(PluginCall call) {
        final boolean enabled = !Boolean.FALSE.equals(call.getBoolean("enabled", true));
        getActivity().runOnUiThread(() -> {
            pullToRefresh = enabled;
            for (SwipeRefreshLayout frame : frames.values()) frame.setEnabled(enabled);
            call.resolve();
        });
    }

    /**
     * Whether a page keeps playing when Vex goes to the background. Off is the
     * polite default for a browser; on is what you want for a podcast, and is
     * why Samsung's media setting exists.
     */
    @PluginMethod
    public void setBackgroundAudio(PluginCall call) {
        backgroundAudio = !Boolean.FALSE.equals(call.getBoolean("enabled", true));
        call.resolve();
    }

    /** Render a saved page from its stored HTML. */
    @PluginMethod
    public void loadHtml(PluginCall call) {
        final String html = call.getString("html", "");
        final String baseUrl = call.getString("baseUrl", "");
        withTab(call, tab -> tab.loadHtml(html, baseUrl));
    }

    /**
     * A PNG of the page, written to the cache directory and handed back as a
     * path — a base64 image of a full page is many megabytes through the
     * bridge, and the only thing the chrome does with it is share or save it.
     */
    @PluginMethod
    public void capturePage(PluginCall call) {
        final String id = call.getString("id");
        final boolean full = Boolean.TRUE.equals(call.getBoolean("full", false));
        getActivity().runOnUiThread(() -> {
            TabWebView tab = tabs.get(id);
            if (tab == null) {
                call.reject("No tab " + id);
                return;
            }
            android.graphics.Bitmap bitmap = tab.capture(full);
            if (bitmap == null) {
                call.reject("Nothing to capture yet");
                return;
            }
            try {
                java.io.File directory = new java.io.File(getContext().getCacheDir(), "captures");
                if (!directory.exists() && !directory.mkdirs()) throw new java.io.IOException("Could not make the capture folder");
                java.io.File file = new java.io.File(directory, "vex-" + System.currentTimeMillis() + ".png");
                try (java.io.FileOutputStream out = new java.io.FileOutputStream(file)) {
                    bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, out);
                }
                bitmap.recycle();
                JSObject result = new JSObject();
                result.put("path", file.getAbsolutePath());
                result.put("width", tab.getWidth());
                call.resolve(result);
            } catch (Exception error) {
                bitmap.recycle();
                call.reject("Could not write the capture: " + error.getMessage());
            }
        });
    }

    /** What the system download queue is doing with our files. */
    @PluginMethod
    public void downloadStatus(PluginCall call) {
        try {
            android.app.DownloadManager manager =
                    (android.app.DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            JSArray rows = new JSArray();
            if (manager == null) {
                JSObject empty = new JSObject();
                empty.put("downloads", rows);
                call.resolve(empty);
                return;
            }
            android.database.Cursor cursor = manager.query(new android.app.DownloadManager.Query());
            while (cursor != null && cursor.moveToNext()) {
                JSObject row = new JSObject();
                row.put("id", cursor.getLong(cursor.getColumnIndexOrThrow(android.app.DownloadManager.COLUMN_ID)));
                row.put("url", cursor.getString(cursor.getColumnIndexOrThrow(android.app.DownloadManager.COLUMN_URI)));
                row.put("title", cursor.getString(cursor.getColumnIndexOrThrow(android.app.DownloadManager.COLUMN_TITLE)));
                row.put("status", cursor.getInt(cursor.getColumnIndexOrThrow(android.app.DownloadManager.COLUMN_STATUS)));
                row.put("downloaded", cursor.getLong(cursor.getColumnIndexOrThrow(android.app.DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)));
                row.put("total", cursor.getLong(cursor.getColumnIndexOrThrow(android.app.DownloadManager.COLUMN_TOTAL_SIZE_BYTES)));
                row.put("localUri", cursor.getString(cursor.getColumnIndexOrThrow(android.app.DownloadManager.COLUMN_LOCAL_URI)));
                rows.put(row);
            }
            if (cursor != null) cursor.close();
            JSObject result = new JSObject();
            result.put("downloads", rows);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Could not read the download queue: " + error.getMessage());
        }
    }

    /** Hand a finished download to whatever app opens that kind of file. */
    @PluginMethod
    public void openDownload(PluginCall call) {
        final String localUri = call.getString("localUri", "");
        getActivity().runOnUiThread(() -> {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setData(Uri.parse(localUri));
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(intent);
                call.resolve();
            } catch (Exception error) {
                call.reject("No app can open that file");
            }
        });
    }

    /** Forget one site: its cookies, its storage, its cache entries. */
    @PluginMethod
    public void clearSiteData(PluginCall call) {
        final String origin = call.getString("origin", "");
        final String host = call.getString("host", "");
        getActivity().runOnUiThread(() -> {
            if (!origin.isEmpty()) WebStorage.getInstance().deleteOrigin(origin);
            if (!host.isEmpty()) {
                CookieManager cookies = CookieManager.getInstance();
                String existing = cookies.getCookie("https://" + host);
                if (existing != null) {
                    for (String pair : existing.split(";")) {
                        String name = pair.split("=")[0].trim();
                        cookies.setCookie("https://" + host, name + "=; Max-Age=0; path=/");
                        cookies.setCookie("https://" + host, name + "=; Max-Age=0; path=/; domain=." + host);
                    }
                    cookies.flush();
                }
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void setPrivacy(PluginCall call) {
        TabWebView.setPrivacy(
                !Boolean.FALSE.equals(call.getBoolean("httpsOnly", true)),
                !Boolean.FALSE.equals(call.getBoolean("doNotTrack", true)));
        call.resolve();
    }

    @PluginMethod
    public void evaluate(PluginCall call) {
        final String code = call.getString("code", "");
        final String id = call.getString("id");
        getActivity().runOnUiThread(() -> {
            TabWebView tab = tabs.get(id);
            if (tab == null) {
                call.reject("No tab " + id);
                return;
            }
            tab.evaluateJavascript(code, value -> {
                JSObject result = new JSObject();
                result.put("result", value);
                call.resolve(result);
            });
        });
    }

    @PluginMethod
    public void clearData(PluginCall call) {
        final boolean cookies = !Boolean.FALSE.equals(call.getBoolean("cookies", true));
        final boolean cache = !Boolean.FALSE.equals(call.getBoolean("cache", true));
        final boolean storage = !Boolean.FALSE.equals(call.getBoolean("storage", true));
        getActivity().runOnUiThread(() -> {
            if (cookies) {
                CookieManager.getInstance().removeAllCookies(null);
                CookieManager.getInstance().flush();
            }
            if (storage) WebStorage.getInstance().deleteAllData();
            if (cache) {
                for (TabWebView tab : tabs.values()) {
                    tab.clearCache(true);
                    tab.clearFormData();
                    tab.clearHistory();
                }
            }
            call.resolve();
        });
    }

    // ── TabWebView.Host ──────────────────────────────────────────────────────

    @Override
    public void emit(String event, JSObject data) {
        if ("loadEnd".equals(event) || "error".equals(event)) {
            SwipeRefreshLayout frame = frames.get(data.getString("id"));
            if (frame != null && frame.isRefreshing()) frame.setRefreshing(false);
        }
        notifyListeners(event, data);
    }

    @Override
    protected void handleOnPause() {
        // Leaving the app stops timers and media unless the person asked for
        // audio to keep going.
        if (!backgroundAudio) {
            for (TabWebView tab : tabs.values()) tab.onPause();
        }
        super.handleOnPause();
    }

    @Override
    protected void handleOnResume() {
        for (TabWebView tab : tabs.values()) tab.onResume();
        super.handleOnResume();
    }

    @Override
    public void openInNewTab(String url, boolean background) {
        JSObject data = new JSObject();
        data.put("url", url);
        data.put("background", background);
        notifyListeners("newTab", data);
    }

    @Override
    public void chooseFile(Intent intent, ValueCallback<Uri[]> callback) {
        if (getActivity() instanceof MainActivity) {
            ((MainActivity) getActivity()).openFileChooser(intent, callback);
        } else {
            callback.onReceiveValue(null);
        }
    }

    @Override
    public void showFullscreen(View view, WebChromeClient.CustomViewCallback callback) {
        getActivity().runOnUiThread(() -> {
            if (fullscreenView != null) {
                callback.onCustomViewHidden();
                return;
            }
            fullscreenView = view;
            fullscreenCallback = callback;
            fullscreenHost.addView(view, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            fullscreenHost.setVisibility(View.VISIBLE);
            container.setVisibility(View.GONE);
            JSObject data = new JSObject();
            data.put("fullscreen", true);
            notifyListeners("fullscreen", data);
        });
    }

    @Override
    public void hideFullscreen() {
        getActivity().runOnUiThread(() -> {
            if (fullscreenView == null) return;
            fullscreenHost.removeView(fullscreenView);
            fullscreenHost.setVisibility(View.GONE);
            fullscreenView = null;
            if (fullscreenCallback != null) {
                fullscreenCallback.onCustomViewHidden();
                fullscreenCallback = null;
            }
            applyContainerBounds();
            JSObject data = new JSObject();
            data.put("fullscreen", false);
            notifyListeners("fullscreen", data);
        });
    }

    @Override
    protected void handleOnDestroy() {
        for (TabWebView tab : tabs.values()) tab.destroy();
        tabs.clear();
        TabWebView.deletePrivateProfile();
        super.handleOnDestroy();
    }
}
