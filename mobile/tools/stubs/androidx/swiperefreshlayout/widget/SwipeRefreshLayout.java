package androidx.swiperefreshlayout.widget;

import android.content.Context;
import android.view.View;
import android.widget.FrameLayout;

public class SwipeRefreshLayout extends FrameLayout {
    public interface OnRefreshListener { void onRefresh(); }
    public interface OnChildScrollUpCallback {
        boolean canChildScrollUp(SwipeRefreshLayout parent, View child);
    }
    public SwipeRefreshLayout(Context context) { super(context); }
    public void setOnRefreshListener(OnRefreshListener listener) { }
    public void setRefreshing(boolean refreshing) { }
    public boolean isRefreshing() { return false; }
    public void setEnabled(boolean enabled) { }
    public void setColorSchemeColors(int... colors) { }
    public void setProgressBackgroundColorSchemeColor(int color) { }
    public void setOnChildScrollUpCallback(OnChildScrollUpCallback callback) { }
}
