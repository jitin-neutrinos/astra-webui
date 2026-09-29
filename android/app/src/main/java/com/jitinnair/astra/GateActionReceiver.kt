package com.jitinnair.astra

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.widget.Toast
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
            var msg = "Couldn't send - open Astra"
            try {
                val req = Request.Builder().url("${GateActivity.BASE}/api/gate/$id")
                    .header("Authorization", "Basic ${parts[2]}")
                    .post(JSONObject().put("choice", choice).toString().toRequestBody("application/json".toMediaType()))
                    .build()
                OkHttpClient().newCall(req).execute().use { r ->
                    if (r.isSuccessful || r.code == 409 || r.code == 404) {
                        (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(notifId)
                        msg = if (choice == "deny") "Denied" else "Approved"
                    }
                }
            } catch (_: Exception) { }
            android.os.Handler(context.mainLooper).post { Toast.makeText(context, msg, Toast.LENGTH_SHORT).show() }
            pending.finish()
        }
    }
}
