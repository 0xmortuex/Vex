package com.getcapacitor;

import android.content.Context;

import androidx.appcompat.app.AppCompatActivity;

public class Plugin {
    public void load() { }
    public Context getContext() { return null; }
    public AppCompatActivity getActivity() { return null; }
    public Bridge getBridge() { return null; }
    public void execute(Runnable runnable) { }
    protected void notifyListeners(String eventName, JSObject data) { }
    protected void notifyListeners(String eventName, JSObject data, boolean retainUntilConsumed) { }
    protected void handleOnDestroy() { }
    protected void handleOnPause() { }
    protected void handleOnResume() { }
    public boolean hasPermission(String permission) { return false; }
}
