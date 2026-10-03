package com.jitinnair.astra;

import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.view.View;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Paints the window decor with the active theme's background colour.
 *
 * WHY THIS EXISTS: the status/navigation bars are edge-to-edge and transparent, so the colour
 * behind them is whatever the window decor is painted with. Capacitor's SystemBars.setStyle()
 * repaints that decor from the theme's android:windowBackground on EVERY call, and it calls
 * itself again on configuration changes. @android:color/transparent resolves to 0x00000000,
 * which Android renders as OPAQUE BLACK — that was the "static black bars regardless of theme"
 * bug.
 *
 * The bundled plugins cannot help: SystemBars documents setBackgroundColor as UNSUPPORTED, and
 * @capacitor/status-bar's setBackgroundColor is a no-op under edge-to-edge
 * (shouldSetStatusBarColor() returns false at targetSdk 36).
 *
 * The web layer therefore calls @capacitor/status-bar's setStyle for icon contrast (that one
 * does NOT touch the decor) instead of SystemBars', which would overwrite this colour on every
 * call. A ColorDrawable is used so the value survives a re-layout.
 */
@CapacitorPlugin(name = "AstraBars")
public class AstraBarsPlugin extends Plugin {

    private static int currentColor = Color.parseColor("#0A0A0F");

    @PluginMethod
    public void setBackgroundColor(PluginCall call) {
        String hex = call.getString("color");
        if (hex == null || hex.isEmpty()) {
            call.reject("color is required");
            return;
        }
        final int color;
        try {
            color = Color.parseColor(hex.startsWith("#") ? hex : "#" + hex);
        } catch (IllegalArgumentException e) {
            call.reject("invalid color: " + hex);
            return;
        }
        currentColor = color;
        getActivity().runOnUiThread(() -> apply(getActivity().getWindow().getDecorView(), color));
        call.resolve();
    }

    private static void apply(View decor, int color) {
        decor.setBackground(new ColorDrawable(color));
        // Also clear any window-level background that could sit behind the decor.
        View root = decor.findViewById(android.R.id.content);
        if (root != null) root.setBackground(null);
    }
}
