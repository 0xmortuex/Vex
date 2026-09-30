package com.vex.browser.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

import com.vex.browser.MainActivity;
import com.vex.browser.R;

/**
 * Vex's home-screen search bar — the one Samsung Internet widget Vex was
 * missing.
 *
 * A widget process cannot run the chrome, so each target is a PendingIntent
 * into MainActivity carrying the action it means. MainActivity forwards it to
 * the chrome, or holds it until the chrome asks (a cold start would otherwise
 * fire the event before anything was listening).
 */
public class SearchWidget extends AppWidgetProvider {

    /** The extra MainActivity reads: "search", "voice" or "scan". */
    public static final String EXTRA_ACTION = "com.vex.browser.WIDGET_ACTION";

    private static final String[] TARGETS = { "search", "voice", "scan" };

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] widgetIds) {
        for (int widgetId : widgetIds) {
            manager.updateAppWidget(widgetId, build(context, widgetId));
        }
    }

    private RemoteViews build(Context context, int widgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_search);
        int[] ids = { R.id.widget_pill, R.id.widget_voice, R.id.widget_scan };
        for (int index = 0; index < ids.length; index++) {
            // One request code per target per widget, so two widgets and three
            // targets never collapse into one PendingIntent.
            int request = widgetId * TARGETS.length + index;
            views.setOnClickPendingIntent(ids[index], launch(context, TARGETS[index], request));
        }
        return views;
    }

    private PendingIntent launch(Context context, String action, int request) {
        Intent intent = new Intent(context, MainActivity.class);
        // A distinct action as well as a distinct request code: two intents that
        // differ only in their extras count as equal, and would overwrite.
        intent.setAction("com.vex.browser.WIDGET." + action);
        intent.putExtra(EXTRA_ACTION, action);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context, request, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
