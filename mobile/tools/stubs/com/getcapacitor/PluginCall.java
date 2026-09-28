package com.getcapacitor;

public class PluginCall {
    public String getString(String name) { return null; }
    public String getString(String name, String defaultValue) { return defaultValue; }
    public Integer getInt(String name) { return null; }
    public Integer getInt(String name, Integer defaultValue) { return defaultValue; }
    public Float getFloat(String name) { return null; }
    public Float getFloat(String name, Float defaultValue) { return defaultValue; }
    public Boolean getBoolean(String name) { return null; }
    public Boolean getBoolean(String name, Boolean defaultValue) { return defaultValue; }
    public JSObject getObject(String name) { return null; }
    public JSObject getObject(String name, JSObject defaultValue) { return defaultValue; }
    public JSArray getArray(String name) { return null; }
    public JSArray getArray(String name, JSArray defaultValue) { return defaultValue; }
    public void resolve() { }
    public void resolve(JSObject data) { }
    public void reject(String msg) { }
    public void reject(String msg, String code) { }
    public void setKeepAlive(Boolean keepAlive) { }
    public boolean isKeptAlive() { return false; }
    public boolean isReleased() { return false; }
}
