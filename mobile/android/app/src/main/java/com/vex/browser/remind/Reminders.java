package com.vex.browser.remind;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * The reminders Android has been asked to wake for, kept where a boot
 * receiver can find them.
 *
 * Alarms do not survive a reboot. The chrome re-arms its list every time Vex
 * starts, but a phone that restarts overnight (Samsung's weekly auto-restart
 * does exactly that) and is not opened before morning would let "tomorrow
 * morning" pass in silence. So the native side keeps its own copy, and puts
 * the alarms back as the phone comes up.
 */
final class Reminders {

    private static final String PREFS = "vex-reminders";

    static final class Entry {
        final String id, url, title, note;
        final long at;
        Entry(String id, long at, String url, String title, String note) {
            this.id = id; this.at = at;
            this.url = url == null ? "" : url;
            this.title = title == null ? "" : title;
            this.note = note == null ? "" : note;
        }
    }

    private Reminders() {}

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void remember(Context context, Entry entry) {
        JSONObject json = new JSONObject();
        try {
            json.put("at", entry.at).put("url", entry.url).put("title", entry.title).put("note", entry.note);
        } catch (JSONException ignored) { return; }
        prefs(context).edit().putString(entry.id, json.toString()).apply();
    }

    static void forget(Context context, String id) {
        if (id != null && !id.isEmpty()) prefs(context).edit().remove(id).apply();
    }

    static List<Entry> all(Context context) {
        List<Entry> entries = new ArrayList<>();
        for (Map.Entry<String, ?> stored : prefs(context).getAll().entrySet()) {
            if (!(stored.getValue() instanceof String)) continue;
            try {
                JSONObject json = new JSONObject((String) stored.getValue());
                entries.add(new Entry(stored.getKey(), json.optLong("at", 0), json.optString("url"),
                        json.optString("title"), json.optString("note")));
            } catch (JSONException ignored) {
                forget(context, stored.getKey());
            }
        }
        return entries;
    }

    /** The id an alarm's intent was made for, or null. */
    static String idOf(Intent intent) {
        String action = intent == null ? null : intent.getAction();
        return action != null && action.startsWith(ACTION_PREFIX) ? action.substring(ACTION_PREFIX.length()) : null;
    }

    private static final String ACTION_PREFIX = "vex.reminder.";

    static PendingIntent pendingFor(Context context, Entry entry) {
        Intent intent = new Intent(context, ReminderReceiver.class);
        intent.setAction(ACTION_PREFIX + entry.id);
        intent.putExtra(ReminderReceiver.EXTRA_URL, entry.url);
        intent.putExtra(ReminderReceiver.EXTRA_TITLE, entry.title);
        intent.putExtra(ReminderReceiver.EXTRA_NOTE, entry.note);
        return PendingIntent.getBroadcast(context, entry.id.hashCode(), intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /**
     * Asks Android to wake for it. An exact alarm needs permission on Android
     * 12+; an inexact one always works and is within a few minutes, which is
     * what a "remind me this evening" actually means. Returns whether it is exact.
     */
    static boolean arm(Context context, Entry entry) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) throw new IllegalStateException("This device has no alarm service");
        PendingIntent pending = pendingFor(context, entry);
        try {
            boolean exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms();
            if (exact) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, entry.at, pending);
            else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, entry.at, pending);
            return exact;
        } catch (SecurityException error) {
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, entry.at, pending);
            return false;
        }
    }

    static void disarm(Context context, String id) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms != null) alarms.cancel(pendingFor(context, new Entry(id, 0, "", "", "")));
    }
}
