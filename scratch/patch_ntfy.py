import re

with open("android/app/src/main/java/com/jitinnair/astra/NtfyPushService.kt", "r") as f:
    code = f.read()

# 1. Add companion object actions
code = code.replace('const val ACTION_SESSION_CHANGED = "com.jitinnair.astra.SESSION_CHANGED"',
'''const val ACTION_SESSION_CHANGED = "com.jitinnair.astra.SESSION_CHANGED"
        const val ACTION_CHAT_OPENED = "com.jitinnair.astra.CHAT_OPENED"
        const val ACTION_CHAT_CLEARED = "com.jitinnair.astra.CHAT_CLEARED"
        const val ACTION_CHAT_CLEARED_ALL = "com.jitinnair.astra.CHAT_CLEARED_ALL"''')

# 2. Update onStartCommand
code = code.replace('''            ACTION_SESSION_CHANGED -> {
                chatAttempt = 0
                reconnectChatLeg("session-changed")
            }''',
'''            ACTION_SESSION_CHANGED -> {
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
            }''')

# 3. Add SessionInfo and resolveSessionInfo
# Insert before `private fun showGateNotification`
session_info_code = '''
    data class SessionInfo(val title: String, val storedKey: String)
    private val sessionCache = mutableMapOf<String, SessionInfo>()
    private val sessionNotFoundCache = mutableMapOf<String, Long>()

    private fun resolveSessionInfo(sid: String): SessionInfo {
        sessionCache[sid]?.let { return it }
        val now = System.currentTimeMillis()
        if (sessionNotFoundCache.containsKey(sid) && now - sessionNotFoundCache[sid]!! < 600000L) {
            return SessionInfo("Astra chat", sid)
        }

        val cookie = readSessionCookie() ?: return SessionInfo("Astra chat", sid)
        val request = Request.Builder()
            .url("https://astra.jitinnair.com/api/hx/session-info/$sid")
            .header("Cookie", cookie)
            .build()
        try {
            val response = sharedClient().newCall(request).execute()
            if (response.isSuccessful) {
                val json = JSONObject(response.body?.string() ?: "{}")
                val title = json.optString("title", "Astra chat")
                val storedKey = json.optString("session_key", sid)
                val info = SessionInfo(if (title.isEmpty()) "Astra chat" else title, if (storedKey.isEmpty()) sid else storedKey)
                sessionCache[sid] = info
                return info
            } else {
                sessionNotFoundCache[sid] = now
            }
        } catch (e: Exception) {
            Log.e(TAG, "resolveSessionInfo failed", e)
            sessionNotFoundCache[sid] = now
        }
        return SessionInfo("Astra chat", sid)
    }

    data class ChatState(var title: String, var storedKey: String, var count: Int, val notifId: Int, val lines: MutableList<String>)
    private val chatStates = mutableMapOf<String, ChatState>()
    private val GROUP_KEY_CHAT = "astra-chat-replies"

    private fun updateGroupSummary() {
        if (chatStates.isEmpty()) {
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.cancel(2001)
            // ponytail: vendor-launcher dependent ceiling
            me.leolin.shortcutbadger.ShortcutBadger.applyCount(applicationContext, 0)
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
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setStyle(inboxStyle)
            .setGroup(GROUP_KEY_CHAT)
            .setGroupSummary(true)
            .setContentIntent(pi)
            .setDeleteIntent(deletePi)
            .setAutoCancel(true)
            .setNumber(totalUnread)
        
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(2001, builder.build())
        me.leolin.shortcutbadger.ShortcutBadger.applyCount(applicationContext, totalUnread)
    }
'''
code = code.replace('    private fun showGateNotification(json: JSONObject) {', session_info_code + '\n    private fun showGateNotification(json: JSONObject) {')

# 4. Modify handleChatFrame
handle_chat_frame_orig = '''    private fun handleChatFrame(sid: String, text: String) {
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
    }'''
handle_chat_frame_new = '''    private fun handleChatFrame(text: String) {
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
    }'''
code = code.replace(handle_chat_frame_orig, handle_chat_frame_new)

# 5. Modify showChatNotification
show_chat_notif_orig = '''    private fun showChatNotification(sid: String, payload: JSONObject?) {
        val stored = chatIdentity().second ?: sid
        val snippet = (payload?.optString("text") ?: "")
            .replace('\\n', ' ').trim().take(140)
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
    }'''

show_chat_notif_new = '''    private fun showChatNotification(sid: String, payload: JSONObject?) {
        val info = resolveSessionInfo(sid)
        val snippet = (payload?.optString("text") ?: "")
            .replace('\\n', ' ').trim().take(140)
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

        val person = androidx.core.app.Person.Builder().setName("Astra").build()
        val messagingStyle = NotificationCompat.MessagingStyle(person)
        messagingStyle.conversationTitle = state.title
        for (line in state.lines) {
            messagingStyle.addMessage(line, System.currentTimeMillis(), person)
        }

        val builder = NotificationCompat.Builder(this, CHANNEL_CHAT)
            .setContentTitle(state.title)
            .setContentText(displaySnippet)
            .setStyle(messagingStyle)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentIntent(pi)
            .setDeleteIntent(deletePi)
            .setAutoCancel(true)
            .setGroup(GROUP_KEY_CHAT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setNumber(state.count)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(notifId, builder.build())
        
        updateGroupSummary()
    }'''
code = code.replace(show_chat_notif_orig, show_chat_notif_new)


# 6. connectChatLeg changes
code = re.sub(
    r'private var chatCurrentSid: String\? = null\n    private var chatCookie: String\? = null\n    private var appForeground = false',
    'private var chatCookie: String? = null\n    private var appForeground = false',
    code
)

connect_chat_orig = '''    private fun connectChatLeg() {
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
            }'''
connect_chat_new = '''    private fun connectChatLeg() {
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
            }'''
code = code.replace(connect_chat_orig, connect_chat_new)

# 7. startChatPrefWatch changes
pref_watch_orig = '''    private fun startChatPrefWatch() {
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
    }'''
pref_watch_new = '''    private fun startChatPrefWatch() {
        val r = object : Runnable {
            override fun run() {
                if (!isRunning) return
                val cookie = readSessionCookie()
                if (cookie != chatCookie) {
                    chatAttempt = 0
                    reconnectChatLeg("identity-changed")
                }
                handler.postDelayed(this, 60_000)
            }
        }
        chatPrefRunnable = r
        handler.postDelayed(r, 60_000)
    }'''
code = code.replace(pref_watch_orig, pref_watch_new)

with open("android/app/src/main/java/com/jitinnair/astra/NtfyPushService.kt", "w") as f:
    f.write(code)

print("done")
