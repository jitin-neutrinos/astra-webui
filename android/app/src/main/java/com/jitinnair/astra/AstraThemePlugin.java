package com.jitinnair.astra;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;

/**
 * Pushes the ACTIVE web theme palette into native storage, and asks native surfaces to repaint.
 *
 * WHY: the theme engine lives in the WebView, but notifications and the gate popup are native and
 * outlive it — a background notification service holds a notification while the WebView is gone.
 * Without this bridge a palette change reaches only the page, so notifications kept the Astra
 * accent forever. The web layer (src/native/shell-theme.ts) calls sync() on every theme change.
 *
 * sync() writes the tokens and bumps `astra_theme_stamp` in ONE commit; the bump is the signal
 * native code uses to invalidate its cache and re-issue live notifications, so notifications
 * already on screen repaint in place rather than waiting for the next push.
 */
@CapacitorPlugin(name = "AstraTheme")
public class AstraThemePlugin extends Plugin {

    private static final String PREFS = "CapacitorStorage";
    private static final String KEY_STAMP = "astra_theme_stamp";

    /** Token names used by the web layer. Stored under `astra_<name>`. */
    private static final String[] TOKENS = {
        "accent", "void", "surface", "surfaceHi", "hairline",
        "ink", "muted", "danger", "okay", "amber",
    };

    @PluginMethod
    public void sync(PluginCall call) {
        String mode = call.getString("mode");
        if (mode == null || !(mode.equals("dark") || mode.equals("light"))) {
            call.reject("mode must be 'dark' or 'light'");
            return;
        }
        JSONObject tokens = call.getObject("tokens");
        if (tokens == null) {
            call.reject("tokens object is required");
            return;
        }

        // Validate while writing: a malformed hex must not reach storage, because the next native
        // read would either throw in Color.parseColor or paint the wrong colour. A dropped token
        // degrades to the Astra baseline for that ONE token, never for the whole notification.
        // (Validating into a JSONObject first and reading it back would force a JSONException
        // signature on the plugin method for no benefit — every value here is already a String.)
        Context ctx = getContext();
        String stamp = Long.toString(System.currentTimeMillis());

        SharedPreferences.Editor ed =
                ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        int applied = 0;
        for (String token : TOKENS) {
            String norm = normaliseHex(tokens.optString(token, ""));
            if (norm != null) {
                ed.putString("astra_" + token, norm);
                applied++;
            }
        }
        ed.putString("astra_theme", mode);
        ed.putString(KEY_STAMP, stamp);
        ed.apply();

        // Kotlin `object`: the JVM entry point is INSTANCE, not a static method.
        AstraThemeRead.INSTANCE.invalidate();

        // Repaint what is already on screen. The service owns the notifications; when it is not
        // running nothing is posted, so this is a no-op rather than an error.
        try {
            Intent i = new Intent(ctx, NtfyPushService.class);
            i.setAction(NtfyPushService.ACTION_THEME_CHANGED);
            ctx.startService(i);
        } catch (Exception e) {
            Log.w("AstraTheme", "repaint broadcast failed", e);
        }

        JSObject ret = new JSObject();
        ret.put("stamp", stamp);
        ret.put("applied", applied);
        call.resolve(ret);
    }

    /** Force a native re-read (used after an install or a storage clear). */
    @PluginMethod
    public void refresh(PluginCall call) {
        AstraThemeRead.INSTANCE.invalidate();
        call.resolve();
    }

    /** Normalise `#rgb`/`#rrggbb` to lowercase `#rrggbb`, or null when unusable. */
    private static String normaliseHex(String v) {
        if (v == null) return null;
        String s = v.trim();
        if (s.length() == 4 && s.charAt(0) == '#') {
            String r = s.substring(1, 2), g = s.substring(2, 3), b = s.substring(3, 4);
            if (!isHexDigits(r) || !isHexDigits(g) || !isHexDigits(b)) return null;
            return ("#" + r + r + g + g + b + b).toLowerCase();
        }
        if (s.length() == 7 && s.charAt(0) == '#') {
            for (int i = 1; i < 7; i++) {
                if (!isHexDigits(s.substring(i, i + 1))) return null;
            }
            return s.toLowerCase();
        }
        return null;
    }

    private static boolean isHexDigits(String s) {
        if (s.length() != 1) return false;
        char c = s.charAt(0);
        return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
    }
}
