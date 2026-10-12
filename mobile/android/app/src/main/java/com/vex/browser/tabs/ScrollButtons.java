package com.vex.browser.tabs;

import android.content.Context;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.LinearLayout;

/**
 * Samsung Internet's scroll buttons: two round arrows at the edge of the page
 * that appear while you scroll and fade a moment after you stop. A tap moves a
 * screenful; a long press goes all the way to the top or the bottom.
 *
 * They are native because they have to be over the page, and the page is a
 * native view drawn above every pixel of the chrome's own WebView — anything
 * the chrome drew there would be underneath it.
 */
final class ScrollButtons extends LinearLayout {

    interface Target {
        /** The page to move: the tab in front, or null. */
        TabWebView current();
    }

    private static final long LINGER = 1800;

    private final Runnable hide = () -> animate().alpha(0f).setDuration(220)
            .withEndAction(() -> setVisibility(View.GONE)).start();

    ScrollButtons(Context context, Target target) {
        super(context);
        setOrientation(VERTICAL);
        setVisibility(View.GONE);
        setAlpha(0f);
        float density = context.getResources().getDisplayMetrics().density;
        int size = Math.round(44 * density);
        int gap = Math.round(10 * density);
        addView(button(context, android.R.drawable.arrow_up_float, "Scroll up", target, true), sized(size, 0));
        addView(button(context, android.R.drawable.arrow_down_float, "Scroll down", target, false), sized(size, gap));
    }

    private static LayoutParams sized(int size, int top) {
        LayoutParams params = new LayoutParams(size, size);
        params.topMargin = top;
        return params;
    }

    private ImageButton button(Context context, int icon, String label, Target target, boolean up) {
        ImageButton button = new ImageButton(context);
        button.setImageResource(icon);
        button.setContentDescription(label);
        GradientDrawable round = new GradientDrawable();
        round.setShape(GradientDrawable.OVAL);
        round.setColor(0xB3202024);
        button.setBackground(round);
        button.setOnClickListener(view -> {
            TabWebView tab = target.current();
            if (tab != null) { if (up) tab.pageUp(false); else tab.pageDown(false); }
            linger();
        });
        button.setOnLongClickListener(view -> {
            TabWebView tab = target.current();
            if (tab != null) { if (up) tab.pageUp(true); else tab.pageDown(true); }
            linger();
            return true;
        });
        return button;
    }

    /** Where they sit inside the page's frame: the trailing edge, low down. */
    static FrameLayout.LayoutParams placement(Context context) {
        float density = context.getResources().getDisplayMetrics().density;
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.END | Gravity.BOTTOM);
        params.setMarginEnd(Math.round(14 * density));
        params.bottomMargin = Math.round(28 * density);
        return params;
    }

    /** The page moved: show them, and start the fade again. */
    void scrolled() {
        removeCallbacks(hide);
        if (getVisibility() != View.VISIBLE) {
            setVisibility(View.VISIBLE);
            bringToFront();
        }
        animate().cancel();
        if (getAlpha() < 1f) animate().alpha(1f).setDuration(140).start();
        postDelayed(hide, LINGER);
    }

    private void linger() {
        removeCallbacks(hide);
        postDelayed(hide, LINGER);
    }

    void dismiss() {
        removeCallbacks(hide);
        animate().cancel();
        setAlpha(0f);
        setVisibility(View.GONE);
    }
}
