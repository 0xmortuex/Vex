package com.vex.browser.work;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Keeps Vex alive while it is doing something long for you — saving a video
 * stream, downloading an on-device model — and says so in the notification
 * shade, with how far it has got.
 *
 * Both jobs run on threads of their own, and a thread is no reason for Android
 * to keep a backgrounded app: lock the phone twenty minutes into a film and the
 * process could be reclaimed with the file half-written. A foreground service
 * is the one thing Android honours for that, and it is also what Samsung
 * Internet shows: a download notification you can watch.
 *
 * Jobs report through the static begin / progress / end; the service starts
 * with the first job and stops itself when the last one ends.
 */
public final class LongWork extends Service {

    private static final String CHANNEL = "vex-work";
    private static final String DONE_CHANNEL = "vex-work-done";
    private static final int ONGOING_ID = 0x7e0001;

    private static final class Job {
        String title;
        int percent = -1;        // -1: no idea yet
        String detail = "";
    }

    private static final Map<String, Job> jobs = new LinkedHashMap<>();
    private static long lastShown = 0;
    // The running service, once it has gone foreground. Stopping goes through
    // it: stopping a service Android was told to start in the foreground,
    // before it has, is a crash ("did not then call startForeground").
    private static LongWork running;

    // ── What the jobs call ───────────────────────────────────────────────────

    public static void begin(Context context, String jobId, String title) {
        synchronized (jobs) {
            Job job = new Job();
            job.title = title;
            jobs.put(jobId, job);
        }
        Context app = context.getApplicationContext();
        try {
            Intent intent = new Intent(app, LongWork.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) app.startForegroundService(intent);
            else app.startService(intent);
        } catch (Exception ignored) {
            // Refused (started from the background on a strict Android): the job
            // still runs, just without the guarantee or the notification.
        }
    }

    public static void progress(Context context, String jobId, int percent, String detail) {
        synchronized (jobs) {
            Job job = jobs.get(jobId);
            if (job == null) return;
            job.percent = percent;
            job.detail = detail == null ? "" : detail;
            // A notification redrawn per segment is a notification that janks
            // the shade; twice a second is plenty for a progress bar.
            long now = System.currentTimeMillis();
            if (now - lastShown < 500) return;
            lastShown = now;
        }
        show(context.getApplicationContext());
    }

    /** `said` is what the finished-notification says; null for none (a failure the app reports itself). */
    public static void end(Context context, String jobId, String said) {
        boolean empty;
        synchronized (jobs) {
            jobs.remove(jobId);
            empty = jobs.isEmpty();
        }
        Context app = context.getApplicationContext();
        if (said != null && !said.isEmpty()) finished(app, said);
        if (!empty) { show(app); return; }
        LongWork service;
        synchronized (jobs) { service = running; }
        // Not foreground yet: onStartCommand will find nothing to do and stop.
        if (service != null) service.finish();
    }

    // ── The service ──────────────────────────────────────────────────────────

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification notification = build(this);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(ONGOING_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(ONGOING_ID, notification);
        }
        boolean empty;
        synchronized (jobs) {
            running = this;
            empty = jobs.isEmpty();
        }
        // A job that ended before the service got here leaves nothing to show.
        if (empty) finish();
        return START_NOT_STICKY;
    }

    private void finish() {
        synchronized (jobs) { if (running == this) running = null; }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE);
        else stopForeground(true);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        synchronized (jobs) { if (running == this) running = null; }
        super.onDestroy();
    }

    /**
     * Android 15 caps a data-sync service at six hours a day. Past that the
     * jobs carry on as ordinary threads; only the guarantee is lost, and the
     * service has to stop or the app is crashed for it.
     */
    @Override
    public void onTimeout(int startId, int fgsType) {
        finish();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    // ── Notifications ────────────────────────────────────────────────────────

    private static void channels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        if (manager.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "Downloads in progress", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Videos and on-device models Vex is saving");
            channel.setShowBadge(false);
            manager.createNotificationChannel(channel);
        }
        if (manager.getNotificationChannel(DONE_CHANNEL) == null) {
            NotificationChannel channel = new NotificationChannel(DONE_CHANNEL, "Finished downloads", NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("When a video or a model Vex was saving is ready");
            manager.createNotificationChannel(channel);
        }
    }

    private static PendingIntent openVex(Context context) {
        Intent open = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (open == null) open = new Intent();
        open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static Notification build(Context context) {
        channels(context);
        String title, text;
        int percent;
        int count;
        synchronized (jobs) {
            count = jobs.size();
            Job first = jobs.isEmpty() ? null : jobs.values().iterator().next();
            title = first == null ? "Vex is saving a file" : first.title;
            text = first == null ? "" : first.detail;
            percent = first == null ? -1 : first.percent;
        }
        if (count > 1) text = (text.isEmpty() ? "" : text + " · ") + "and " + (count - 1) + " more";
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(context, CHANNEL)
                : new Notification.Builder(context);
        builder.setSmallIcon(android.R.drawable.stat_sys_download)
                .setContentTitle(title)
                .setContentText(text)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(openVex(context))
                .setProgress(100, Math.max(0, percent), percent < 0);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        }
        return builder.build();
    }

    private static void show(Context context) {
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        boolean empty;
        synchronized (jobs) { empty = jobs.isEmpty(); }
        if (empty) return;
        try { manager.notify(ONGOING_ID, build(context)); } catch (SecurityException ignored) { /* notifications off */ }
    }

    private static void finished(Context context, String said) {
        channels(context);
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(context, DONE_CHANNEL)
                : new Notification.Builder(context);
        builder.setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentTitle(said)
                .setContentText("Tap to open Vex")
                .setAutoCancel(true)
                .setContentIntent(openVex(context));
        try {
            manager.notify((int) (System.currentTimeMillis() % Integer.MAX_VALUE), builder.build());
        } catch (SecurityException ignored) { /* notifications off */ }
    }
}
