package com.vex.browser.remind;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * "Bring this page back at six." The chrome keeps the list; this only asks
 * Android to wake up at the right moment, which is the one part a web page
 * cannot do for itself.
 */
@CapacitorPlugin(name = "VexRemind")
public class VexRemindPlugin extends Plugin {

    private PendingIntent pendingFor(String id, String url, String title, String note, boolean mutable) {
        Intent intent = new Intent(getContext(), ReminderReceiver.class);
        intent.setAction("vex.reminder." + id);
        intent.putExtra(ReminderReceiver.EXTRA_URL, url);
        intent.putExtra(ReminderReceiver.EXTRA_TITLE, title);
        intent.putExtra(ReminderReceiver.EXTRA_NOTE, note);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT
                | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !mutable ? PendingIntent.FLAG_IMMUTABLE : 0);
        return PendingIntent.getBroadcast(getContext(), id.hashCode(), intent, flags);
    }

    @PluginMethod
    public void schedule(PluginCall call) {
        String id = call.getString("id", "");
        long at = call.getInt("at", 0).longValue();
        // Milliseconds do not fit in an int; the chrome sends them as a string
        // rather than losing the top bits.
        try { at = Long.parseLong(call.getString("atMillis", String.valueOf(at))); } catch (NumberFormatException ignored) { }
        if (id.isEmpty() || at <= 0) {
            call.reject("A reminder needs an id and a time");
            return;
        }
        AlarmManager alarms = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) {
            call.reject("This device has no alarm service");
            return;
        }
        PendingIntent pending = pendingFor(id, call.getString("url", ""), call.getString("title", ""),
                call.getString("note", ""), false);
        try {
            // An exact alarm needs permission on Android 12+; an inexact one
            // always works and is within a few minutes, which is what a
            // "remind me this evening" actually means.
            boolean exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms();
            if (exact) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
            else alarms.set(AlarmManager.RTC_WAKEUP, at, pending);
            JSObject result = new JSObject();
            result.put("exact", exact);
            call.resolve(result);
        } catch (SecurityException error) {
            alarms.set(AlarmManager.RTC_WAKEUP, at, pending);
            JSObject result = new JSObject();
            result.put("exact", false);
            call.resolve(result);
        }
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String id = call.getString("id", "");
        AlarmManager alarms = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
        if (alarms != null && !id.isEmpty()) {
            alarms.cancel(pendingFor(id, "", "", "", false));
        }
        call.resolve();
    }
}
