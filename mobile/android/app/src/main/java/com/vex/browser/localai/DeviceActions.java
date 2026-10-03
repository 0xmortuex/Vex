package com.vex.browser.localai;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.net.Uri;
import android.provider.CalendarContract;
import android.provider.ContactsContract;
import android.provider.Settings;

import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * What Mobile Actions' model can ask the phone to do — the same six functions
 * the Gallery declares, because those are what FunctionGemma was fine-tuned on.
 *
 * Nothing here acts behind your back: every action but the torch opens the
 * app that does it (Contacts, Calendar, your mail app, Maps, Settings) with the
 * details filled in, and you confirm there. No permission is needed for any of
 * it — the torch is the camera's flash, which Android lets any app switch
 * without the camera permission.
 */
public final class DeviceActions {

    private DeviceActions() { }

    /** Run one action; returns a sentence saying what happened. */
    public static String run(Activity activity, String name, JSONObject args) throws Exception {
        Context context = activity;
        switch (name) {
            case "turn_on_flashlight": torch(context, true); return "The torch is on";
            case "turn_off_flashlight": torch(context, false); return "The torch is off";
            case "open_wifi_settings":
                start(activity, new Intent(Settings.ACTION_WIFI_SETTINGS));
                return "Opened Wi-Fi settings";
            case "show_location_on_map": {
                String location = args.optString("location", "");
                start(activity, new Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + Uri.encode(location))));
                return "Showing " + location + " on the map";
            }
            case "send_email": {
                Intent intent = new Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:"));
                intent.putExtra(Intent.EXTRA_EMAIL, new String[] { args.optString("to", "") });
                intent.putExtra(Intent.EXTRA_SUBJECT, args.optString("subject", ""));
                intent.putExtra(Intent.EXTRA_TEXT, args.optString("body", ""));
                start(activity, intent);
                return "Opened an email to " + args.optString("to", "");
            }
            case "create_contact": {
                Intent intent = new Intent(ContactsContract.Intents.Insert.ACTION);
                intent.setType(ContactsContract.RawContacts.CONTENT_TYPE);
                String full = (args.optString("first_name", "") + " " + args.optString("last_name", "")).trim();
                intent.putExtra(ContactsContract.Intents.Insert.NAME, full);
                intent.putExtra(ContactsContract.Intents.Insert.PHONE, args.optString("phone_number", ""));
                intent.putExtra(ContactsContract.Intents.Insert.EMAIL, args.optString("email", ""));
                start(activity, intent);
                return "Opened a new contact for " + full;
            }
            case "create_calendar_event": {
                Intent intent = new Intent(Intent.ACTION_INSERT).setData(CalendarContract.Events.CONTENT_URI);
                intent.putExtra(CalendarContract.Events.TITLE, args.optString("title", ""));
                long begin = parseDateTime(args.optString("datetime", ""));
                if (begin > 0) {
                    intent.putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, begin);
                    intent.putExtra(CalendarContract.EXTRA_EVENT_END_TIME, begin + 3600_000L);
                }
                start(activity, intent);
                return "Opened a new event: " + args.optString("title", "");
            }
            default:
                throw new IllegalArgumentException("Vex does not know how to " + name.replace('_', ' '));
        }
    }

    private static void start(Activity activity, Intent intent) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        activity.runOnUiThread(() -> {
            try { activity.startActivity(intent); }
            catch (Throwable error) {
                android.widget.Toast.makeText(activity, "No app on this phone can do that", android.widget.Toast.LENGTH_SHORT).show();
            }
        });
    }

    private static void torch(Context context, boolean on) throws Exception {
        CameraManager cameras = (CameraManager) context.getSystemService(Context.CAMERA_SERVICE);
        if (cameras == null) throw new IllegalStateException("This phone has no camera service");
        for (String id : cameras.getCameraIdList()) {
            CameraCharacteristics characteristics = cameras.getCameraCharacteristics(id);
            Boolean flash = characteristics.get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
            Integer facing = characteristics.get(CameraCharacteristics.LENS_FACING);
            if (Boolean.TRUE.equals(flash) && facing != null && facing == CameraCharacteristics.LENS_FACING_BACK) {
                cameras.setTorchMode(id, on);
                return;
            }
        }
        throw new IllegalStateException("This phone has no torch");
    }

    /** YYYY-MM-DDTHH:MM:SS, the format the model was trained to give, in local time. */
    static long parseDateTime(String value) {
        if (value == null || value.isEmpty()) return 0;
        for (String pattern : new String[] { "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd HH:mm", "yyyy-MM-dd" }) {
            try {
                SimpleDateFormat format = new SimpleDateFormat(pattern, Locale.US);
                format.setLenient(false);
                Date date = format.parse(value);
                if (date != null) return date.getTime();
            } catch (Exception ignored) { }
        }
        return 0;
    }
}
