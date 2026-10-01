package com.vex.browser.remind;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;

import com.vex.browser.R;

/**
 * What happens when a reminder comes due: a notification that opens the page
 * it was set on.
 *
 * The desktop asks Windows to wake Vex for a reminder (src/main/os-schedule.js).
 * Android's equivalent is an alarm and a broadcast, and the phone does not need
 * Vex to be running for either.
 */
public class ReminderReceiver extends BroadcastReceiver {

    public static final String CHANNEL = "vex-reminders";
    public static final String EXTRA_URL = "vex.url";
    public static final String EXTRA_TITLE = "vex.title";
    public static final String EXTRA_NOTE = "vex.note";

    @Override
    public void onReceive(Context context, Intent intent) {
        Reminders.forget(context, Reminders.idOf(intent));
        notify(context, intent.getStringExtra(EXTRA_URL), intent.getStringExtra(EXTRA_TITLE),
                intent.getStringExtra(EXTRA_NOTE));
    }

    static void notify(Context context, String url, String title, String note) {
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;

        if (manager.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "Reminders", NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("Pages you asked Vex to bring back");
            manager.createNotificationChannel(channel);
        }

        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse(url == null || url.isEmpty() ? "about:blank" : url));
        open.setPackage(context.getPackageName());
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pending = PendingIntent.getActivity(context, (int) System.currentTimeMillis(), open, flags);

        Notification notification = new Notification.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_notify)
                .setContentTitle(note == null || note.isEmpty() ? "A page you saved for later" : note)
                .setContentText(title == null || title.isEmpty() ? url : title)
                .setAutoCancel(true)
                .setContentIntent(pending)
                .build();
        try {
            manager.notify((int) (System.currentTimeMillis() % Integer.MAX_VALUE), notification);
        } catch (SecurityException ignored) { /* notifications are off */ }
    }
}
