package com.vex.browser.tabs;

import android.content.Context;
import android.util.TypedValue;
import android.view.MotionEvent;
import android.widget.FrameLayout;

/**
 * Holds the page WebViews and watches for a swipe that starts at the left or
 * right screen edge — the gesture phone browsers use for back and forward.
 *
 * It has to live here rather than in the chrome's JavaScript: the page WebView
 * sits on top of the chrome WebView, so a touch on the page never reaches the
 * HTML layer at all. onInterceptTouchEvent lets the drag be recognised before
 * the page scrolls, and the page keeps every touch that is not an edge drag.
 */
public class EdgeSwipeLayout extends FrameLayout {

    public interface Listener {
        /** "right" = swipe rightwards from the left edge (go back). */
        void onEdgeSwipe(String direction);
    }

    private final Listener listener;
    private final float edgePx;
    private final float thresholdPx;
    private final float slopPx;

    private float startX, startY;
    private boolean fromLeft, fromRight, armed, consuming;

    public EdgeSwipeLayout(Context context, Listener listener) {
        super(context);
        this.listener = listener;
        this.edgePx = dp(context, 22);
        this.thresholdPx = dp(context, 72);
        this.slopPx = dp(context, 40);
        setClickable(false);
        setFocusable(false);
    }

    private static float dp(Context context, float value) {
        return TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value,
                context.getResources().getDisplayMetrics());
    }

    @Override
    public boolean onInterceptTouchEvent(MotionEvent event) {
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                startX = event.getX();
                startY = event.getY();
                fromLeft = startX <= edgePx && !systemOwnsEdge(true);
                fromRight = startX >= getWidth() - edgePx && !systemOwnsEdge(false);
                armed = fromLeft || fromRight;
                return false;
            case MotionEvent.ACTION_MOVE:
                if (!armed) return false;
                float dx = event.getX() - startX;
                float dy = event.getY() - startY;
                if (Math.abs(dy) > slopPx) {
                    armed = false;         // a vertical scroll, not a page swipe
                    return false;
                }
                if (fromLeft && dx > thresholdPx) {
                    armed = false;
                    consuming = true;      // swallow the rest of this gesture
                    listener.onEdgeSwipe("right");
                    return true;
                }
                if (fromRight && dx < -thresholdPx) {
                    armed = false;
                    consuming = true;
                    listener.onEdgeSwipe("left");
                    return true;
                }
                return false;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                armed = false;
                consuming = false;
                return false;
            default:
                return false;
        }
    }

    /**
     * With gesture navigation, a swipe in from either edge is Android's own
     * Back, and the strip it watches is where this one would be. Two
     * meanings for one gesture is a page that goes back twice or not at all,
     * so the system's wins: this listens only where Android is not (three-
     * button navigation, or an edge the system has left alone).
     */
    private boolean systemOwnsEdge(boolean left) {
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.Q) return false;
        android.view.WindowInsets insets = getRootWindowInsets();
        if (insets == null) return false;
        android.graphics.Insets gestures = insets.getSystemGestureInsets();
        return left ? gestures.left > 0 : gestures.right > 0;
    }

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        // Consume only the gesture that was intercepted above. Returning true
        // for anything else would eat taps meant for the chrome underneath.
        if (!consuming) return super.onTouchEvent(event);
        int action = event.getActionMasked();
        if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) consuming = false;
        return true;
    }
}
