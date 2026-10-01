package com.jitinnair.astra

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Context.NOTIFICATION_SERVICE
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import kotlin.concurrent.thread

/** One-tap Approve / Deny straight from the notification shade - no UI. */
class GateActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getStringExtra(GateActivity.EXTRA_GATE_ID) ?: return
        val choice = intent.getStringExtra("choice") ?: return
        val notifId = intent.getIntExtra(GateActivity.EXTRA_NOTIF_ID, 0)
        val parts = (context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
            .getString("ntfy_conn", "") ?: "").split("|")
        if (parts.size < 3) return
        val pending = goAsync()
        thread {
            var ok = false
            var denied = choice == "deny"
            try {
                val req = Request.Builder().url("${GateActivity.BASE}/api/gate/$id")
                    .header("Authorization", "Basic ${parts[2]}")
                    .post(JSONObject().put("choice", choice).toString().toRequestBody("application/json".toMediaType()))
                    .build()
                OkHttpClient().newCall(req).execute().use { r ->
                    if (r.isSuccessful || r.code == 409 || r.code == 404) {
                        (context.getSystemService(NOTIFICATION_SERVICE) as NotificationManager).cancel(notifId)
                        ok = true
                    }
                }
            } catch (_: Exception) { }
            confirm(context, ok, denied)
            pending.finish()
        }
    }

    /** Branded confirmation (flat) instead of a Toast — survives lockscreen, carries the badge. */
    private fun confirm(context: Context, ok: Boolean, denied: Boolean) {
        val nm = context.getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(CONFIRM_CHANNEL, "Astra confirmations", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Confirms an approval or denial answered from the notification"
                    lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
                    setShowBadge(false)
                }
            )
        }
        val title: String; val text: String
        if (!ok) { title = "Couldn't send"; text = "Open Astra and answer there." }
        else if (denied) { title = "Denied"; text = "Astra will not run it." }
        else { title = "Approved"; text = "Astra is continuing." }
        val n = NotificationCompat.Builder(context, CONFIRM_CHANNEL)
            .setSmallIcon(R.drawable.ic_astra_notify)
            .setColor(0xFF22D3EE.toInt())
            .setContentTitle(title)
            .setContentText(text)
            .setAutoCancel(true)
            .setTimeoutAfter(if (ok) 4000 else 8000)   // quiet self-clearing confirmation
            .build()
        nm.notify(3000 + title.hashCode() % 1000, n)
    }

    companion object { private const val CONFIRM_CHANNEL = "astra-confirm" }
}
