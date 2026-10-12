package com.vex.browser.remind;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Puts the reminders back after a reboot (and after Vex is updated, or the
 * clock is changed). One that came due while the phone was off is shown now,
 * late, rather than not at all.
 */
public class ReminderBoot extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) return;
        long now = System.currentTimeMillis();
        for (Reminders.Entry entry : Reminders.all(context)) {
            if (entry.at <= now) {
                ReminderReceiver.notify(context, entry.url, entry.title, entry.note);
                Reminders.forget(context, entry.id);
            } else {
                try { Reminders.arm(context, entry); } catch (RuntimeException ignored) { /* no alarm service */ }
            }
        }
    }
}
