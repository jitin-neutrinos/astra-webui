package com.jitinnair.astra

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.RemoteInput
import okhttp3.*
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import kotlin.math.min
import kotlin.math.pow

/**
 * NtfyPushService — ONE long-lived WebSocket to the self-hosted ntfy server,
 * raising heads-up / lock-screen notifications for Astra gates (approvals,
 * clarify questions) no matter which device or surface raised them.
 *
 * Android 15 truth: the old `dataSync` foreground-service type is capped at
 * 6h/24h, after which the system KILLS the service (silence = "pushes stopped
 * working after a few hours"). `specialUse` has no such cap and is the
 * sanctioned type for a personal app that must hold a persistent channel.
 *
 * Lock-screen popup: every gate notification carries a fullScreenIntent. On a
 * sideloaded app (no Play Store revoke) Android grants USE_FULL_SCREEN_INTENT
 * by default: screen off/locked → the gate card is shown full-screen over the
 * lock screen; screen on → standard heads-up. Tapping it unlocks/presents the
 * deep-linked chat without hunting for the app icon.
 */
class NtfyPushService : Service() {
    private var client: OkHttpClient? = null
    private var webSocket: WebSocket? = null
    private var isRunning = false
    private var reconnectAttempt = 0
    private val handler = Handler(Looper.getMainLooper())
    private val TAG = "NtfyPushService"
    private val NOTIFICATION_ID = 1001
    private var reconnectRunnable: Runnable? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannels()
        startAsForeground("Connecting…")
        isRunning = true
        connectWebSocket()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Restart STICKY: after a low-memory kill the service (and pushes) come
        // back on their own instead of dying until the app is reopened.
        return START_STICKY
    }

    // ---------------------------------------------------------------------
    // Channels
    // ---------------------------------------------------------------------
    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_PUSH, "Astra approvals & questions",
                    NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = "Approval requests and questions from Astra chats"
                    lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                    setShowBadge(true)
                }
            )
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_FG, "Astra connection",
                    NotificationManager.IMPORTANCE_MIN
                ).apply {
                    description = "Background connection status"
                }
            )
        }
    }

    private fun startAsForeground(text: String) {
        val notification = foregroundNotification(text)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun foregroundNotification(text: String): Notification {
        val intent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, intent, PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, CHANNEL_FG)
            .setContentTitle("Astra")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .build()
    }

    // ---------------------------------------------------------------------
    // WebSocket
    // ---------------------------------------------------------------------
    private fun connectWebSocket() {
        if (!isRunning) return

        val prefs: SharedPreferences = getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
        val connString = prefs.getString("ntfy_conn", "") ?: ""
        if (connString.isEmpty()) {
            Log.w(TAG, "ntfy_conn not set; service idle")
            stopSelf()
            return
        }

        val parts = connString.split("|")
        if (parts.size < 3) {
            Log.e(TAG, "ntfy_conn malformed")
            stopSelf()
            return
        }

        val url = parts[0].trimEnd('/')
        val topic = parts[1]
        val auth = parts[2]

        val wsUrl = "$url/$topic/ws"
        val request = Request.Builder()
            .url(wsUrl)
            .header("Authorization", "Basic $auth")
            .build()

        client = OkHttpClient.Builder()
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .pingInterval(30, TimeUnit.SECONDS)   // OkHttp-level keepalive: half-dead Wi-Fi/NAT wires get recycled and reconnected instead of hanging
            .retryOnConnectionFailure(true)
            .build()

        webSocket = client?.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.d(TAG, "WebSocket opened")
                reconnectAttempt = 0
                val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                manager.notify(NOTIFICATION_ID, foregroundNotification("Connected"))
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val json = JSONObject(text)
                    if (json.optString("event") == "clear") return
                    if (json.optString("event") == "open") return
                    if (json.optString("event") == "message") {
                        showGateNotification(json)
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error parsing message", e)
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "WebSocket closed: $reason")
                scheduleReconnect()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "WebSocket failure", t)
                scheduleReconnect()
            }
        })
    }

    private fun scheduleReconnect() {
        if (!isRunning) return
        reconnectRunnable?.let { handler.removeCallbacks(it) }
        val delaySec = min(300.0, 1.0 * (2.0).pow(reconnectAttempt)).toLong().coerceAtLeast(1)
        reconnectAttempt++
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, foregroundNotification("Reconnecting in ${delaySec}s"))
        val r = Runnable { if (isRunning) connectWebSocket() }
        reconnectRunnable = r
        handler.postDelayed(r, delaySec * 1000)
    }

    // ---------------------------------------------------------------------
    // Gate notification
    // ---------------------------------------------------------------------
    private fun showGateNotification(json: JSONObject) {
        val title = json.optString("title", "Astra")
        val message = json.optString("message", "")
        val clickUrl = json.optString("click", "")

        // Deep link: prefer the app-scheme link minted from the chat path so a
        // tap lands INSIDE the right chat even when the app was cold-started.
        val openIntent = Intent(this, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            data = Uri.parse(clickPathToScheme(clickUrl))
            `package` = packageName
            addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val openPi = PendingIntent.getActivity(
            this, clickUrl.hashCode(), openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Full-screen intent: SAME activity. Screen off/locked → Android shows
        // this card full-screen over the lock screen; unlock/present → chat.
        val fullScreenPi = PendingIntent.getActivity(
            this, clickUrl.hashCode() + 1, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val builder = NotificationCompat.Builder(this, CHANNEL_PUSH)
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message))
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentIntent(openPi)
            .setFullScreenIntent(fullScreenPi, true)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)

        // Approve / Reject — deep-link straight into the chat with the choice
        // pre-wired; one tap from the notification, no app navigation.
        if (json.optString("extras_astra_kind") == "approval" || json.has("extras")) {
            val approveIntent = Intent(this, MainActivity::class.java).apply {
                action = Intent.ACTION_VIEW
                data = Uri.parse(clickPathToScheme(clickUrl))
                `package` = packageName
                putExtra("gate_choice", "approve")
                addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            }
            val rejectIntent = Intent(this, MainActivity::class.java).apply {
                action = Intent.ACTION_VIEW
                data = Uri.parse(clickPathToScheme(clickUrl))
                `package` = packageName
                putExtra("gate_choice", "reject")
                addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            }
            builder.addAction(0, "Approve", PendingIntent.getActivity(
                this, clickUrl.hashCode() + 2, approveIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            builder.addAction(0, "Reject", PendingIntent.getActivity(
                this, clickUrl.hashCode() + 3, rejectIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
        }

        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(clickUrl.hashCode().coerceAtLeast(1), builder.build())
    }

    private fun clickPathToScheme(clickUrl: String): String {
        return if (clickUrl.isNotEmpty()) {
            try {
                val uri = Uri.parse(clickUrl)
                "astra://open?path=${uri.path ?: "/"}"
            } catch (e: Exception) {
                "astra://open?path=/"
            }
        } else {
            "astra://open?path=/"
        }
    }

    // Android 15+: dataSync/specialUse FGS that hit their (6h / managed) limit
    // get a short grace window to stop cleanly. stopSelf() here avoids the
    // RemoteServiceException crash; START_STICKY brings the service back.
    override fun onTimeout(startId: Int, fgsType: Int) {
        Log.w(TAG, "FGS timeout (type=$fgsType) — stopping cleanly")
        stopSelf()
    }

    override fun onDestroy() {
        isRunning = false
        reconnectRunnable?.let { handler.removeCallbacks(it) }
        webSocket?.close(1000, "Service destroyed")
        client?.dispatcher?.executorService?.shutdown()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val CHANNEL_PUSH = "astra-push"
        const val CHANNEL_FG = "astra-connection"
    }
}
