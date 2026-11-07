# Capacitor reflects over plugin classes and their @PluginMethod methods.
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * { @com.getcapacitor.PluginMethod public *; }
-keep class com.vex.browser.** { *; }
# JavascriptInterface members are called by name from page script.
-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }
