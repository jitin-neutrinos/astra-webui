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
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.RemoteInput
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.IconCompat
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
    private var ntfyDownSince = 0L
    private val handler = Handler(Looper.getMainLooper())
    // ponytail: 30s cookie cache, not a watcher. Upgrade if login must show in <30s while backgrounded.
    private var cookieCache: String? = null
    private var cookieCacheAt = 0L
    private var summaryQueued = false
    private val summaryRunnable = Runnable {
        summaryQueued = false
        publishGroupSummary()
    }
    private val TAG = "NtfyPushService"
    private val NOTIFICATION_ID = 1001
    private var reconnectRunnable: Runnable? = null

    // ---- brand (flat, no gradients) -----------------------------------------
    // cyanx token from the web index.css; one accent everywhere.
    private val brandColor: Int get() = 0xFF22D3EE.toInt()
    private val greenStatus: Int get() = 0xFF10B981.toInt()   // okay token (GateActivity)
    private val redStatus: Int get() = 0xFFEF4444.toInt()
    private var ntfyUp = false   // gate socket health → status dot

    /** Full-color logo bitmap — small-icon slot. Owner wants the real
     *  logo in the panel group header; ROMs that allow color render it as-is.
     *  CRASH FIX (v1.11.7): R.mipmap.ic_launcher is adaptive-icon XML on API 26+
     *  — BitmapFactory returns null for XML, and IconCompat.createWithBitmap(null)
     *  NPEs at service start (killed the app at launch in v1.11.6). Decode the
     *  PNG foreground instead, crop to the glyph, cache. */
    private var logoBmp: Bitmap? = null
    private fun fullLogo(): Bitmap {
        logoBmp?.let { return it }
        val bmp = try {
            val raw = android.graphics.BitmapFactory.decodeResource(resources, R.mipmap.ic_launcher_foreground)
            if (raw == null) throw IllegalStateException("foreground not a bitmap")
            // glyph occupies ~[63..362]x[70..371] of the 432px art — crop + square
            val size = minOf(raw.width, raw.height)
            val x0 = (raw.width * 0.145f).toInt().coerceAtLeast(0)
            val y0 = (raw.height * 0.160f).toInt().coerceAtLeast(0)
            val side = (size * 0.70f).toInt().coerceAtMost(minOf(raw.width - x0, raw.height - y0))
            Bitmap.createScaledBitmap(
                Bitmap.createBitmap(raw, x0, y0, side, side), 96, 96, true
            )
        } catch (e: Exception) {
            Log.e(TAG, "fullLogo decode failed — fallback stencil", e)
            val d = ContextCompat.getDrawable(this, R.drawable.ic_astra_notify)!!
            val b = Bitmap.createBitmap(d.intrinsicWidth, d.intrinsicHeight, Bitmap.Config.ARGB_8888)
            val c = android.graphics.Canvas(b)
            d.setBounds(0, 0, c.width, c.height); d.draw(c)
            b
        }
        logoBmp = bmp
        return bmp
    }

    private fun astraPersona(): androidx.core.app.Person = androidx.core.app.Person.Builder()
        .setName("Astra")
        // Real launcher art, as-is (full-color gradient star) — not a redrawn glyph.
        .setIcon(IconCompat.createWithBitmap(fullLogo()))
        .build()

    // ---- chat leg (R1): second socket, same service, shared client ----------
    // Native-owned background chat WS: while the app is backgrounded/dead the
    // WebView socket is gone (Doze kills it silently), so THIS leg is what
    // knows a turn finished. Filtered server-side via ?sid= — it receives only
    // message.complete/message.error for the session the page last pushed.
    private var chatSocket: WebSocket? = null
    private var chatAttempt = 0
    private var chatRunnable: Runnable? = null
    private var chatPrefRunnable: Runnable? = null
    private var chatCookie: String? = null
    private var appForeground = false

    override fun onCreate() {
        super.onCreate()
        createNotificationChannels()
        isRunning = true
        startAsForeground()
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
            ACTION_CHAT_OPENED -> {
                val storedKey = intent?.getStringExtra("stored_key")
                if (storedKey != null) {
                    val sid = chatStates.entries.firstOrNull { it.value.storedKey == storedKey }?.key
                    if (sid != null) {
                        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                        val state = chatStates.remove(sid)
                        if (state != null) manager.cancel(state.notifId)
                        updateGroupSummary()
                    }
                }
            }
            ACTION_CHAT_CLEARED -> {
                val sid = intent?.getStringExtra("sid")
                if (sid != null) {
                    chatStates.remove(sid)
                    updateGroupSummary()
                }
            }
            ACTION_CHAT_CLEARED_ALL -> {
                val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                for ((_, state) in chatStates) manager.cancel(state.notifId)
                chatStates.clear()
                updateGroupSummary()
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

    private fun startAsForeground() {
        val notification = statusNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    // ---- foreground status notification: unread count > connection dot -------------
    // Owner spec: unread chats → count tile in cyan; none unread + connected → green
    // dot; not connected → red dot. Flat colors only.
    private fun totalUnread(): Int = chatStates.values.sumOf { it.count }

    private fun publishStatus() {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, statusNotification())
    }

    private fun statusNotification(): Notification {
        val unread = totalUnread()
        val intent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE)
        val builder = NotificationCompat.Builder(this, CHANNEL_FG)
        when {
            unread > 0 -> builder
                .setContentTitle("$unread unread ${if (unread == 1) "reply" else "replies"}")
                .setContentText(if (chatStates.size > 1) "${chatStates.size} chats waiting" else "Tap to open Astra")
                .setColor(brandColor)
                .setNumber(unread)
            ntfyUp -> builder
                .setContentTitle("Connected")
                .setContentText("Listening for replies & approvals")
                .setColor(greenStatus)
            else -> builder
                .setContentTitle(if (ntfyDownSince > 0) "Reconnecting…" else "Connecting…")
                .setContentText("Notifications will resume shortly")
                .setColor(redStatus)
        }
        // Full-color logo everywhere, including the silent status row. State
        // still reads through setColor (green/red/cyan) on tinting ROMs.
        return builder
            .setSmallIcon(IconCompat.createWithBitmap(fullLogo()))
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setShowWhen(false)
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
                ntfyDownSince = 0L
                ntfyUp = true
                publishStatus()
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
        if (ntfyDownSince == 0L) ntfyDownSince = System.currentTimeMillis()
        ntfyUp = false
        publishStatus()
        reconnectRunnable?.let { handler.removeCallbacks(it) }
        val delaySec = min(300.0, 1.0 * (2.0).pow(reconnectAttempt)).toLong().coerceAtLeast(1)
        reconnectAttempt++
        // Status text only after 60s down. Dial still happens immediately.
        if (System.currentTimeMillis() - ntfyDownSince >= 60_000L) {
            publishStatus()
        }
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
        val now = System.currentTimeMillis()
        if (now - cookieCacheAt < 30_000L) return cookieCache
        val cookie = try {
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
        cookieCache = cookie
        cookieCacheAt = now
        return cookie
    }

    // One OkHttp client for both legs (connection pool + threads shared).
    private fun sharedClient(): OkHttpClient {
        if (client == null) {
            client = OkHttpClient.Builder()
                .readTimeout(0, TimeUnit.MILLISECONDS)
                .pingInterval(60, TimeUnit.SECONDS)
                .retryOnConnectionFailure(true)
                .build()
        }
        return client!!
    }

    private fun connectChatLeg() {
        if (!isRunning) return
        val cookie = readSessionCookie()
        chatCookie = cookie
        if (cookie.isNullOrEmpty()) {
            scheduleChatReconnect("no-identity")
            return
        }
        val request = Request.Builder()
            .url("wss://astra.jitinnair.com/api/hx/ws?filter=complete")
            .header("Cookie", cookie)
            .build()
        chatSocket = sharedClient().newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                Log.d(TAG, "chat WS opened filter=complete")
                chatAttempt = 0
            }

            override fun onMessage(ws: WebSocket, text: String) {
                handleChatFrame(text)
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
                if (code == 401 || code == 403) {
                    cookieCacheAt = 0L
                    chatAttempt = chatAttempt.coerceAtLeast(6)
                }
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
                val cookie = readSessionCookie()
                if (cookie != chatCookie) {
                    chatAttempt = 0
                    reconnectChatLeg("identity-changed")
                }
                handler.postDelayed(this, 300_000)
            }
        }
        chatPrefRunnable = r
        handler.postDelayed(r, 300_000)
    }

    // R3: message.complete while backgrounded → quiet notification.
    private fun handleChatFrame(text: String) {
        if (!text.contains("message.complete")) return
        try {
            val msg = JSONObject(text)
            val params = msg.optJSONObject("params") ?: return
            if (params.optString("type") != "message.complete") return
            val sid = params.optString("session_id")
            if (sid.isEmpty()) return
            val payload = params.optJSONObject("payload")
            if (payload != null && (payload.has("gate") || payload.has("approval"))) return
            if (payload != null && payload.optString("status") == "error") return
            if (appForeground) return
            showChatNotification(sid, payload)
        } catch (e: Exception) {
            Log.e(TAG, "chat frame parse", e)
        }
    }

    private fun showChatNotification(sid: String, payload: JSONObject?) {
        val info = resolveSessionInfo(sid, payload?.optString("stored_session_id"))
        val snippet = (payload?.optString("text") ?: "")
            .replace('\n', ' ').trim().take(140)
        val displaySnippet = if (snippet.isEmpty()) "Your reply is ready." else snippet
        
        val notifId = ("chat:$sid").hashCode().coerceAtLeast(2)
        val state = chatStates.getOrPut(sid) { ChatState(info.title, info.storedKey, 0, notifId, mutableListOf()) }
        state.count++
        state.lines.add(displaySnippet)
        if (state.lines.size > 6) state.lines.removeAt(0)

        val intent = Intent(this, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            data = Uri.parse("astra://open?path=/c/${info.storedKey}")
            `package` = packageName
            addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val pi = PendingIntent.getActivity(this, notifId, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

        val deleteIntent = Intent(this, NtfyPushService::class.java).apply {
            action = ACTION_CHAT_CLEARED
            putExtra("sid", sid)
        }
        val deletePi = PendingIntent.getService(this, notifId, deleteIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

        val person = astraPersona()
        val messagingStyle = NotificationCompat.MessagingStyle(person)
        messagingStyle.conversationTitle = state.title
        for (line in state.lines) {
            messagingStyle.addMessage(line, System.currentTimeMillis(), person)
        }

        val builder = NotificationCompat.Builder(this, CHANNEL_CHAT)
            .setContentTitle(state.title)
            .setContentText(displaySnippet)
            .setStyle(messagingStyle)
            .setSmallIcon(IconCompat.createWithBitmap(fullLogo()))
            .setColor(brandColor)
            .setContentIntent(pi)
            .setDeleteIntent(deletePi)
            .setAutoCancel(true)
            .setGroup(GROUP_KEY_CHAT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setNumber(state.count)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(notifId, builder.build())
        
        updateGroupSummary()
    }

    // ---------------------------------------------------------------------
    // Gate notification
    // ---------------------------------------------------------------------

    data class SessionInfo(val title: String, val storedKey: String)
    private val sessionCache = mutableMapOf<String, SessionInfo>()
    private val sessionNotFoundCache = mutableMapOf<String, Long>()

    // storedHint = stored_session_id stamped by the proxy (live→stored
    // bridge). With it, title + deep link resolve against the STORED id —
    // the only id the history API and /c/<id> route understand. Without
    // it (mapping unknown), the old live-sid fallback applies.
    private fun resolveSessionInfo(sid: String, storedHint: String?): SessionInfo {
        if (!storedHint.isNullOrEmpty()) {
            sessionCache[sid]?.let { return it }
            val now = System.currentTimeMillis()
            if (sessionNotFoundCache.containsKey(sid) && now - sessionNotFoundCache[sid]!! < 600_000L) {
                return SessionInfo("Chat", storedHint)
            }
            val cookie = readSessionCookie()
                ?: return SessionInfo("Chat", storedHint)
            return try {
                val request = Request.Builder()
                    .url("https://astra.jitinnair.com/api/hx/session-info/$storedHint")
                    .header("Cookie", cookie)
                    .build()
                sharedClient().newCall(request).execute().use { response ->
                    if (response.isSuccessful) {
                        val json = JSONObject(response.body?.string() ?: "{}")
                        val title = json.optString("title", "Chat")
                        val info = SessionInfo(if (title.isEmpty()) "Chat" else title, storedHint)
                        sessionCache[sid] = info
                        info
                    } else {
                        sessionNotFoundCache[sid] = now
                        SessionInfo("Chat", storedHint)
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "resolveSessionInfo(hint) failed", e)
                sessionNotFoundCache[sid] = now
                SessionInfo("Chat", storedHint)
            }
        }
        sessionCache[sid]?.let { return it }
        val now = System.currentTimeMillis()
        if (sessionNotFoundCache.containsKey(sid) && now - sessionNotFoundCache[sid]!! < 600000L) {
            return SessionInfo("Chat", sid)
        }

        val cookie = readSessionCookie() ?: return SessionInfo("Chat", sid)
        val request = Request.Builder()
            .url("https://astra.jitinnair.com/api/hx/session-info/$sid")
            .header("Cookie", cookie)
            .build()
        try {
            val response = sharedClient().newCall(request).execute()
            if (response.isSuccessful) {
                val json = JSONObject(response.body?.string() ?: "{}")
                val title = json.optString("title", "Chat")
                val storedKey = json.optString("session_key", sid)
                val info = SessionInfo(if (title.isEmpty()) "Chat" else title, if (storedKey.isEmpty()) sid else storedKey)
                sessionCache[sid] = info
                return info
            } else {
                sessionNotFoundCache[sid] = now
            }
        } catch (e: Exception) {
            Log.e(TAG, "resolveSessionInfo failed", e)
            sessionNotFoundCache[sid] = now
        }
        return SessionInfo("Chat", sid)
    }

    data class ChatState(var title: String, var storedKey: String, var count: Int, val notifId: Int, val lines: MutableList<String>)
    private val chatStates = mutableMapOf<String, ChatState>()
    private val GROUP_KEY_CHAT = "astra-chat-replies"

    private fun updateGroupSummary() {
        if (chatStates.isEmpty()) {
            handler.removeCallbacks(summaryRunnable)
            summaryQueued = false
            publishGroupSummary()
            return
        }
        // ponytail: 5s coalesce. Per-chat notification still posts immediately.
        if (summaryQueued) return
        summaryQueued = true
        handler.postDelayed(summaryRunnable, 5_000)
    }

    private fun publishGroupSummary() {
        if (chatStates.isEmpty()) {
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.cancel(2001)
            // ponytail: vendor-launcher dependent ceiling
            me.leolin.shortcutbadger.ShortcutBadger.applyCount(applicationContext, 0)
            publishStatus()   // back to green/red dot
            return
        }

        var totalUnread = 0
        val inboxStyle = NotificationCompat.InboxStyle()
        for ((_, state) in chatStates) {
            totalUnread += state.count
            val line = "${state.title}: ${state.count} new"
            inboxStyle.addLine(line)
        }

        val title = "$totalUnread new replies" + if (chatStates.size > 1) " · ${chatStates.size} chats" else ""
        val intent = Intent(this, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            `package` = packageName
            addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val pi = PendingIntent.getActivity(this, 2001, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

        val deleteIntent = Intent(this, NtfyPushService::class.java).apply {
            action = ACTION_CHAT_CLEARED_ALL
        }
        val deletePi = PendingIntent.getService(this, 2001, deleteIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

        val builder = NotificationCompat.Builder(this, CHANNEL_CHAT)
            .setContentTitle(title)
            .setSmallIcon(IconCompat.createWithBitmap(fullLogo()))
            .setColor(brandColor)
            .setStyle(inboxStyle)
            .setGroup(GROUP_KEY_CHAT)
            .setGroupSummary(true)
            .setContentIntent(pi)
            .setDeleteIntent(deletePi)
            .setAutoCancel(true)
            .setNumber(totalUnread)
        
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(2001, builder.build())
        me.leolin.shortcutbadger.ShortcutBadger.applyCount(applicationContext, totalUnread)
        publishStatus()   // unread count on the persistent status notification
    }

    // Gate id -> chat title for the notification body (header already says Astra).
    // GET /api/gate/:id with the ntfy cred the service already holds; title via
    // the existing session-info resolver. 15s in-memory cache, null on any miss.
    private val gateTitleCache = mutableMapOf<String, Pair<String, Long>>()
    private fun gateChatTitle(gateId: String): String? {
        val now = System.currentTimeMillis()
        gateTitleCache[gateId]?.let { (t, at) ->
            if (now - at < 60_000L) return t
        }
        val parts = (getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
            .getString("ntfy_conn", "") ?: "").split("|")
        if (parts.size < 3) return null
        return try {
            val req = Request.Builder()
                .url("https://astra.jitinnair.com/api/gate/$gateId")
                .header("Authorization", "Basic ${parts[2]}")
                .build()
            sharedClient().newCall(req).execute().use { r ->
                if (!r.isSuccessful) return null
                val g = JSONObject(r.body?.string() ?: "{}")
                val sid = g.optString("sid", "")
                if (sid.isEmpty()) return null
                val info = resolveSessionInfo(sid, g.optString("stored_session_id"))
                val t = info.title.takeUnless { it == "Chat" }
                if (t != null) gateTitleCache[gateId] = t to now
                t
            }
        } catch (e: Exception) {
            Log.e(TAG, "gateChatTitle failed", e)
            null
        }
    }

    private fun showGateNotification(json: JSONObject) {
        val title = json.optString("title", "Astra")
        val message = json.optString("message", "")
        val clickUrl = json.optString("click", "")
        val msgId = json.optString("id", System.nanoTime().toString())
        val notifId = msgId.hashCode().coerceAtLeast(2)
        val gateId = try { Uri.parse(clickUrl).getQueryParameter("gate") ?: "" } catch (e: Exception) { "" }
        val isApproval = title.contains("approval", ignoreCase = true)

        // Body title = the chat's name (owner spec: header already says Astra).
        // Chain: gate id -> sid -> session title. Fall back to kind text, never "Astra".
        val chatTitle = if (gateId.isNotEmpty()) gateChatTitle(gateId) else null
        val bodyTitle = when {
            chatTitle != null -> chatTitle
            isApproval -> "Approval needed"
            title.contains("question", ignoreCase = true) -> "Question"
            else -> "Update"
        }

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
            .setContentTitle(bodyTitle)
            .setContentText(message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message))
            .setSmallIcon(IconCompat.createWithBitmap(fullLogo()))
            .setColor(brandColor)
            .setColorized(isApproval)   // approvals: flat solid-cyan banner (call-style)
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
            builder.addAction(R.drawable.ic_action_approve, "Allow once", act("once", 2))
            builder.addAction(R.drawable.ic_action_deny, "Deny", act("deny", 3))
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
        handler.removeCallbacks(summaryRunnable)
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
        const val ACTION_CHAT_OPENED = "com.jitinnair.astra.CHAT_OPENED"
        const val ACTION_CHAT_CLEARED = "com.jitinnair.astra.CHAT_CLEARED"
        const val ACTION_CHAT_CLEARED_ALL = "com.jitinnair.astra.CHAT_CLEARED_ALL"
    }
}
