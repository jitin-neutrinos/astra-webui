package com.jitinnair.astra

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import android.Manifest

@CapacitorPlugin(name = "NativeNtfy", permissions = [
    Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications")
])
class NativeNtfy : Plugin() {
    @PluginMethod
    fun start(call: PluginCall) {
        val context: Context = context
        try {
            val intent = Intent(context, NtfyPushService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
            call.resolve(JSObject().put("status", "started"))
        } catch (e: Exception) {
            // ForegroundServiceStartNotAllowedException etc. — background-start
            // restrictions must never crash the web layer.
            call.resolve(JSObject().put("status", "deferred").put("error", e.message ?: "start failed"))
        }
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        val context: Context = context
        context.stopService(Intent(context, NtfyPushService::class.java))
        call.resolve(JSObject().put("status", "stopped"))
    }

    /** Page → native session identity bridge (R1): the background chat leg
     *  subscribes with ?sid=<liveSid> and deep-links to /c/<storedKey>. */
    @PluginMethod
    fun setLiveSession(call: PluginCall) {
        val liveSid = call.getString("liveSid")
        val storedKey = call.getString("storedKey")
        val prefs: SharedPreferences = context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
        if (liveSid != null) prefs.edit().putString("astra_live_sid", liveSid).apply()
        if (storedKey != null) prefs.edit().putString("astra_stored_key", storedKey).apply()
        // Kick the service's chat leg: new filter → immediate redial (no 60s
        // watcher wait). Attempt reset happens in the service.
        val intent = Intent(context, NtfyPushService::class.java)
        intent.action = NtfyPushService.ACTION_SESSION_CHANGED
        try { context.startService(intent) } catch (_: Exception) { /* service down */ }
        call.resolve()
    }

    /** Android 13+ runtime notification permission status. */
    @PluginMethod
    fun permission(call: PluginCall) {
        if (Build.VERSION.SDK_INT < 33) {
            call.resolve(JSObject().put("granted", true).put("canAsk", false))
            return
        }
        val granted = androidx.core.content.ContextCompat.checkSelfPermission(
            context, Manifest.permission.POST_NOTIFICATIONS
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        call.resolve(JSObject().put("granted", granted).put("canAsk", !granted))
    }

    /** Fire the Android 13+ POST_NOTIFICATIONS runtime prompt. */
    @PluginMethod
    fun askPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT < 33) {
            call.resolve(JSObject().put("granted", true))
            return
        }
        requestPermissionForAlias("notifications", call, "permissionResult")
    }

    @PermissionCallback
    private fun permissionResult(call: PluginCall) {
        val granted = androidx.core.content.ContextCompat.checkSelfPermission(
            context, Manifest.permission.POST_NOTIFICATIONS
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        call.resolve(JSObject().put("granted", granted))
    }

    /** Can this app post full-screen (lock-screen popup) notifications? */
    @PluginMethod
    fun canFullScreenIntent(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= 34) {
            val nm = context.getSystemService(NotificationManager::class.java)
            call.resolve(JSObject().put("granted", nm.canUseFullScreenIntent()))
        } else {
            call.resolve(JSObject().put("granted", true))
        }
    }

    /** Deep-link the user to the full-screen-intent special-access settings page. */
    @PluginMethod
    fun requestFullScreenIntent(call: PluginCall) {
        try {
            val intent = Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT)
                .setData(Uri.parse("package:${context.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            call.resolve()
        } catch (e: Exception) {
            call.reject("settings page unavailable", e)
        }
    }
}
