package com.getcapacitor;

import android.webkit.WebView;

import androidx.appcompat.app.AppCompatActivity;

public class Bridge {
    public WebView getWebView() { return null; }
    public AppCompatActivity getActivity() { return null; }
    public void triggerWindowJSEvent(String eventName) { }
    public void triggerWindowJSEvent(String eventName, String data) { }
    public void eval(String js, android.webkit.ValueCallback<String> callback) { }
}
