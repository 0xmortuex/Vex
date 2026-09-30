package com.vex.browser.remind;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;

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
        String url = intent.getStringExtra(EXTRA_URL);
        String title = intent.getStringExtra(EXTRA_TITLE);
        String note = intent.getStringExtra(EXTRA_NOTE);

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "Reminders", NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("Pages you asked Vex to bring back");
            manager.createNotificationChannel(channel);
        }

        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse(url == null ? "about:blank" : url));
        open.setPackage(context.getPackageName());
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT
                | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent pending = PendingIntent.getActivity(context, (int) System.currentTimeMillis(), open, flags);

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(context, CHANNEL)
                : new Notification.Builder(context);
        Notification notification = builder
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(note == null || note.isEmpty() ? "A page you saved for later" : note)
                .setContentText(title == null || title.isEmpty() ? url : title)
                .setAutoCancel(true)
                .setContentIntent(pending)
                .build();
        manager.notify((int) (System.currentTimeMillis() % Integer.MAX_VALUE), notification);
    }
}
