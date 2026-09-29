package com.jitinnair.astra

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build

/**
 * Restores the ntfy push pipe after a reboot or an app update, without the
 * app ever being opened. Reads the stored conn string directly (no JS round
 * trip) and only starts the service when the user had push configured.
 *
 * Android 15+ forbids BOOT_COMPLETED receivers from STARTING dataSync
 * foreground services — but specialUse (our type) is explicitly allowed, so
 * the plain startForegroundService here is compliant.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED && action != Intent.ACTION_MY_PACKAGE_REPLACED) return

        val prefs: SharedPreferences = context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
        val conn = prefs.getString("ntfy_conn", "") ?: ""
        if (conn.isEmpty()) return // push never configured — stay quiet

        try {
            val svc = Intent(context, NtfyPushService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(svc)
            } else {
                context.startService(svc)
            }
        } catch (e: Exception) {
            // Android 15+ "restrictions on BOOT_COMPLETED receivers launching
            // foreground services" can still throw on some OEM builds; the
            // service restarts on next app open either way (START_STICKY).
        }
    }
}
