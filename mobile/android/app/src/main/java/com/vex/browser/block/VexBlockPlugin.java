package com.vex.browser.block;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

/** JS control surface for {@link BlockEngine}. */
@CapacitorPlugin(name = "VexBlock")
public class VexBlockPlugin extends Plugin {

    @PluginMethod
    public void setEnabled(PluginCall call) {
        BlockEngine.get().setEnabled(Boolean.TRUE.equals(call.getBoolean("enabled", true)));
        call.resolve();
    }

    @PluginMethod
    public void setSiteAllowed(PluginCall call) {
        BlockEngine.get().setSiteAllowed(call.getString("host"),
                Boolean.TRUE.equals(call.getBoolean("allowed", false)));
        call.resolve();
    }

    @PluginMethod
    public void loadRules(PluginCall call) {
        List<String> block = strings(call.getArray("block", new JSArray()));
        List<String> allow = strings(call.getArray("allow", new JSArray()));
        Map<String, List<String>> hide = new HashMap<>();
        JSObject hideObject = call.getObject("hide", new JSObject());
        if (hideObject != null) {
            Iterator<String> keys = hideObject.keys();
            while (keys.hasNext()) {
                String host = keys.next();
                JSONArray selectors = hideObject.optJSONArray(host);
                if (selectors == null) continue;
                List<String> list = new ArrayList<>(selectors.length());
                for (int i = 0; i < selectors.length(); i++) {
                    String selector = selectors.optString(i, null);
                    if (selector != null && !selector.isEmpty()) list.add(selector);
                }
                hide.put(host, list);
            }
        }
        // Parsing a 100k-line list off the UI thread: the call resolves when
        // the engine is actually swapped, so the first page load cannot race it.
        new Thread(() -> {
            BlockEngine.get().load(block, allow, hide);
            JSObject result = new JSObject();
            result.put("rules", BlockEngine.get().ruleCount());
            call.resolve(result);
        }, "vex-block-load").start();
    }

    @PluginMethod
    public void stats(PluginCall call) {
        JSObject result = new JSObject();
        result.put("blocked", BlockEngine.get().blockedCount());
        result.put("rules", BlockEngine.get().ruleCount());
        result.put("enabled", BlockEngine.get().isEnabled());
        call.resolve(result);
    }

    private static List<String> strings(JSArray array) {
        List<String> out = new ArrayList<>();
        if (array == null) return out;
        for (int i = 0; i < array.length(); i++) {
            Object value = array.opt(i);
            if (value instanceof String) out.add((String) value);
        }
        return out;
    }
}
