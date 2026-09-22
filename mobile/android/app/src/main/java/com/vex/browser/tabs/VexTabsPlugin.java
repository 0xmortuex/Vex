package com.vex.browser.tabs;

import android.content.Intent;
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
    private String activeId;
    private int sequence;
    private boolean visible = true;
    private int textZoom = 100;
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
            tab.setVisibility(View.GONE);
            container.addView(tab, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            tabs.put(id, tab);
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
            if (tab != null) {
                boolean wasPrivate = tab.isIncognito();
                container.removeView(tab);
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
            for (Map.Entry<String, TabWebView> entry : tabs.entrySet()) {
                boolean on = entry.getKey().equals(id);
                entry.getValue().setVisibility(on ? View.VISIBLE : View.GONE);
                // A background tab keeps running (audio, timers) but must not
                // draw; onPause would also silence video in the active tab.
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
        notifyListeners(event, data);
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
