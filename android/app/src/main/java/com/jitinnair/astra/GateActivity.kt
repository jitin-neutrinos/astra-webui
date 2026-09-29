package com.jitinnair.astra

import android.app.Activity
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import kotlin.concurrent.thread

/**
 * Interactive approval / question pop-up (Authenticator / Okta Verify style).
 * Launched by the push notification (tap or lock-screen full-screen intent).
 * Fetches the pending gate from the Astra server, renders it as a dialog card
 * over whatever is on screen, and posts the answer straight back — the chat
 * never has to be opened.
 */
class GateActivity : Activity() {

    private val http = OkHttpClient()
    private var gateId = ""
    private var notifId = 0
    private lateinit var root: LinearLayout
    private lateinit var card: LinearLayout

    private val navy = Color.parseColor("#0B1B2E")
    private val aqua = Color.parseColor("#A7DADB")
    private val emerald = Color.parseColor("#10B981")
    private val danger = Color.parseColor("#EF4444")
    private val muted = Color.parseColor("#9FB3C8")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            )
        }
        window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        window.setDimAmount(0.6f)
        window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
        setFinishOnTouchOutside(false)

        gateId = intent.getStringExtra(EXTRA_GATE_ID) ?: ""
        notifId = intent.getIntExtra(EXTRA_NOTIF_ID, 0)
        buildShell()
        if (gateId.isEmpty()) { openChatFallback(); return }
        showStatus("Loading request…")
        thread { load() }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        recreate()
    }

    // ---- shell -----------------------------------------------------------
    private fun dp(v: Int) = TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics
    ).toInt()

    private fun buildShell() {
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(14), dp(14), dp(14))
        }
        card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(20), dp(20), dp(16))
            background = GradientDrawable().apply {
                setColor(navy); cornerRadius = dp(22).toFloat(); setStroke(dp(1), Color.parseColor("#26405C"))
            }
        }
        val sv = ScrollView(this).apply { addView(card) }
        root.addView(sv)
        setContentView(root)
    }

    private fun text(s: String, sizeSp: Float, color: Int, bold: Boolean = false) = TextView(this).apply {
        text = s; setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp); setTextColor(color)
        if (bold) setTypeface(typeface, Typeface.BOLD)
        setPadding(0, dp(4), 0, dp(4))
    }

    private fun button(label: String, fill: Int, fg: Int, onClick: () -> Unit) = Button(this).apply {
        text = label; isAllCaps = false; setTextColor(fg)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
        background = GradientDrawable().apply { setColor(fill); cornerRadius = dp(14).toFloat() }
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(50)).apply { topMargin = dp(8) }
        setOnClickListener { onClick() }
    }

    private fun showStatus(msg: String) = runOnUiThread {
        card.removeAllViews(); card.addView(text(msg, 15f, muted))
    }

    // ---- data ------------------------------------------------------------
    private fun creds(): Pair<String, String>? {
        val prefs = getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
        val parts = (prefs.getString("ntfy_conn", "") ?: "").split("|")
        return if (parts.size >= 3) Pair(BASE, "Basic ${parts[2]}") else null
    }

    private fun load() {
        val (base, auth) = creds() ?: run { runOnUiThread { openChatFallback() }; return }
        try {
            http.newCall(Request.Builder().url("$base/api/gate/$gateId").header("Authorization", auth).build())
                .execute().use { r ->
                    val body = r.body?.string() ?: ""
                    when {
                        r.code == 404 -> showDone("This request is no longer pending.")
                        !r.isSuccessful -> runOnUiThread { openChatFallback() }
                        else -> {
                            val g = JSONObject(body)
                            if (g.optBoolean("answered")) showDone("Already answered.")
                            else runOnUiThread { render(g) }
                        }
                    }
                }
        } catch (e: Exception) {
            runOnUiThread { openChatFallback() }
        }
    }

    private fun post(payload: JSONObject) {
        val (base, auth) = creds() ?: return
        showStatus("Sending…")
        thread {
            try {
                val req = Request.Builder().url("$base/api/gate/$gateId").header("Authorization", auth)
                    .post(payload.toString().toRequestBody("application/json".toMediaType())).build()
                http.newCall(req).execute().use { r ->
                    when {
                        r.isSuccessful -> { cancelNotification(); showDone("Sent ✓", true) }
                        r.code == 409 -> showDone("Already answered.")
                        else -> runOnUiThread {
                            Toast.makeText(this, "Couldn't deliver (${r.code}). Open the chat to answer.", Toast.LENGTH_LONG).show()
                            openChatFallback()
                        }
                    }
                }
            } catch (e: Exception) {
                runOnUiThread {
                    Toast.makeText(this, "Network error. Open the chat to answer.", Toast.LENGTH_LONG).show()
                    openChatFallback()
                }
            }
        }
    }

    private fun cancelNotification() {
        if (notifId != 0) (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).cancel(notifId)
    }

    private fun showDone(msg: String, autoClose: Boolean = false) = runOnUiThread {
        card.removeAllViews()
        card.addView(text(msg, 17f, if (autoClose) emerald else muted, true))
        card.addView(button("Close", Color.parseColor("#1B3350"), Color.WHITE) { finish() })
        if (autoClose) card.postDelayed({ if (!isFinishing) finish() }, 900)
    }

    private fun openChatFallback() {
        val chat = intent.getStringExtra(EXTRA_CLICK) ?: ""
        val i = Intent(this, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            data = Uri.parse("astra://open?path=" + (try { Uri.parse(chat).path ?: "/" } catch (e: Exception) { "/" }))
            addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        startActivity(i)
        finish()
    }

    // ---- render ----------------------------------------------------------
    private fun render(g: JSONObject) {
        card.removeAllViews()
        card.addView(text((g.optString("title", "Astra")).uppercase(), 11f, aqua, true))
        if (g.optString("kind") == "approval") renderApproval(g) else renderClarify(g)
        card.addView(button("Open chat instead", Color.TRANSPARENT, muted) { openChatFallback() })
    }

    private fun renderApproval(g: JSONObject) {
        val cmd = g.optString("command")
        val desc = g.optString("description")
        if (desc.isNotEmpty()) card.addView(text(desc, 16f, Color.WHITE, true))
        if (cmd.isNotEmpty()) {
            card.addView(text(cmd, 13f, Color.parseColor("#D7E3F0")).apply {
                typeface = Typeface.MONOSPACE
                setPadding(dp(12), dp(10), dp(12), dp(10))
                background = GradientDrawable().apply { setColor(Color.parseColor("#06121F")); cornerRadius = dp(10).toFloat() }
            })
        }
        if (desc.isEmpty() && cmd.isEmpty()) card.addView(text("Astra is asking permission to continue.", 16f, Color.WHITE, true))
        val choices = g.optJSONArray("choices") ?: JSONArray().put("once").put("deny")
        val labels = mapOf("once" to "Approve once", "session" to "Allow this chat", "always" to "Always allow", "deny" to "Deny")
        for (i in 0 until choices.length()) {
            val c = choices.getString(i)
            val deny = c == "deny"
            card.addView(button(labels[c] ?: c, if (deny) Color.parseColor("#3A1F26") else if (c == "once") emerald else Color.parseColor("#1B3350"),
                if (deny) danger else Color.WHITE) { post(JSONObject().put("choice", c)) })
        }
    }

    private fun renderClarify(g: JSONObject) {
        val qs = g.optJSONArray("questions") ?: JSONArray()
        val picks = HashMap<String, MutableList<String>>()
        val freeTexts = HashMap<String, EditText>()
        val keys = ArrayList<String>()
        for (i in 0 until qs.length()) {
            val q = qs.getJSONObject(i)
            val question = q.optString("question")
            val key = q.optString("qid").ifEmpty { question }
            keys.add(key)
            card.addView(text((if (qs.length() > 1) "${i + 1}. " else "") + question, 16f, Color.WHITE, true))
            val multi = q.optBoolean("multi_select")
            val choices = q.optJSONArray("choices") ?: JSONArray()
            val list = picks.getOrPut(key) { mutableListOf() }
            val chipViews = ArrayList<Pair<String, Button>>()
            fun restyle() = chipViews.forEach { (c, b) ->
                val on = list.contains(c)
                (b.background as GradientDrawable).setColor(if (on) emerald else Color.parseColor("#1B3350"))
            }
            for (j in 0 until choices.length()) {
                val c = choices.getString(j)
                val b = button(c, Color.parseColor("#1B3350"), Color.WHITE) {
                    if (multi) { if (!list.remove(c)) list.add(c) } else { list.clear(); list.add(c) }
                    restyle()
                }
                chipViews.add(Pair(c, b)); card.addView(b)
            }
            val et = EditText(this).apply {
                hint = if (choices.length() > 0) "Or type your own answer" else "Type your answer"
                setHintTextColor(muted); setTextColor(Color.WHITE)
                inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
                background = GradientDrawable().apply { setColor(Color.parseColor("#06121F")); cornerRadius = dp(12).toFloat() }
                setPadding(dp(12), dp(10), dp(12), dp(10))
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) }
            }
            freeTexts[key] = et; card.addView(et)
        }
        card.addView(button("Send answer", emerald, Color.WHITE) {
            fun ans(k: String): String {
                val p = (picks[k] ?: mutableListOf()).joinToString(", ")
                val x = freeTexts[k]?.text?.toString()?.trim() ?: ""
                return if (p.isNotEmpty() && x.isNotEmpty()) "$p — $x" else p.ifEmpty { x }
            }
            if (keys.any { ans(it).isEmpty() }) {
                Toast.makeText(this, "Answer every question first", Toast.LENGTH_SHORT).show()
            } else if (qs.length() == 1 && qs.getJSONObject(0).optString("qid").isEmpty()) {
                post(JSONObject().put("answer", ans(keys[0])))
            } else {
                val a = JSONObject(); keys.forEach { a.put(it, ans(it)) }
                post(JSONObject().put("answers", a))
            }
        })
    }

    companion object {
        const val EXTRA_GATE_ID = "gate_id"
        const val EXTRA_NOTIF_ID = "notif_id"
        const val EXTRA_CLICK = "click"
        const val BASE = "https://astra.jitinnair.com"
    }
}
