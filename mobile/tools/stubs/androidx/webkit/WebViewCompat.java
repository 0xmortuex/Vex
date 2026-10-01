package androidx.webkit;

import android.webkit.WebView;

import java.util.Set;

public class WebViewCompat {
    public static ScriptHandler addDocumentStartJavaScript(WebView webView, String script, Set<String> allowedOriginRules) {
        return null;
    }

    // Which WebView is actually installed — a real androidx.webkit API, and the
    // first question any WebView-shaped bug report has to answer. Nullable.
    public static android.content.pm.PackageInfo getCurrentWebViewPackage(android.content.Context context) { return null; }
}
