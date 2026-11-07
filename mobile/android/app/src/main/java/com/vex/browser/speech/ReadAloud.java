package com.vex.browser.speech;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.session.MediaSession;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import com.vex.browser.R;

/**
 * Keeps a page being read aloud going once you lock the phone or switch apps,
 * the way Chrome's "Listen to this page" does, and puts its controls where a
 * listener looks for them: the notification shade, the lock screen and the
 * headset button.
 *
 * Android's freezer stops a backgrounded app's threads within seconds, and
 * the speech engine's progress callbacks would stop arriving with them. A
 * media-playback foreground service is what says "this app is playing
 * something", and it comes with a notification that has a Stop on it, so
 * reading never becomes something you cannot silence.
 *
 * The plugin owns the reading; this only holds the foreground and draws it.
 */
public final class ReadAloud extends Service {

    interface Controls {
        void play();
        void pause();
        void stop();
    }

    static final String ACTION_SHOW = "com.vex.browser.readaloud.SHOW";
    static final String ACTION_PLAY = "com.vex.browser.readaloud.PLAY";
    static final String ACTION_PAUSE = "com.vex.browser.readaloud.PAUSE";
    static final String ACTION_STOP = "com.vex.browser.readaloud.STOP";

    private static final String CHANNEL = "vex-read-aloud";
    private static final int ID = 0x7e0002;
    // Paused for this long, the notification goes (the bar in Vex stays): a
    // reading you walked away from an hour ago is not one to leave in the shade.
    private static final long PAUSED_FOR = 10 * 60 * 1000;

    // All of this is touched on the main thread only.
    static Controls controls;
    static MediaSession.Token token;
    static String title = "";
    static String progress = "";
    static boolean playing;
    private static ReadAloud running;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable expire = () -> { if (!playing) finish(); };

    // ── What the plugin calls ────────────────────────────────────────────────

    /** Show it, or redraw it for a new line or a pause. */
    static void update(Context context) {
        if (running != null) { running.present(); return; }
        Context app = context.getApplicationContext();
        try {
            Intent intent = new Intent(app, ReadAloud.class).setAction(ACTION_SHOW);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) app.startForegroundService(intent);
            else app.startService(intent);
        } catch (Exception ignored) {
            // Refused from the background: the reading still goes on while
            // Android lets it, just without the notification.
        }
    }

    static void end() {
        if (running != null) running.finish();
    }

    // ── The service ──────────────────────────────────────────────────────────

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        running = this;
        String action = intent == null ? ACTION_SHOW : String.valueOf(intent.getAction());
        // Whatever started it, it has to go foreground before anything else or
        // Android ends the app for it.
        present();
        // Nothing to control: Vex was ended under a notification left behind.
        if (controls == null) { finish(); return START_NOT_STICKY; }
        switch (action) {
            case ACTION_PLAY: controls.play(); break;
            case ACTION_PAUSE: controls.pause(); break;
            case ACTION_STOP: controls.stop(); break;
            default: break;
        }
        return START_NOT_STICKY;
    }

    private void present() {
        Notification notification = build(this);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(ID, notification);
            }
        } catch (RuntimeException refused) {
            // Not allowed to go foreground from here (the app is in the
            // background and nothing the user did started it): show it plainly.
            NotificationManager manager = getSystemService(NotificationManager.class);
            try { if (manager != null) manager.notify(ID, notification); } catch (SecurityException ignored) { }
        }
        main.removeCallbacks(expire);
        if (!playing) {
            // Paused: still there to carry on from, but it can be swiped away.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_DETACH);
            else stopForeground(false);
            main.postDelayed(expire, PAUSED_FOR);
        }
    }

    private void finish() {
        main.removeCallbacks(expire);
        if (running == this) running = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE);
        else stopForeground(true);
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.cancel(ID);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        main.removeCallbacks(expire);
        if (running == this) running = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    // ── The notification ─────────────────────────────────────────────────────

    private static PendingIntent action(Context context, String action, int request) {
        Intent intent = new Intent(context, ReadAloud.class).setAction(action);
        return PendingIntent.getService(context, request, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static Notification build(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager != null
                && manager.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "Reading aloud", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("The page Vex is reading to you, with its controls");
            channel.setShowBadge(false);
            manager.createNotificationChannel(channel);
        }
        Intent open = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (open == null) open = new Intent();
        open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent content = PendingIntent.getActivity(context, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Action toggle = playing
                ? new Notification.Action.Builder(android.R.drawable.ic_media_pause, "Pause", action(context, ACTION_PAUSE, 1)).build()
                : new Notification.Action.Builder(android.R.drawable.ic_media_play, "Carry on", action(context, ACTION_PLAY, 2)).build();
        Notification.Action stop = new Notification.Action.Builder(
                android.R.drawable.ic_menu_close_clear_cancel, "Stop", action(context, ACTION_STOP, 3)).build();

        Notification.MediaStyle style = new Notification.MediaStyle().setShowActionsInCompactView(0, 1);
        if (token != null) style.setMediaSession(token);

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(context, CHANNEL)
                : new Notification.Builder(context);
        builder.setSmallIcon(R.drawable.ic_notify)
                .setContentTitle(title == null || title.isEmpty() ? "Reading aloud" : title)
                .setContentText(playing ? progress : "Paused · " + progress)
                .setContentIntent(content)
                .setDeleteIntent(action(context, ACTION_STOP, 4))
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setOngoing(playing)
                .addAction(toggle)
                .addAction(stop)
                .setStyle(style);
        return builder.build();
    }
}
