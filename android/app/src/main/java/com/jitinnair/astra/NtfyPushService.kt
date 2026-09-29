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

    // ---- chat leg (R1): second socket, same service, shared client ----------
    // Native-owned background chat WS: while the app is backgrounded/dead the
    // WebView socket is gone (Doze kills it silently), so THIS leg is what
    // knows a turn finished. Filtered server-side via ?sid= — it receives only
    // message.complete/message.error for the session the page last pushed.
    private var chatSocket: WebSocket? = null
    private var chatAttempt = 0
    private var chatRunnable: Runnable? = null
    private var chatPrefRunnable: Runnable? = null
    private var chatCurrentSid: String? = null
    private var chatCookie: String? = null
    private var appForeground = false

    override fun onCreate() {
        super.onCreate()
        createNotificationChannels()
        startAsForeground("Connecting…")
        isRunning = true
        connectWebSocket()
        connectChatLeg()
        startChatPrefWatch()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Restart STICKY: after a low-memory kill the service (and pushes) come
        // back on their own instead of dying until the app is reopened.
        when (intent?.action) {
            ACTION_APP_FOREGROUND -> appForeground = true
            ACTION_APP_BACKGROUND -> appForeground = false
            ACTION_SESSION_CHANGED -> {
                chatAttempt = 0
                reconnectChatLeg("session-changed")
            }
        }
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
                    enableVibration(true)
                    vibrationPattern = longArrayOf(0, 250, 150, 250)
                }
            )
            manager.deleteNotificationChannel("astra-push")
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_CHAT, "Astra replies",
                    NotificationManager.IMPORTANCE_DEFAULT
                ).apply {
                    description = "Heads-up when Astra finishes a reply in the background"
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

        client = sharedClient()

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
    // Chat leg (R1/R3): native-owned background chat socket
    // ---------------------------------------------------------------------

    // Live identity the page pushed (sid + stored chat key). Prefs are the
    // one-way bridge — the page cannot call into a service that may be dead.
    private fun chatIdentity(): Pair<String, String?> {
        val prefs = getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
        val sid = prefs.getString("astra_live_sid", null)
        val stored = prefs.getString("astra_stored_key", null)
        return (sid ?: stored ?: "") to stored
    }

    private fun readSessionCookie(): String? {
        return try {
            // HttpOnly cookies ARE visible here (web-plan verified fact).
            android.webkit.CookieManager.getInstance()
                .getCookie("https://astra.jitinnair.com")
                ?.split(";")
                ?.map { it.trim() }
                ?.firstOrNull { it.startsWith("astra_session=") }
        } catch (e: Exception) {
            Log.e(TAG, "cookie read failed", e)
            null
        }
    }

    // One OkHttp client for both legs (connection pool + threads shared).
    private fun sharedClient(): OkHttpClient {
        if (client == null) {
            client = OkHttpClient.Builder()
                .readTimeout(0, TimeUnit.MILLISECONDS)
                .pingInterval(30, TimeUnit.SECONDS)
                .retryOnConnectionFailure(true)
                .build()
        }
        return client!!
    }

    private fun connectChatLeg() {
        if (!isRunning) return
        val (sid, _) = chatIdentity()
        val cookie = readSessionCookie()
        chatCurrentSid = sid
        chatCookie = cookie
        if (sid.isEmpty() || cookie.isNullOrEmpty()) {
            // No identity yet (never logged in / cookie replay pending): stay
            // quiet, the 60s prefs watcher re-fires once the page pushes one.
            scheduleChatReconnect("no-identity")
            return
        }
        val request = Request.Builder()
            .url("wss://astra.jitinnair.com/api/hx/ws?sid=${Uri.encode(sid)}")
            .header("Cookie", cookie)
            .build()
        chatSocket = sharedClient().newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                Log.d(TAG, "chat WS opened sid=$sid")
                chatAttempt = 0
            }

            override fun onMessage(ws: WebSocket, text: String) {
                handleChatFrame(sid, text)
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "chat WS closed: $reason")
                scheduleChatReconnect("closed")
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                val code = response?.code
                Log.e(TAG, "chat WS failure code=$code", t)
                // 401/403 = session cookie dead — long backoff; the prefs
                // watcher re-arms fast once the next in-app login writes one.
                if (code == 401 || code == 403) chatAttempt = chatAttempt.coerceAtLeast(6)
                scheduleChatReconnect(if (code == 401 || code == 403) "auth" else "failure")
            }
        })
    }

    private fun scheduleChatReconnect(why: String) {
        if (!isRunning) return
        chatRunnable?.let { handler.removeCallbacks(it) }
        val delaySec = min(300.0, 1.0 * (2.0).pow(chatAttempt)).toLong().coerceAtLeast(1)
        chatAttempt++
        Log.d(TAG, "chat reconnect in ${delaySec}s ($why)")
        val r = Runnable { if (isRunning) connectChatLeg() }
        chatRunnable = r
        handler.postDelayed(r, delaySec * 1000)
    }

    private fun reconnectChatLeg(why: String) {
        try { chatSocket?.close(1000, "redial: $why") } catch (_: Exception) { /* gone */ }
        chatSocket = null
        connectChatLeg()
    }

    // 60s identity watcher: the page can change chat / re-login while the
    // service holds a socket with the OLD filter — redial when sid or cookie
    // changed. Residual staleness window is <= 60s (accepted in the plan).
    private fun startChatPrefWatch() {
        val r = object : Runnable {
            override fun run() {
                if (!isRunning) return
                val (sid, _) = chatIdentity()
                val cookie = readSessionCookie()
                if (sid != chatCurrentSid || cookie != chatCookie) {
                    chatAttempt = 0
                    reconnectChatLeg("identity-changed")
                }
                handler.postDelayed(this, 60_000)
            }
        }
        chatPrefRunnable = r
        handler.postDelayed(r, 60_000)
    }

    // R3: message.complete while backgrounded → quiet notification.
    private fun handleChatFrame(sid: String, text: String) {
        // Deltas are 95% of frames — substring prescan, no parse.
        if (!text.contains("message.complete")) return
        try {
            val msg = JSONObject(text)
            val params = msg.optJSONObject("params") ?: return
            if (params.optString("type") != "message.complete") return
            if (params.optString("session_id") != sid) return
            val payload = params.optJSONObject("payload")
            // Belt-and-braces: gates are ntfy's job, never double-notify one.
            if (payload != null && (payload.has("gate") || payload.has("approval"))) return
            if (payload != null && payload.optString("status") == "error") return
            if (appForeground) return // the open page renders live
            showChatNotification(sid, payload)
        } catch (e: Exception) {
            Log.e(TAG, "chat frame parse", e)
        }
    }

    private fun showChatNotification(sid: String, payload: JSONObject?) {
        val stored = chatIdentity().second ?: sid
        val snippet = (payload?.optString("text") ?: "")
            .replace('\n', ' ').trim().take(140)
        val notifId = ("chat:$sid").hashCode().coerceAtLeast(2)
        val intent = Intent(this, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            data = Uri.parse("astra://open?path=/c/$stored")
            `package` = packageName
            addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val pi = PendingIntent.getActivity(
            this, notifId, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val builder = NotificationCompat.Builder(this, CHANNEL_CHAT)
            .setContentTitle("Astra replied")
            .setContentText(if (snippet.isEmpty()) "Your reply is ready." else snippet)
            .setStyle(NotificationCompat.BigTextStyle().bigText(if (snippet.isEmpty()) "Your reply is ready." else snippet))
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentIntent(pi)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(notifId, builder.build())
    }

    // ---------------------------------------------------------------------
    // Gate notification
    // ---------------------------------------------------------------------
    private fun showGateNotification(json: JSONObject) {
        val title = json.optString("title", "Astra")
        val message = json.optString("message", "")
        val clickUrl = json.optString("click", "")
        val msgId = json.optString("id", System.nanoTime().toString())
        val notifId = msgId.hashCode().coerceAtLeast(2)
        val gateId = try { Uri.parse(clickUrl).getQueryParameter("gate") ?: "" } catch (e: Exception) { "" }
        val isApproval = title.contains("approval", ignoreCase = true)

        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        // Interactive pop-up card. No gate id (older server / plain push) -> open the chat.
        val popup = if (gateId.isNotEmpty()) Intent(this, GateActivity::class.java).apply {
            putExtra(GateActivity.EXTRA_GATE_ID, gateId)
            putExtra(GateActivity.EXTRA_NOTIF_ID, notifId)
            putExtra(GateActivity.EXTRA_CLICK, clickUrl)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        } else Intent(this, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            data = Uri.parse(clickPathToScheme(clickUrl))
            `package` = packageName
            addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val contentPi = PendingIntent.getActivity(this, notifId, popup, flags)
        val fullPi = PendingIntent.getActivity(this, notifId + 1, popup, flags)

        val builder = NotificationCompat.Builder(this, CHANNEL_PUSH)
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message))
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentIntent(contentPi)
            .setFullScreenIntent(fullPi, true)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)

        // One-tap Approve / Deny that actually answers (posts to the Astra server).
        if (gateId.isNotEmpty() && isApproval) {
            fun act(choice: String, off: Int) = PendingIntent.getBroadcast(
                this, notifId + off,
                Intent(this, GateActionReceiver::class.java).apply {
                    putExtra(GateActivity.EXTRA_GATE_ID, gateId)
                    putExtra(GateActivity.EXTRA_NOTIF_ID, notifId)
                    putExtra("choice", choice)
                }, flags)
            builder.addAction(0, "Approve", act("once", 2))
            builder.addAction(0, "Deny", act("deny", 3))
        }

        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(notifId, builder.build())
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
        chatRunnable?.let { handler.removeCallbacks(it) }
        chatPrefRunnable?.let { handler.removeCallbacks(it) }
        webSocket?.close(1000, "Service destroyed")
        chatSocket?.close(1000, "Service destroyed")
        client?.dispatcher?.executorService?.shutdown()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val CHANNEL_PUSH = "astra-push-v2"
        const val CHANNEL_FG = "astra-connection"
        const val CHANNEL_CHAT = "astra-chat-v2"
        const val ACTION_APP_FOREGROUND = "com.jitinnair.astra.APP_FOREGROUND"
        const val ACTION_APP_BACKGROUND = "com.jitinnair.astra.APP_BACKGROUND"
        const val ACTION_SESSION_CHANGED = "com.jitinnair.astra.SESSION_CHANGED"
    }
}
