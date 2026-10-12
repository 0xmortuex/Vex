package com.vex.browser.remind;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * "Bring this page back at six." The chrome keeps the list; this only asks
 * Android to wake up at the right moment, which is the one part a web page
 * cannot do for itself.
 */
@CapacitorPlugin(name = "VexRemind")
public class VexRemindPlugin extends Plugin {

    @PluginMethod
    public void schedule(PluginCall call) {
        String id = call.getString("id", "");
        long at = call.getInt("at", 0).longValue();
        // Milliseconds do not fit in an int; the chrome sends them as a string
        // rather than losing the top bits.
        try { at = Long.parseLong(call.getString("atMillis", String.valueOf(at))); } catch (NumberFormatException ignored) { }
        if (id.isEmpty() || at <= 0) {
            call.reject("A reminder needs an id and a time");
            return;
        }
        Reminders.Entry entry = new Reminders.Entry(id, at, call.getString("url", ""),
                call.getString("title", ""), call.getString("note", ""));
        try {
            boolean exact = Reminders.arm(getContext(), entry);
            Reminders.remember(getContext(), entry);
            JSObject result = new JSObject();
            result.put("exact", exact);
            call.resolve(result);
        } catch (RuntimeException error) {
            call.reject(error.getMessage());
        }
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String id = call.getString("id", "");
        if (!id.isEmpty()) {
            Reminders.disarm(getContext(), id);
            Reminders.forget(getContext(), id);
        }
        call.resolve();
    }
}
