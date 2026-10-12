package com.getcapacitor;

import org.json.JSONException;
import org.json.JSONObject;

public class JSObject extends JSONObject {
    public JSObject() { super(); }
    public JSObject(String json) throws JSONException { super(json); }
    public static JSObject fromJSONObject(JSONObject obj) throws JSONException { return new JSObject(); }
    public JSObject put(String key, boolean value) { return this; }
    public JSObject put(String key, int value) { return this; }
    public JSObject put(String key, long value) { return this; }
    public JSObject put(String key, double value) { return this; }
    public JSObject put(String key, Object value) { return this; }
    public JSObject put(String key, String value) { return this; }
    public String getString(String key) { return null; }
    // Both overloads exist in @capacitor/android's own JSObject.java, which
    // ships as source inside the npm package — checked there, not guessed.
    public String getString(String key, String defaultValue) { return defaultValue; }
}
